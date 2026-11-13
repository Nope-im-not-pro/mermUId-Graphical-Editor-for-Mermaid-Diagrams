// Lizenz-Prüfung aller Produktions-Abhängigkeiten (transitiv) aus package-lock.json.
// Nur Node-stdlib. Verstoß -> exit 1.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ALLOW = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD']);

// Ausnahmeliste N-01 (Nutzer-Entscheid 2026-11-01).
const EXCEPTIONS = {
	'robust-predicates': 'Unlicense akzeptiert (N-01)',
	khroma: 'kein license-Feld, LICENSE-Datei MIT (N-01)',
	elkjs: 'EPL-2.0 nur installiert, per Vite-Alias gestubbt (N-01)'
};

const ELK_SIGNATURES = ['elkjs', 'org.eclipse.elk'];

function isAllowed(license) {
	if (typeof license !== 'string' || license === '') return false;
	const options = license.replace(/[()]/g, '').split(/\s+OR\s+/);
	return options.some((option) => ALLOW.has(option.trim()));
}

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
let violations = 0;
const rows = [];

for (const [path, info] of Object.entries(lock.packages ?? {})) {
	if (path === '' || info.dev || info.link) continue;
	const name = info.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
	let license = info.license;
	if (license === undefined && existsSync(join(path, 'package.json'))) {
		license = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')).license;
	}
	let status;
	if (isAllowed(license)) status = 'ok';
	else if (EXCEPTIONS[name]) status = `Ausnahme: ${EXCEPTIONS[name]}`;
	else {
		status = 'VERSTOSS';
		violations++;
	}
	rows.push(`${name}\t${info.version}\t${license ?? '(fehlt)'}\t${status}`);
}

console.log('Paket\tVersion\tLizenz\tStatus');
console.log(rows.sort().join('\n'));

function* jsFiles(dir) {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) yield* jsFiles(full);
		else if (full.endsWith('.js')) yield full;
	}
}

if (existsSync('build')) {
	let found = 0;
	for (const file of jsFiles('build')) {
		const content = readFileSync(file, 'utf8');
		const hit = ELK_SIGNATURES.find((sig) => content.includes(sig));
		if (hit) {
			console.log(`VERSTOSS: ${file} enthält "${hit}" (elkjs im Bundle, N-01)`);
			found++;
		}
	}
	violations += found;
	console.log(
		`build/: ${found === 0 ? 'kein elkjs-Inhalt' : `${found} Datei(en) mit elkjs-Inhalt`}`
	);
} else {
	console.log('build/: nicht vorhanden, Bundle-Prüfung übersprungen');
}

console.log(`${rows.length} Produktions-Pakete geprüft, ${violations} Verstoß/Verstöße`);
process.exit(violations > 0 ? 1 : 0);
