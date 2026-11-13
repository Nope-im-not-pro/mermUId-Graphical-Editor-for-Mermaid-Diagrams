// @vitest-environment jsdom
import mermaid from 'mermaid';
import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { createSync } from '../../../../src/lib/controllers/sync';
import { commandFor } from '../../../../src/lib/views/panels/properties';
import { ctx, flow, flowOut } from './helpers';

const BASE = 'flowchart TD\n  A[Start]\n  B[Ende]\n  A --> B\n';
const timer = { set: () => 0, clear: () => {} };

const parses = async (text: string) =>
	mermaid.parse(text).then(
		() => true,
		() => false
	);

async function accepted(input: string, line: string) {
	const doc = flow(BASE);
	const cmd = commandFor(doc, 'A', 'click', input);
	expect(cmd).not.toBeNull();
	const out = flowOut(cmd!.do(doc, ctx));
	expect(out.split('\n')).toContain(`  ${line}`);
	expect(await parses(out)).toBe(true);
	const sync = await createSync(out, { timer });
	expect(get(sync)).toMatchObject({ mode: 'flowchart', errors: [], conflict: false });
	sync.dispose();
}

describe('click-Texte (Befund 1)', () => {
	it.each([
		['href ""'],
		['href "u" ""'],
		['cb ""'],
		['call cb() ""'],
		['href "`t`"'],
		['href "u" "`t`"'],
		['href "`"'],
		['href "a`b"'],
		['href "u" "a`b"'],
		['"" _blank'],
		['cb "`"'],
		['call cb() "`t`"']
	])('lehnt %j ab', async (input) => {
		expect(commandFor(flow(BASE), 'A', 'click', input)).toBeNull();
	});

	it.each([
		['href ""', false],
		['href "u" ""', false],
		['cb ""', false],
		['call cb() ""', false],
		['href "`t`"', false],
		['href "u" "`t`"', false],
		['href "`"', false]
	])('Gegenprobe mermaid: %j parst nicht', async (input, ok) => {
		expect(await parses(`${BASE}  click A ${input}\n`)).toBe(ok);
	});

	it.each([
		['href "u"', 'click A href "u"'],
		['href " "', 'click A href " "'],
		['href "u" " "', 'click A href "u" " "'],
		['"u" "t" _self', 'click A href "u" "t" _self'],
		['cb " "', 'click A cb " "'],
		['call cb(1) "t"', 'click A call cb(1) "t"']
	])('%j bleibt gültig und parst', accepted);
});

describe('click-Callback-Name (Befund 2)', () => {
	const blocked = [
		'end',
		'graph',
		'flowchart',
		'subgraph',
		'style',
		'click',
		'class',
		'classDef',
		'linkStyle',
		'interpolate',
		'default',
		'_self',
		'_top',
		'_parent',
		'_blank'
	];

	it.each(blocked)('%s wird abgelehnt, mermaid parst ihn nicht', async (word) => {
		const doc = flow(BASE);
		expect(commandFor(doc, 'A', 'click', word)).toBeNull();
		expect(commandFor(doc, 'A', 'click', `${word} "t"`)).toBeNull();
		expect(await parses(`${BASE}  click A ${word}\n`)).toBe(false);
	});

	it.each(['TB', 'LR', 'direction', 'accTitle', 'v', 'o', 'x', 'end1', 'End', 'STYLE'])(
		'%s bleibt gültig und parst',
		async (word) => {
			await accepted(word, `click A ${word}`);
			await accepted(`${word} "t"`, `click A ${word} "t"`);
		}
	);
});
