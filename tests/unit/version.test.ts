import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { changelogVersion, readVersion } from '../../scripts/version.mjs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

describe('Version (V-26)', () => {
	it('package.json.version === erste Versions-Überschrift in CHANGELOG.md', () => {
		const version = readVersion();
		expect(version).toMatch(/^\d+\.\d+\.\d+/);
		expect(pkg.version).toBe(version);
	});

	it('__APP_VERSION__ (define) === Version aus CHANGELOG.md', () => {
		expect(__APP_VERSION__).toBe(readVersion());
	});

	it('changelogVersion: erste "## x.y.z - "-Überschrift, "Unveröffentlicht" zählt nicht', () => {
		const text = [
			'# Changelog',
			'',
			'## Unveröffentlicht',
			'',
			'## 1.2.3-rc.1 - 2026-11-12',
			'',
			'## 1.2.2 - 2026-11-01'
		].join('\n');
		expect(changelogVersion(text)).toBe('1.2.3-rc.1');
		expect(changelogVersion('## 0.3.0 - 2026-11-10\r\n')).toBe('0.3.0');
	});

	it('changelogVersion: "## Unreleased" (englische Konvention) zählt nicht', () => {
		const text = ['# Changelog', '', '## Unreleased', '', '## 0.4.0 - 2026-11-12'].join('\n');
		expect(changelogVersion(text)).toBe('0.4.0');
		expect(changelogVersion('# Changelog\n\n## Unreleased\n')).toBeNull();
	});

	it('changelogVersion: ohne Versions-Überschrift null', () => {
		expect(changelogVersion('# Changelog\n\n## Unveröffentlicht\n### 1.0.0 - x\n')).toBeNull();
		expect(changelogVersion('')).toBeNull();
	});

	it('readVersion: fehlende Datei null', () => {
		expect(readVersion('does-not-exist/CHANGELOG.md')).toBeNull();
	});
});
