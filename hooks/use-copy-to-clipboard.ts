import { ConvexError } from "convex/values";
import { useState } from "react";
import { toast } from "sonner";
import {
	getClipboardErrorMessage,
	getPublicConvexError,
} from "@/lib/expected-errors";

export function useCopyToClipboard() {
	const [state, setState] = useState<"idle" | "copying" | "copied">("idle");

	const copy = async (
		readText: () => string | Promise<string>,
		successMessage: string,
		failureMessage: string,
	) => {
		setState("copying");

		try {
			await navigator.clipboard.writeText(await readText());
		} catch (error) {
			setState("idle");
			toast.error(
				error instanceof ConvexError
					? getPublicConvexError(error, failureMessage).message
					: getClipboardErrorMessage(error, failureMessage),
			);

			return;
		}

		setState("copied");
		toast.success(successMessage);
		setTimeout(() => setState("idle"), 2000);
	};

	return { state, copy };
}
