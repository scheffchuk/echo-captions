// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConvexError } from "convex/values";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BroadcastGlossaryPanelView } from "@/components/broadcast-glossary-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { testId } from "@/test/ids";

if (!Element.prototype.hasPointerCapture) {
	Element.prototype.hasPointerCapture = () => false;
	Element.prototype.releasePointerCapture = () => {};
}

if (!Element.prototype.scrollIntoView) {
	Element.prototype.scrollIntoView = () => {};
}

const updateMappings = vi.fn();

const sessionId = testId("sessions", "session-1");

const revisionId = testId("translationMappingRevisions", "revision-1");

const initialMappings = [
	{ term: "Echo", targetLanguage: "ja", translation: "エコー" },
];

function GlossaryHarness() {
	const [open, setOpen] = useState(true);

	return (
		<TooltipProvider>
			<BroadcastGlossaryPanelView
				updateTranslationMappings={updateMappings}
				sessionId={sessionId}
				initialMappings={initialMappings}
				initialRevisionId={revisionId}
				audienceCodes={["en", "ja"]}
				trigger="none"
				open={open}
				onOpenChange={setOpen}
			/>
		</TooltipProvider>
	);
}

afterEach(() => {
	cleanup();
});

beforeEach(() => {
	vi.clearAllMocks();
	updateMappings.mockResolvedValue({
		revisionId: "revision-2",
		changed: true,
	});
});

describe("BroadcastGlossaryPanel", () => {
	it("projects the draft without row IDs when saving", async () => {
		const user = userEvent.setup();
		render(<GlossaryHarness />);

		const replacement = screen.getByPlaceholderText("e.g. poetry");
		await user.clear(replacement);
		await user.type(replacement, "  エコー Prime  ");
		await user.click(screen.getByRole("button", { name: "Save glossary" }));

		await waitFor(() => expect(updateMappings).toHaveBeenCalledTimes(1));
		expect(updateMappings).toHaveBeenCalledWith({
			sessionId,
			expectedRevisionId: revisionId,
			translationMappings: [
				{ term: "Echo", targetLanguage: "ja", translation: "エコー Prime" },
			],
		});
	});

	it("shows row feedback and does not persist an incomplete mapping", async () => {
		const user = userEvent.setup();
		render(<GlossaryHarness />);

		await user.click(screen.getByRole("button", { name: "Add mapping" }));
		const terms = screen.getAllByPlaceholderText("e.g. shici");
		const term = terms[terms.length - 1];

		if (!(term instanceof HTMLElement)) {
			throw new Error("Expected a term field");
		}

		await user.type(term, "Local");
		await user.click(screen.getByRole("button", { name: "Save glossary" }));

		expect(
			screen.getByText("Complete this mapping or remove the row."),
		).toBeInTheDocument();
		expect(updateMappings).not.toHaveBeenCalled();
	});

	it("asks before discarding draft edits", async () => {
		const user = userEvent.setup();
		render(<GlossaryHarness />);

		await user.click(screen.getByRole("button", { name: "Add mapping" }));
		const terms = screen.getAllByPlaceholderText("e.g. shici");
		const term = terms[terms.length - 1];

		if (!(term instanceof HTMLElement)) {
			throw new Error("Expected a term field");
		}

		await user.type(term, "Local");
		await user.click(screen.getByRole("button", { name: "Cancel" }));

		expect(screen.getByText("Discard glossary changes?")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Discard" }));

		await waitFor(() =>
			expect(screen.queryByText("Glossary")).not.toBeInTheDocument(),
		);
	});

	it("keeps the draft after a revision conflict and reloads it explicitly", async () => {
		const user = userEvent.setup();
		updateMappings.mockRejectedValueOnce(
			new ConvexError({
				code: "mapping_revision_conflict",
				message: "Glossary changed elsewhere",
			}),
		);
		render(<GlossaryHarness />);

		const replacement = screen.getByPlaceholderText("e.g. poetry");
		await user.clear(replacement);
		await user.type(replacement, "Local change");
		await user.click(screen.getByRole("button", { name: "Save glossary" }));

		await waitFor(() =>
			expect(
				screen.getByText(
					"This glossary changed in another tab. Reload it to continue.",
				),
			).toBeInTheDocument(),
		);
		expect(replacement).toHaveValue("Local change");

		await user.click(screen.getByRole("button", { name: "Reload glossary" }));
		expect(
			screen.queryByText(
				"This glossary changed in another tab. Reload it to continue.",
			),
		).not.toBeInTheDocument();
		expect(screen.getByPlaceholderText("e.g. poetry")).toHaveValue("エコー");
	});
});
