// T25 C2: AK-M13 Offline-Betrieb des One-Folder-Pakets. Entpackt das Linux-ZIP aus release/
// (erzeugt von scripts/package-onefolder.mjs, kein eigener Build im Test), startet das Binary
// mit --no-open und prüft: alle Requests gehen an 127.0.0.1, die Kernaktion läuft ohne Netz.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

/** Version wie scripts/package-onefolder.mjs: erste Überschrift "## x.y.z - " aus CHANGELOG.md. */
function changelogVersion(): string {
	const m = readFileSync('CHANGELOG.md', 'utf8').match(
		/^## (\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?) - /m
	);
	return m ? m[1] : '0.0.0_no-changelog';
}

const NAME = `mermuid-${changelogVersion()}-linux-amd64`;
const ZIP = resolve('release', `${NAME}.zip`);

let tempDir = '';
let proc: ChildProcess | undefined;
let appUrl = '';

/** Liest die erste Zeile "http://127.0.0.1:<port>/" aus stdout des Binaries. */
function waitForUrl(child: ChildProcess): Promise<string> {
	return new Promise((resolveUrl, reject) => {
		let out = '';
		let err = '';
		const timer = setTimeout(() => reject(new Error(`keine URL nach 10 s: ${out}${err}`)), 10_000);
		child.stdout?.on('data', (chunk: Buffer) => {
			out += chunk.toString();
			if (out.includes('läuft bereits')) {
				clearTimeout(timer);
				reject(new Error(`andere mermUId-Instanz aktiv, Test nicht aussagekräftig: ${out}`));
				return;
			}
			const m = out.match(/^(http:\/\/127\.0\.0\.1:\d+\/)$/m);
			if (m) {
				clearTimeout(timer);
				resolveUrl(m[1]);
			}
		});
		child.stderr?.on('data', (chunk: Buffer) => (err += chunk.toString()));
		child.on('exit', (code) => {
			clearTimeout(timer);
			reject(new Error(`Binary beendet (Exit ${code}): ${out}${err}`));
		});
	});
}

test.describe.configure({ mode: 'serial' });

// Ohne Paket (z. B. frischer Checkout, npm run verify ohne Release) Spec überspringen statt rot.
// Datei-Ebene: alle Tests übersprungen, beforeAll läuft dann nicht.
test.skip(
	!existsSync(ZIP),
	`Paket fehlt: ${ZIP}. Zuerst "node scripts/package-onefolder.mjs" ausführen (INFRA.md "Pakete").`
);

test.beforeAll(async () => {
	tempDir = mkdtempSync(join(tmpdir(), 'mermuid-offline-'));
	execFileSync('unzip', ['-q', ZIP, '-d', tempDir]);
	const dir = join(tempDir, NAME);
	proc = spawn('./mermuid', ['--no-open'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
	appUrl = await waitForUrl(proc);
});

test.afterAll(async () => {
	if (proc && proc.exitCode === null && proc.signalCode === null) {
		const exited = new Promise<void>((done) => proc!.once('exit', () => done()));
		proc.kill('SIGTERM');
		const timer = setTimeout(() => proc!.kill('SIGKILL'), 3_000);
		await exited;
		clearTimeout(timer);
	}
	if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

test('AK-M13: One-Folder-Paket läuft offline, nur Requests an 127.0.0.1', async ({
	page,
	context
}) => {
	const requests: string[] = [];
	page.on('request', (req) => requests.push(req.url()));
	// Kein Netz außer 127.0.0.1: alles andere wird abgebrochen und fällt in der Host-Prüfung auf.
	await context.route(
		(url) => url.hostname !== '127.0.0.1',
		(route) => route.abort('internetdisconnected')
	);

	await page.goto(appUrl);
	await expect(page).toHaveTitle(/ - mermUId$/);
	const pane = page.locator('.svelte-flow__pane');
	await expect(pane).toBeVisible();
	await page.waitForLoadState('networkidle');

	// Kernaktion vollständig offline: Knoten anlegen, Code enthält ihn.
	await context.setOffline(true);
	await page.getByRole('button', { name: 'Manuell', exact: true }).click();
	await pane.dblclick({ position: { x: 120, y: 120 } });
	await expect(page.locator('.svelte-flow__node[data-id="n1"]')).toBeVisible();
	await page.getByRole('tab', { name: 'Code' }).click();
	await expect(page.locator('#shell-code .cm-line').filter({ hasText: 'n1' })).not.toHaveCount(0);
	await context.setOffline(false);

	expect(requests.length).toBeGreaterThan(0);
	// data:-URLs haben keinen Host; blob:-URLs tragen den Host ihres Ursprungs.
	const host = (u: string) => new URL(u.startsWith('blob:') ? u.slice(5) : u).hostname;
	const foreign = requests.filter((u) => !u.startsWith('data:') && host(u) !== '127.0.0.1');
	expect(foreign, 'Requests an andere Hosts als 127.0.0.1').toEqual([]);
});
