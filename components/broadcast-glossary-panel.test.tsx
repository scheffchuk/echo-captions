// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConvexError } from "convex/values";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BroadcastGlossaryPanel } from "@/components/broadcast-glossary-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Id } from "@/convex/_generated/dataModel";

if (!Element.prototype.hasPointerCapture) {
	Element.prototype.hasPointerCapture = () => false;
	Element.prototype.releasePointerCapture = () => {};
}

if (!Element.prototype.scrollIntoView) {
	Element.prototype.scrollIntoView = () => {};
}

const mocks = vi.hoisted(() => ({
	updateMappings: vi.fn(),
}));

vi.mock("convex/react", () => ({
	useMutation: () => mocks.updateMappings,
}));

const sessionId = "session-1" as Id<"sessions">;
const revisionId = "revision-1" as Id<"translationMappingRevisions">;
const initialMappings = [
	{ term: "Echo", targetLanguage: "ja", translation: "エコー" },
];

function GlossaryHarness() {
	const [open, setOpen] = useState(true);
	return (
		<TooltipProvider>
			<BroadcastGlossaryPanel
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
	mocks.updateMappings.mockResolvedValue({
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

		await waitFor(() => expect(mocks.updateMappings).toHaveBeenCalledTimes(1));
		expect(mocks.updateMappings).toHaveBeenCalledWith({
			sessionId,
			expectedRevisionId: revisionId,
			translationMappings: [
				{ term: "Echo", targetLanguage: "ja", translation: "エコー Prime" },
			],
		});
	});

	it("asks before discarding draft edits", async () => {
		const user = userEvent.setup();
		render(<GlossaryHarness />);

		await user.click(screen.getByRole("button", { name: "Add mapping" }));
		const terms = screen.getAllByPlaceholderText("e.g. shici");
		await user.type(terms[terms.length - 1] as HTMLElement, "Local");
		await user.click(screen.getByRole("button", { name: "Cancel" }));

		expect(screen.getByText("Discard glossary changes?")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Discard" }));

		await waitFor(() =>
			expect(screen.queryByText("Glossary")).not.toBeInTheDocument(),
		);
	});

	it("keeps the draft after a revision conflict and reloads it explicitly", async () => {
		const user = userEvent.setup();
		mocks.updateMappings.mockRejectedValueOnce(
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
