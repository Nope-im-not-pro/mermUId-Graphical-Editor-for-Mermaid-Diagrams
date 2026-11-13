// One-Folder-Pakete je OS (T25, O-38, T121): npm run build, Binary + dist/ (Inhalt von build/) als ZIP
// unter release/, dazu release/SHA256SUMS. Nur Node-Bordmittel; Binary-Build über Docker (Go-Image per
// Digest gepinnt), ZIP über zip-CLI.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readVersion } from './version.mjs';

const GO_IMAGE =
	'golang:1.27.3-alpine@sha256:d200d2dd76b03a99b52651fd1325aff7dcd35422c35c01bac56571b0507f3deb';
const TARGETS = [
	{ os: 'linux', bin: 'mermuid' },
	{ os: 'windows', bin: 'mermuid.exe' }
];

/**
 * Eine Zeile im Format von `sha256sum` (Hash, zwei Leerzeichen, Dateiname), prüfbar mit `sha256sum -c`.
 * @param {string} name relativer Dateiname
 * @param {Buffer} data Dateiinhalt
 * @returns {string}
 */
export function sha256Line(name, data) {
	return `${createHash('sha256').update(data).digest('hex')}  ${name}`;
}

/**
 * Abbruchgrund eines Kindprozesses aus dem Fehler von execFileSync.
 * @param {{ code?: string, status?: number | null, signal?: string | null }} err
 * @returns {string}
 */
export function failureReason(err) {
	if (err.code === 'ENOENT') return 'not found';
	if (err.signal) return `terminated by signal ${err.signal}`;
	return `exit code ${err.status ?? err.code}`;
}

/**
 * Fehler von npm/docker/zip: kurze Meldung und Exit 1 statt Stacktrace.
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} [cwd]
 */
function run(cmd, args, cwd) {
	try {
		execFileSync(cmd, args, { cwd, stdio: 'inherit' });
	} catch (err) {
		console.error(`Error: ${cmd} failed (${failureReason(/** @type {any} */ (err))})`);
		process.exit(1);
	}
}

function main() {
	const BUILD = resolve('build');
	const SERVER = resolve('server');
	const RELEASE = resolve('release');
	const STAGE = join(RELEASE, 'stage');
	const LICENSE = resolve('LICENSE');

	if (!existsSync(LICENSE)) {
		console.error('LICENSE is missing');
		process.exit(1);
	}

	let version = readVersion();
	if (!version) {
		version = '0.0.0_no-changelog';
		console.warn(`Warning: no version found in CHANGELOG.md, using ${version}`);
	}

	run('npm', ['run', 'build']);

	rmSync(STAGE, { recursive: true, force: true });
	mkdirSync(STAGE, { recursive: true });

	const folders = TARGETS.map((t) => ({ ...t, name: `mermuid-${version}-${t.os}-amd64` }));
	for (const f of folders) mkdirSync(join(STAGE, f.name), { recursive: true });

	// Binaries neu bauen, Ausgabe nur in release/stage (server/ read-only gemountet, server/bin/ bleibt).
	const uid = execFileSync('id', ['-u']).toString().trim();
	const gid = execFileSync('id', ['-g']).toString().trim();
	const ldflags = `-s -w -X main.version=${version}`;
	const script = folders
		.map(
			(f) =>
				`GOOS=${f.os} GOARCH=amd64 go build -trimpath -ldflags="${ldflags}" -o /out/${f.name}/${f.bin} .`
		)
		.join(' && ');
	run('docker', [
		'run',
		'--rm',
		'--pull',
		'never',
		'-u',
		`${uid}:${gid}`,
		'-e',
		'HOME=/tmp',
		'-e',
		'GOCACHE=/tmp/gocache',
		'-e',
		'GOPATH=/tmp/gopath',
		'-e',
		'CGO_ENABLED=0',
		'-v',
		`${SERVER}:/src:ro`,
		'-v',
		`${STAGE}:/out`,
		'-w',
		'/src',
		GO_IMAGE,
		'sh',
		'-c',
		script
	]);

	const sums = [];
	for (const f of folders) {
		const dir = join(STAGE, f.name);
		chmodSync(join(dir, f.bin), 0o755);
		cpSync(BUILD, join(dir, 'dist'), { recursive: true });
		cpSync(LICENSE, join(dir, 'LICENSE'));
		const zipName = `${f.name}.zip`;
		const zipFile = join(RELEASE, zipName);
		rmSync(zipFile, { force: true });
		// zip übernimmt die Unix-Rechte aus dem Dateisystem (0755 für das Binary); -X ohne Extra-Felder.
		run('zip', ['-q', '-r', '-X', zipFile, f.name], STAGE);
		sums.push(sha256Line(zipName, readFileSync(zipFile)));
		console.log(`created: release/${zipName}`);
	}

	// Relative Namen: prüfbar mit `cd release && sha256sum -c SHA256SUMS`.
	writeFileSync(join(RELEASE, 'SHA256SUMS'), `${sums.join('\n')}\n`);
	console.log('created: release/SHA256SUMS');
}

// Hauptteil nur bei direktem Aufruf (Import in Unit-Tests ohne Seiteneffekt).
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
