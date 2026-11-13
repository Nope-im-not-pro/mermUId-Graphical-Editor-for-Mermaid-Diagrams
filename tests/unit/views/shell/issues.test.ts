// T123 C3 (V-24): validateModel je Modellstand genau einmal (Zähltest).
import { describe, expect, it, vi } from 'vitest';
import { validateModel } from '../../../../src/lib/services/validator';
import { createIssues } from '../../../../src/lib/views/shell/issues';
import { sampleDoc } from '../../model/fixtures';

describe('createIssues', () => {
	it('mehrere Leser desselben Stands -> 1 Aufruf; neuer Stand oder Sprache -> +1', () => {
		const validate = vi.fn(validateModel);
		const issuesOf = createIssues(validate);
		const doc = sampleDoc();
		const first = issuesOf(doc, 'de');
		expect(issuesOf(doc, 'de')).toBe(first);
		expect(issuesOf(doc, 'de')).toBe(first);
		expect(validate).toHaveBeenCalledTimes(1);
		const next = { ...doc };
		issuesOf(next, 'de');
		issuesOf(next, 'de');
		expect(validate).toHaveBeenCalledTimes(2);
		expect(validate).toHaveBeenLastCalledWith(next);
		issuesOf(next, 'en');
		expect(validate).toHaveBeenCalledTimes(3);
	});

	it('liefert das Ergebnis von validateModel', () => {
		const doc = sampleDoc();
		expect(createIssues()(doc, 'de')).toEqual(validateModel(doc));
	});
});
