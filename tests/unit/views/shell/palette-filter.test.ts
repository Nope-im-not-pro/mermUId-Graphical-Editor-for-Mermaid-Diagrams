import { describe, expect, it } from 'vitest';
import { filterTools, TOOLS } from '../../../../src/lib/views/shell/palette';

const ids = (query: string) => filterTools(TOOLS, query).map((t) => t.id);

describe('filterTools (Palette-Suche)', () => {
	it('leere oder nur aus Leerzeichen bestehende Suche liefert alle Werkzeuge', () => {
		expect(filterTools(TOOLS, '')).toEqual(TOOLS);
		expect(filterTools(TOOLS, '   ')).toEqual(TOOLS);
	});

	it('findet Teilwörter ohne Rücksicht auf Groß-/Kleinschreibung', () => {
		expect(ids('raute')).toEqual(['shape:diamond']);
		expect(ids('  VORLAGE ')).toEqual(['template:linear', 'template:decision']);
		expect(ids('subgraph')).toEqual(['container']);
	});

	it('ohne Treffer leere Liste', () => {
		expect(ids('gibtsnicht')).toEqual([]);
	});
});
