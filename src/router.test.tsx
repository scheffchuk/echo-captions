// @vitest-environment jsdom

import { RegistryProvider, useAtom } from "@effect/atom-react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as Atom from "effect/unstable/reactivity/Atom";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { getRouter } from "@/src/router";

const memory = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
	configurable: true,
	value: {
		get length() {
			return memory.size;
		},
		clear: () => memory.clear(),
		getItem: (key: string) => memory.get(key) ?? null,
		key: (index: number) => [...memory.keys()][index] ?? null,
		removeItem: (key: string) => memory.delete(key),
		setItem: (key: string, value: string) => memory.set(key, value),
	},
});

afterEach(() => {
	memory.clear();
	cleanup();
});

const counterAtom = Atom.make(0);

function Counter({ label }: { label: string }) {
	const [value, setValue] = useAtom(counterAtom);
	return (
		<button type="button" onClick={() => setValue(value + 1)}>
			{label}: {value}
		</button>
	);
}

describe("router Effect registry", () => {
	it("isolates each application tree while surviving Strict Mode", async () => {
		const router = getRouter();
		const Wrap = router.options.Wrap;
		if (!Wrap) throw new Error("Router wrapper is not configured");

		const user = userEvent.setup();
		render(
			<StrictMode>
				<Wrap>
					<Counter label="first" />
				</Wrap>
				<Wrap>
					<Counter label="second" />
				</Wrap>
			</StrictMode>,
		);

		await user.click(screen.getByRole("button", { name: "first: 0" }));

		expect(
			screen.getByRole("button", { name: "first: 1" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "second: 0" }),
		).toBeInTheDocument();
	});

	it("keeps the router wrapper backed by RegistryProvider", () => {
		const router = getRouter();
		const Wrap = router.options.Wrap;
		if (!Wrap) throw new Error("Router wrapper is not configured");

		const element = Wrap({ children: null });
		expect(element.type).toBe(RegistryProvider);
	});
});
