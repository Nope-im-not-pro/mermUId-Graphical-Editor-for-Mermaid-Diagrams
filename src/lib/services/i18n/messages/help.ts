// Bereichs-Texte (help). en folgt den Schlüsseln von de (fehlender Schlüssel = Typfehler).
export const de = {
	'help.title': 'Hilfe',
	'help.close': 'Schließen',
	'help.version': 'Version {version}',
	'help.loading': 'Diagramm wird geladen ...',
	'help.renderError': 'Diagramm nicht darstellbar{where}: {message}',
	'help.renderErrorLine': ' (Zeile {line})',
	'help.svgUnreadable': 'SVG nicht lesbar.'
} as const;

export const en: Record<keyof typeof de, string> = {
	'help.title': 'Help',
	'help.close': 'Close',
	'help.version': 'Version {version}',
	'help.loading': 'Loading diagram ...',
	'help.renderError': 'Diagram cannot be displayed{where}: {message}',
	'help.renderErrorLine': ' (line {line})',
	'help.svgUnreadable': 'SVG not readable.'
};
