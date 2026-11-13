import { describe, expect, it } from 'vitest';
import { failureReason, sha256Line } from '../../../scripts/package-onefolder.mjs';

describe('package-onefolder (T121)', () => {
	it('sha256Line: Format von "sha256sum" (Hash, zwei Leerzeichen, relativer Name)', () => {
		expect(sha256Line('mermuid-1.0.0-linux-amd64.zip', Buffer.from('abc'))).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  mermuid-1.0.0-linux-amd64.zip'
		);
	});

	it('failureReason: Signal des Kindprozesses statt generischem Fehler', () => {
		expect(failureReason({ status: null, signal: 'SIGINT' })).toBe('terminated by signal SIGINT');
		expect(failureReason({ status: null, signal: 'SIGTERM' })).toBe('terminated by signal SIGTERM');
	});

	it('failureReason: fehlendes Programm und Exit-Code', () => {
		expect(failureReason({ code: 'ENOENT' })).toBe('not found');
		expect(failureReason({ status: 2, signal: null })).toBe('exit code 2');
	});
});
