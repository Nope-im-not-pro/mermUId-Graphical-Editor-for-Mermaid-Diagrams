// T23 C2a: AK-M04, 10 Grafik-Aktionen ab definiertem Startzustand; die gespeicherte Datei
// muss byte-genau der Golden-Datei unter tests/fixtures/golden/actions/ entsprechen.
import { readFile } from 'node:fs/promises';
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

const GOLDEN = 'tests/fixtures/golden/actions';

const FLOW = 'flowchart TD\n    A[Start] --> B[Ende]\n';
const SEQ = 'sequenceDiagram\n    participant Alice\n    participant Bob\n    Alice->>Bob: Hallo\n';

interface Action {
	readonly file: string;
	readonly title: string;
	readonly start: string;
	readonly name: string;
	run(page: Page): Promise<void>;
}

const ACTIONS: readonly Action[] = [
	{
		file: '01-flow-knoten-anlegen',
		title: 'flowchart Knoten per Doppelklick anlegen (Einrasten an)',
		name: 'flow.mmd',
		start: FLOW,
		async run(page) {
			await page.getByRole('button', { name: 'Einrasten' }).click();
			await page.locator('.svelte-flow__pane').dblclick({ position: { x: 100, y: 100 } });
			await expect(node(page, 'n1')).toBeVisible();
		}
	},
	{
		file: '02-flow-kante-ziehen',
		title: 'flowchart Kante von A nach B ziehen',
		name: 'flow.mmd',
		start: 'flowchart LR\n    A[Start]\n    B[Ende]\n',
		async run(page) {
			await connect(page, 'A', 'B');
			await expect(page.locator('.svelte-flow__edge')).toHaveCount(1);
		}
	},
	{
		file: '03-flow-umbenennen',
		title: 'flowchart Knoten B per Doppelklick umbenennen',
		name: 'flow.mmd',
		start: FLOW,
		async run(page) {
			await relabel(page, node(page, 'B'), 'Fertig');
		}
	},
	{
		file: '04-flow-form-aendern',
		title: 'flowchart Form von A auf Raute ändern',
		name: 'flow.mmd',
		start: FLOW,
		async run(page) {
			await node(page, 'A').click();
			await properties(page).getByLabel('Form').selectOption({ label: 'Raute (Entscheidung)' });
		}
	},
	{
		file: '05-flow-loeschen',
		title: 'flowchart Knoten B mit Kanten löschen',
		name: 'flow.mmd',
		start: 'flowchart TD\n    A[Start] --> B[Mitte]\n    B --> C[Ende]\n',
		async run(page) {
			await node(page, 'B').click();
			await page.keyboard.press('Delete');
			const dialog = page.getByRole('dialog');
			await expect(dialog).toContainText('Löschen bestätigen');
			await dialog.getByRole('button', { name: 'Löschen', exact: true }).click();
			await expect(node(page, 'B')).toHaveCount(0);
		}
	},
	{
		file: '06-flow-richtung',
		title: 'flowchart Richtung auf LR ändern',
		name: 'flow.mmd',
		start: FLOW,
		async run(page) {
			await properties(page).getByLabel('Richtung').selectOption('LR');
		}
	},
	{
		file: '07-flow-subgraph',
		title: 'flowchart A und B in Subgraph gruppieren',
		name: 'flow.mmd',
		start: FLOW,
		async run(page) {
			await node(page, 'A').click();
			await node(page, 'B').click({ modifiers: ['Shift'] });
			await node(page, 'A').click({ button: 'right' });
			await page.getByRole('menuitem', { name: 'In Subgraph gruppieren', exact: true }).click();
		}
	},
	{
		file: '08-seq-teilnehmer',
		title: 'sequence Teilnehmer anlegen',
		name: 'seq.mmd',
		start: SEQ,
		async run(page) {
			await seqTools(page).getByRole('button', { name: '+ Teilnehmer', exact: true }).click();
		}
	},
	{
		file: '09-seq-nachricht',
		title: 'sequence Nachricht Bob an Alice mit -->> anlegen',
		name: 'seq.mmd',
		start: SEQ,
		async run(page) {
			const tools = seqTools(page);
			await tools.getByLabel('Von', { exact: true }).selectOption('Bob');
			await tools.getByLabel('An', { exact: true }).selectOption('Alice');
			await tools.getByLabel('Pfeil', { exact: true }).selectOption('-->>');
			await tools.getByRole('button', { name: '+ Nachricht', exact: true }).click();
		}
	},
	{
		file: '10-seq-notiz',
		title: 'sequence Notiz rechts neben Bob anlegen',
		name: 'seq.mmd',
		start: SEQ,
		async run(page) {
			const tools = seqTools(page);
			await tools.getByLabel('Von', { exact: true }).selectOption('Bob');
			await tools.getByLabel('Platzierung', { exact: true }).selectOption('right of');
			await tools.getByRole('button', { name: '+ Notiz', exact: true }).click();
			await expect(seqSurface(page).getByRole('button', { name: 'Notiz: Notiz' })).toBeVisible();
		}
	}
];

test.beforeEach(async ({ page }) => {
	await startApp(page);
});

for (const action of ACTIONS) {
	test(`AK-M04: ${action.file} ${action.title}`, async ({ page }) => {
		const golden = await readFile(`${GOLDEN}/${action.file}.mmd`);
		await openText(page, action.name, action.start);
		await action.run(page);
		await expect(page.getByTestId('file')).toHaveText(`Datei: ${action.name} (geändert)`);
		const saved = await saveBytes(page);
		expect(saved.toString('utf8')).toBe(golden.toString('utf8'));
		expect(saved.equals(golden), 'byte-genau gleich der Golden-Datei').toBe(true);
	});
}
