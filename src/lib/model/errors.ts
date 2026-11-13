/**
 * Fehler der Model-Schicht als Code mit Parametern (T128 C3). Rein: keine Importe aus Service-,
 * Controller- oder View-Schicht. Übersetzt wird im Sync-Controller (`describeError`, Schlüssel
 * `services.model.<code>`); `message` ist sprachneutral und stabil.
 */
export type ModelErrorCode =
	'unknownContainer' | 'unknownSection' | 'idTaken' | 'unknownId' | 'unknownEndpoint' | 'cycle';

export type ModelErrorParams = Readonly<Record<string, string | number>>;

export class ModelError extends Error {
	constructor(
		readonly code: ModelErrorCode,
		readonly params: ModelErrorParams = {}
	) {
		super(`${code} ${JSON.stringify(params)}`);
		this.name = 'ModelError';
	}
}
