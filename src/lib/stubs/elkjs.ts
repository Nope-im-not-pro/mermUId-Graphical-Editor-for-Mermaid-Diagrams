// N-01: Ersatz für elkjs (EPL-2.0). vite.config.ts leitet jeden elkjs-Import hierher um.
// Mermaid nur über den Export-Einstieg `mermaid` (= dist/mermaid.core.mjs) importieren,
// nie dist/mermaid.esm.mjs: dieser bettet elk.bundled.js direkt ein.
export default class ELK {
	layout(): never {
		throw new Error('ELK disabled (N-01): nur Layout "dagre" ist zulässig.');
	}
}
