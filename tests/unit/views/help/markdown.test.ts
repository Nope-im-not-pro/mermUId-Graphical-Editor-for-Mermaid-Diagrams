import { describe, expect, it } from 'vitest';
import {
	mermaidBlocks,
	parseInline,
	parseMarkdown,
	type Block
} from '../../../../src/lib/views/help/markdown';

const text = (t: string) => ({ type: 'text', text: t }) as const;
const code = (t: string) => ({ type: 'code', text: t }) as const;

describe('parseInline', () => {
	it('Text und Inline-Code', () => {
		expect(parseInline('a `b` c')).toEqual([text('a '), code('b'), text(' c')]);
	});

	it('Code-Span mit mehreren Backticks und Randleerzeichen', () => {
		expect(parseInline('x `` a`b `` y')).toEqual([text('x '), code('a`b'), text(' y')]);
	});

	it('nicht geschlossener Backtick bleibt Text', () => {
		expect(parseInline('a `b')).toEqual([text('a `b')]);
	});

	it('Backslash-Escape für Satzzeichen, sonst unverändert', () => {
		expect(parseInline('a \\* b \\q')).toEqual([text('a * b \\q')]);
	});

	it('HTML bleibt Text', () => {
		expect(parseInline('<b>x</b>')).toEqual([text('<b>x</b>')]);
	});

	it('leere Eingabe', () => {
		expect(parseInline('')).toEqual([]);
	});
});

describe('parseMarkdown', () => {
	it('Überschriften mit Ebene und schließenden Rauten', () => {
		expect(parseMarkdown('# Eins\n\n### Drei ##\n')).toEqual<Block[]>([
			{ type: 'heading', level: 1, content: [text('Eins')] },
			{ type: 'heading', level: 3, content: [text('Drei')] }
		]);
	});

	it('Absatz verbindet Zeilen, Leerzeile trennt', () => {
		expect(parseMarkdown('a\nb\n\nc')).toEqual<Block[]>([
			{ type: 'paragraph', content: [text('a b')] },
			{ type: 'paragraph', content: [text('c')] }
		]);
	});

	it('Absatz endet vor Überschrift, Liste und Fence', () => {
		const blocks = parseMarkdown('a\n# H\nb\n- l\nc\n```\nx\n```');
		expect(blocks.map((b) => b.type)).toEqual([
			'paragraph',
			'heading',
			'paragraph',
			'list',
			'paragraph',
			'code'
		]);
	});

	it('ungeordnete und geordnete Liste mit Fortsetzungszeile', () => {
		expect(parseMarkdown('- a\n  weiter\n* `b`\n\n1. x\n2) y')).toEqual<Block[]>([
			{ type: 'list', ordered: false, items: [[text('a weiter')], [code('b')]] },
			{ type: 'list', ordered: true, items: [[text('x')], [text('y')]] }
		]);
	});

	it('Wechsel der Listenart beginnt neue Liste', () => {
		const blocks = parseMarkdown('- a\n1. b');
		expect(blocks).toHaveLength(2);
	});

	it('Tabelle mit Kopf, Ausrichtung, Inline-Code und escaptem Pipe', () => {
		const md = '| A | B |\n| :-- | --: |\n| `x\\|y` | 2 |\n| ohne Rand\n\nnach';
		expect(parseMarkdown(md)).toEqual<Block[]>([
			{
				type: 'table',
				head: [[text('A')], [text('B')]],
				rows: [
					[[code('x|y')], [text('2')]],
					[[text('ohne Rand')], []]
				]
			},
			{ type: 'paragraph', content: [text('nach')] }
		]);
	});

	it('Zeile mit Pipe ohne Trennzeile ist Absatz', () => {
		expect(parseMarkdown('a | b\nc')).toEqual<Block[]>([
			{ type: 'paragraph', content: [text('a | b c')] }
		]);
	});

	it('Tabelle endet an Zeile ohne Pipe', () => {
		const blocks = parseMarkdown('A|B\n-|-\n1|2\nText');
		expect(blocks.map((b) => b.type)).toEqual(['table', 'paragraph']);
	});

	it('Code-Block mit Sprache, Inhalt roh', () => {
		expect(parseMarkdown('```text\n# kein Titel\n  `x`\n```\n')).toEqual<Block[]>([
			{ type: 'code', lang: 'text', text: '# kein Titel\n  `x`' }
		]);
	});

	it('Mermaid-Block, Tilde-Fence und längere Schließ-Fence', () => {
		expect(parseMarkdown('```mermaid\nflowchart LR\n  A --> B\n`````\n~~~\n```\n~~~')).toEqual<
			Block[]
		>([
			{ type: 'mermaid', text: 'flowchart LR\n  A --> B' },
			{ type: 'code', lang: '', text: '```' }
		]);
	});

	it('kürzere Fence schließt nicht, offener Block läuft bis zum Ende', () => {
		expect(parseMarkdown('````\n```\nx')).toEqual<Block[]>([
			{ type: 'code', lang: '', text: '```\nx' }
		]);
	});

	it('CRLF und leere Eingabe', () => {
		expect(parseMarkdown('# A\r\n\r\nb\r\n')).toEqual<Block[]>([
			{ type: 'heading', level: 1, content: [text('A')] },
			{ type: 'paragraph', content: [text('b')] }
		]);
		expect(parseMarkdown('')).toEqual([]);
	});
});

describe('mermaidBlocks', () => {
	it('liefert nur Mermaid-Inhalte in Reihenfolge', () => {
		const blocks = parseMarkdown('```mermaid\na\n```\n```text\nb\n```\n```mermaid\nc\n```');
		expect(mermaidBlocks(blocks)).toEqual(['a', 'c']);
	});
});
