/**
 * Sequence-Adapter (T11): Parser, Serializer und asynchrone Validierung über mermaid (O-15).
 * Unterstützte Untermenge: SUBSET.md.
 */
import type { DiagramAdapter } from '../../../model/types';
import { parse } from './parser';
import { serialize } from './serializer';
import { validate } from './validate';

export { parse, serialize, validate };
/** Sequenz-Erkennung für die View (T128, V-25); Bereitstellung über `controllers/sync`. */
export { messageLexes } from './lexer';
export { autonumberText } from './serializer';
export {
	BOX_COLORS,
	isBoxColor,
	lifecycleLine,
	rawEvents,
	withoutAutonumber,
	type Lifecycle,
	type RawDeclaration,
	type RawEvents,
	type RawStep
} from './syntax';

export const sequenceAdapter: DiagramAdapter = { type: 'sequence', parse, serialize };
