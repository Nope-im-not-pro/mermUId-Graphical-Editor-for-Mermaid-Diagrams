import { describe, expect, it } from 'vitest';
import { MERMAID_THEMES, blocksTheme } from '../../../../src/lib/services/security';

describe('MERMAID_THEMES (F-09)', () => {
	it('Allow-Liste auf T06-Stand, ohne neo/redux (O-13, O-167)', () => {
		expect(MERMAID_THEMES).toEqual(['default', 'neutral', 'dark', 'forest', 'base']);
	});
});

describe('blocksTheme (mermaid.parse-Ergebnis, O-174)', () => {
	const parsed = (config: unknown) => ({ diagramType: 'flowchart-v2', config });

	it('kein Theme oder Allow-Listen-Wert: nicht gesperrt', () => {
		expect(blocksTheme(parsed({}))).toBe(false);
		expect(blocksTheme(parsed({ themeVariables: { primaryColor: '#ff0000' } }))).toBe(false);
		for (const theme of MERMAID_THEMES) expect(blocksTheme(parsed({ theme })), theme).toBe(false);
	});

	it('andere Werte gesperrt: neo/redux, Schreibvarianten, Nicht-Strings', () => {
		for (const theme of ['neo', 'redux', 'dark redux', 'dark,redux', 'Dark', '', 5, null, [], {}]) {
			expect(blocksTheme(parsed({ theme })), JSON.stringify(theme)).toBe(true);
		}
		expect(blocksTheme(parsed({ theme: undefined }))).toBe(true);
	});

	it('unklares Ergebnis gesperrt (fail-closed)', () => {
		for (const value of [false, undefined, null, 'x', [], {}, parsed(null), parsed([])]) {
			expect(blocksTheme(value), JSON.stringify(value)).toBe(true);
		}
	});
});
