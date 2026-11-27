import "@testing-library/jest-dom/vitest";

class ResizeObserverStub {
	observe() {}
	unobserve() {}
	disconnect() {}
}

if (!globalThis.ResizeObserver) {
	globalThis.ResizeObserver = ResizeObserverStub;
}

if (!globalThis.CSS) {
	Object.defineProperty(globalThis, "CSS", {
		configurable: true,
		value: {
			supports: () => false,
		},
	});
} else if (!globalThis.CSS.supports) {
	globalThis.CSS.supports = () => false;
}

if (globalThis.window && !globalThis.window.matchMedia) {
	Object.defineProperty(globalThis.window, "matchMedia", {
		configurable: true,
		value: (query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		}),
	});
}

if (globalThis.Element && !("getAnimations" in globalThis.Element.prototype)) {
	Object.defineProperty(globalThis.Element.prototype, "getAnimations", {
		configurable: true,
		value: () => [],
	});
}

if (
	globalThis.HTMLElement &&
	!("showPopover" in globalThis.HTMLElement.prototype)
) {
	Object.defineProperty(globalThis.HTMLElement.prototype, "showPopover", {
		configurable: true,
		value(this: HTMLElement) {
			this.style.display = "block";
		},
	});
	Object.defineProperty(globalThis.HTMLElement.prototype, "hidePopover", {
		configurable: true,
		value(this: HTMLElement) {
			this.style.display = "";
		},
	});
}
