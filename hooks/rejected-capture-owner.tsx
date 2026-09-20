import { createContext, type ReactNode, useContext, useState } from "react";
import {
	createRejectedCaptureOwner,
	type RejectedCaptureOwner,
} from "@/hooks/broadcast-capture";

const RejectedCaptureOwnerContext = createContext<RejectedCaptureOwner | null>(
	null,
);

export function RejectedCaptureOwnerProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [owner] = useState(createRejectedCaptureOwner);

	return (
		<RejectedCaptureOwnerContext.Provider value={owner}>
			{children}
		</RejectedCaptureOwnerContext.Provider>
	);
}

export function useRejectedCaptureOwner(): RejectedCaptureOwner {
	const owner = useContext(RejectedCaptureOwnerContext);
	if (!owner) {
		throw new Error(
			"useRejectedCaptureOwner must be used within RejectedCaptureOwnerProvider",
		);
	}
	return owner;
}
