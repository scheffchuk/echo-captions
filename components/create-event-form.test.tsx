// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateEventFormView } from "@/components/create-event-form";
import { TooltipProvider } from "@/components/ui/tooltip";

if (!Element.prototype.hasPointerCapture) {
	Element.prototype.hasPointerCapture = () => false;
	Element.prototype.releasePointerCapture = () => {};
}

if (!Element.prototype.scrollIntoView) {
	Element.prototype.scrollIntoView = () => {};
}

const createSession = vi.fn();

const onCreated = vi.fn();

afterEach(() => {
	cleanup();
});

beforeEach(() => {
	vi.clearAllMocks();
	createSession.mockResolvedValue({ slug: "session-123" });
});

async function openForm() {
	const user = userEvent.setup();
	render(
		<TooltipProvider>
			<CreateEventFormView
				createSession={createSession}
				onCreated={onCreated}
			/>
		</TooltipProvider>,
	);
	await user.click(screen.getByRole("button", { name: "New event" }));

	return user;
}

async function goToLanguages(user: ReturnType<typeof userEvent.setup>) {
	await user.type(
		screen.getByRole("textbox", { name: "Event Name" }),
		"  The Night Library  ",
	);
	await user.click(screen.getByRole("button", { name: "Next" }));
	await waitFor(() =>
		expect(screen.getByText("Languages")).toBeInTheDocument(),
	);
}

describe("CreateEventForm", () => {
	it("prevents leaving the details step until the event name is valid", async () => {
		const user = await openForm();

		await user.click(screen.getByRole("button", { name: "Next" }));

		expect(screen.getByText("Event name is required")).toBeInTheDocument();
		expect(screen.getByText("Event details")).toBeInTheDocument();
	});

	it("validates spoken languages before allowing creation", async () => {
		const user = await openForm();
		await goToLanguages(user);

		await user.click(screen.getByRole("button", { name: "Remove English" }));
		await user.click(screen.getByRole("button", { name: "Create event" }));

		expect(
			screen.getByText("Add at least one spoken language"),
		).toBeInTheDocument();
		expect(createSession).not.toHaveBeenCalled();
	});

	it("submits normalized event details, audience languages, and mappings", async () => {
		const user = await openForm();
		await user.clear(screen.getByRole("textbox", { name: "Event Name" }));
		await user.type(
			screen.getByRole("textbox", { name: "Event Name" }),
			"  The Night Library  ",
		);
		await user.type(
			screen.getByRole("textbox", { name: "Event Description" }),
			"  A reading  ",
		);
		await user.click(screen.getByRole("button", { name: "Event Date" }));

		const dateButton = screen
			.getAllByRole("button")
			.find((button) => button.hasAttribute("data-day"));

		if (!(dateButton instanceof HTMLElement)) {
			throw new Error("Expected a date button");
		}

		await user.click(dateButton);
		await user.click(screen.getByRole("button", { name: "Next" }));
		await waitFor(() =>
			expect(screen.getByText("Languages")).toBeInTheDocument(),
		);

		await user.click(
			screen.getByRole("button", { name: "Add another audience language" }),
		);
		await user.click(screen.getByRole("button", { name: /Japanese/ }));
		await user.click(screen.getByRole("button", { name: "Add mapping" }));
		await user.type(screen.getByPlaceholderText("e.g. shici"), "  Echo  ");
		await user.click(screen.getByRole("combobox"));
		await user.click(screen.getByRole("option", { name: "Japanese" }));
		await waitFor(() =>
			expect(screen.getByRole("combobox")).toHaveTextContent("Japanese"),
		);
		await user.type(screen.getByPlaceholderText("e.g. poetry"), "  エコー  ");

		await user.click(screen.getByRole("button", { name: "Create event" }));

		await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
		expect(createSession).toHaveBeenCalledWith({
			title: "The Night Library",
			description: "A reading",
			eventDate: expect.any(Number),
			spokenLanguages: ["en"],
			audienceLanguagesExtra: ["ja"],
			translationMappings: [
				{ term: "Echo", targetLanguage: "ja", translation: "エコー" },
			],
		});
		await waitFor(() => expect(onCreated).toHaveBeenCalledWith("session-123"));
		await user.click(screen.getByRole("button", { name: "New event" }));
		expect(screen.getByText("Event details")).toBeInTheDocument();
		expect(screen.getByRole("textbox", { name: "Event Name" })).toHaveValue("");
	});

	it("rejects a partially filled mapping instead of silently dropping it", async () => {
		const user = await openForm();
		await goToLanguages(user);
		await user.click(screen.getByRole("button", { name: "Add mapping" }));
		await user.type(screen.getByPlaceholderText("e.g. shici"), "Echo");
		await user.click(screen.getByRole("button", { name: "Create event" }));

		expect(
			screen.getByText("Complete this mapping or remove the row."),
		).toBeInTheDocument();
		expect(createSession).not.toHaveBeenCalled();
	});

	it("preserves the untitled fallback for a whitespace-only event name", async () => {
		const user = await openForm();
		await user.type(screen.getByRole("textbox", { name: "Event Name" }), "   ");
		await user.click(screen.getByRole("button", { name: "Next" }));
		await waitFor(() =>
			expect(screen.getByText("Languages")).toBeInTheDocument(),
		);
		await user.click(screen.getByRole("button", { name: "Create event" }));

		await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
		expect(createSession).toHaveBeenCalledWith(
			expect.objectContaining({ title: "Untitled" }),
		);
	});

	it("keeps the entered values visible after a server rejection", async () => {
		createSession.mockRejectedValueOnce(
			new ConvexError("Slug service unavailable"),
		);
		const user = await openForm();
		await goToLanguages(user);

		await user.click(screen.getByRole("button", { name: "Create event" }));

		await waitFor(() =>
			expect(screen.getByText("Slug service unavailable")).toBeInTheDocument(),
		);
		await user.click(screen.getByRole("button", { name: "Back" }));
		expect(screen.getByRole("textbox", { name: "Event Name" })).toHaveValue(
			"  The Night Library  ",
		);
	});

	it("uses form submission state to ignore a duplicate create action", async () => {
		let resolveCreate!: (value: { slug: string }) => void;
		createSession.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveCreate = resolve;
			}),
		);
		const user = await openForm();
		await goToLanguages(user);

		const createButton = screen.getByRole("button", { name: "Create event" });
		await user.click(createButton);
		await waitFor(() => expect(createButton).toBeDisabled());
		await user.click(createButton);

		expect(createSession).toHaveBeenCalledTimes(1);
		resolveCreate({ slug: "session-123" });
	});

	it("resets on close and opens a clean wizard when reopened", async () => {
		const user = await openForm();
		await user.type(
			screen.getByRole("textbox", { name: "Event Name" }),
			"Draft event",
		);
		await user.click(screen.getByRole("button", { name: "Close" }));
		await user.click(screen.getByRole("button", { name: "New event" }));

		expect(screen.getByText("Event details")).toBeInTheDocument();
		expect(screen.getByRole("textbox", { name: "Event Name" })).toHaveValue("");
	});

	it("closes the wizard and reports the created slug", async () => {
		const user = await openForm();
		await goToLanguages(user);
		await user.click(screen.getByRole("button", { name: "Create event" }));

		await waitFor(() => expect(onCreated).toHaveBeenCalledWith("session-123"));
		await waitFor(() =>
			expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
		);
	});
});
