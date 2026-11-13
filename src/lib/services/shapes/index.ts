/**
 * Geteiltes Geometrie-Modul nach D-04 (Entscheid D3, Option D; Verträge O-24).
 *
 * Reine Funktionen ohne DOM und ohne Svelte: Knotenformen als SVG-Pfad, Label-Umbruch mit
 * injizierter Textmetrik, Kantenpfade über `@xyflow/system` mit festen Parametern, Linienmuster
 * und Pfeilspitzen als Daten. Editor-Knoten (T17) und Exporter (T20) nutzen ausschließlich diese
 * Funktionen, damit Editor-Canvas und Export-SVG dieselbe Geometrie zeigen. Keine externen
 * Ressourcen, kein Fremdobjekt-Element im SVG (D-04 e, PNG ohne Canvas-Tainting).
 * Formnamen spiegeln den flowchart-Katalog samt `@{ shape }`-Formen, ohne die Adapter-Schicht zu importieren (O-27).
 */
export {
	META_SHAPE_NAMES,
	SHAPE_NAMES,
	shapePath,
	type MetaShapeName,
	type ShapeName
} from './paths';
export { fitShape, labelArea, wrapLabel } from './label';
export {
	BEZIER_CURVATURE,
	SMOOTHSTEP_BORDER_RADIUS,
	SMOOTHSTEP_OFFSET,
	SELF_LOOP_SIZE,
	edgePath,
	linePattern,
	markerFor,
	selfLoopPath,
	type EdgeEnd,
	type EdgeGeometry,
	type EdgeKind,
	type EdgeMarkers,
	type LinePattern,
	type LoopBox,
	type LoopEnd,
	type MarkerGeometry,
	type MarkerKind,
	type SelfLoopGeometry
} from './edges';
