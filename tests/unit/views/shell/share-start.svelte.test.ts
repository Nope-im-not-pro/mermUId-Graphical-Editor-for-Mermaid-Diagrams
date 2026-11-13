// @vitest-environment jsdom
// T136 C2 (F-11): Start mit Teilen-Fragment in der Shell: Fragment sofort entfernt, Entwurf vor
// Link, Rückfrage vor dem Laden; "Link kopieren" in der Kopfzeile.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { encodeShareFragment } from '../../../../src/lib/services/file';
import { DRAFT_KEY } from '../../../../src/lib/views/shell/draft';
import type { ShareAccess } from '../../../../src/lib/views/shell/fileSession.svelte';
import { installBrowserStubs } from '../canvas/helpers';
import { button, mountShell, settle, unmountShells } from './helpers';

beforeAll(installBrowserStubs);
afterEach(unmountShells);

const START = 'flowchart TD\n';
const SHARED = 'flowchart TD\n  S[Geteilt]\n';

function fakeShare(hash: string) {
	return {
		hash: () => hash,
		clear: vi.fn(),
		base: () => 'https://app.example/',
		copy: vi.fn(async () => {})
	} satisfies ShareAccess;
}

const dialogTitle = (target: HTMLElement) =>
	target.querySelector('[role="dialog"] h2, [role="dialog"] [id$="-title"]')?.textContent?.trim();
/** Wartet auf den Dialog-Titel (unter Last reichen feste `settle`-Runden nicht immer). */
const waitTitle = (target: HTMLElement, title: string) =>
	vi.waitFor(() => expect(dialogTitle(target)).toBe(title), { timeout: 4000 });
const fileName = (target: HTMLElement) =>
	target.querySelector('[data-testid="file"]')?.textContent ?? '';

async function sharedHash(): Promise<string> {
	const result = await encodeShareFragment(SHARED);
	if (!result.ok) throw new Error(result.error);
	return '#' + result.fragment;
}

describe('Shell: Start mit Teilen-Fragment', () => {
	it('ohne Fragment: kein Entfernen, keine Rückfrage', async () => {
		const share = fakeShare('#abschnitt');
		const { target } = await mountShell(START, { share });
		await settle();
		expect(share.clear).not.toHaveBeenCalled();
		expect(target.querySelector('[role="dialog"]')).toBeNull();
	});

	it('Fragment sofort entfernt, Rückfrage, Laden lädt geteilten Inhalt', async () => {
		const share = fakeShare(await sharedHash());
		const { target } = await mountShell(START, { share });
		await settle();
		expect(share.clear).toHaveBeenCalledTimes(1);
		await waitTitle(target, 'Geteiltes Diagramm laden?');
		button(target, 'Laden').click();
		await settle();
		expect(target.querySelector('[role="dialog"]')).toBeNull();
		await vi.waitFor(() => expect(fileName(target)).toContain('geteilt.mmd'));
		expect(fileName(target)).toContain('geändert');
	});

	it('Abbrechen: nichts geladen, Fragment trotzdem entfernt', async () => {
		const share = fakeShare(await sharedHash());
		const { target } = await mountShell(START, { share });
		await waitTitle(target, 'Geteiltes Diagramm laden?');
		button(target, 'Abbrechen').click();
		await settle();
		expect(share.clear).toHaveBeenCalledTimes(1);
		expect(fileName(target)).toContain('diagramm.mmd');
	});

	it('defektes Fragment: Meldung nach Laden, nichts geladen', async () => {
		const share = fakeShare('#code=v1:!!!');
		const { target } = await mountShell(START, { share });
		await waitTitle(target, 'Geteiltes Diagramm laden?');
		button(target, 'Laden').click();
		await settle();
		await vi.waitFor(() =>
			expect(target.textContent).toContain('Link beschädigt oder unvollständig')
		);
		expect(fileName(target)).toContain('diagramm.mmd');
	});

	it('Entwurf vor Link; wiederhergestellter Entwurf ist durch die Ungespeichert-Rückfrage geschützt', async () => {
		localStorage.setItem(DRAFT_KEY, JSON.stringify({ code: 'flowchart TD\n  E\n', name: 'e.mmd' }));
		const share = fakeShare(await sharedHash());
		const { target } = await mountShell(START, { share });
		await settle();
		await waitTitle(target, 'Entwurf gefunden');
		button(target, 'Wiederherstellen').click();
		await settle();
		await waitTitle(target, 'Geteiltes Diagramm laden?');
		button(target, 'Laden').click();
		await settle();
		await vi.waitFor(() =>
			expect(target.querySelector('[role="dialog"]')?.textContent).toContain('Verwerfen')
		);
		button(target, 'Abbrechen').click();
		await settle();
		expect(fileName(target)).toContain('e.mmd');
	});

	it('Esc behält Entwurf: Link-Rückfrage nennt das Ersetzen, Abbrechen lässt den Entwurf stehen', async () => {
		const draft = JSON.stringify({ code: 'flowchart TD\n  E\n', name: 'e.mmd' });
		localStorage.setItem(DRAFT_KEY, draft);
		const share = fakeShare(await sharedHash());
		const { target } = await mountShell(START, { share });
		await waitTitle(target, 'Entwurf gefunden');
		document.activeElement!.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
		);
		await settle();
		await waitTitle(target, 'Geteiltes Diagramm laden?');
		expect(target.querySelector('[role="dialog"]')?.textContent).toContain(
			'Der behaltene Entwurf wird dabei ersetzt.'
		);
		button(target, 'Abbrechen').click();
		await settle();
		expect(fileName(target)).toContain('diagramm.mmd');
		expect(localStorage.getItem(DRAFT_KEY)).toBe(draft);
	});
});

describe('Shell: Link kopieren', () => {
	it('Knopf in der Kopfzeile kopiert Basis + Fragment, keine Änderung der Adresse', async () => {
		const share = fakeShare('');
		const { target } = await mountShell(START, { share });
		await settle();
		button(target, 'Link kopieren').click();
		await settle();
		const expected = await encodeShareFragment(START);
		expect(expected.ok).toBe(true);
		expect(share.copy).toHaveBeenCalledWith(
			'https://app.example/#' + (expected.ok ? expected.fragment : '')
		);
		expect(share.clear).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(target.textContent).toContain('Link kopiert'));
	});
});
