import { describe, expect, it } from 'vitest';
import { originLine } from '../../../../src/lib/services/render/lines';

describe('originLine', () => {
	it('ohne Vorverarbeitung bleibt die Zeile gleich', () => {
		expect(originLine('flowchart TD\n    A --> B\n    C -->\n', 3)).toBe(3);
	});

	it('rechnet Kommentar- und Leerzeilen am Anfang heraus', () => {
		expect(originLine('%% eins\n\nflowchart TD\n    A --> B\n    C -->\n', 3)).toBe(5);
	});

	it('rechnet Kommentarzeilen mitten im Text heraus', () => {
		expect(originLine('flowchart TD\n    %% x\n    A --> B\n    C -->\n', 3)).toBe(4);
	});

	it('rechnet Frontmatter und mehrzeilige Direktiven heraus', () => {
		const code =
			'---\ntitle: T\nconfig:\n  theme: dark\n---\n%%{init: {\n  "theme": "forest"\n}}%%\n' +
			'flowchart TD\n    A --> B\n    C -->\n';
		expect(originLine(code, 1)).toBe(9);
		expect(originLine(code, 3)).toBe(11);
	});

	it('behandelt CRLF und einzelnes CR wie mermaid', () => {
		expect(originLine('%% k\r\nflowchart TD\r\n    A -->\r\n', 2)).toBe(3);
		expect(originLine('%% k\rflowchart TD\r    A -->\r', 2)).toBe(3);
	});

	it('Frontmatter mit Einrückung, Leerraum nach dem Zaun und ohne Abschluss', () => {
		expect(originLine('  ---  \n  title: x\n  ---  \n\nflowchart TD\n', 1)).toBe(5);
		expect(originLine('---\ntitle: x\nflowchart TD\n', 1)).toBe(1);
		expect(originLine('---flowchart TD\n', 1)).toBe(1);
	});

	it('nimmt den ersten schließenden Zaun', () => {
		expect(originLine('---\na: 1\n---\nflowchart TD\n---\nx\n', 1)).toBe(4);
	});

	it('Zeilen hinter dem Textende werden fortgezählt', () => {
		expect(originLine('flowchart TD\n    A -->\n', 4)).toBe(4);
		expect(originLine('flowchart TD', 2)).toBe(2);
		expect(originLine('', 1)).toBe(1);
	});
});
