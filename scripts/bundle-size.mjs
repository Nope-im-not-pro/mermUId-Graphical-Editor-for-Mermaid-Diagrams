// Initial-JS-Größe des statischen Builds gegen Budget 5 MB [A9]. Nur Node-stdlib.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const BUDGET = 5 * 1024 * 1024;
const BUILD = resolve('build');
const index = join(BUILD, 'index.html');

if (!existsSync(index)) {
	console.error('build/index.html fehlt, zuerst "npm run build" ausführen');
	process.exit(1);
}

const html = readFileSync(index, 'utf8');
const entries = new Set();
for (const m of html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"]+\.js)"/g)) {
	entries.add(resolve(BUILD, m[1].replace(/^\//, '')));
}
// Dynamische Imports in Inline-Skripten des Bootstraps (import("./_app/...js")).
for (const m of html.matchAll(/import\(\s*["']([^"']+\.js)["']\s*\)/g)) {
	entries.add(resolve(BUILD, m[1].replace(/^\//, '')));
}

// Statische Imports transitiv verfolgen (import ... from "x", import "x", export ... from "x").
const STATIC_IMPORT = /(?:import|export)\s*(?:[\w*{}\s,$]+?\s*from\s*)?["']([^"']+\.js)["']/g;
const seen = new Set();
const queue = [...entries];
while (queue.length > 0) {
	const file = queue.pop();
	if (seen.has(file) || !existsSync(file)) continue;
	seen.add(file);
	for (const m of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
		if (m[1].startsWith('.')) queue.push(resolve(dirname(file), m[1]));
	}
}

let total = 0;
for (const file of seen) total += statSync(file).size;

const ok = total <= BUDGET;
console.log(
	`Initial-JS: ${total} Byte in ${seen.size} Datei(en), Budget ${BUDGET} Byte: ${ok ? 'ok' : 'über Budget'}`
);
process.exit(ok ? 0 : 1);
