// @vitest-environment jsdom
/**
 * T135 C3 (F-06): Nachrichten-Option Erzeugen/Zerstören (`create`/`destroy`) im Sequenz-Canvas.
 * Je Aktion ein Undo-Schritt; Code gültig wie mermaid 12.2 (`getCreatedActors`/
 * `getDestroyedActors`), Modell gleich Re-Parse; Verstöße gegen die mermaid-Regeln abgelehnt.
 */
import { flushSync } from 'svelte';
import mermaid from 'mermaid';
import { afterEach, describe, expect, it } from 'vitest';
import type { Command } from '../../../../src/lib/controllers/commands/history';
import type { DiagramDocument } from '../../../../src/lib/model/types';
import {
	deleteElements,
	rename,
	setLifecycle,
	setMessage
} from '../../../../src/lib/views/canvas/sequence/commands';
import { codeOf, docOf, makeSync, parseOk, semantic } from './helpers';
import { itemEl, mountSequence, settle, unmountAll } from './mount';

afterEach(unmountAll);
mermaid.initialize({ startOnLoad: false });

const S = 'sequenceDiagram\n';

interface SequenceDb {
	getMessages(): { from?: string; to?: string }[];
	getCreatedActors(): Map<string, number>;
	getDestroyedActors(): Map<string, number>;
}

/** mermaid-db: je erzeugtem/zerstörtem Teilnehmer [ID, Quelle, Ziel] der zugehörigen Nachricht. */
async function mermaidLife(text: string) {
	await mermaid.parse(text);
	const db = (await mermaid.mermaidAPI.getDiagramFromText(text)).db as unknown as SequenceDb;
	const messages = db.getMessages();
	const at = (map: Map<string, number>) =>
		[...map].map(([id, i]) => [id, messages[i]?.from, messages[i]?.to]);
	return { created: at(db.getCreatedActors()), destroyed: at(db.getDestroyedActors()) };
}

function modelLife(doc: DiagramDocument) {
	const with_ = (key: string) =>
		doc.edges
			.filter((e) => typeof e.props[key] === 'string')
			.map((e) => [e.props[key], e.sourceId, e.targetId]);
	return { created: with_('create'), destroyed: with_('destroy') };
}

/** Command ausführen: Code wie erwartet, gleich mermaid und Re-Parse, ein Undo, Redo. */
async function step(text: string, command: Command, expected: string) {
	const sync = await makeSync(text);
	await sync.execute(command);
	const code = codeOf(sync);
	const doc = docOf(sync);
	expect(code).toBe(expected);
	expect(modelLife(doc)).toEqual(await mermaidLife(code));
	expect(semantic(doc)).toEqual(semantic(parseOk(code)));
	expect(modelLife(doc)).toEqual(modelLife(parseOk(code)));
	await sync.undo();
	expect(codeOf(sync)).toBe(text);
	await sync.redo();
	expect(codeOf(sync)).toBe(code);
	sync.dispose();
	return doc;
}

async function rejected(text: string, command: Command, message: RegExp) {
	const sync = await makeSync(text);
	const doc = docOf(sync);
	await expect(sync.execute(command)).rejects.toThrow(message);
	expect(docOf(sync)).toBe(doc);
	expect(codeOf(sync)).toBe(text);
	let undo = true;
	sync.commands.subscribe((st) => (undo = st.canUndo))();
	expect(undo).toBe(false);
	sync.dispose();
}

describe('setLifecycle: create', () => {
	it('Ziel erstmals genannt: create-Zeile direkt vor der Nachricht', async () => {
		await step(
			S + '    A->>B: a\n    B->>C: c\n',
			setLifecycle('e2', 'create'),
			S + '    A->>B: a\n    create participant C\n    B->>C: c\n'
		);
	});

	it('ausdrückliche Deklaration entfällt, Typ und Alias gehen in die create-Zeile', async () => {
		const doc = await step(
			S + '    actor C as Carl\n    A->>B: a\n    B->>C: c\n',
			setLifecycle('e2', 'create'),
			S + '    A->>B: a\n    create actor C as Carl\n    B->>C: c\n'
		);
		expect(doc.order).not.toContain('C');
	});

	it('Option aufheben: create-Zeile entfällt, geänderter Teilnehmer wird deklariert', async () => {
		await step(
			S + '    A->>B: a\n    create actor C as Carl\n    B->>C: c\n',
			setLifecycle('e2', ''),
			S + '    A->>B: a\n    actor C as Carl\n    B->>C: c\n'
		);
	});

	it('Ziel schon vorher genannt: abgelehnt', () =>
		rejected(S + 'A->>C: a\nB->>C: c\n', setLifecycle('e2', 'create'), /vor create/));

	it('Ziel in einer Gruppe: abgelehnt (create in Gruppe nur im Code)', () =>
		rejected(S + 'box G\nparticipant C\nend\nA->>C: c\n', setLifecycle('e1', 'create'), /Gruppe/));

	it('keine Nachricht: abgelehnt', () =>
		rejected(S + 'Note over A: n\n', setLifecycle('n1', 'create'), /Nachricht/));

	it('gleiche Option: kein Undo-Schritt', async () => {
		const text = S + 'create participant C\nA->>C: c\n';
		const sync = await makeSync(text);
		await sync.execute(setLifecycle('e1', 'create'));
		let undo = true;
		sync.commands.subscribe((st) => (undo = st.canUndo))();
		expect(undo).toBe(false);
		expect(codeOf(sync)).toBe(text);
		sync.dispose();
	});
});

describe('setLifecycle: destroy', () => {
	it('Ziel zerstören', async () => {
		await step(
			S + '    A->>B: a\n    A-xB: weg\n',
			setLifecycle('e2', 'destroyTarget'),
			S + '    A->>B: a\n    destroy B\n    A-xB: weg\n'
		);
	});

	it('Absender zerstören, dann wechseln auf Ziel (Rohzeile wird neu geschrieben)', async () => {
		await step(
			S + 'A->>B: a\ndestroy A\nA-xB: weg\n',
			setLifecycle('e2', 'destroyTarget'),
			S + 'A->>B: a\ndestroy B\nA-xB: weg\n'
		);
	});

	it('Nachricht nach destroy nennt ihn nicht mehr: abgelehnt', () =>
		rejected(
			S + 'A->>B: a\ndestroy B\nA-xB: weg\n',
			setMessage('e2', { targetId: 'A' }),
			/destroy B/
		));

	it('create und destroy im Code vor einer Nachricht: Option abgelehnt', () =>
		rejected(
			S + 'A->>B: a\ncreate participant C\ndestroy A\nA->>C: c\n',
			setLifecycle('e2', 'destroyTarget'),
			/create\/destroy/
		));
});

describe('erzeugter Teilnehmer', () => {
	it('umbenennen schreibt die create-Zeile neu', async () => {
		await step(
			S + 'create participant C\nA->>C: c\n',
			rename('C', 'Carl'),
			S + 'create participant C as Carl\nA->>C: c\n'
		);
	});

	it('löschen entfernt create-Zeile und Nachricht', async () => {
		await step(
			S + 'A->>B: a\ncreate participant C\nA->>C: c\n',
			deleteElements(['C']),
			S + 'A->>B: a\n'
		);
	});
});

describe('Leiste: Auswahl Erzeugen/Zerstören', () => {
	const select = (target: HTMLElement) =>
		target.querySelector<HTMLSelectElement>('select[aria-label="Teilnehmer erzeugen/zerstören"]')!;

	it('ohne Nachricht deaktiviert; Auswahl setzt die Option, ein Undo', async () => {
		const text = S + '    A->>B: a\n    B->>C: c\n';
		const { sync, target } = await mountSequence(text);
		expect(select(target).disabled).toBe(true);
		itemEl(target, 'e2')!.focus();
		flushSync();
		const el = select(target);
		expect(el.disabled).toBe(false);
		expect([...el.options].map((o) => o.value)).toEqual([
			'',
			'create',
			'destroySource',
			'destroyTarget'
		]);
		el.value = 'create';
		el.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();
		await settle();
		expect(codeOf(sync)).toBe(S + '    A->>B: a\n    create participant C\n    B->>C: c\n');
		flushSync();
		expect(select(target).value).toBe('create');
		await sync.undo();
		expect(codeOf(sync)).toBe(text);
	});

	it('ohne Auswahl dieselben Optionen wie mit Nachricht (Breite stabil, kein Umbruch der Leiste)', async () => {
		// Regression W30 e2e AK-M06: wuchs die Auswahl beim ersten Klick von "Ohne" auf alle
		// Optionen, brach die Leiste um und verschob die Fläche zwischen den Klicks eines Doppelklicks.
		const { target } = await mountSequence(S + '    A->>B: a\n');
		const values = () => [...select(target).options].map((o) => o.value);
		const before = values();
		itemEl(target, 'e1')!.focus();
		flushSync();
		expect(values()).toEqual(before);
	});

	it('Selbstnachricht: nur eine Zerstören-Option, Auswahl bleibt stabil', async () => {
		const text = S + '    A->>B: a\n    B->>B: c\n';
		const { sync, target } = await mountSequence(text);
		itemEl(target, 'e2')!.focus();
		flushSync();
		const el = select(target);
		expect([...el.options].map((o) => o.value)).toEqual(['', 'create', 'destroySource']);
		el.value = 'destroySource';
		el.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();
		await settle();
		expect(codeOf(sync)).toBe(S + '    A->>B: a\n    destroy B\n    B->>B: c\n');
		flushSync();
		expect(select(target).value).toBe('destroySource');
	});
});
