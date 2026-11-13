// @vitest-environment jsdom
// T123 C2 (V-24): Export-Ablauf (Dialog offen/zu, Ausführung, Meldungen) ohne Komponente.
import { flushSync, mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportSvg, type PngScale, type RasterRequest } from '../../../../src/lib/services/export';
import { DICTIONARIES } from '../../../../src/lib/services/i18n';
import type { RenderResult } from '../../../../src/lib/services/render';
import ExportDialog from '../../../../src/lib/views/shell/ExportDialog.svelte';
import {
	createExporter,
	EXPORT_KEY,
	exportName,
	exportTitle,
	initialExport,
	type ExportDeps,
	type ExportOptions
} from '../../../../src/lib/views/shell/exporting';
import { newFile } from '../../../../src/lib/views/shell/file';
import { applyLocale } from '../../../../src/lib/views/shell/i18n.svelte';
import type { StatusMessage } from '../../../../src/lib/views/shell/status';
import { edge, emptyDoc, node } from '../../model/fixtures';

// T123 C4: exportSvg durchgereicht, damit die Tests die Eingabe (Sequenz-Szene, Auswahl) sehen.
vi.mock('../../../../src/lib/services/export', async (orig) => {
	const mod = await orig<typeof import('../../../../src/lib/services/export')>();
	return { ...mod, exportSvg: vi.fn(mod.exportSvg) };
});

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g/></svg>';
const CODE = 'flowchart TD\n  A --> B\n';
const doc = emptyDoc({ nodes: [node('A'), node('B')], edges: [edge('e1', 'A', 'B')] });

function setup(over: Partial<ExportDeps> = {}) {
	const said: StatusMessage[] = [];
	const downloads: { name: string; blob: Blob }[] = [];
	const blobs = new Map<string, Blob>();
	const document = window.document;
	const env = {
		document: {
			createElement: (tag: string) => {
				const a = document.createElement(tag) as HTMLAnchorElement;
				a.click = () => {
					downloads.push({ name: a.download, blob: blobs.get(a.href)! });
				};
				return a;
			},
			body: document.body
		} as unknown as Document,
		createObjectURL: (blob: Blob) => {
			const url = `blob:${blobs.size}`;
			blobs.set(url, blob);
			return url;
		},
		revokeObjectURL: () => {}
	};
	const render = vi.fn(async (): Promise<RenderResult> => ({ ok: true, svg: SVG }));
	const rasterize = vi.fn(async () => new Blob(['png'], { type: 'image/png' }));
	const canvas = { geometry: vi.fn(() => ({})), selection: vi.fn(() => ['A']) };
	const deps: ExportDeps = {
		doc: () => doc,
		code: () => CODE,
		mode: () => 'flowchart',
		fileName: () => 'plan.mmd',
		env: () => env,
		canvas: () => canvas,
		palette: () => undefined,
		render,
		measure: () => (s: string) => s.length * 8,
		rasterize: () => rasterize,
		say: (m) => said.push(m),
		...over
	};
	const exporter = createExporter(deps);
	return { exporter, said, downloads, render, rasterize, canvas, last: () => said.at(-1) };
}

const options = (over: Partial<ExportOptions> = {}): ExportOptions => ({
	...initialExport(doc, 'flowchart'),
	...over
});

beforeEach(() => localStorage.clear());
afterEach(() => {
	vi.unstubAllGlobals();
	applyLocale('de');
});

describe('createExporter: Dialog', () => {
	it('show öffnet, cancel schließt; Start geschlossen', () => {
		const { exporter } = setup();
		expect(get(exporter.open)).toBe(false);
		exporter.show();
		expect(get(exporter.open)).toBe(true);
		exporter.cancel();
		expect(get(exporter.open)).toBe(false);
	});

	it('run schließt den Dialog vor der Ausführung', async () => {
		const { exporter, render } = setup();
		exporter.show();
		let openDuringRender: boolean | null = null;
		render.mockImplementation(async () => {
			openDuringRender = get(exporter.open);
			return { ok: true, svg: SVG };
		});
		await exporter.run(options());
		expect(openDuringRender).toBe(false);
		expect(get(exporter.open)).toBe(false);
	});
});

describe('createExporter: Ausführung', () => {
	it('SVG: Download mit Dateiname aus der Datei, Erfolgsmeldung', async () => {
		const { exporter, downloads, last } = setup();
		await exporter.run(options({ format: 'svg' }));
		expect(downloads.map((d) => d.name)).toEqual(['plan.svg']);
		expect(downloads[0].blob.type).toBe('image/svg+xml');
		expect(last()).toEqual({
			key: 'app.shell.exported',
			params: { name: 'plan.svg' },
			tone: 'success'
		});
	});

	it('SVG scheitert: Fehlermeldung, kein Download', async () => {
		const render = vi.fn(async (): Promise<RenderResult> => ({
			ok: false,
			error: { message: 'kaputt' }
		}));
		const { exporter, downloads, last } = setup({ render });
		await exporter.run(options({ format: 'svg' }));
		expect(downloads).toEqual([]);
		expect(last()?.tone).toBe('error');
	});

	it('PNG: Rasterizer mit Skala und Hintergrund, Download .png', async () => {
		const { exporter, downloads, rasterize, last } = setup();
		await exporter.run(options({ format: 'png', scale: 2, background: true }));
		expect(rasterize).toHaveBeenCalledTimes(1);
		expect(rasterize.mock.calls[0]).toMatchObject([{ scale: 2, background: '#ffffff' }]);
		expect(downloads.map((d) => d.name)).toEqual(['plan.png']);
		expect(last()).toEqual({
			key: 'app.shell.exported',
			params: { name: 'plan.png' },
			tone: 'success'
		});
	});

	it('PNG ohne Hintergrund: transparent (background null)', async () => {
		const { exporter, rasterize } = setup();
		await exporter.run(options({ format: 'png', background: false }));
		expect(rasterize.mock.calls[0]).toMatchObject([{ background: null }]);
	});

	it('Markdown: Zwischenablage, Erfolgsmeldung, kein Download', async () => {
		const writeText = vi.fn(async () => {});
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		const { exporter, downloads, last, render } = setup();
		await exporter.run(options({ format: 'markdown', embed: false }));
		expect(writeText).toHaveBeenCalledTimes(1);
		expect(writeText.mock.calls[0]).toEqual([expect.stringContaining('```mermaid')]);
		expect(render).not.toHaveBeenCalled();
		expect(downloads).toEqual([]);
		expect(last()).toEqual({ key: 'app.shell.copied', tone: 'success', more: [] });
	});

	it('Ausnahme (z. B. Zwischenablage verweigert): Fehlermeldung mit Export-Label', async () => {
		vi.stubGlobal('navigator', {
			clipboard: { writeText: async () => Promise.reject(new Error('verweigert')) }
		});
		const { exporter, last } = setup();
		await exporter.run(options({ format: 'markdown' }));
		expect(last()).toMatchObject({
			key: 'app.shell.failed',
			tone: 'error',
			params: { label: { key: 'app.export.title' } }
		});
	});

	it('Auswahl nur bei Option selection gelesen', async () => {
		const { exporter, canvas } = setup();
		await exporter.run(options({ source: 'editor' }));
		expect(canvas.selection).not.toHaveBeenCalled();
		await exporter.run(options({ source: 'editor', selection: true }));
		expect(canvas.selection).toHaveBeenCalledTimes(1);
	});

	it('Theme-Farben nur bei Option theme gelesen', async () => {
		const palette = vi.fn(() => undefined);
		const { exporter } = setup({ palette });
		await exporter.run(options());
		expect(palette).not.toHaveBeenCalled();
		await exporter.run(options({ theme: true }));
		expect(palette).toHaveBeenCalledTimes(1);
	});

	it('ohne Graph-Canvas: leere Geometrie, kein Absturz', async () => {
		const { exporter, last } = setup({ canvas: () => null, mode: () => 'code' });
		await exporter.run(options({ format: 'svg' }));
		expect(last()?.key).toBe('app.shell.exported');
	});
});

describe('createExporter: Pfade (T123 C4, Review C2)', () => {
	const svgInput = () => vi.mocked(exportSvg).mock.calls.at(-1)![0];

	it('PNG scheitert: Fehlerschlüssel des Dienstes, kein Download, kein Rasterizer', async () => {
		const { exporter, downloads, rasterize, last } = setup();
		await exporter.run(options({ format: 'png', scale: 4 as PngScale }));
		expect(rasterize).not.toHaveBeenCalled();
		expect(downloads).toEqual([]);
		expect(last()).toEqual({ key: 'services.export.scale', tone: 'error' });
	});

	it('PNG: Rasterizer wirft -> Fehlermeldung mit dessen Text, kein Download', async () => {
		const rasterize = vi.fn(async (): Promise<Blob> => Promise.reject(new Error('kein Canvas')));
		const { exporter, downloads, last } = setup({ rasterize: () => rasterize });
		await exporter.run(options({ format: 'png' }));
		expect(rasterize).toHaveBeenCalledTimes(1);
		expect(downloads).toEqual([]);
		expect(last()).toEqual({
			key: 'app.status.text',
			params: { text: 'kein Canvas' },
			tone: 'error'
		});
	});

	it('SVG und Markdown rufen den Rasterizer nicht', async () => {
		vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => {}) } });
		const { exporter, rasterize } = setup();
		await exporter.run(options({ format: 'svg' }));
		await exporter.run(options({ format: 'markdown' }));
		expect(rasterize).not.toHaveBeenCalled();
	});

	it('Sequenz: Szene aus toSequence; Graph: keine Szene', async () => {
		const { exporter } = setup({ mode: () => 'sequence' });
		await exporter.run(options({ format: 'svg' }));
		expect(svgInput().sequence).toBeDefined();
		const graph = setup();
		await graph.exporter.run(options({ format: 'svg' }));
		expect(svgInput().sequence).toBeUndefined();
	});

	it('Auswahl-Export: nur die IDs der Canvas-Auswahl', async () => {
		const { exporter } = setup();
		await exporter.run(options({ source: 'editor', selection: true }));
		expect(svgInput().only).toEqual(new Set(['A']));
		await exporter.run(options({ source: 'editor' }));
		expect(svgInput().only).toBeUndefined();
	});

	it('Markdown mit Warnungen: Hinweis-Ton, Warnungen als Teile', async () => {
		vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => {}) } });
		const code = '%% @mermuid: {"v":1,"pos":5}\n' + CODE;
		const { exporter, last } = setup({ code: () => code });
		await exporter.run(options({ format: 'markdown' }));
		expect(last()).toEqual({
			key: 'app.shell.copied',
			tone: 'info',
			more: [{ key: 'services.meta.posNotObject' }]
		});
	});

	it('SVG scheitert: Text des Dienstes als Fehlermeldung', async () => {
		const render = vi.fn(async (): Promise<RenderResult> => ({
			ok: false,
			error: { message: 'kaputt' }
		}));
		const { exporter, last } = setup({ render });
		await exporter.run(options({ format: 'svg', source: 'mermaid' }));
		expect(last()).toEqual({ key: 'app.status.text', params: { text: 'kaputt' }, tone: 'error' });
	});
});

// T127 C1 (V-22): Wahl überlebt Neuladen, Größe/Titel im SVG, "Layout einbetten" je Typ.
const manual = emptyDoc({
	nodes: [node('A')],
	layout: { mode: 'manual', engine: 'dagre', positions: {}, gridSize: 10, snap: false }
});
const sequenceDoc = emptyDoc({ diagramType: 'sequence' });

describe('Export-Wahl in localStorage (T127 C1)', () => {
	it('Format, Quelle und Maßstab aus dem letzten Export gelten nach Neuladen', async () => {
		const { exporter } = setup();
		await exporter.run(options({ format: 'png', source: 'mermaid', scale: 3 }));
		expect(JSON.parse(localStorage.getItem(EXPORT_KEY)!)).toEqual({
			format: 'png',
			source: 'mermaid',
			scale: 3,
			background: false,
			color: '',
			margin: 0
		});
		expect(initialExport(manual, 'flowchart')).toMatchObject({
			format: 'png',
			source: 'mermaid',
			scale: 3,
			background: false,
			embed: true
		});
	});

	it('ohne Speicherwert: Startwerte nach defaultSource', () => {
		expect(initialExport(manual, 'flowchart')).toMatchObject({
			format: 'svg',
			source: 'editor',
			scale: 1
		});
	});

	it('ungültige Werte verworfen, gültige bleiben', () => {
		localStorage.setItem(EXPORT_KEY, JSON.stringify({ format: 'gif', source: 'x', scale: 4 }));
		expect(initialExport(manual, 'flowchart')).toMatchObject({
			format: 'svg',
			source: 'editor',
			scale: 1
		});
		localStorage.setItem(EXPORT_KEY, JSON.stringify({ format: 'markdown', scale: '2' }));
		expect(initialExport(manual, 'flowchart')).toMatchObject({ format: 'markdown', scale: 1 });
		for (const raw of ['{kaputt', 'null', '[1]', '"svg"']) {
			localStorage.setItem(EXPORT_KEY, raw);
			expect(initialExport(manual, 'flowchart')).toMatchObject({ format: 'svg', scale: 1 });
		}
	});

	it('gespeicherte Quelle editor ohne Editor-SVG (Code-Modus): mermaid', () => {
		localStorage.setItem(EXPORT_KEY, JSON.stringify({ source: 'editor' }));
		expect(initialExport(emptyDoc(), 'code').source).toBe('mermaid');
		expect(initialExport(emptyDoc(), 'flowchart').source).toBe('editor');
	});

	it('Storage wirft (SecurityError): Startwerte, Export läuft trotzdem', async () => {
		const storage = () => {
			throw new Error('SecurityError');
		};
		expect(initialExport(manual, 'flowchart', storage)).toMatchObject({ format: 'svg', scale: 1 });
		const { exporter, downloads } = setup({ storage });
		await exporter.run(options({ format: 'svg' }));
		expect(downloads.map((d) => d.name)).toEqual(['plan.svg']);
	});

	it('nur setItem wirft (QuotaExceeded): Export läuft, keine Fehlermeldung', async () => {
		const quota: Storage = {
			...localStorage,
			getItem: (key: string) => localStorage.getItem(key),
			setItem: () => {
				throw new DOMException('voll', 'QuotaExceededError');
			}
		};
		const { exporter, downloads, last } = setup({ storage: () => quota });
		await exporter.run(options({ format: 'svg' }));
		expect(downloads.map((d) => d.name)).toEqual(['plan.svg']);
		expect(last()).toMatchObject({ key: 'app.shell.exported', tone: 'success' });
	});

	it('erzwungene Quelle im Code-Modus überschreibt gespeicherte Wahl nicht (O-140)', async () => {
		localStorage.setItem(EXPORT_KEY, JSON.stringify({ source: 'editor' }));
		const { exporter } = setup({ mode: () => 'code' });
		await exporter.run({ ...initialExport(manual, 'code'), format: 'png', scale: 2 });
		expect(JSON.parse(localStorage.getItem(EXPORT_KEY)!)).toEqual({
			format: 'png',
			source: 'editor',
			scale: 2,
			background: false,
			color: '',
			margin: 0
		});
		expect(initialExport(manual, 'flowchart').source).toBe('editor');
	});
});

describe('SVG-Titel und Dateiname (T127 C1)', () => {
	const svgInput = () => vi.mocked(exportSvg).mock.calls.at(-1)![0];

	it('Titel = Dateiname ohne Endung', async () => {
		expect(exportTitle('plan.v2.mmd')).toBe('plan.v2');
		const { exporter, downloads } = setup({ fileName: () => 'auftrag.md' });
		await exporter.run(options({ format: 'svg', source: 'mermaid' }));
		expect(svgInput().title).toBe('auftrag');
		const text = await downloads[0].blob.text();
		expect(text).toContain('<title>auftrag</title>');
	});

	it('Reihenfolge doc.title -> Dateiname -> Standardtitel (O-140)', async () => {
		expect(exportTitle('plan.mmd', 'Foo')).toBe('Foo');
		expect(exportTitle('plan.mmd', '')).toBe('plan');
		const titled = { ...doc, title: 'Foo' };
		const first = setup({ doc: () => titled });
		await first.exporter.run(options({ format: 'svg', source: 'mermaid' }));
		expect(await first.downloads[0].blob.text()).toContain('<title>Foo</title>');
		const second = setup();
		await second.exporter.run(options({ format: 'svg', source: 'mermaid' }));
		expect(await second.downloads[0].blob.text()).toContain('<title>plan</title>');
		applyLocale('en');
		expect(exportTitle('', '')).toBe('Diagram');
	});

	it('ohne Dateiname: Standardtitel je Sprache, in EN kein deutsches Wort', async () => {
		expect(exportTitle('')).toBe('Diagramm');
		expect(exportName('', 'svg')).toBe('diagramm.svg');
		applyLocale('en');
		expect(exportTitle('')).toBe('Diagram');
		expect(exportName('', 'svg')).toBe('diagram.svg');
		const { exporter, downloads, last } = setup({ fileName: () => '' });
		await exporter.run(options({ format: 'svg', source: 'mermaid' }));
		const text = await downloads[0].blob.text();
		expect(text).toContain('<title>Diagram</title>');
		expect(text).not.toMatch(/Diagramm/i);
		expect(last()).toMatchObject({ params: { name: 'diagram.svg' } });
	});

	it('EN-Texte des Export-Dialogs frei von deutschen Wörtern', () => {
		const german =
			/[äöüÄÖÜß]|\b(diagramm|quelle|maßstab|hintergrund|einbetten|exportieren|auswahl|farben|kopieren|weißer)\b/i;
		const en = Object.entries(DICTIONARIES.en).filter(([k]) => k.startsWith('app.export.'));
		expect(en.length).toBeGreaterThan(10);
		for (const [key, value] of en) expect(`${key}: ${value}`).not.toMatch(german);
	});
});

describe('ExportDialog: "Layout einbetten" je Diagrammtyp (T127 C1)', () => {
	function open(doc: typeof manual) {
		const target = document.body.appendChild(document.createElement('div'));
		const app = mount(ExportDialog, {
			target,
			props: {
				initial: { ...initialExport(doc, 'flowchart'), format: 'markdown' },
				editor: true,
				onexport: () => {},
				oncancel: () => {}
			}
		});
		flushSync();
		const labels = [...target.querySelectorAll('label')].map((l) => l.textContent!.trim());
		unmount(app);
		target.remove();
		return labels;
	}

	it('flowchart zeigt den Schalter, sequence nicht', () => {
		expect(initialExport(sequenceDoc, 'sequence').embedLayout).toBe(false);
		expect(open(manual)).toContain('Layout einbetten');
		expect(open(sequenceDoc)).not.toContain('Layout einbetten');
	});
});

// T127 C2 (F-08): Bild in die Zwischenablage, PNG-Hintergrund und Rand.
class FakeItem {
	constructor(readonly items: Record<string, Blob | Promise<Blob>>) {}
}

function clipboard(write = vi.fn<(items: FakeItem[]) => Promise<void>>(async () => {})) {
	vi.stubGlobal('navigator', { clipboard: { write } });
	vi.stubGlobal('ClipboardItem', FakeItem);
	return write;
}

async function copiedBlob(write: ReturnType<typeof clipboard>): Promise<Blob> {
	return await Object.values(write.mock.calls[0][0][0].items)[0];
}

describe('createExporter: Zwischenablage (T127 C2)', () => {
	it('SVG kopieren: ClipboardItem image/svg+xml, kein Download, Erfolgsmeldung', async () => {
		const write = clipboard();
		const { exporter, downloads, last } = setup();
		await exporter.run(options({ format: 'svg', copy: true }));
		expect(write).toHaveBeenCalledTimes(1);
		expect(Object.keys(write.mock.calls[0][0][0].items)).toEqual(['image/svg+xml']);
		expect(await (await copiedBlob(write)).text()).toContain('<svg');
		expect(downloads).toEqual([]);
		expect(last()).toEqual({
			key: 'app.export.copied',
			params: { format: 'SVG' },
			tone: 'success'
		});
	});

	it('PNG kopieren: Blob des Rasterizers, Hintergrund und Rand wie beim Download', async () => {
		const write = clipboard();
		const { exporter, downloads, rasterize, last } = setup();
		await exporter.run(
			options({ format: 'png', copy: true, background: true, color: 'navy', margin: 8 })
		);
		expect(rasterize.mock.calls[0]).toMatchObject([{ background: 'navy', width: 26, height: 26 }]);
		expect(await copiedBlob(write)).toBe(await rasterize.mock.results[0].value);
		expect(downloads).toEqual([]);
		expect(last()).toMatchObject({ key: 'app.export.copied', params: { format: 'PNG' } });
	});

	it('write läuft synchron im Aufruf (Nutzergeste), noch vor dem Rendern', async () => {
		const write = clipboard();
		const { exporter, render } = setup();
		const done = exporter.run(options({ format: 'svg', copy: true }));
		expect(write).toHaveBeenCalledTimes(1);
		await done;
		expect(render).toHaveBeenCalledTimes(1);
	});

	it('nicht unterstützt: Fehlermeldung mit Hinweis, kein Download', async () => {
		vi.stubGlobal('navigator', { clipboard: {} });
		const { exporter, downloads, last } = setup();
		await exporter.run(options({ format: 'png', copy: true }));
		expect(downloads).toEqual([]);
		expect(last()).toMatchObject({
			key: 'app.shell.failed',
			tone: 'error',
			params: { label: { key: 'app.export.copyPng' } }
		});
	});

	it('write wirft: Fehlermeldung mit Kopier-Label und Grund', async () => {
		clipboard(vi.fn(async () => Promise.reject(new Error('verweigert'))));
		const { exporter, downloads, last } = setup();
		await exporter.run(options({ format: 'svg', copy: true }));
		expect(downloads).toEqual([]);
		expect(last()).toMatchObject({
			key: 'app.shell.failed',
			tone: 'error',
			params: { label: { key: 'app.export.copySvg' } }
		});
		expect(JSON.stringify(last())).toContain('verweigert');
	});

	it('Export scheitert beim Kopieren: Meldung des Dienstes statt Clipboard-Fehler', async () => {
		clipboard(
			vi.fn(async (items: FakeItem[]) => {
				await Object.values(items[0].items)[0];
			})
		);
		const render = vi.fn(async (): Promise<RenderResult> => ({
			ok: false,
			error: { message: 'kaputt' }
		}));
		const { exporter, last } = setup({ render });
		await exporter.run(options({ format: 'svg', source: 'mermaid', copy: true }));
		expect(last()).toEqual({ key: 'app.status.text', params: { text: 'kaputt' }, tone: 'error' });
	});

	it('Kopieren speichert keine Kopier-Absicht in der Wahl', async () => {
		clipboard();
		const { exporter } = setup();
		await exporter.run(options({ format: 'svg', copy: true }));
		expect(JSON.parse(localStorage.getItem(EXPORT_KEY)!)).not.toHaveProperty('copy');
	});
});

describe('PNG-Hintergrund und Rand (T127 C2)', () => {
	const bg = (rasterize: ReturnType<typeof setup>['rasterize']) =>
		(rasterize.mock.calls.at(-1) as unknown as [RasterRequest])[0].background;

	it('freier Wert aus der Allow-Liste, sonst Theme-Farbe, sonst Weiß', async () => {
		const palette = vi.fn(() => ({ background: '#101010' }));
		const { exporter, rasterize } = setup({ palette });
		await exporter.run(options({ format: 'png', background: true, color: 'hsl(10, 20%, 30%)' }));
		expect(bg(rasterize)).toBe('hsl(10, 20%, 30%)');
		for (const color of ['', 'url(#x)', 'red;x', 'currentcolor']) {
			await exporter.run(options({ format: 'png', background: true, color }));
			expect(bg(rasterize)).toBe('#101010');
		}
		const plain = setup({ palette: () => ({ background: 'var(--x)' }) });
		await plain.exporter.run(options({ format: 'png', background: true, color: '' }));
		expect(bg(plain.rasterize)).toBe('#ffffff');
	});

	it('ohne Hintergrund transparent, auch mit Farbe', async () => {
		const { exporter, rasterize } = setup();
		await exporter.run(options({ format: 'png', background: false, color: 'red' }));
		expect(bg(rasterize)).toBeNull();
	});

	it('Rand ungültig -> Standard 0', async () => {
		const { exporter, rasterize } = setup();
		await exporter.run(options({ format: 'png', margin: 1000 }));
		expect(rasterize.mock.calls[0]).toMatchObject([{ width: 10, height: 10 }]);
	});

	it('Hintergrund, Farbe und Rand überleben Neuladen; ungültige Werte verworfen', async () => {
		const { exporter } = setup();
		await exporter.run(options({ format: 'png', background: true, color: ' teal ', margin: 12 }));
		expect(initialExport(manual, 'flowchart')).toMatchObject({
			background: true,
			color: 'teal',
			margin: 12
		});
		await exporter.run(options({ format: 'png', background: true, color: 'url(x)', margin: 12 }));
		expect(initialExport(manual, 'flowchart').color).toBeUndefined();
		for (const raw of [
			{ background: 'ja', color: 'url(x)', margin: 513 },
			{ background: 1, color: 7, margin: '12' },
			{ margin: 1.5, color: 'constructor' }
		]) {
			localStorage.setItem(EXPORT_KEY, JSON.stringify(raw));
			const start = initialExport(manual, 'flowchart');
			expect(start.background).toBe(false);
			expect(start).not.toHaveProperty('color');
			expect(start).not.toHaveProperty('margin');
		}
	});
});

describe('ExportDialog: Kopieren (T127 C2)', () => {
	function dialog(format: 'svg' | 'png' | 'markdown', onexport = vi.fn()) {
		const target = document.body.appendChild(document.createElement('div'));
		const app = mount(ExportDialog, {
			target,
			props: {
				initial: { ...initialExport(manual, 'flowchart'), format },
				editor: true,
				onexport,
				oncancel: () => {}
			}
		});
		flushSync();
		const copy = [...target.querySelectorAll('button')].find((b) =>
			/kopieren|copy/i.test(b.textContent!)
		);
		return {
			target,
			copy,
			close: () => {
				unmount(app);
				target.remove();
			}
		};
	}

	it('unterstützt: Knopf je Format aktiv, Klick meldet copy', () => {
		clipboard();
		const onexport = vi.fn();
		const png = dialog('png', onexport);
		expect(png.copy?.textContent?.trim()).toBe('PNG kopieren');
		expect(png.copy?.disabled).toBe(false);
		png.copy!.click();
		expect(onexport).toHaveBeenCalledWith(expect.objectContaining({ format: 'png', copy: true }));
		png.close();
		const svg = dialog('svg');
		expect(svg.copy?.textContent?.trim()).toBe('SVG kopieren');
		svg.close();
		const md = dialog('markdown');
		expect(md.copy).toBeUndefined();
		md.close();
	});

	it('nicht unterstützt: Knopf aria-disabled, fokussierbar, Klick ohne copy, Hinweis (DE/EN)', () => {
		vi.stubGlobal('navigator', { clipboard: {} });
		const onexport = vi.fn();
		const de = dialog('png', onexport);
		expect(de.copy?.disabled).toBe(false);
		expect(de.copy?.getAttribute('aria-disabled')).toBe('true');
		de.copy!.focus();
		expect(document.activeElement).toBe(de.copy);
		de.copy!.click();
		expect(onexport).not.toHaveBeenCalled();
		const hint = de.target.querySelector(`#${de.copy!.getAttribute('aria-describedby')}`);
		expect(hint?.textContent).toBe(DICTIONARIES.de['app.export.copyUnsupported']);
		de.close();
		applyLocale('en');
		const en = dialog('svg');
		expect(en.copy?.textContent?.trim()).toBe('Copy SVG');
		expect(en.copy?.getAttribute('aria-disabled')).toBe('true');
		expect(en.target.textContent).toContain(DICTIONARIES.en['app.export.copyUnsupported']);
		en.close();
	});

	it('Exportieren meldet kein copy; Rand aus dem Feld als Zahl', () => {
		clipboard();
		const onexport = vi.fn();
		const png = dialog('png', onexport);
		const margin = png.target.querySelector<HTMLInputElement>('input[type="number"]')!;
		margin.value = '16';
		margin.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		png.target.querySelector('form')!.requestSubmit();
		const sent = onexport.mock.calls[0][0] as ExportOptions;
		expect(sent.copy).toBeFalsy();
		expect(sent.margin).toBe(16);
		png.close();
	});
});

describe('Standard-Dateiname je Sprache (T127 C2, O-137)', () => {
	it('DE diagramm.mmd, EN diagram.mmd', () => {
		expect(newFile('').name).toBe('diagramm.mmd');
		applyLocale('en');
		expect(newFile('').name).toBe('diagram.mmd');
	});
});
