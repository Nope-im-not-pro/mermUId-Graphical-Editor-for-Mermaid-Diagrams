/**
 * Strukturelles Teilen zwischen zwei Modellständen (T142, O-121): Teilbäume von `next`, die
 * wertgleich zu `prev` sind, werden durch die Objekte aus `prev` ersetzt. Generisch über den
 * Objektbaum (keine Feld-Liste), damit neue Felder von `DiagramDocument` automatisch erfasst sind.
 * Array-Elemente werden über den Index zugeordnet; trägt das Element an gleicher Stelle eine
 * andere String-`id`, über die ID (erstes Vorkommen).
 * Rein: weder `prev` noch `next` werden verändert; geänderte Objekte erhalten eine neue Hülle,
 * deren wertgleiche Unterobjekte aus `prev` stammen, neue Unterobjekte bleiben die aus `next`.
 */
import type { DiagramDocument } from './types';

type Obj = Record<string, unknown>;

function isPlain(v: unknown): v is Obj {
	if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
	const proto = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
}

function idOf(v: unknown): string | undefined {
	return isPlain(v) && typeof v.id === 'string' ? v.id : undefined;
}

/**
 * Strings aus `prev` nach Inhalt, erst bei Bedarf aufgebaut. Ein abweichend zugeordnetes Element
 * (z. B. Kante mit verschobener ID) übernimmt so wenigstens gleiche Texte aus `prev` und hält
 * keine Teilstrings des neuen Quelltexts fest.
 */
class StringPool {
	private map: Map<string, string> | undefined;
	constructor(private readonly prev: unknown) {}

	get(s: string): string {
		if (!this.map) {
			const map = new Map<string, string>();
			const walk = (v: unknown) => {
				if (typeof v === 'string') {
					if (!map.has(v)) map.set(v, v);
				} else if (Array.isArray(v)) v.forEach(walk);
				else if (isPlain(v)) Object.values(v).forEach(walk);
			};
			walk(this.prev);
			this.map = map;
		}
		return this.map.get(s) ?? s;
	}
}

function share(a: unknown, b: unknown, pool: StringPool): unknown {
	if (Object.is(a, b)) return a;
	if (typeof b === 'string') return pool.get(b);
	if (Array.isArray(a) && Array.isArray(b)) return shareArray(a, b, pool);
	if (isPlain(a) && isPlain(b)) return shareObject(a, b, pool);
	return b;
}

function shareArray(a: unknown[], b: unknown[], pool: StringPool): unknown[] {
	// ID-Zuordnung nur, wenn das Element an gleicher Stelle eine andere ID trägt (doppelte IDs
	// bleiben so positionsgleich); die Map entsteht erst bei Bedarf.
	let byId: Map<string, unknown> | undefined;
	let same = a.length === b.length;
	const out = b.map((y, i) => {
		const id = idOf(y);
		let base = a[i];
		if (id !== undefined && idOf(base) !== id) {
			if (!byId) {
				byId = new Map();
				for (const x of a) {
					const key = idOf(x);
					if (key !== undefined && !byId.has(key)) byId.set(key, x);
				}
			}
			base = byId.get(id) ?? base;
		}
		const v = share(base, y, pool);
		if (!Object.is(v, a[i])) same = false;
		return v;
	});
	return same ? a : out;
}

function shareObject(a: Obj, b: Obj, pool: StringPool): Obj {
	const keys = Object.keys(b);
	let same = keys.length === Object.keys(a).length;
	// Prototyp von `b` und `defineProperty`: ein Schlüssel `__proto__` bleibt eigene Eigenschaft.
	const out = Object.create(Object.getPrototypeOf(b)) as Obj;
	for (const k of keys) {
		const has = Object.hasOwn(a, k);
		const v = share(has ? a[k] : undefined, b[k], pool);
		if (!has || !Object.is(v, a[k])) same = false;
		Object.defineProperty(out, k, {
			value: v,
			enumerable: true,
			writable: true,
			configurable: true
		});
	}
	return same ? a : out;
}

/** `next` mit allen zu `prev` wertgleichen Teilen aus `prev`; bei voller Gleichheit `prev` selbst. */
export function shareUnchanged(prev: DiagramDocument, next: DiagramDocument): DiagramDocument {
	return share(prev, next, new StringPool(prev)) as DiagramDocument;
}
