export function getViewerUrl(slug: string) {
	if (typeof window === "undefined") {
		return `/view/${slug}`;
	}

	return `${window.location.origin}/view/${slug}`;
}
