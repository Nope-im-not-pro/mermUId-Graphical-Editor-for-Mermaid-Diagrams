// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {}
	/** V-26: App-Version aus CHANGELOG.md, per `define` in vite.config.ts. */
	const __APP_VERSION__: string;
}

export {};
