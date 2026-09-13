import "@testing-library/jest-dom/vitest";

class ResizeObserverStub {
	observe() {}
	unobserve() {}
	disconnect() {}
}

if (!globalThis.ResizeObserver) {
	globalThis.ResizeObserver = ResizeObserverStub;
}
