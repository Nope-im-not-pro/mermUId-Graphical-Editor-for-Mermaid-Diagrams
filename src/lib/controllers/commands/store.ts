/**
 * Svelte-Store-Anbindung des Command-Stacks (Controller-Schicht). Abonnenten erhalten
 * unveränderliche Snapshots: Dokumente werden tief eingefroren; von außen kommende
 * Dokumente (Startzustand, `codeApply`) werden vorher kopiert, damit spätere Mutationen
 * des Aufrufers den Store nicht erreichen. `codeApply` gleicht zuerst per `shareUnchanged`
 * mit dem aktuellen Stand ab (T142, O-121): wertgleiche Teile kommen aus dem eingefrorenen
 * Vorzustand, kopiert (`structuredClone`) wird nur, was danach nicht vom Store stammt, danach
 * `deepFreeze`. Code-Einträge mit Quelltext halten kein Modell (Rückfall E): `undo`/`redo` bauen
 * es über die übergebene `Rebuild`-Funktion neu, das Ergebnis läuft durch denselben Abgleich
 * gegen den aktuellen Stand. Vom Store bereits tief eingefrorene Teilbäume werden
 * übersprungen, so kostet ein Command nur die durch die Operation neu erzeugten Objekte; fremd
 * (flach) eingefrorene Objekte werden weiter durchlaufen. Payloads bleiben unberührt (Eigentum
 * des Aufrufers).
 */
import { writable, type Readable } from 'svelte/store';
import type { DiagramDocument } from '../../model/types';
import type { IdCounters } from '../../model/ids';
import { shareUnchanged } from '../../model/share';
import {
	codeApply,
	createHistory,
	execute,
	redo,
	transaction,
	undo,
	type Command,
	type History,
	type HistoryEntry,
	type Rebuild
} from './history';

export interface CommandState {
	readonly doc: DiagramDocument;
	readonly canUndo: boolean;
	readonly canRedo: boolean;
}

export interface CommandStore extends Readable<CommandState> {
	execute(command: Command, payload?: unknown): void;
	transaction(label: string, commands: readonly Command[], payload?: unknown): void;
	/**
	 * `floor`: optionale Untergrenze des ID-Zählers (D-03, O-22), z. B. aus der Metadaten-Zeile.
	 * `source`: Code-Text, dessen Parse `next` ist; der Eintrag hält dann kein Modell (T142 E).
	 */
	codeApply(next: DiagramDocument, payload?: unknown, floor?: IdCounters, source?: string): void;
	/**
	 * Liefert den rückgängig gemachten Eintrag (inkl. Payload) oder `undefined`. `rebuild` baut
	 * das Modell eines Code-Eintrags neu; Pflicht, sobald Einträge mit Quelltext existieren.
	 */
	undo(rebuild?: Rebuild): HistoryEntry | undefined;
	/** Liefert den wiederhergestellten Eintrag (inkl. Payload) oder `undefined`. */
	redo(rebuild?: Rebuild): HistoryEntry | undefined;
}

/** Vom Store vollständig (tief) eingefrorene Objekte. */
const deeplyFrozen = new WeakSet<object>();

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !deeplyFrozen.has(value)) {
		deeplyFrozen.add(value);
		Object.freeze(value);
		for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
	}
	return value;
}

/** Hat `value` unterhalb (inklusive) ein vom Store eingefrorenes Objekt? */
function holdsShared(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	if (deeplyFrozen.has(value)) return true;
	return Object.values(value).some(holdsShared);
}

/**
 * Kopiert alles, was nicht vom Store stammt: Teilbäume ohne Store-Objekte per
 * `structuredClone`, gemischte Hüllen flach mit rekursiv isolierten Werten.
 */
function isolate<T>(value: T): T {
	if (!value || typeof value !== 'object' || deeplyFrozen.has(value)) return value;
	if (!holdsShared(value)) return structuredClone(value);
	if (Array.isArray(value)) return value.map(isolate) as T;
	// Wie `shareObject`: Prototyp bleibt, ein Schlüssel `__proto__` bleibt eigene Eigenschaft.
	const out = Object.create(Object.getPrototypeOf(value)) as Record<string, unknown>;
	for (const [key, v] of Object.entries(value)) {
		Object.defineProperty(out, key, {
			value: isolate(v),
			enumerable: true,
			writable: true,
			configurable: true
		});
	}
	return out as T;
}

function toState(h: History): CommandState {
	return Object.freeze({
		doc: deepFreeze(h.doc),
		canUndo: h.past.length > 0,
		canRedo: h.future.length > 0
	});
}

/** `source`: Code-Text, dessen Parse `initial` ist (T142 E). */
export function createCommandStore(
	initial: DiagramDocument,
	counters?: IdCounters,
	source?: string
): CommandStore {
	let history = createHistory(structuredClone(initial), counters, source);
	const state = writable(toState(history));
	/** Fremdes Modell übernehmen: teilen mit dem aktuellen Stand, Rest isolieren. */
	const adopt = (next: DiagramDocument) => isolate(shareUnchanged(history.doc, next));
	const commit = (next: History) => {
		history = next;
		state.set(toState(history));
	};
	return {
		subscribe: state.subscribe,
		execute: (command, payload) => commit(execute(history, command, payload)),
		transaction: (label, commands, payload) =>
			commit(execute(history, transaction(label, commands), payload)),
		codeApply: (next, payload, floor, source) =>
			commit(codeApply(history, adopt(next), payload, floor, source)),
		undo(rebuild) {
			const entry = history.past.at(-1);
			if (entry) commit(undo(history, rebuild && ((text) => adopt(rebuild(text)))));
			return entry;
		},
		redo(rebuild) {
			const entry = history.future[0];
			if (entry) commit(redo(history, rebuild && ((text) => adopt(rebuild(text)))));
			return entry;
		}
	};
}
