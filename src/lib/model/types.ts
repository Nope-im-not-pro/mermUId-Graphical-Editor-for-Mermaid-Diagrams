/**
 * Diagramm-Modell nach KONZEPT §8. Unabhängig von Mermaid-Syntax, serialisierbar,
 * versioniert. Typspezifische Felder stehen in `kind` plus `props`.
 * `sourceText` = Original-Quelltext nach dem letzten Parse; leer ('') = kanonisch serialisieren.
 * `parentId` = ID des umgebenden Containers, `null` auf oberster Ebene.
 */

export type StyleMap = Record<string, string>;
export type PropsMap = Record<string, unknown>;

/** `[x, y, w, h]` */
export type Position = [number, number, number, number];

export interface Header {
	/** YAML-Frontmatter, unverändert erhalten. */
	frontmatter: string;
	/** `%%{init: ...}%%`-Direktiven, unverändert erhalten. */
	directives: string[];
	/**
	 * Kanten-IDs in `edges`-Reihenfolge beim letzten Parse (T142, ersetzt Index/Anzahl an den Kanten).
	 * Der Flowchart-Serializer erkennt daran eine unveränderte Kantenfolge (`linkStyle`-Indizes);
	 * fehlt das Feld (z. B. Sequence), gilt die Folge als geändert.
	 */
	parsedEdgeIds?: string[];
}

export interface DiagramNode {
	id: string;
	kind: string;
	label: string;
	shape: string;
	cssClasses: string[];
	style: StyleMap;
	props: PropsMap;
	parentId: string | null;
	sourceText: string;
}

export interface DiagramEdge {
	id: string;
	kind: string;
	sourceId: string;
	targetId: string;
	label: string;
	lineStyle: string;
	arrowHead: string;
	/** Ersetzt den indexbasierten `linkStyle`; Indizes berechnet der Serializer aus `order`. */
	style: StyleMap;
	props: PropsMap;
	parentId: string | null;
	sourceText: string;
}

export interface Section {
	label: string;
	/** Reihenfolge der Mitglieder (Knoten, Kanten, Container) innerhalb der Section. */
	memberIds: string[];
}

export interface Container {
	id: string;
	kind: string;
	label: string;
	direction: string;
	parentId: string | null;
	sections: Section[];
	props: PropsMap;
	sourceText: string;
}

export interface ClassDef {
	name: string;
	style: StyleMap;
	sourceText: string;
}

export interface RawBlock {
	id: string;
	rawText: string;
}

export interface Comment {
	id: string;
	text: string;
}

export interface LayoutMeta {
	mode: 'manual' | 'auto';
	engine: string;
	/** Element-ID zu `[x, y, w, h]`; nur Layout-Klasse "Graph". */
	positions: Record<string, Position>;
	gridSize: number;
	snap: boolean;
}

export interface DiagramDocument {
	id: string;
	diagramType: string;
	title: string;
	header: Header;
	/**
	 * IDs aller Top-Level-Statements in Quelltext-Reihenfolge. ClassDefs haben keine ID und
	 * stehen hier als `classDef:<name>` (O-12), damit kein Konflikt mit Knoten-IDs entsteht.
	 */
	order: string[];
	nodes: DiagramNode[];
	edges: DiagramEdge[];
	containers: Container[];
	classDefs: ClassDef[];
	rawBlocks: RawBlock[];
	comments: Comment[];
	layout: LayoutMeta;
	modelVersion: number;
}

export interface ParseError {
	line: number;
	column: number;
	message: string;
}

export type ParseResult = { ok: true; doc: DiagramDocument } | { ok: false; errors: ParseError[] };

export interface DiagramAdapter {
	/** Mermaid-Diagrammtyp, z. B. `flowchart`, `sequence`. */
	type: string;
	parse(text: string): ParseResult;
	serialize(doc: DiagramDocument): string;
	/**
	 * Diagramm-Richtung in Buchstabenform (`TB`, `TD`, `LR`, `RL`, `BT`), leer ohne Angabe.
	 * Nur für Typen mit Richtung (Flowchart); Naht zum Sync-Orchestrator T13.
	 */
	getDirection?(doc: DiagramDocument): string;
	/**
	 * Hinweise zum geparsten Dokument, bereits übersetzt; nie Fehler (O-83). Zeilenangaben
	 * beziehen sich auf den an `parse` übergebenen Text.
	 */
	warnings?(doc: DiagramDocument): string[];
}
