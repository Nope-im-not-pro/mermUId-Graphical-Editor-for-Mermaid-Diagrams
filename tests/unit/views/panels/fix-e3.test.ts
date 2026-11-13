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

describe('click-Callback mit Sperrwort-Präfix vor `$` (Befund 1)', () => {
	const prefixed = [
		'end',
		'graph',
		'flowchart',
		'subgraph',
		'style',
		'class',
		'classDef',
		'linkStyle',
		'interpolate',
		'default',
		'_self',
		'_top',
		'_parent',
		'_blank'
	].flatMap((w) => [`${w}$`, `${w}$x`]);

	it.each(prefixed)('%s wird abgelehnt, mermaid parst ihn nicht', async (word) => {
		const doc = flow(BASE);
		expect(commandFor(doc, 'A', 'click', word)).toBeNull();
		expect(commandFor(doc, 'A', 'click', `${word} "t"`)).toBeNull();
		expect(await parses(`${BASE}  click A ${word}\n`)).toBe(false);
	});

	// Gegenprobe: Ergebnis je Wort aus echter mermaid-Probe (alle parsen).
	it.each(['click$', 'call$', '$end', 'end_', 'end1', 'v$', 'x$', 'o$', 'END', 'End', 'TB', 'LR'])(
		'%s bleibt gültig und parst',
		async (word) => {
			for (const input of [word, `${word} "t"`]) {
				const doc = flow(BASE);
				const cmd = commandFor(doc, 'A', 'click', input);
				expect(cmd).not.toBeNull();
				const out = flowOut(cmd!.do(doc, ctx));
				expect(out.split('\n')).toContain(`  click A ${input}`);
				expect(await parses(out)).toBe(true);
				const sync = await createSync(out, { timer });
				expect(get(sync)).toMatchObject({ mode: 'flowchart', errors: [], conflict: false });
				sync.dispose();
			}
		}
	);
});
