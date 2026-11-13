// T127 C2 (F-08): PNG-Hintergrund (Allow-Liste) und Rand in px.
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_MARGIN,
	MAX_MARGIN,
	isBackgroundColor,
	isMargin,
	marginOf,
	pngBackground
} from '../../../../src/lib/services/export/background';

describe('isBackgroundColor (Allow-Liste)', () => {
	it.each([
		'#fff',
		'#ffff',
		'#a1b2c3',
		'#A1B2C3D4',
		'transparent',
		'Transparent',
		'white',
		'rebeccapurple',
		'LightGoldenRodYellow',
		'rgb(1, 2, 3)',
		'rgba(1,2,3,0.5)',
		'rgb(10% 20% 30% / 50%)',
		'hsl(120, 50%, 50%)',
		'hsla(120deg, 50%, 50%, 0.3)',
		'hsl(0.5turn 10% 90%)',
		'hsl(-30 10% 90% / .5)'
	])('zulässig: %s', (value) => {
		expect(isBackgroundColor(value)).toBe(true);
	});

	it.each([
		'',
		'#ff',
		'#fffff',
		'#fffffff',
		'#ggg',
		'notacolor',
		'currentcolor',
		'inherit',
		'url(#x)',
		'red;fill:url(x)',
		'rgb(1,2)',
		'rgb(1, 2, 3',
		'hsl(120, 50, 50)',
		'hsl(120 50% 50%,)',
		'hsl(1e3, 1%, 1%)',
		'red\n',
		' red',
		'constructor',
		'toString',
		'expression(alert(1))'
	])('verworfen: %j', (value) => {
		expect(isBackgroundColor(value)).toBe(false);
	});
});

describe('pngBackground', () => {
	it('erster zulässiger Kandidat, getrimmt', () => {
		expect(pngBackground(' #123 ', '#fff')).toBe('#123');
		expect(pngBackground('url(x)', 'rgb(1,2,3)', '#fff')).toBe('rgb(1,2,3)');
		expect(pngBackground('', undefined, '#ffffff')).toBe('#ffffff');
		expect(pngBackground('bad', 'auch schlecht')).toBeNull();
	});
});

describe('Rand in px', () => {
	it('Ganzzahl 0..512 zulässig', () => {
		for (const v of [0, 1, 24, MAX_MARGIN]) {
			expect(isMargin(v)).toBe(true);
			expect(marginOf(v)).toBe(v);
		}
	});

	it('ungültig: Standard', () => {
		expect(DEFAULT_MARGIN).toBe(0);
		for (const v of [-1, 513, 1.5, NaN, Infinity, '12', null, undefined, {}]) {
			expect(isMargin(v)).toBe(false);
			expect(marginOf(v)).toBe(DEFAULT_MARGIN);
		}
	});
});
