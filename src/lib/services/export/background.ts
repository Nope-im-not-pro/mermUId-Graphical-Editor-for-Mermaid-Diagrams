/**
 * PNG-Hintergrund und Rand (T127 C2, F-08). Rein, ohne DOM.
 *
 * Der Hintergrund ist Nutzereingabe und geht als `fillStyle` in den Canvas: nur die Allow-Liste
 * kommt durch (Hex 3/4/6/8, `transparent`, benannte CSS-Farben, `rgb()`/`rgba()` wie
 * `isSafeColor`, `hsl()`/`hsla()` mit Zahlen). Kein `url(`, keine Schlüsselwörter wie
 * `currentcolor`/`inherit`, kein Leerraum außen.
 */
import { isSafeColor } from '../shapes/style';

/** Rand in px um die Zeichnung (vor dem Maßstab). */
export const DEFAULT_MARGIN = 0;
export const MAX_MARGIN = 512;

/** Benannte Farben aus CSS Color Level 4 (ohne Systemfarben). */
const NAMED = new Set(
	(
		'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
		'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
		'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
		'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
		'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
		'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
		'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
		'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
		'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
		'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
		'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
		'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
		'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
		'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
		'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
		'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
		'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow ' +
		'yellowgreen transparent'
	).split(' ')
);

const PLAIN = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`;
const HUE = `-?${PLAIN}(?:deg|grad|rad|turn)?`;
const PCT = `${PLAIN}%`;
const ALPHA = `${PLAIN}%?`;
/** `hsl()`/`hsla()`: Komma-Form (Sättigung/Helligkeit in %) oder Leerzeichen-Form mit `/ alpha`. */
const HSL = new RegExp(
	`^hsla?\\( *(?:${HUE} *, *${PCT} *, *${PCT} *(?:, *${ALPHA} *)?` +
		`|${HUE} +${PCT} +${PCT} *(?:/ *${ALPHA} *)?)\\)$`,
	'i'
);

export function isBackgroundColor(value: string): boolean {
	return NAMED.has(value.toLowerCase()) || isSafeColor(value) || HSL.test(value);
}

/** Erster zulässiger Kandidat (getrimmt), sonst `null`. */
export function pngBackground(...candidates: (string | undefined)[]): string | null {
	for (const c of candidates) {
		const v = c?.trim();
		if (v && isBackgroundColor(v)) return v;
	}
	return null;
}

export function isMargin(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_MARGIN;
}

/** Rand in px; ungültig (keine Ganzzahl, außerhalb 0..512) -> `DEFAULT_MARGIN`. */
export function marginOf(value: unknown): number {
	return isMargin(value) ? value : DEFAULT_MARGIN;
}
