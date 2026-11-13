/**
 * Verbinden-Modus der Shell als Zustandsautomat (T123 C3, KONZEPT §5): `idle` -> `start` ->
 * `picking` (Quelle fest, Ziel per Pfeil) -> Enter verbindet, Esc bricht ab, `reset` beendet still
 * (Moduswechsel, fremde Taste). Alt+Pfeil (`neighbor`) verbindet direkt ohne Moduszustand.
 */
import type { Rect } from '../canvas/common/grid';
import { neighbor, type ConnectStep, type Dir } from './keymap';
import type { StatusMessage } from './status';

export type ConnectState =
	| { readonly type: 'idle' }
	| { readonly type: 'picking'; readonly source: string; readonly target: string | null };

export interface ConnectDeps {
	/** Auswahl, sonst fokussierter Knoten (kann Kanten enthalten). */
	targets(): string[];
	nodeIds(): string[];
	/** Geometrie des Graph-Canvas; `null` ohne Graph-Canvas. */
	geometry(): Readonly<Record<string, Rect>> | null;
	label(id: string): string | undefined;
	/** Quelle und Ziel markieren, ohne zu zentrieren. */
	select(ids: string[]): void;
	connect(source: string, target: string): void;
	say(message: StatusMessage): void;
}

export interface ConnectMode {
	readonly state: ConnectState;
	readonly active: boolean;
	start(): void;
	step(step: ConnectStep): void;
	neighbor(dir: Dir): void;
	reset(): void;
}

const IDLE: ConnectState = { type: 'idle' };

export function createConnectMode(deps: ConnectDeps): ConnectMode {
	let state: ConnectState = IDLE;
	const info = (key: StatusMessage['key'], params?: StatusMessage['params']) =>
		deps.say({ key, ...(params && { params }), tone: 'info' });
	const source = () => deps.targets().find((id) => deps.nodeIds().includes(id));
	const next = (from: string, dir: Dir) => {
		const geometry = deps.geometry();
		return geometry ? neighbor(geometry, deps.nodeIds(), from, dir) : null;
	};

	return {
		get state() {
			return state;
		},
		get active() {
			return state.type !== 'idle';
		},
		start() {
			const id = source();
			if (!id) return info('app.shell.connectNoSource');
			state = { type: 'picking', source: id, target: null };
			info('app.shell.connectStart');
		},
		step(step) {
			if (state.type === 'idle') return;
			const c = state;
			if (step.type !== 'target') {
				state = IDLE;
				if (step.type === 'cancel') info('app.shell.connectCancelled');
				else if (c.target) deps.connect(c.source, c.target);
				else info('app.shell.connectNoTarget');
				return;
			}
			const target = next(c.target ?? c.source, step.dir);
			if (!target) return info('app.shell.noNeighbor');
			state = { ...c, target };
			deps.select([c.source, target]);
			info('app.shell.connectTarget', { target: deps.label(target) || target });
		},
		neighbor(dir) {
			const from = source();
			const target = from ? next(from, dir) : null;
			if (!from || !target) info('app.shell.noNeighbor');
			else deps.connect(from, target);
		},
		reset() {
			state = IDLE;
		}
	};
}
