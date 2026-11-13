import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	findMermaidBlocks,
	planBlockSelection,
	readMarkdown,
	replaceMermaidBlock
} from '../../../../src/lib/services/file';

const fixture = readFileSync(
	new URL('../../../fixtures/file/three-blocks.md', import.meta.url),
	'utf8'
);

describe('findMermaidBlocks mit Fixture three-blocks.md', () => {
	const blocks = findMermaidBlocks(fixture);

	it('findet genau 3 Mermaid-Blöcke, ignoriert js-Block und verschachteltes Beispiel', () => {
		expect(blocks).toHaveLength(3);
		expect(blocks.map((b) => b.index)).toEqual([0, 1, 2]);
		expect(blocks[0].code).toBe('flowchart TD\n  A[Start] --> B[Ende]');
		expect(blocks[1].code).toBe('sequenceDiagram\n  Alice->>Bob: Hallo');
		expect(blocks[2].code).toBe('flowchart LR\n  C --> D');
	});

	it('liefert Fence-Zeichen und Info-String', () => {
		expect(blocks[0].fence).toBe('```');
		expect(blocks[1].fence).toBe('~~~');
		expect(blocks[1].info).toBe('mermaid title="Ablauf"');
		expect(blocks.every((b) => b.closed)).toBe(true);
	});

	it('Offsets zeigen auf Fence-Zeilen und Inhalt', () => {
		const b = blocks[0];
		expect(fixture.slice(b.start, b.contentStart)).toBe('```mermaid\n');
		expect(fixture.slice(b.contentEnd, b.end)).toBe('```\n');
	});
});

describe('replaceMermaidBlock', () => {
	it('zweiten Block ändern: Text außerhalb des Blocks byte-gleich', () => {
		const blocks = findMermaidBlocks(fixture);
		const second = blocks[1];
		const out = replaceMermaidBlock(fixture, 1, 'sequenceDiagram\n  Bob->>Alice: Tschüss');

		const before = fixture.slice(0, second.contentStart);
		const after = fixture.slice(second.contentEnd);
		expect(out.startsWith(before)).toBe(true);
		expect(out.endsWith(after)).toBe(true);
		expect(Buffer.from(out.slice(0, before.length))).toEqual(Buffer.from(before));
		expect(Buffer.from(out.slice(out.length - after.length))).toEqual(Buffer.from(after));
		expect(out.slice(before.length, out.length - after.length)).toBe(
			'sequenceDiagram\n  Bob->>Alice: Tschüss\n'
		);

		const again = findMermaidBlocks(out);
		expect(again).toHaveLength(3);
		expect(again[0].code).toBe(blocks[0].code);
		expect(again[1].code).toBe('sequenceDiagram\n  Bob->>Alice: Tschüss');
		expect(again[2].code).toBe(blocks[2].code);
	});

	it('zweiten Block in CRLF-Datei ändern: Block-Zeilenenden folgen der Datei', () => {
		const crlf = fixture.replace(/\n/g, '\r\n');
		const second = findMermaidBlocks(crlf)[1];
		const out = replaceMermaidBlock(crlf, 1, 'sequenceDiagram\n  Bob->>Alice: Tschüss');
		expect(out.slice(0, second.contentStart)).toBe(crlf.slice(0, second.contentStart));
		expect(out.endsWith(crlf.slice(second.contentEnd))).toBe(true);
		expect(out).toContain(
			'~~~mermaid title="Ablauf"\r\nsequenceDiagram\r\n  Bob->>Alice: Tschüss\r\n~~~'
		);
		expect(out.replace(/\r\n/g, '')).not.toMatch(/\n/);
	});

	it('gemischte Datei: Block übernimmt das Zeilenende der öffnenden Fence-Zeile', () => {
		const md = 'Text\n```mermaid\r\nalt\r\n```\r\nEnde\n';
		expect(replaceMermaidBlock(md, 0, 'a\nb')).toBe('Text\n```mermaid\r\na\r\nb\r\n```\r\nEnde\n');
	});

	it('eingerückter Block: Einrückung wird beim Lesen entfernt und beim Schreiben ergänzt', () => {
		const md = '  ```mermaid\n  flowchart TD\n    A --> B\n\n  ```\n';
		const [block] = findMermaidBlocks(md);
		expect(block.indent).toBe(2);
		expect(block.code).toBe('flowchart TD\n  A --> B\n');
		expect(replaceMermaidBlock(md, 0, 'flowchart LR\n\n  X --> Y')).toBe(
			'  ```mermaid\n  flowchart LR\n\n    X --> Y\n  ```\n'
		);
	});

	it('leerer neuer Inhalt ergibt leeren Block', () => {
		expect(replaceMermaidBlock('```mermaid\nalt\n```\n', 0, '')).toBe('```mermaid\n```\n');
	});

	it('nicht geschlossener Block reicht bis Dokumentende und bleibt offen', () => {
		const md = 'Vorher\n```mermaid\nflowchart TD';
		const [block] = findMermaidBlocks(md);
		expect(block.closed).toBe(false);
		expect(block.end).toBe(md.length);
		expect(block.code).toBe('flowchart TD');
		expect(replaceMermaidBlock(md, 0, 'flowchart LR')).toBe('Vorher\n```mermaid\nflowchart LR');
		expect(replaceMermaidBlock('```mermaid\na\n', 0, 'b')).toBe('```mermaid\nb\n');
	});

	it('öffnende Fence als letzte Zeile ohne Zeilenende', () => {
		const md = 'x\n```mermaid';
		expect(findMermaidBlocks(md)[0].code).toBe('');
		expect(replaceMermaidBlock(md, 0, 'flowchart TD')).toBe('x\n```mermaid\nflowchart TD');
	});

	it('ungültiger Index wirft Fehler ohne Pfadangabe', () => {
		expect(() => replaceMermaidBlock(fixture, 3, 'x')).toThrow(/Mermaid-Block 3/);
		expect(() => replaceMermaidBlock(fixture, -1, 'x')).toThrow(RangeError);
	});
});

describe('replaceMermaidBlock: neuer Code mit Fence-Zeilen (Fence wird verlängert)', () => {
	const md = 'A\n```mermaid\nx\n```\nB\n```mermaid\nz\n```\nC\n';

	function checkReplace(source: string, index: number, code: string, fence: string): string {
		const before = findMermaidBlocks(source);
		const block = before[index];
		const out = replaceMermaidBlock(source, index, code);
		const after = findMermaidBlocks(out);
		expect(after).toHaveLength(before.length);
		expect(after[index].code).toBe(code);
		expect(after[index].fence).toBe(fence);
		after.forEach((b, i) => {
			if (i !== index) expect(b.code).toBe(before[i].code);
		});
		// Übriger Text byte-gleich, nur die Fence-Zeichen des Blocks sind länger.
		expect(out.slice(0, after[index].start)).toBe(source.slice(0, block.start));
		expect(out.slice(after[index].end)).toBe(source.slice(block.end));
		const grow = (s: string) => s.replace(block.fence, fence);
		expect(out.slice(after[index].start, after[index].contentStart)).toBe(
			grow(source.slice(block.start, block.contentStart))
		);
		expect(out.slice(after[index].contentEnd, after[index].end)).toBe(
			grow(source.slice(block.contentEnd, block.end))
		);
		return out;
	}

	it('Schließ-Fence gleicher Länge im neuen Code', () => {
		const out = checkReplace(md, 0, 'a\n```\nb', '````');
		expect(out).toBe('A\n````mermaid\na\n```\nb\n````\nB\n```mermaid\nz\n```\nC\n');
	});

	it('längere Schließ-Fence, eingerückt und mit Leerraum dahinter', () => {
		checkReplace(md, 0, 'a\n  `````  \nb', '``````');
		checkReplace(md, 1, '````\n```', '`````');
	});

	it('Fences anderen Zeichens oder mit Info-String bleiben ohne Verlängerung', () => {
		const out = replaceMermaidBlock(md, 0, 'a\n~~~~\n``` x\nb');
		expect(out).toBe('A\n```mermaid\na\n~~~~\n``` x\nb\n```\nB\n```mermaid\nz\n```\nC\n');
	});

	it('Tilde-Fence mit Info-String, CRLF und eingerückter Block', () => {
		checkReplace('~~~mermaid title="t"\r\nalt\r\n~~~\r\nRest\r\n', 0, 'a\n~~~~~', '~~~~~~');
		checkReplace('  ```mermaid\n  alt\n  ```\nRest\n', 0, 'a\n `````', '``````');
	});

	it('offener Block am Dokumentende: öffnende Fence wird verlängert', () => {
		const out = checkReplace('Vorher\n```mermaid\nalt\n', 0, 'a\n```\nb', '````');
		expect(out).toBe('Vorher\n````mermaid\na\n```\nb\n');
	});

	it('Zeile mit mehr als 3 Leerzeichen Einrückung ist keine Schließ-Fence', () => {
		const out = replaceMermaidBlock(md, 0, '    ```');
		expect(out).toBe('A\n```mermaid\n    ```\n```\nB\n```mermaid\nz\n```\nC\n');
		expect(findMermaidBlocks(out)).toHaveLength(2);
	});
});

describe('replaceMermaidBlock: Roundtrip ohne Änderung ist byte-gleich', () => {
	const cases: Record<string, string> = {
		'Leerzeile am Ende': 'x\n```mermaid\na\n\n```\n',
		'mehrere Leerzeilen am Ende': 'x\n```mermaid\na\n\n\n```\ny\n',
		CRLF: 'x\r\n```mermaid\r\na\r\n\r\nb\r\n```\r\ny\r\n',
		'gemischte Zeilenenden im Block': 'x\n```mermaid\na\r\nb\n```\n',
		eingerückt: '  ```mermaid\n  a\n    b\n\n  ```\n',
		'eingerückt, Inhalt weniger eingerückt': '   ```mermaid\n a\nb\n   ```\n',
		'Leerraum-Zeile im eingerückten Block': '  ```mermaid\n  a\n  \n  b\n  ```\n',
		leer: '```mermaid\n```\n',
		'leer mit einer Leerzeile': '```mermaid\n\n```\n',
		'offen am Dokumentende': '```mermaid\na\n\n',
		'offen ohne Zeilenende': '```mermaid',
		Fixture: fixture
	};

	for (const [name, source] of Object.entries(cases)) {
		it(name, () => {
			findMermaidBlocks(source).forEach((block, i) => {
				expect(replaceMermaidBlock(source, i, block.code)).toBe(source);
			});
		});
	}

	it('Code-Vertrag: abschließende Leerzeile im Code bleibt beim Ersetzen erhalten', () => {
		const out = replaceMermaidBlock('x\n```mermaid\nalt\n```\n', 0, 'a\n');
		expect(out).toBe('x\n```mermaid\na\n\n```\n');
		expect(findMermaidBlocks(out)[0].code).toBe('a\n');
	});
});

describe('replaceMermaidBlock: offener leerer Block am Dokumentende', () => {
	it('öffnende Zeile mit Zeilenende: neuer Inhalt endet mit Zeilenende', () => {
		expect(replaceMermaidBlock('```mermaid\n', 0, 'y')).toBe('```mermaid\ny\n');
		expect(replaceMermaidBlock('x\r\n```mermaid\r\n', 0, 'y\nz')).toBe(
			'x\r\n```mermaid\r\ny\r\nz\r\n'
		);
	});

	it('öffnende Zeile ohne Zeilenende bleibt ohne Schluss-Zeilenumbruch', () => {
		expect(replaceMermaidBlock('```mermaid', 0, 'y')).toBe('```mermaid\ny');
	});
});

describe('replaceMermaidBlock: offener Block liefert exakt den neuen Code (P3)', () => {
	const sources = [
		'Vorher\n```mermaid\nalt',
		'Vorher\n```mermaid\nalt\n',
		'Vorher\n```mermaid\nalt\n\n',
		'x\r\n```mermaid\r\nalt',
		'```mermaid\n',
		'```mermaid'
	];
	const codes = ['neu', 'neu\n', 'neu\n\n', 'a\nb', 'a\nb\n', '\n', '\n\n', ''];
	for (const source of sources) {
		it.each(codes)(`${JSON.stringify(source)} mit Code %j`, (code) => {
			const out = replaceMermaidBlock(source, 0, code);
			const [block] = findMermaidBlocks(out);
			expect(block.closed).toBe(false);
			expect(block.code).toBe(code);
			expect(out.startsWith(source.slice(0, findMermaidBlocks(source)[0].start))).toBe(true);
		});
	}

	it('abschließende Leerzeile ohne Schluss-Umbruch im Dokument', () => {
		expect(replaceMermaidBlock('```mermaid\nalt', 0, 'a\n')).toBe('```mermaid\na\n\n');
		expect(replaceMermaidBlock('```mermaid', 0, 'a\n')).toBe('```mermaid\na\n\n');
	});
});

describe('Fence-Erkennung nach CommonMark (Grenzen)', () => {
	it('erkennt bis 3 Leerzeichen Einrückung, nicht 4 oder Tab', () => {
		expect(findMermaidBlocks('   ```mermaid\na\n   ```\n')).toHaveLength(1);
		expect(findMermaidBlocks('    ```mermaid\na\n    ```\n')).toHaveLength(0);
		expect(findMermaidBlocks('\t```mermaid\na\n\t```\n')).toHaveLength(0);
	});

	it('Schließ-Fence: gleiches Zeichen, mindestens gleiche Länge, nur Leerraum danach', () => {
		const md = '````mermaid\na\n```\n~~~~\n```` x\n`````  \nnach\n';
		const [block] = findMermaidBlocks(md);
		expect(block.code).toBe('a\n```\n~~~~\n```` x');
		expect(md.slice(block.end)).toBe('nach\n');
	});

	it('Info-String: erstes Wort muss genau "mermaid" sein', () => {
		expect(findMermaidBlocks('``` mermaid  \na\n```\n')).toHaveLength(1);
		expect(findMermaidBlocks('```mermaid{x}\na\n```\n')).toHaveLength(0);
		expect(findMermaidBlocks('```Mermaid\na\n```\n')).toHaveLength(0);
		expect(findMermaidBlocks('```mermaidx\na\n```\n')).toHaveLength(0);
		expect(findMermaidBlocks('```\na\n```\n')).toHaveLength(0);
	});

	it('Backtick-Fence mit Backtick im Info-String ist keine Fence', () => {
		const md = '```mermaid `x`\na\n```mermaid\nb\n```\n';
		const blocks = findMermaidBlocks(md);
		expect(blocks).toHaveLength(1);
		expect(blocks[0].code).toBe('b');
	});

	it('Tilde-Fence darf Backticks im Info-String haben', () => {
		expect(findMermaidBlocks('~~~mermaid `x`\na\n~~~\n')).toHaveLength(1);
	});

	it('zwei Zeichen sind keine Fence', () => {
		expect(findMermaidBlocks('``mermaid\na\n``\n')).toHaveLength(0);
	});

	it('Blockquote und Listen-Container werden nicht ausgewertet', () => {
		expect(findMermaidBlocks('> ```mermaid\n> a\n> ```\n')).toHaveLength(0);
		expect(findMermaidBlocks('- ```mermaid\n  a\n  ```\n')).toHaveLength(0);
	});
});

describe('planBlockSelection (D-17 a)', () => {
	it('kein Block: kein Ziel, keine Auswahl', () => {
		expect(planBlockSelection([])).toEqual({ count: 0, needsSelection: false, defaultIndex: null });
	});

	it('ein Block: direkt der erste, keine Auswahl', () => {
		const blocks = findMermaidBlocks('```mermaid\na\n```\n');
		expect(planBlockSelection(blocks)).toEqual({
			count: 1,
			needsSelection: false,
			defaultIndex: 0
		});
	});

	it('mehr als ein Block: Kennzeichen "Auswahl nötig"', () => {
		expect(planBlockSelection(findMermaidBlocks(fixture))).toEqual({
			count: 3,
			needsSelection: true,
			defaultIndex: null
		});
	});
});

describe('readMarkdown', () => {
	it('entfernt BOM, merkt Zeilenende, liefert Blöcke und Auswahl', () => {
		const bytes = new Uint8Array([
			0xef,
			0xbb,
			0xbf,
			...new TextEncoder().encode('```mermaid\r\na\r\n```\r\n')
		]);
		const doc = readMarkdown(bytes);
		expect(doc.text.startsWith('```')).toBe(true);
		expect(doc.hadBom).toBe(true);
		expect(doc.lineEnding).toBe('crlf');
		expect(doc.blocks).toHaveLength(1);
		expect(doc.blocks[0].code).toBe('a');
		expect(doc.selection.defaultIndex).toBe(0);
	});
});
