import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
	{
		ignores: [
			'build/',
			'coverage/',
			'.svelte-kit/',
			'node_modules/',
			'test-results/',
			'playwright-report/',
			'release/',
			'z_*/',
			'restore.py'
		]
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	{
		// __APP_VERSION__: Build-Konstante per `define` (vite.config.ts, O-115).
		languageOptions: {
			globals: { ...globals.browser, ...globals.node, __APP_VERSION__: 'readonly' }
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: { parserOptions: { parser: ts.parser } }
	},
	// O-31/V-30: kein {@html}, kein innerHTML/outerHTML im App-Code (Tests bauen DOM-Fixtures).
	{
		files: ['src/**/*.{js,ts,svelte}'],
		rules: {
			'svelte/no-at-html-tags': 'error',
			'no-restricted-syntax': [
				'error',
				{
					selector: 'MemberExpression[property.name=/^(inner|outer)HTML$/]',
					message: 'innerHTML/outerHTML verboten (O-31): DOM-API oder Textknoten nutzen.'
				},
				{
					selector: 'MemberExpression[property.value=/^(inner|outer)HTML$/]',
					message: 'innerHTML/outerHTML verboten (O-31): DOM-API oder Textknoten nutzen.'
				}
			]
		}
	},
	// Einzige Ausnahme: Entity-Dekodierung über <textarea> (RCDATA, kein Markup, kein Skript).
	{
		files: ['src/lib/services/security/index.ts'],
		rules: { 'no-restricted-syntax': 'off' }
	}
);
