/**
 * Adapter-Register des Sync-Orchestrators. Einziger Import von `services/adapters` in `src/`
 * (KONZEPT §6.1, statischer Test). `parse` ist synchron, `validate` asynchron über mermaid (O-15).
 */
import type { DiagramAdapter, DiagramDocument, ParseError } from '../../model/types';
import { flowchartAdapter, validate as validateFlowchart } from '../../services/adapters/flowchart';
import {
	autonumberText,
	BOX_COLORS,
	isBoxColor,
	lifecycleLine,
	messageLexes,
	rawEvents,
	sequenceAdapter,
	validate as validateSequence,
	withoutAutonumber,
	type Lifecycle,
	type RawEvents
} from '../../services/adapters/sequence';

export type { RawDeclaration, RawEvents, RawStep } from '../../services/adapters/sequence';

/** Diagrammtypen mit grafischem Adapter. */
export type AdapterType = 'flowchart' | 'sequence';

export interface AdapterEntry {
	adapter: DiagramAdapter;
	validate(text: string): Promise<ParseError[]>;
}

export type AdapterRegistry = Readonly<Record<AdapterType, AdapterEntry>>;

export const defaultAdapters: AdapterRegistry = {
	flowchart: { adapter: flowchartAdapter, validate: validateFlowchart },
	sequence: { adapter: sequenceAdapter, validate: validateSequence }
};

/**
 * Sequenz-Erkennung des Adapters für die View-Schicht (T128, V-25): Lexer-Nachbildung für
 * Nachrichtenzeilen und Auswertung von RawBlock-Text; `autonumber`-Text für den Schalter
 * "Nummerierung" (T135, O-169); Farb-Allow-Liste der Teilnehmer-Gruppe `box` (T135 C2); `create`/`destroy`-Zeilen (T135 C3).
 * Reine Funktionen, kein parse/serialize.
 */
export const sequenceGrammar: {
	messageLexes(from: string, arrow: string, activation: string, to: string): boolean;
	rawEvents(rawText: string): RawEvents;
	withoutAutonumber(rawText: string): string;
	autonumberText(doc: DiagramDocument): string;
	isBoxColor(value: string): boolean;
	boxColors: readonly string[];
	lifecycleLine(text: string): Lifecycle | null;
} = {
	messageLexes,
	rawEvents,
	withoutAutonumber,
	autonumberText,
	isBoxColor,
	boxColors: BOX_COLORS,
	lifecycleLine
};
