// @vitest-environment jsdom
import {
	act,
	cleanup,
	render,
	renderHook,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UsePaginatedQueryResult } from "convex/react";
import { ConvexError } from "convex/values";
import { type ReactNode, StrictMode, useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaptionFeed } from "@/components/caption-feed";
import { OperatorCaptionFeed } from "@/components/operator-caption-feed";
import {
	type CaptionRetry,
	type OperatorCaptionAdapters,
	OperatorCaptionAdaptersProvider,
	type OperatorCommit,
} from "@/hooks/operator-caption-adapters";
import { useSessionOperatorCommits } from "@/hooks/use-session-operator-commits";
import { operatorCommitsToFeedItems } from "@/lib/operator-commit-feed";
import { testId } from "@/test/ids";

afterEach(cleanup);

function RepairArea() {
	const operator = useSessionOperatorCommits(sessionId);
	const items = operatorCommitsToFeedItems(operator.commits);

	return (
		<>
			<section aria-label="Operator">
				<OperatorCaptionFeed
					operator={operator}
					items={items}
					languageCode="en"
				/>
			</section>
			<section aria-label="Audience">
				<CaptionFeed items={items} languageCode="ja" />
			</section>
		</>
	);
}

const sessionId = testId("sessions", "repair-session");

function commit(commitId: string): OperatorCommit {
	return {
		acceptedCommitId: testId("acceptedCommits", commitId),
		commitId,
		sessionId,
		broadcastId: testId("broadcasts", "sealed-broadcast"),
		broadcastSequence: 1,
		commitOrdinal: 1,
		sequence: 1,
		sourceText: "Finished fallback",
		sourceLanguage: "en",
		translationTargets: ["ja"],
		status: "failed",
		targetCount: 1,
		completedTargetCount: 0,
		failedTargetCount: 1,
		translations: {},
		segmentId: testId("segments", commitId),
		segmentStatus: "failed",
	};
}

function deferred<A>() {
	let resolve!: (value: A) => void;
	let reject!: (cause: unknown) => void;

	const promise = new Promise<A>((res, rej) => {
		resolve = res;
		reject = rej;
	});

	return { promise, resolve, reject };
}

function fixture(initial = [commit("caption-1")]) {
	const loadMore = vi.fn();

	let page: UsePaginatedQueryResult<OperatorCommit> = {
		results: initial,
		status: "CanLoadMore",
		isLoading: false,
		loadMore,
	};

	const listeners = new Set<() => void>();
	const retry = vi.fn<CaptionRetry>();

	const adapters: OperatorCaptionAdapters = {
		useCommits: () =>
			useSyncExternalStore(
				(listener) => {
					listeners.add(listener);

					return () => {
						listeners.delete(listener);
					};
				},
				() => page,
			),
		useRetry: () => retry,
	};

	const Wrapper = ({ children }: { children: ReactNode }) => (
		<StrictMode>
			<OperatorCaptionAdaptersProvider adapters={adapters}>
				{children}
			</OperatorCaptionAdaptersProvider>
		</StrictMode>
	);

	return {
		retry,
		Wrapper,
		update: (results: OperatorCommit[]) => {
			page = { ...page, results };

			for (const listener of listeners) listener();
		},
		loadMore,
		setPage: (next: UsePaginatedQueryResult<OperatorCommit>) => {
			page = next;

			for (const listener of listeners) listener();
		},
	};
}

describe("Operator caption repairs", () => {
	it("loads repairable older captions without moving the reader from the existing caption", async () => {
		const newer = { ...commit("newer"), sourceText: "Newer fallback" };
		const f = fixture([newer]);
		const view = render(<RepairArea />, { wrapper: f.Wrapper });
		const operatorSection = view.getByRole("region", { name: "Operator" });
		const operator = within(operatorSection);
		const scroll = operatorSection.querySelector(".overflow-y-auto");

		if (!(scroll instanceof HTMLElement))
			throw new Error("Expected caption scroll surface");
		let height = 1000;
		Object.defineProperty(scroll, "scrollHeight", {
			configurable: true,
			get: () => height,
		});
		Object.defineProperty(scroll, "clientHeight", {
			configurable: true,
			value: 200,
		});
		scroll.scrollTop = 200;
		scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
		await userEvent
			.setup()
			.click(operator.getByRole("button", { name: "Load older captions" }));
		expect(f.loadMore).toHaveBeenCalledExactlyOnceWith(100);
		act(() =>
			f.setPage({
				results: [newer],
				status: "LoadingMore",
				isLoading: true,
				loadMore: f.loadMore,
			}),
		);
		expect(
			operator.getByRole("button", { name: "Load older captions" }),
		).toBeDisabled();
		height = 1600;
		act(() =>
			f.setPage({
				results: [newer, { ...commit("older"), sourceText: "Older fallback" }],
				status: "Exhausted",
				isLoading: false,
				loadMore: f.loadMore,
			}),
		);
		expect(scroll.scrollTop).toBe(800);
		expect(
			operator.queryByRole("button", { name: "Load older captions" }),
		).not.toBeInTheDocument();

		const repairButtons = operator.getAllByRole("button", {
			name: "Retry caption",
		});

		await userEvent.setup().click(repairButtons[0]);
		expect(f.retry).toHaveBeenCalledExactlyOnceWith({
			acceptedCommitId: testId("acceptedCommits", "older"),
		});
	});

	it("repairs a caption in place with Operator-only progress and retained audience fallback", async () => {
		const f = fixture();
		const admission = deferred<Awaited<ReturnType<CaptionRetry>>>();
		f.retry.mockImplementation(() => admission.promise);
		const view = render(<RepairArea />, { wrapper: f.Wrapper });
		const operator = within(view.getByRole("region", { name: "Operator" }));
		const audience = within(view.getByRole("region", { name: "Audience" }));
		expect(
			audience.queryByRole("button", { name: "Retry caption" }),
		).not.toBeInTheDocument();
		await userEvent
			.setup()
			.click(operator.getByRole("button", { name: "Retry caption" }));
		expect(operator.getByText("Retrying…")).toBeInTheDocument();
		expect(operator.getByText("Finished fallback")).toBeInTheDocument();
		expect(audience.getByText("Finished fallback")).toBeInTheDocument();
		expect(audience.queryByText("Retrying…")).not.toBeInTheDocument();
		await act(async () => {
			f.update([{ ...commit("caption-1"), status: "pending" }]);
			admission.resolve({
				acceptedCommitId: testId("acceptedCommits", "caption-1"),
				commitId: "caption-1",
				status: "pending",
				sequence: 1,
				targetCount: 1,
				completedTargetCount: 0,
				failedTargetCount: 0,
				segmentId: testId("segments", "caption-1"),
			});
		});
		act(() =>
			f.update([
				{
					...commit("caption-1"),
					status: "translated",
					segmentStatus: "translated",
					translations: { ja: "Repaired translation" },
				},
			]),
		);
		expect(
			operator.queryByRole("button", { name: "Retry caption" }),
		).not.toBeInTheDocument();
		expect(audience.getByText("Repaired translation")).toBeInTheDocument();
	});

	it("loads older captions in bounded pages and keeps them in caption order", async () => {
		const f = fixture([commit("newer")]);

		const { result } = renderHook(() => useSessionOperatorCommits(sessionId), {
			wrapper: f.Wrapper,
		});

		act(() => result.current.loadOlder());
		expect(f.loadMore).toHaveBeenCalledExactlyOnceWith(100);
		act(() =>
			f.setPage({
				results: [commit("newer")],
				status: "LoadingMore",
				isLoading: true,
				loadMore: f.loadMore,
			}),
		);
		expect(result.current.loadingOlder).toBe(true);
		expect(result.current.canLoadOlder).toBe(false);
		act(() => result.current.loadOlder());
		expect(f.loadMore).toHaveBeenCalledTimes(1);
		act(() =>
			f.setPage({
				results: [commit("newer"), commit("older")],
				status: "Exhausted",
				isLoading: false,
				loadMore: f.loadMore,
			}),
		);
		expect(result.current.commits.map((item) => item.commitId)).toEqual([
			"older",
			"newer",
		]);
		expect(result.current.canLoadOlder).toBe(false);
		act(() => result.current.loadOlder());
		expect(f.loadMore).toHaveBeenCalledTimes(1);
	});

	it("propagates unknown transport defects even without an error presenter", async () => {
		const f = fixture();
		const defect = new Error("Transport defect");
		f.retry.mockRejectedValue(defect);

		const { result } = renderHook(() => useSessionOperatorCommits(sessionId), {
			wrapper: f.Wrapper,
		});

		await act(async () => {
			await expect(result.current.retry("caption-1")).rejects.toBe(defect);
		});
		expect(result.current.isRetrying("caption-1")).toBe(false);
	});

	it("presents an admission rejection once and leaves another caption's repair running", async () => {
		const f = fixture([commit("caption-2"), commit("caption-1")]);
		const admission = deferred<Awaited<ReturnType<CaptionRetry>>>();
		f.retry
			.mockImplementationOnce(() => admission.promise)
			.mockRejectedValueOnce(
				new ConvexError({
					code: "session_deleting",
					message: "Session is being deleted",
				}),
			);
		const onError = vi.fn();

		const { result } = renderHook(
			() => useSessionOperatorCommits(sessionId, onError),
			{ wrapper: f.Wrapper },
		);

		let repairing!: Promise<void>;
		act(() => {
			repairing = result.current.retry("caption-1");
		});
		await act(async () => {
			await result.current.retry("caption-2");
		});
		expect(onError).toHaveBeenCalledExactlyOnceWith("Session is being deleted");
		expect(result.current.isRetrying("caption-1")).toBe(true);
		expect(result.current.isRetrying("caption-2")).toBe(false);
		await act(async () => {
			admission.reject(new ConvexError({ message: "Repair unavailable" }));
			await repairing;
		});
		expect(onError).toHaveBeenCalledTimes(2);
	});

	it("admits a repair once and immediately disables only that caption", async () => {
		const f = fixture([commit("caption-2"), commit("caption-1")]);
		const admission = deferred<Awaited<ReturnType<CaptionRetry>>>();
		f.retry.mockImplementation(() => admission.promise);

		const { result } = renderHook(() => useSessionOperatorCommits(sessionId), {
			wrapper: f.Wrapper,
		});

		let repairing!: Promise<void>;
		act(() => {
			repairing = result.current.retry("caption-1");
		});
		expect(result.current.isRetrying("caption-1")).toBe(true);
		expect(result.current.isRetrying("caption-2")).toBe(false);
		await act(async () => {
			await result.current.retry("caption-1");
		});
		expect(f.retry).toHaveBeenCalledExactlyOnceWith({
			acceptedCommitId: testId("acceptedCommits", "caption-1"),
		});
		await act(async () => {
			f.update([
				{ ...commit("caption-1"), status: "pending" },
				commit("caption-2"),
			]);
			admission.resolve({
				acceptedCommitId: testId("acceptedCommits", "caption-1"),
				commitId: "caption-1",
				status: "pending",
				sequence: 1,
				targetCount: 1,
				completedTargetCount: 0,
				failedTargetCount: 0,
				segmentId: testId("segments", "caption-1"),
			});
			await repairing;
		});
		expect(result.current.isRetrying("caption-1")).toBe(true);
		act(() => f.update([commit("caption-1"), commit("caption-2")]));
		expect(result.current.isRetrying("caption-1")).toBe(false);
	});
});
