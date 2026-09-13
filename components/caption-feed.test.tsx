// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CaptionFeed } from "@/components/caption-feed";
import type { CaptionFeedItem } from "@/lib/caption-feed-items";
import type { CaptionSegment } from "@/lib/segment-display";

afterEach(() => {
	cleanup();
});

function segment(
	sourceText: string,
	overrides: Partial<CaptionSegment> = {},
): CaptionSegment {
	return {
		sourceText,
		sourceLanguage: "en",
		translations: {},
		status: "translated",
		...overrides,
	};
}

function item(id: string, sourceText: string): CaptionFeedItem {
	return { id, segment: segment(sourceText) };
}

function getScrollContainer(container: HTMLElement): HTMLElement {
	const node = container.querySelector(".overflow-y-auto");
	if (!(node instanceof HTMLElement)) {
		throw new Error("scroll container not found");
	}
	return node;
}

function mockOverflow(
	el: HTMLElement,
	metrics: { scrollHeight: number; clientHeight: number; scrollTop?: number },
) {
	let scrollHeight = metrics.scrollHeight;
	Object.defineProperty(el, "scrollHeight", {
		configurable: true,
		get: () => scrollHeight,
	});
	Object.defineProperty(el, "clientHeight", {
		configurable: true,
		get: () => metrics.clientHeight,
	});
	if (metrics.scrollTop !== undefined) {
		el.scrollTop = metrics.scrollTop;
	}
	return {
		setScrollHeight(next: number) {
			scrollHeight = next;
		},
	};
}

function Harness({
	initialItems,
	initialPartial = "",
}: {
	initialItems: CaptionFeedItem[];
	initialPartial?: string;
}) {
	const [items, setItems] = useState(initialItems);
	const [partialText, setPartialText] = useState(initialPartial);

	return (
		<div>
			<button
				type="button"
				onClick={() => setPartialText((text) => `${text} more words`)}
			>
				grow-partial
			</button>
			<button
				type="button"
				onClick={() =>
					setItems((prev) => [
						...prev,
						item(`seg-${prev.length + 1}`, `Line ${prev.length + 1}`),
					])
				}
			>
				add-line
			</button>
			<div style={{ height: 200 }}>
				<CaptionFeed
					items={items}
					languageCode="en"
					partialText={partialText}
					showPartial
				/>
			</div>
		</div>
	);
}

describe("CaptionFeed auto-scroll", () => {
	it("scrolls to bottom when partialText grows while committed lines exist", async () => {
		const user = userEvent.setup();
		const view = render(
			<Harness
				initialItems={[item("seg-1", "Committed line")]}
				initialPartial="partial"
			/>,
		);
		const root = within(view.container);

		const scroll = getScrollContainer(view.container);
		const overflow = mockOverflow(scroll, {
			scrollHeight: 300,
			clientHeight: 120,
			scrollTop: 180,
		});

		overflow.setScrollHeight(480);
		await user.click(root.getByRole("button", { name: "grow-partial" }));

		await waitFor(() => {
			expect(scroll.scrollTop).toBe(480);
		});
	});

	it("scrolls to bottom when a new committed line is appended", async () => {
		const user = userEvent.setup();
		const view = render(<Harness initialItems={[item("seg-1", "First")]} />);
		const root = within(view.container);

		const scroll = getScrollContainer(view.container);
		const overflow = mockOverflow(scroll, {
			scrollHeight: 250,
			clientHeight: 120,
			scrollTop: 130,
		});

		overflow.setScrollHeight(400);
		await user.click(root.getByRole("button", { name: "add-line" }));

		await waitFor(() => {
			expect(scroll.scrollTop).toBe(400);
		});
	});

	it("does not auto-scroll after the user scrolls away from the bottom", async () => {
		const user = userEvent.setup();
		const view = render(
			<Harness
				initialItems={[item("seg-1", "Committed line")]}
				initialPartial="partial"
			/>,
		);
		const root = within(view.container);

		const scroll = getScrollContainer(view.container);
		const overflow = mockOverflow(scroll, {
			scrollHeight: 400,
			clientHeight: 120,
			scrollTop: 280,
		});

		scroll.scrollTop = 0;
		fireEvent.scroll(scroll);

		expect(
			root.getByRole("button", { name: "Jump to latest" }),
		).toBeInTheDocument();

		overflow.setScrollHeight(520);
		await user.click(root.getByRole("button", { name: "grow-partial" }));

		await waitFor(() => {
			expect(scroll.scrollTop).toBe(0);
		});
	});

	it("jump to latest re-pins and resumes following partialText", async () => {
		const user = userEvent.setup();
		const view = render(
			<Harness
				initialItems={[item("seg-1", "Committed line")]}
				initialPartial="partial"
			/>,
		);
		const root = within(view.container);

		const scroll = getScrollContainer(view.container);
		const overflow = mockOverflow(scroll, {
			scrollHeight: 400,
			clientHeight: 120,
			scrollTop: 280,
		});

		scroll.scrollTop = 0;
		fireEvent.scroll(scroll);

		overflow.setScrollHeight(400);
		await user.click(root.getByRole("button", { name: "Jump to latest" }));

		await waitFor(() => {
			expect(scroll.scrollTop).toBe(400);
		});

		overflow.setScrollHeight(560);
		await user.click(root.getByRole("button", { name: "grow-partial" }));

		await waitFor(() => {
			expect(scroll.scrollTop).toBe(560);
		});
	});
});
