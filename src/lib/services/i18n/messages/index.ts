// Gesamt-Wörterbuch aus den Bereichs-Dateien. Ein fehlender en-Schlüssel ist ein Typfehler
// in der jeweiligen Bereichs-Datei (Record<keyof typeof de, string>).
import * as app from './app';
import * as canvas from './canvas';
import * as help from './help';
import * as panels from './panels';
import * as services from './services';
import * as shell from './shell';

export const de = {
	...shell.de,
	...app.de,
	...panels.de,
	...canvas.de,
	...services.de,
	...help.de
};
export const en: Record<keyof typeof de, string> = {
	...shell.en,
	...app.en,
	...panels.en,
	...canvas.en,
	...services.en,
	...help.en
};
