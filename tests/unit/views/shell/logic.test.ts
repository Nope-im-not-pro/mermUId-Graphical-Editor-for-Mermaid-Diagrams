import { describe, expect, it } from 'vitest';
import { bannerFor } from '../../../../src/lib/views/shell/banner';
import {
	afterJump,
	forMode,
	initialPanels,
	panelsLocked,
	selectTab,
	toggleCode,
	togglePreview
} from '../../../../src/lib/views/shell/panels';
import {
	cursorStatus,
	diagramKeyword,
	layoutStatus,
	parserStatus,
	syncStatus,
	typeLabel
} from '../../../../src/lib/views/shell/status';

const base = { mode: 'flowchart' as const, pending: false, conflict: false, errors: [] };
const err = { line: 3, column: 2, message: 'Unerwartetes Zeichen' };

describe('panels', () => {
	it('Code-Panel per Default eingeklappt (FA-10), Vorschau offen', () => {
		expect(initialPanels()).toEqual({ tab: 'properties', previewOpen: true });
	});

	it('Code ein/aus wechselt zwischen Eigenschaften und Code', () => {
		const open = toggleCode(initialPanels());
		expect(open.tab).toBe('code');
		expect(toggleCode(open).tab).toBe('properties');
		expect(selectTab(open, 'properties').tab).toBe('properties');
	});

	it('Vorschau einklappbar', () => {
		expect(togglePreview(initialPanels()).previewOpen).toBe(false);
	});

	it('nur Code: Code-Tab und Vorschau erzwungen, Graph unverändert', () => {
		const closed = togglePreview(initialPanels());
		expect(forMode(closed, 'code')).toEqual({ tab: 'code', previewOpen: true });
		expect(forMode(closed, 'flowchart')).toBe(closed);
		expect(forMode(closed, 'sequence')).toBe(closed);
		expect(panelsLocked('code')).toBe(true);
		expect(panelsLocked('flowchart')).toBe(false);
		expect(panelsLocked('sequence')).toBe(false);
	});

	it('Sprung: Zeile öffnet Code, Element öffnet Eigenschaften', () => {
		const p = initialPanels();
		expect(afterJump(p, { type: 'line', line: 1, column: 1 }).tab).toBe('code');
		expect(afterJump(toggleCode(p), { type: 'element', id: 'A' }).tab).toBe('properties');
	});
});

describe('status', () => {
	it('Parser-Status mit erster Fehlerzeile', () => {
		expect(parserStatus(base)).toBe('Parser: OK');
		expect(parserStatus({ ...base, errors: [err, { ...err, line: 9 }] })).toBe(
			'Parser: Fehler in Zeile 3'
		);
		expect(parserStatus({ ...base, mode: 'code' })).toBe('Parser: nicht unterstützt');
	});

	it('Sync-Status nach Vorrang Konflikt, Prüfung, nur Code', () => {
		expect(syncStatus(base)).toBe('Sync: Grafik=Code');
		expect(syncStatus({ ...base, pending: true })).toBe('Sync: Code wird geprüft');
		expect(syncStatus({ ...base, pending: true, conflict: true })).toBe('Sync: Konflikt');
		expect(syncStatus({ ...base, mode: 'code' })).toBe('Sync: nur Code');
	});

	it('Sync-Status bei Parse-Fehler ohne Konflikt: "Code ungültig" (O-54)', () => {
		expect(syncStatus({ ...base, errors: [err] })).toBe('Sync: Code ungültig');
		expect(syncStatus({ ...base, errors: [err], conflict: true })).toBe('Sync: Konflikt');
		expect(syncStatus({ ...base, errors: [err], pending: true })).toBe('Sync: Code wird geprüft');
		expect(syncStatus({ ...base, mode: 'code', errors: [err] })).toBe('Sync: nur Code');
	});

	it('Layout-Modus je Layout-Klasse', () => {
		expect(layoutStatus('flowchart', 'manual')).toBe('Layout: manuell');
		expect(layoutStatus('flowchart', 'auto')).toBe('Layout: automatisch');
		expect(layoutStatus('sequence', 'manual')).toBe('Layout: Sequenz');
		expect(layoutStatus('code', 'auto')).toBe('Layout: Mermaid');
	});

	it('Zeile:Spalte', () => {
		expect(cursorStatus(null)).toBe('Z -:-');
		expect(cursorStatus({ line: 12, column: 4 })).toBe('Z 12:4');
	});

	it('Typ-Anzeige, übrige Typen als nur Code', () => {
		expect(typeLabel('flowchart', '')).toBe('flowchart');
		expect(typeLabel('sequence', '')).toBe('sequenceDiagram');
		expect(typeLabel('code', '%% x\n---\ntitle: T\n---\n  pie title Haus\n')).toBe(
			'pie (nur Code)'
		);
		expect(typeLabel('code', '')).toBe('unbekannt (nur Code)');
		expect(diagramKeyword('%%{init: {}}%%\nclassDiagram\n')).toBe('classDiagram');
	});
});

describe('banner', () => {
	it('unsichtbar ohne Konflikt und im Modus nur Code', () => {
		expect(bannerFor(base)).toBeNull();
		expect(bannerFor({ ...base, mode: 'code', conflict: true })).toBeNull();
	});

	it('Konflikt mit ungültigem Code nennt Zeile, Spalte und drei Wahlen', () => {
		const b = bannerFor({ ...base, conflict: true, errors: [err] })!;
		expect(b.message).toBe(
			'Ungültiger Code in Zeile 3, Spalte 2: Unerwartetes Zeichen. Die Grafik zeigt den letzten gültigen Stand.'
		);
		expect(b.actions.map((a) => [a.id, a.label])).toEqual([
			['keepGraphic', 'Grafik behalten'],
			['keepCode', 'Code behalten'],
			['diff', 'Diff ansehen']
		]);
	});

	it('Zeilen-/Spalten-Link des ersten Fehlers setzt die Meldung zusammen', () => {
		const b = bannerFor({ ...base, conflict: true, errors: [err] })!;
		expect(b.link).toMatchObject({ text: 'Zeile 3, Spalte 2', line: err.line, column: err.column });
		expect(b.link!.before + b.link!.text + b.link!.after).toBe(b.message);
		expect(bannerFor({ ...base, conflict: true })!.link).toBeNull();
	});

	it('Konflikt ohne Fehlerliste', () => {
		expect(bannerFor({ ...base, conflict: true })!.message).toBe(
			'Konflikt zwischen Grafik und Code. Die Grafik zeigt den letzten gültigen Stand.'
		);
	});

	it('Konflikt-Variante trägt Art und Beschriftung "Konflikt:"', () => {
		const b = bannerFor({ ...base, conflict: true, errors: [err] })!;
		expect([b.kind, b.label]).toEqual(['conflict', 'Konflikt:']);
	});

	it('Parse-Fehler ohne Konflikt: Fehler-Variante mit Zeilen-Link, ohne Wahlknöpfe (D1)', () => {
		const b = bannerFor({ ...base, errors: [err] })!;
		expect([b.kind, b.label]).toEqual(['error', 'Syntaxfehler:']);
		expect(b.message).toBe(
			'Ungültiger Code in Zeile 3, Spalte 2: Unerwartetes Zeichen. Die Grafik zeigt den letzten gültigen Stand.'
		);
		expect(b.link).toMatchObject({ text: 'Zeile 3, Spalte 2', line: 3, column: 2 });
		expect(b.actions).toEqual([]);
		expect(bannerFor({ ...base, mode: 'code', errors: [err] })).toBeNull();
	});
});
