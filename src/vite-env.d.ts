/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_CONVEX_URL?: string;
	readonly NEXT_PUBLIC_CONVEX_URL?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
