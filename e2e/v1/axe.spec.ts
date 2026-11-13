// T139 C1 (V-33): minimaler a11y-Scan ohne neue Abhängigkeit (axe-core ist MPL-2.0 und liegt
// außerhalb der Lizenz-Allow-Liste [A3], scripts/license-check.mjs). Geprüft im DOM:
// - jedes sichtbare interaktive oder per [tabindex] fokussierbare Element sowie img und
//   [role=img] hat einen zugänglichen Namen (Berechnung durch Playwright),
// - keine doppelten `id`,
// - aria-labelledby/-controls/-describedby zeigen auf vorhandene `id`,
// - nichts Fokussierbares innerhalb von aria-hidden="true",
// - genau ein main-Landmark, html[lang] gesetzt.
// Zustände: Startseite, mit Diagramm (Flowchart und Sequenz), offener Dialog; je dunkel und hell.
import { expect, test, type Page } from '@playwright/test';
import { openText, seqSurface, startApp } from '../mvp/sync/helpers-actions';

interface Report {
	/** Beschreibungen der markierten Kandidaten (Index = `data-a11y-scan`). */
	candidates: string[];
	duplicateIds: string[];
	brokenRefs: string[];
	hiddenFocusable: string[];
	mains: number;
	lang: string;
}

/** Fokussierbare und benennungspflichtige Elemente (inkl. fokussierbarer `[tabindex]`). */
const NAMED =
	'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"], [tabindex]:not([tabindex="-1"]), img, [role="img"]';

/**
 * Scan im Browser; liefert Befunde als kurze Beschreibungen (Tag, Klasse, Rolle). Sichtbare
 * Kandidaten für die Namensprüfung werden mit `data-a11y-scan` markiert; den Namen berechnet
 * danach Playwright (`toHaveAccessibleName`, Accessible-Name-Algorithmus inkl. role=img und
 * ausgeblendeter Kinder).
 */
function scan(page: Page): Promise<Report> {
	return page.evaluate((selector) => {
		const describe = (el: Element) => {
			const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
			const role = el.getAttribute('role');
			return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${role ? `[role=${role}]` : ''}`;
		};
		const hidden = (el: Element) =>
			el.closest('[aria-hidden="true"], [inert], [hidden]') !== null ||
			!(el as HTMLElement).checkVisibility({ visibilityProperty: true, opacityProperty: false });

		for (const el of document.querySelectorAll('[data-a11y-scan]'))
			el.removeAttribute('data-a11y-scan');
		const candidates = [...document.querySelectorAll(selector)].filter((el) => !hidden(el));
		candidates.forEach((el, i) => el.setAttribute('data-a11y-scan', String(i)));

		// aria-hidden-focus: fokussierbar (natives interaktives Element oder tabindex >= 0, nicht
		// disabled, nicht inert) innerhalb von aria-hidden="true" ist ein Befund.
		const focusable = (el: Element) => {
			if (el.closest('[inert]') || (el as HTMLButtonElement).disabled === true) return false;
			const tabindex = el.getAttribute('tabindex');
			if (tabindex !== null) return Number(tabindex) >= 0;
			return el.matches(
				'button, a[href], input:not([type="hidden"]), select, textarea, summary, [contenteditable]:not([contenteditable="false"])'
			);
		};
		const hiddenFocusable = [...document.querySelectorAll('[aria-hidden="true"]')].flatMap((root) =>
			[root, ...root.querySelectorAll('*')].filter(focusable).map(describe)
		);

		const counts = new Map<string, number>();
		for (const el of document.querySelectorAll('[id]'))
			counts.set(el.id, (counts.get(el.id) ?? 0) + 1);
		const duplicateIds = [...counts].filter(([, n]) => n > 1).map(([id, n]) => `${id} x${n}`);

		const brokenRefs: string[] = [];
		for (const attr of ['aria-labelledby', 'aria-controls', 'aria-describedby']) {
			for (const el of document.querySelectorAll(`[${attr}]`)) {
				for (const id of el.getAttribute(attr)!.split(/\s+/).filter(Boolean)) {
					if (!document.getElementById(id)) brokenRefs.push(`${describe(el)} ${attr}=${id}`);
				}
			}
		}

		return {
			candidates: candidates.map(describe),
			duplicateIds,
			brokenRefs: [...new Set(brokenRefs)],
			hiddenFocusable: [...new Set(hiddenFocusable)],
			mains: document.querySelectorAll('main, [role="main"]').length,
			lang: document.documentElement.lang
		};
	}, NAMED);
}

/** Markierte Kandidaten ohne zugänglichen Namen, Name von Playwright berechnet. */
async function unnamed(page: Page, report: Report): Promise<string[]> {
	const out = new Set<string>();
	for (const [i, desc] of report.candidates.entries()) {
		try {
			await expect(page.locator(`[data-a11y-scan="${i}"]`)).toHaveAccessibleName(/\S/, {
				timeout: 250
			});
		} catch {
			out.add(desc);
		}
	}
	return [...out];
}

const FLOW = ['flowchart LR', '  A[Start] --> B{Ok?}', '  B -->|ja| C[Ende]', ''].join('\n');
const SEQ = 'sequenceDiagram\n    participant Alice\n    participant Bob\n    Alice->>Bob: Hallo\n';

type Setup = (page: Page) => Promise<void>;

const STATES: [string, Setup][] = [
	['Startseite', async () => {}],
	[
		'mit Flowchart',
		async (page) => {
			await openText(page, 'a11y.mmd', FLOW);
			await expect(page.locator('.svelte-flow__node')).toHaveCount(3);
			await expect(page.locator('.center > .preview .preview-body svg')).toBeVisible();
		}
	],
	[
		'mit Sequenz',
		async (page) => {
			await openText(page, 'a11y-seq.mmd', SEQ);
			await expect(seqSurface(page)).toBeVisible();
			await expect(page.locator('.center > .preview .preview-body svg')).toBeVisible();
		}
	],
	[
		'offener Dialog',
		async (page) => {
			await openText(page, 'a11y.mmd', FLOW);
			await page
				.getByRole('toolbar', { name: 'Werkzeugleiste' })
				.getByRole('button', { name: 'Export', exact: true })
				.click();
			await expect(page.getByRole('dialog')).toBeVisible();
		}
	]
];

for (const theme of ['dark', 'light'] as const) {
	test.describe(`a11y-Scan, Schema ${theme} (T139 C1)`, () => {
		test.use({ viewport: { width: 1280, height: 800 } });

		test.beforeEach(async ({ page }) => {
			await page.addInitScript((value) => {
				try {
					localStorage.setItem('mermuid.theme', value);
				} catch {
					// Ohne Storage gilt der Standard; der Test prüft data-theme.
				}
			}, theme);
			await startApp(page);
			await expect(page.locator('.shell')).toHaveAttribute('data-theme', theme);
		});

		for (const [name, setup] of STATES) {
			test(`${name}: Namen, IDs, ARIA-Verweise, aria-hidden-Fokus, lang`, async ({ page }) => {
				await setup(page);
				const report = await scan(page);
				expect(report.lang).toMatch(/^(de|en)/);
				expect(await unnamed(page, report), 'Elemente ohne zugänglichen Namen').toEqual([]);
				expect(report.duplicateIds, 'doppelte id').toEqual([]);
				expect(report.brokenRefs, 'ARIA-Verweise ins Leere').toEqual([]);
				expect(report.hiddenFocusable, 'fokussierbar in aria-hidden').toEqual([]);
			});
		}
	});
}

// Befund (T139 C1): Die Shell hat kein `main`-Landmark (Shell.svelte rendert `.main` als
// `div`). Fix im Produktcode liegt außerhalb des Scopes (e2e/v1); bis dahin fixme. Unabhängig
// vom Farbschema, daher einmal je Browser.
test.fixme('genau ein main-Landmark (T139 C1)', async ({ page }) => {
	await startApp(page);
	const report = await scan(page);
	expect(report.mains).toBe(1);
});
