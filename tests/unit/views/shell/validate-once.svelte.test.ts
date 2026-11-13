// @vitest-environment jsdom
// T123 C4 (V-24): validateModel app-weit genau einmal je Modellstand (Shell -> Fehlerliste und
// Canvas-Marker über GraphCanvas/GraphFlow/toFlow).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { validateModel } from '../../../../src/lib/services/validator';
import { place } from '../../controllers/sync/helpers';
import { installBrowserStubs, nodeEl, SAMPLE } from '../canvas/helpers';
import { mountShell, settle, unmountShells } from './helpers';

vi.mock('../../../../src/lib/services/validator', async (orig) => {
	const mod = await orig<typeof import('../../../../src/lib/services/validator')>();
	return { ...mod, validateModel: vi.fn(mod.validateModel) };
});

beforeAll(installBrowserStubs);
afterEach(unmountShells);

const calls = () => vi.mocked(validateModel).mock.calls.map((c) => c[0]);

describe('Shell: validateModel einmal je Modellstand (T123 C4)', () => {
	it('Fehlerliste und Canvas-Marker teilen einen Aufruf je Stand', async () => {
		vi.mocked(validateModel).mockClear();
		const { sync, target } = await mountShell(SAMPLE);
		await settle();
		expect(calls().length).toBeGreaterThan(0);
		expect(new Set(calls()).size).toBe(calls().length);
		// Befund erscheint weiterhin am Canvas-Knoten (Container-ID S1, Hinweis).
		expect(nodeEl(target, 'S1')!.querySelector('.issue')!.textContent).toMatch(/^ℹ \S/);
		const before = calls().length;
		await sync.execute(place('A', [0, 0, 80, 40]));
		await settle();
		expect(calls().length).toBe(before + 1);
		expect(new Set(calls()).size).toBe(calls().length);
	});
});
