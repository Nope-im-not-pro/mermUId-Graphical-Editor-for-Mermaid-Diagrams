// V-26: Einzige Versionsquelle ist CHANGELOG.md (erste Überschrift "## x.y.z - ";
// "Unreleased" bzw. "Unveröffentlicht" zählt nicht). Genutzt von vite.config.ts (__APP_VERSION__) und als Naht
// für das Release-Skript (T121).
import { existsSync, readFileSync } from 'node:fs';

/**
 * Version der ersten Versions-Überschrift eines CHANGELOG-Textes.
 * @param {string} text
 * @returns {string | null}
 */
export function changelogVersion(text) {
	const m = text.match(/^## (\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?) - /m);
	return m ? m[1] : null;
}

/**
 * Version aus der CHANGELOG-Datei (Standard: CHANGELOG.md relativ zum Arbeitsverzeichnis,
 * wie package-onefolder.mjs; npm-Skripte, vite und vitest laufen im Projekt-Root).
 * @param {string} [file]
 * @returns {string | null}
 */
export function readVersion(file = 'CHANGELOG.md') {
	return existsSync(file) ? changelogVersion(readFileSync(file, 'utf8')) : null;
}
