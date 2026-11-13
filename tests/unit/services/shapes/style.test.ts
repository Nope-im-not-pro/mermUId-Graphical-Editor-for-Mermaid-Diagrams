import { describe, expect, it } from 'vitest';
import type { ClassDef } from '../../../../src/lib/model/types';
import {
	contrastText,
	resolveStyle,
	safeStyle,
	textColor
} from '../../../../src/lib/services/shapes/style';

const defs: ClassDef[] = [
	{ name: 'warn', style: { fill: '#f96', stroke: '#333', 'stroke-width': '4px' }, sourceText: '' },
	{ name: 'ok', style: { fill: '#9f6', color: 'rgb(0, 0, 0)' }, sourceText: '' }
];

describe('safeStyle: Allow-Liste', () => {
	it('übernimmt hex, rgb()/rgba(), Stärke und Strichmuster', () => {
		expect(
			safeStyle({
				fill: '#00aa00',
				stroke: 'rgba(1, 2, 3, 0.5)',
				color: '#FFF',
				'stroke-width': '2px',
				'stroke-dasharray': '5 5'
			})
		).toEqual({
			fill: '#00aa00',
			stroke: 'rgba(1, 2, 3, 0.5)',
			color: '#FFF',
			strokeWidth: 2,
			strokeDasharray: '5 5'
		});
	});

	it('Stärke ohne Einheit und mit Nachkomma, Muster mit Komma', () => {
		expect(safeStyle({ 'stroke-width': '1.5', 'stroke-dasharray': '4,2, 1' })).toEqual({
			strokeWidth: 1.5,
			strokeDasharray: '4 2 1'
		});
	});

	it.each([
		['url(#x)'],
		['url(javascript:alert(1))'],
		['expression(alert(1))'],
		['"#fff"'],
		["'#fff'"],
		['#fff" onload="x'],
		['red'],
		['#ggg'],
		['#12345'],
		['rgb(1,2,3);background:url(x)'],
		['var(--x)'],
		['']
	])('verwirft Farbe %s', (value) => {
		expect(safeStyle({ fill: value, stroke: value, color: value })).toEqual({});
	});

	it.each([['2em'], ['-1'], ['calc(1px)'], ['url(x)'], ['"2"']])('verwirft Stärke %s', (value) => {
		expect(safeStyle({ 'stroke-width': value })).toEqual({});
	});

	it.each([['5 x'], ['url(a)'], ['expression(1)'], ["'5 5'"], ['5px 5px'], ['']])(
		'verwirft Strichmuster %s',
		(value) => {
			expect(safeStyle({ 'stroke-dasharray': value })).toEqual({});
		}
	);

	it('ignoriert unbekannte Eigenschaften', () => {
		expect(safeStyle({ background: '#fff', 'font-size': '20px', fill: '#abc' })).toEqual({
			fill: '#abc'
		});
	});
});

describe('resolveStyle', () => {
	it('eigener style vor classDef', () => {
		expect(resolveStyle({ fill: '#00aa00' }, ['warn'], defs)).toEqual({
			fill: '#00aa00',
			stroke: '#333',
			strokeWidth: 4
		});
	});

	it('mehrere Klassen: spätere gewinnt', () => {
		expect(resolveStyle({}, ['warn', 'ok'], defs)).toEqual({
			fill: '#9f6',
			stroke: '#333',
			strokeWidth: 4,
			color: 'rgb(0, 0, 0)'
		});
	});

	it('unbekannte Klasse und leerer Stil ergeben kein Ergebnis', () => {
		expect(resolveStyle({}, ['fehlt'], defs)).toEqual({});
		expect(resolveStyle({}, [], [])).toEqual({});
	});

	it('classDef default gilt als unterste Ebene', () => {
		const all: ClassDef[] = [
			...defs,
			{ name: 'default', style: { fill: '#111', stroke: '#222' }, sourceText: '' }
		];
		expect(resolveStyle({}, [], all)).toEqual({ fill: '#111', stroke: '#222' });
		expect(resolveStyle({}, ['ok'], all)).toEqual({
			fill: '#9f6',
			stroke: '#222',
			color: 'rgb(0, 0, 0)'
		});
	});

	it('unzulässiger eigener Wert verdeckt keinen zulässigen classDef-Wert', () => {
		expect(resolveStyle({ fill: 'url(#x)' }, ['ok'], defs).fill).toBe('#9f6');
	});

	it('ohne Klassen: nur eigener Stil (Kanten, linkStyle)', () => {
		expect(resolveStyle({ stroke: '#f00', 'stroke-width': '2px' })).toEqual({
			stroke: '#f00',
			strokeWidth: 2
		});
	});
});

describe('safeStyle: rgb()/rgba() strikt', () => {
	it.each([
		['rgb(1, 2, 3)'],
		['rgb(1,2,3)'],
		['rgba(1, 2, 3, 0.5)'],
		['rgba(1,2,3,50%)'],
		['rgb(10%, 20%, 30%)'],
		['rgb(1 2 3)'],
		['rgb(1 2 3 / 0.5)'],
		['rgba(1 2 3 / 50%)'],
		['rgb(.5 1.5 255)'],
		['rgba(10%, 20%, 30%, 0.5)'],
		['rgba(10, 20, 30, 50%)']
	])('übernimmt %s', (value) => {
		expect(safeStyle({ fill: value }).fill).toBe(value);
	});

	it.each([
		['rgb(,,,)'],
		['rgb(%)'],
		['rgb()'],
		['rgb(1, 2)'],
		['rgb(1, 2, 3, 4, 5)'],
		['rgb(1 2 3 4)'],
		['rgb(1, 2 3)'],
		['rgb(1, 2, 3 / 0.5)'],
		['rgb(1 2 3 /)'],
		['rgb(1,\n2,3)'],
		['rgb(1\n2 3)'],
		['rgb(1,\u20282,3)'],
		['rgb(1\u2028 2 3)'],
		['rgb(1.2.3, 4, 5)'],
		['rgb(1%%, 2, 3)'],
		['rgb(10%, 20, 30)'],
		['rgb(10, 20%, 30)'],
		['rgba(10, 20, 30%, 0.5)']
	])('verwirft %j', (value) => {
		expect(safeStyle({ fill: value })).toEqual({});
	});
});

describe('safeStyle: Stärke geklemmt auf 0.5..20', () => {
	it.each([
		['0', 0.5],
		['0.1px', 0.5],
		['0.5', 0.5],
		['20px', 20],
		['21', 20],
		['1000px', 20]
	])('%s -> %d', (value, expected) => {
		expect(safeStyle({ 'stroke-width': value }).strokeWidth).toBe(expected);
	});
});

describe('contrastText', () => {
	it.each([
		['#000', '#ffffff'],
		['#000000', '#ffffff'],
		['#00000080', '#ffffff'],
		['#1d2232', '#ffffff'],
		['#fff', '#000000'],
		['#FFFF', '#000000'],
		['#00aa00', '#000000'],
		['#f96', '#000000'],
		['#0000ff', '#ffffff'],
		['rgb(0, 0, 0)', '#ffffff'],
		['rgba(255,255,255,0.5)', '#000000'],
		['rgb(100% 100% 100%)', '#000000'],
		['rgb(0% 0% 50% / 1)', '#ffffff']
	])('%s -> %s', (fill, expected) => {
		expect(contrastText(fill)).toBe(expected);
	});

	it.each([
		['rgba(0,0,0,0.1)'],
		['#0000'],
		['rgb(0 0 0 / 0.1)'],
		['#7c8cff0d'],
		['rgba(255, 255, 255, 49%)'],
		['rgba(0, 0, 0, 0.49)']
	])('Alpha < 0.5: %s -> undefined (Theme-Textfarbe)', (fill) => {
		expect(contrastText(fill)).toBeUndefined();
	});

	it.each([
		['rgba(0, 0, 0, 0.5)', '#ffffff'],
		['rgb(255 255 255 / 50%)', '#000000'],
		['#fff8', '#000000'],
		['#00000080', '#ffffff']
	])('Alpha >= 0.5 (Grenzfall 0.5): %s -> %s', (fill, expected) => {
		expect(contrastText(fill)).toBe(expected);
	});

	it('unbekanntes Format ergibt undefined', () => {
		expect(contrastText('red')).toBeUndefined();
		expect(contrastText('url(#x)')).toBeUndefined();
	});
});

describe('textColor', () => {
	it('eigene Textfarbe hat Vorrang', () => {
		expect(textColor({ fill: '#000', color: '#f00' })).toBe('#f00');
	});

	it('ohne color aus der Füllung abgeleitet', () => {
		expect(textColor({ fill: '#000' })).toBe('#ffffff');
	});

	it('ohne fill und color: undefined (Theme-Farbe)', () => {
		expect(textColor({})).toBeUndefined();
		expect(textColor({ stroke: '#000' })).toBeUndefined();
	});
});

describe('resolveStyle: Container ohne classDef default', () => {
	const all: ClassDef[] = [
		...defs,
		{ name: 'default', style: { fill: '#111', stroke: '#222' }, sourceText: '' }
	];

	it('withDefault: false lässt die default-Ebene weg', () => {
		expect(resolveStyle({ color: '#fff' }, ['ok'], all, { withDefault: false })).toEqual({
			fill: '#9f6',
			color: '#fff'
		});
		expect(resolveStyle({}, [], all, { withDefault: false })).toEqual({});
	});
});
