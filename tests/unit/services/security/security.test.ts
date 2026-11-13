// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
	APP_CONFIG_ALLOW_LIST,
	MERMAID_SECURE_KEYS,
	filterMermaidConfig,
	isAllowedLinkScheme,
	sanitizeLabel
} from '../../../../src/lib/services/security';
import fixture from '../../../fixtures/security/xss-labels.json';

type XssCase = { id: string; input: string; init?: Record<string, unknown> };

const cases: XssCase[] = fixture;

describe('xss-labels.json', () => {
	it('enthält genau 8 Fälle', () => {
		expect(cases).toHaveLength(8);
	});

	it.each(cases)('$id liefert Text ohne < und ohne javascript:', ({ input }) => {
		const out = sanitizeLabel(input);
		expect(out).not.toContain('<');
		expect(out.toLowerCase()).not.toContain('javascript:');
	});

	it.each(cases.filter((c) => c.init))('$id: init wird auf strict gezwungen', ({ init }) => {
		const out = filterMermaidConfig(init);
		expect(out.securityLevel).toBe('strict');
		expect(out.startOnLoad).toBe(false);
		expect(out.theme).toBe('dark');
	});
});

describe('sanitizeLabel', () => {
	it('behält reinen Text', () => {
		expect(sanitizeLabel('Kunde prüft')).toBe('Kunde prüft');
	});

	it('entfernt Tags, behält Inhalt', () => {
		expect(sanitizeLabel('<b class="x">fett</b> und <i>kursiv</i>')).toBe('fett und kursiv');
	});

	it('liefert decodierten Text statt Entities', () => {
		expect(sanitizeLabel('a &amp; b')).toBe('a & b');
	});

	it.each([6, 7, 8])('liefert leeren Text bei %i-fach kodierter Payload', (fach) => {
		let payload = '<img src=x onerror="alert(1)">Text';
		for (let i = 0; i < fach; i++)
			payload = payload.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
		const out = sanitizeLabel(payload);
		expect(out).not.toContain('<');
		expect(out).toBe('');
	});
});

describe('isAllowedLinkScheme', () => {
	it.each([
		'https://example.org/x?a=1&b=2',
		'http://example.org',
		'HTTPS://EXAMPLE.ORG',
		'  https://example.org'
	])('erlaubt %s', (url) => {
		expect(isAllowedLinkScheme(url)).toBe(true);
	});

	it.each([
		'javascript:alert(1)',
		'JaVaScRiPt:alert(1)',
		' \u0000\t\njavascript:alert(1)',
		'java\tscript:alert(1)',
		'&#106;avascript:alert(1)',
		'jav&#x61;script:alert(1)',
		'data:text/html,<script>alert(1)</script>',
		'vbscript:msgbox(1)',
		'file:///etc/passwd',
		'ftp://example.org',
		'mailto:a@b.de',
		'/relativ/pfad',
		'example.org',
		'//example.org',
		'',
		'http//kaputt'
	])('verweigert %j', (url) => {
		expect(isAllowedLinkScheme(url)).toBe(false);
	});
});

/** Zusätzlich zu `MERMAID_SECURE_KEYS` gesperrt (Reihenfolge wie in `filterMermaidConfig`). */
const APP_SECURE_KEYS = ['layout', 'htmlLabels', 'themeCSS', 'fontFamily', 'altFontFamily'];

describe('filterMermaidConfig', () => {
	it('Allow-Liste schneidet die secure-Liste nicht', () => {
		for (const key of APP_CONFIG_ALLOW_LIST) {
			expect(MERMAID_SECURE_KEYS).not.toContain(key);
		}
	});

	it('Ausgabe-Schlüssel folgen den Konstanten', () => {
		const out = filterMermaidConfig({
			theme: 'dark',
			flowchart: { curve: 'basis' },
			sequence: { wrap: true },
			secure: [],
			startOnLoad: true,
			layout: 'elk'
		});
		const enforced = [
			'securityLevel',
			'startOnLoad',
			'htmlLabels',
			'maxEdges',
			'maxTextSize',
			'layout',
			'secure'
		];
		const userKeys = Object.keys(out).filter((key) => !enforced.includes(key));
		expect(userKeys.sort()).toEqual([...APP_CONFIG_ALLOW_LIST].sort());
		for (const key of MERMAID_SECURE_KEYS) {
			expect(out.secure).toContain(key);
			if (!enforced.includes(key)) expect(out).not.toHaveProperty(key);
		}
	});

	it.each([{}, { layout: 'elk' }])('erzwingt layout dagre und sperrt layout (%j)', (init) => {
		const out = filterMermaidConfig(init);
		expect(out.layout).toBe('dagre');
		expect(out.secure).toEqual([...MERMAID_SECURE_KEYS, ...APP_SECURE_KEYS]);
	});

	it('sperrt htmlLabels, themeCSS, fontFamily, altFontFamily ohne Duplikate', () => {
		const { secure } = filterMermaidConfig({ secure: ['themeCSS', 'layout'] });
		expect(secure).toEqual(expect.arrayContaining([...MERMAID_SECURE_KEYS, ...APP_SECURE_KEYS]));
		expect(new Set(secure as string[]).size).toBe((secure as string[]).length);
	});

	it('setzt startOnLoad false und übernimmt startOnLoad, themeCSS, fontFamily nicht', () => {
		const out = filterMermaidConfig({
			startOnLoad: true,
			themeCSS: '* { background: url(https://evil.example/x) }',
			fontFamily: 'x; background: url(https://evil.example/y)',
			altFontFamily: 'evil'
		});
		expect(out.startOnLoad).toBe(false);
		expect(out).not.toHaveProperty('themeCSS');
		expect(out).not.toHaveProperty('fontFamily');
		expect(out).not.toHaveProperty('altFontFamily');
	});

	it('verwirft unbekannte Enum-Werte für curve und messageAlign', () => {
		const out = filterMermaidConfig({
			flowchart: { curve: 'evil' },
			sequence: { messageAlign: 'justify' }
		});
		expect(out.flowchart).toEqual({ htmlLabels: false });
		expect(out.sequence).toEqual({});
	});

	it('behält gültige Enum-Werte und Zahlen', () => {
		const out = filterMermaidConfig({
			flowchart: { curve: 'rounded', nodeSpacing: 50, rankSpacing: 0, padding: 15 },
			sequence: { messageAlign: 'left', actorMargin: 50 }
		});
		expect(out.flowchart).toEqual({
			htmlLabels: false,
			curve: 'rounded',
			nodeSpacing: 50,
			rankSpacing: 0,
			padding: 15
		});
		expect(out.sequence).toEqual({ messageAlign: 'left', actorMargin: 50 });
	});

	it.each([NaN, Infinity, -Infinity, -1, 1e6])('verwirft Zahl %d außerhalb des Bereichs', (n) => {
		const out = filterMermaidConfig({
			flowchart: { nodeSpacing: n, rankSpacing: n, padding: n },
			sequence: { actorMargin: n }
		});
		expect(out.flowchart).toEqual({ htmlLabels: false });
		expect(out.sequence).toEqual({});
	});

	it('erzwingt Sicherheitswerte und Limits', () => {
		const out = filterMermaidConfig({
			securityLevel: 'loose',
			htmlLabels: true,
			maxEdges: 99999,
			maxTextSize: 1e9,
			flowchart: { htmlLabels: true, curve: 'basis' }
		});
		expect(out.securityLevel).toBe('strict');
		expect(out.htmlLabels).toBe(false);
		expect(out.maxEdges).toBe(1000);
		expect(out.maxTextSize).toBe(200000);
		expect(out.flowchart).toEqual({ htmlLabels: false, curve: 'basis' });
	});

	it('entfernt secure-Schlüssel und Unbekanntes', () => {
		const out = filterMermaidConfig({
			secure: [],
			startOnLoad: true,
			suppressErrorRendering: true,
			themeVariables: { fontFamily: 'x;}</style><script>' },
			themeCSS: '* { background: url(javascript:alert(1)) }',
			layout: 'elk',
			dompurifyConfig: { ALLOWED_TAGS: ['script'] },
			sequence: { mirrorActors: false, actorFontFamily: 'evil' }
		});
		expect(Object.keys(out).sort()).toEqual(
			[
				'flowchart',
				'htmlLabels',
				'layout',
				'maxEdges',
				'maxTextSize',
				'secure',
				'securityLevel',
				'sequence',
				'startOnLoad'
			].sort()
		);
		expect(out.sequence).toEqual({ mirrorActors: false });
	});

	it('ignoriert ungültige Eingaben', () => {
		for (const init of [null, undefined, 'x', 42, ['theme']]) {
			const out = filterMermaidConfig(init);
			expect(out.securityLevel).toBe('strict');
			expect(out).not.toHaveProperty('theme');
		}
	});

	it('verwirft Werte falschen Typs', () => {
		const out = filterMermaidConfig({
			theme: { evil: 1 },
			flowchart: 'x',
			sequence: { wrap: 'ja' }
		});
		expect(out).not.toHaveProperty('theme');
		expect(out.flowchart).toEqual({ htmlLabels: false });
		expect(out.sequence).toEqual({});
	});

	it('lässt Eingabe unverändert', () => {
		const init = { securityLevel: 'loose', theme: 'forest', flowchart: { htmlLabels: true } };
		const copy = structuredClone(init);
		const out = filterMermaidConfig(init);
		expect(init).toEqual(copy);
		expect(out.flowchart).not.toBe(init.flowchart);
	});

	it('keine Prototype-Pollution über __proto__ und constructor', () => {
		const init = JSON.parse(
			'{"__proto__":{"polluted":"ja","theme":"dark"},"constructor":{"prototype":{"polluted":"ja"}},"flowchart":{"__proto__":{"polluted":"ja"}}}'
		);
		const out = filterMermaidConfig(init) as Record<string, unknown>;
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		expect(Object.prototype).not.toHaveProperty('polluted');
		expect(out).not.toHaveProperty('theme');
		expect(Object.hasOwn(out, 'constructor')).toBe(false);
		expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
		expect((out.flowchart as Record<string, unknown>).polluted).toBeUndefined();
	});
});
