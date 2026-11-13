// T114 (V-19): Statusmeldung als `{key, params, tone}`; Text entsteht erst bei der Anzeige,
// damit ein Sprachwechsel die angezeigte Meldung mitübersetzt.
import { afterEach, describe, expect, it } from 'vitest';
import { FileServiceError } from '../../../../src/lib/services/file';
import { msg, setLocale } from '../../../../src/lib/services/i18n';
import { applyLocale } from '../../../../src/lib/views/shell/i18n.svelte';
import {
	errorPart,
	known,
	messageText,
	plain,
	type StatusMessage
} from '../../../../src/lib/views/shell/status';

afterEach(() => applyLocale('de'));

describe('messageText', () => {
	it('übersetzt Schlüssel und Parameter bei jeder Anzeige neu', () => {
		const m: StatusMessage = {
			key: 'app.shell.opened',
			params: { name: 'a.mmd' },
			tone: 'success'
		};
		expect(messageText(m)).toBe('Geöffnet: a.mmd');
		applyLocale('en');
		expect(messageText(m)).toBe('Opened: a.mmd');
	});

	it('Parameter als Schlüssel werden mitübersetzt (Label in "fehlgeschlagen")', () => {
		const m: StatusMessage = {
			key: 'app.shell.failed',
			params: { label: { key: 'app.shell.load' }, reason: plain('kein Parser') },
			tone: 'error'
		};
		expect(messageText(m)).toBe('Laden fehlgeschlagen: kein Parser');
		applyLocale('en');
		expect(messageText(m)).toBe('Loading failed: kein Parser');
	});

	it('verkettete Meldung "<Grund> <Fehlschlag>" wechselt beide Teile', () => {
		const m: StatusMessage = {
			key: 'services.file.notFound',
			tone: 'error',
			more: [{ key: 'services.file.saveFailed' }]
		};
		expect(messageText(m)).toBe(
			'Datei nicht gefunden (verschoben oder gelöscht). Datei konnte nicht gespeichert werden.'
		);
		applyLocale('en');
		expect(messageText(m)).toBe('File not found (moved or deleted). File could not be saved.');
	});

	it('keine Meldung: leerer Text', () => {
		expect(messageText(null)).toBe('');
	});
});

describe('errorPart / known', () => {
	afterEach(() => setLocale('de'));

	it('FileServiceError: code -> Schlüssel', () => {
		const part = errorPart(new FileServiceError(msg('services.file.quota'), 'quota'));
		expect(part).toEqual({ key: 'services.file.quota' });
	});

	it('FileServiceError zu groß: Grenze bleibt Parameter', () => {
		const err = new FileServiceError(msg('services.file.tooLarge', { max: '1 MB' }), 'too-large');
		const m: StatusMessage = { ...errorPart(err), tone: 'error' };
		applyLocale('en');
		expect(messageText(m)).toBe('File is too large (limit 1 MB).');
	});

	it('Meldung aus der anderen Sprache wird ebenfalls erkannt', () => {
		setLocale('en');
		const err = new FileServiceError(msg('services.file.notUtf8'), 'not-utf8');
		expect(errorPart(err)).toEqual({ key: 'services.file.notUtf8' });
	});

	it('fremder Text bleibt Text (kein falscher Schlüssel)', () => {
		const part = errorPart(new FileServiceError('Platte voll', 'save-failed'));
		expect(messageText({ ...part, tone: 'error' })).toBe('Platte voll');
		expect(messageText({ ...errorPart('weg'), tone: 'error' })).toBe('weg');
		expect(messageText({ ...errorPart(new Error('kaputt')), tone: 'error' })).toBe('kaputt');
	});

	it('known: Kandidaten mit Parametern, sonst parameterlose Schlüssel', () => {
		expect(
			known('x.md enthält keinen Mermaid-Block.', [
				{ key: 'app.file.noBlock', params: { name: 'x.md' } }
			])
		).toEqual({
			key: 'app.file.noBlock',
			params: { name: 'x.md' }
		});
		expect(known('SVG ohne gültige viewBox.')).toEqual({ key: 'services.export.viewBox' });
		expect(known('Render kaputt')).toEqual(plain('Render kaputt'));
	});

	it('known: Text, der in einer Sprache mehreren Schlüsseln gehört, bleibt Text', () => {
		// DE "Hinweis" = app.new.wNote und panels.errors.hint; EN "Note" mehrfach.
		expect(known('Hinweis')).toEqual(plain('Hinweis'));
		expect(known('Note')).toEqual(plain('Note'));
	});
});
