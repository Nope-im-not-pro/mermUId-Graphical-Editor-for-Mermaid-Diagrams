// T23 C2a: AK-M06, Roundtrip grafisch ändern, speichern, öffnen. Nach dem Öffnen der
// gespeicherten Datei ist das Modell im Canvas identisch (Knoten, Kanten, Labels, Reihenfolge,
// seit T139 C2 auch Form je Knoten und Container-Zugehörigkeit)
// und erneutes Speichern liefert denselben Text (stabile Reihenfolge).
import { expect, test, type Page } from '@playwright/test';
import {
	connect,
	node,
	openText,
	properties,
	relabel,
	saveBytes,
	seqSurface,
	seqTools,
	startApp
} from './helpers-actions';

/** Knoten: ID, Label, Form (Präfix des zugänglichen Namens), Container (Subgraph-ID oder ''). */
type FlowNodeView = [id: string, label: string, form: string, parent: string];

interface FlowModel {
	nodes: FlowNodeView[];
	edges: [string, string][];
}

/**
 * Knoten und Kanten des Graph-Canvas in DOM-Reihenfolge. T139 C2 (V-33): Form aus dem
 * zugänglichen Namen "<Form>: <Label>" (`nodeAriaLabel`, aus `data.shape`); Container-Zugehörigkeit
 * geometrisch: kleinster Subgraph-Rahmen, der den Knoten vollständig umschließt (xyflow schreibt
 * `parentId` nicht ins DOM; der Rahmen wächst nur um seine Mitglieder, `frameAround`).
 */
async function flowModel(page: Page): Promise<FlowModel> {
	const nodes = await page.locator('.svelte-flow__node').evaluateAll((es) => {
		const boxes = es
			.filter((e) => e.classList.contains('svelte-flow__node-container'))
			.map((e) => ({ id: e.getAttribute('data-id') ?? '', r: e.getBoundingClientRect() }));
		const inside = (a: DOMRect, b: DOMRect) =>
			a.left >= b.left - 0.5 &&
			a.top >= b.top - 0.5 &&
			a.right <= b.right + 0.5 &&
			a.bottom <= b.bottom + 0.5;
		return es.map((e): [string, string, string, string] => {
			const id = e.getAttribute('data-id') ?? '';
			const r = e.getBoundingClientRect();
			const parent = boxes
				.filter((b) => b.id !== id && inside(r, b.r))
				.sort((x, y) => x.r.width * x.r.height - y.r.width * y.r.height)[0];
			const form = (e.getAttribute('aria-label') ?? '').split(': ')[0];
			return [id, (e as HTMLElement).innerText, form, parent?.id ?? ''];
		});
	});
	const edges = await page
		.locator('.svelte-flow__edge')
		.evaluateAll((es) =>
			es.map((e): [string, string] => [e.getAttribute('aria-label') ?? '', e.textContent ?? ''])
		);
	return { nodes, edges };
}

/** Elemente der Sequenzfläche (Teilnehmer, Nachrichten, Notizen) in Reihenfolge. */
async function seqModel(page: Page): Promise<string[]> {
	return seqSurface(page)
		.getByRole('button')
		.evaluateAll((es) => es.map((e) => e.getAttribute('aria-label') ?? ''));
}

/** Speichern, gespeicherte Datei öffnen, Modell vergleichen, erneut speichern: gleicher Text. */
async function roundtrip<T>(page: Page, name: string, model: () => Promise<T>): Promise<string> {
	const before = await model();
	const saved = await saveBytes(page);
	await openText(page, name, saved);
	await expect.poll(model).toEqual(before);
	const again = await saveBytes(page);
	expect(again.toString('utf8'), 'stabile Reihenfolge im Text').toBe(saved.toString('utf8'));
	return saved.toString('utf8');
}

test.beforeEach(async ({ page }) => {
	await startApp(page);
});

test('AK-M06: flowchart grafisch ändern, speichern, öffnen ergibt identisches Modell', async ({
	page
}) => {
	await openText(
		page,
		'flow.mmd',
		[
			'flowchart TD',
			'    A[Start] --> B[Prüfen]',
			'    B --> C[Ende]',
			'    subgraph G [Gruppe]',
			'        D{{Mitglied}}',
			'    end',
			''
		].join('\n')
	);
	await page.locator('.svelte-flow__pane').dblclick({ position: { x: 100, y: 100 } });
	await expect(node(page, 'n1')).toBeVisible();
	await relabel(page, node(page, 'n1'), 'Neu');
	await connect(page, 'n1', 'B');
	await expect(page.locator('.svelte-flow__edge')).toHaveCount(3);
	await relabel(page, node(page, 'B'), 'Prüfen & Weiter');
	await node(page, 'A').click();
	await properties(page).getByLabel('Form').selectOption({ label: 'Stadion' });
	// T139 C2: Meta-Form aus T138 (`@{ shape: doc }`).
	await node(page, 'B').click();
	await properties(page).getByLabel('Form').selectOption({ label: 'Dokument' });
	await expect(page.getByTestId('file')).toHaveText('Datei: flow.mmd (geändert)');

	const model = await flowModel(page);
	expect(model.nodes).toEqual([
		['G', 'Gruppe', 'Subgraph', ''],
		['A', 'Start', 'Stadion', ''],
		['B', 'Prüfen & Weiter', 'Dokument', ''],
		['C', 'Ende', 'Rechteck', ''],
		['D', 'Mitglied', 'Sechseck', 'G'],
		['n1', 'Neu', 'Rechteck', '']
	]);
	expect(model.edges.map(([ends]) => ends)).toEqual([
		'Edge from A to B',
		'Edge from B to C',
		'Edge from n1 to B'
	]);

	const text = await roundtrip(page, 'flow.mmd', () => flowModel(page));
	expect(text).toMatch(/^flowchart TD\n/);
	expect(text).toContain('A([Start])');
	expect(text).toMatch(/B@\{ shape: doc, label: "Prüfen & Weiter" \}/);
	expect(text).toMatch(/^\s*subgraph G \[Gruppe\]\n\s*D\{\{Mitglied\}\}\n\s*end$/m);
	expect(text).toMatch(/^\s*n1 --> B$/m);
});

test('AK-M06: flowchart Label mit Anführungszeichen übersteht Speichern und Öffnen', async ({
	page
}) => {
	await openText(page, 'zitat.mmd', 'flowchart LR\n    A[Start] --> B[Ende]\n');
	await relabel(page, node(page, 'A'), 'Sag "Hallo"');
	await expect(node(page, 'A')).toHaveText('Sag "Hallo"');
	await expect(page.getByTestId('file')).toHaveText('Datei: zitat.mmd (geändert)');

	await roundtrip(page, 'zitat.mmd', () => flowModel(page));
	await expect(node(page, 'A')).toHaveText('Sag "Hallo"');
});

test('AK-M06: sequence grafisch ändern, speichern, öffnen ergibt identisches Modell', async ({
	page
}) => {
	await openText(
		page,
		'seq.mmd',
		'sequenceDiagram\n    participant Alice\n    participant Bob\n    Alice->>Bob: Hallo\n'
	);
	const tools = seqTools(page);
	await tools.getByRole('button', { name: '+ Teilnehmer', exact: true }).click();
	await tools.getByLabel('Von', { exact: true }).selectOption('Bob');
	await tools.getByLabel('An', { exact: true }).selectOption('Teilnehmer1');
	await tools.getByRole('button', { name: '+ Nachricht', exact: true }).click();
	await relabel(
		page,
		seqSurface(page).getByRole('button', { name: 'Nachricht: Nachricht', exact: true }),
		'Er sagt "Hallo"'
	);
	await tools.getByRole('button', { name: '+ Notiz', exact: true }).click();
	await expect(page.getByTestId('file')).toHaveText('Datei: seq.mmd (geändert)');

	const model = await seqModel(page);
	expect(model).toContain('Teilnehmer: Teilnehmer1');
	expect(model).toContain('Nachricht: Er sagt "Hallo"');
	expect(model.filter((m) => m.startsWith('Notiz:'))).toHaveLength(1);

	const text = await roundtrip(page, 'seq.mmd', () => seqModel(page));
	expect(text).toMatch(/^\s*Bob->>Teilnehmer1: Er sagt "Hallo"$/m);
});
