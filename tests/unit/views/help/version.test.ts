// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readVersion } from '../../../../scripts/version.mjs';
import HelpPanel from '../../../../src/lib/views/help/HelpPanel.svelte';
import { applyLocale } from '../../../../src/lib/views/shell/i18n.svelte';

vi.mock('../../../../src/lib/services/render', () => ({
	renderSvg: async () => ({ ok: true, svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' })
}));

let cleanup: (() => void) | null = null;
afterEach(() => {
	cleanup?.();
	cleanup = null;
	document.body.replaceChildren();
	applyLocale('de');
});

function versionText(): string | null {
	const target = document.createElement('div');
	document.body.append(target);
	const app = mount(HelpPanel, { target, props: { open: true, onclose: () => {} } });
	cleanup = () => unmount(app);
	flushSync();
	return target.querySelector('.help-header .help-version')?.textContent ?? null;
}

describe('HelpPanel zeigt Version (V-26)', () => {
	it.each([
		['de', 'Version'],
		['en', 'Version']
	] as const)('%s: Kopfzeile nennt Version aus CHANGELOG.md', (locale, word) => {
		applyLocale(locale);
		const version = readVersion();
		expect(version).not.toBeNull();
		expect(versionText()).toBe(`${word} ${version}`);
	});
});
