/**
 * Startvorlagen des Neu-Dialogs (T105 C1, V-14, F-14): je Typ flowchart/sequence drei Vorlagen
 * im grafisch editierbaren Subset (keine Aliase). Beschriftungen folgen der UI-Sprache; der Code
 * entsteht erst beim Anlegen. Standard (Enter) ist das leere flowchart wie bisher bei "Neu".
 */
import type { MessageKey } from '../../services/i18n';
import { t } from './i18n.svelte';

export type NewType = 'flowchart' | 'sequence';

export interface Template {
	id: string;
	label: MessageKey;
	code: () => string;
}

export const NEW_TYPES: readonly NewType[] = ['flowchart', 'sequence'];

export const TYPE_LABEL: Record<NewType, MessageKey> = {
	flowchart: 'app.new.flowchart',
	sequence: 'app.new.sequence'
};

const lines = (...rows: string[]) => rows.join('\n') + '\n';

const TEMPLATES: Record<NewType, readonly Template[]> = {
	flowchart: [
		{ id: 'empty', label: 'app.new.tplEmpty', code: () => 'flowchart TD\n' },
		{
			id: 'process',
			label: 'app.new.tplProcess',
			code: () =>
				lines(
					'flowchart TD',
					`  A([${t('app.new.wStart')}])`,
					`  B[${t('app.new.wStep')}]`,
					`  C([${t('app.new.wEnd')}])`,
					'  A --> B',
					'  B --> C'
				)
		},
		{
			id: 'decision',
			label: 'app.new.tplDecision',
			code: () =>
				lines(
					'flowchart TD',
					`  A([${t('app.new.wStart')}])`,
					`  B{${t('app.new.wCheck')}}`,
					`  C[${t('app.new.wFix')}]`,
					`  D([${t('app.new.wEnd')}])`,
					'  A --> B',
					`  B -->|${t('app.new.wNo')}| C`,
					'  C --> B',
					`  B -->|${t('app.new.wYes')}| D`
				)
		}
	],
	sequence: [
		{ id: 'empty', label: 'app.new.tplEmpty', code: () => 'sequenceDiagram\n' },
		{
			id: 'request',
			label: 'app.new.tplRequest',
			code: () =>
				lines(
					'sequenceDiagram',
					'  participant Client',
					'  participant Server',
					`  Client->>Server: ${t('app.new.wRequest')}`,
					`  Server-->>Client: ${t('app.new.wResponse')}`
				)
		},
		{
			id: 'three',
			label: 'app.new.tplThree',
			code: () => {
				const user = t('app.new.wUser');
				const service = t('app.new.wService');
				return lines(
					'sequenceDiagram',
					`  actor ${user}`,
					'  participant App',
					`  participant ${service}`,
					`  ${user}->>App: ${t('app.new.wRequest')}`,
					`  App->>${service}: ${t('app.new.wRequest')}`,
					`  ${service}-->>App: ${t('app.new.wResponse')}`,
					`  App-->>${user}: ${t('app.new.wResponse')}`,
					`  Note over App,${service}: ${t('app.new.wNote')}`
				);
			}
		}
	]
};

export function templatesFor(type: NewType): readonly Template[] {
	return TEMPLATES[type];
}

export const DEFAULT_TEMPLATE = { type: 'flowchart' as NewType, id: 'empty' };

export function templateCode(type: NewType, id: string): string {
	return TEMPLATES[type].find((tpl) => tpl.id === id)!.code();
}
