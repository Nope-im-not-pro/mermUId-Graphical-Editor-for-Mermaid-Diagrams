<script lang="ts">
	import { SvelteFlowProvider } from '@xyflow/svelte';
	import type { SyncController } from '../../../controllers/sync';
	import type { ModelIssue } from '../../../services/validator';
	import type { Reserve } from './fit';
	import GraphFlow, { type BeforeDelete, type CanvasControl } from './GraphFlow.svelte';
	import type { Measure } from './mapping';

	let {
		sync,
		measure,
		onselect,
		oncontrol,
		onzoom,
		beforedelete,
		issues,
		reserve,
		ongrid
	}: {
		sync: SyncController;
		measure?: Measure;
		onselect?: (ids: string[]) => void;
		oncontrol?: (control: CanvasControl) => void;
		onzoom?: (percent: string) => void;
		beforedelete?: BeforeDelete;
		/** Modell-Befunde der Shell (T123 C4), an GraphFlow durchgereicht. */
		issues?: readonly ModelIssue[];
		/** T126 C1: Vorschau-Rand beim Einpassen, Raster-Schalter in der Shell. */
		reserve?: Reserve | null;
		ongrid?: (shown: boolean) => void;
	} = $props();
</script>

<SvelteFlowProvider>
	<GraphFlow
		{sync}
		{measure}
		{onselect}
		{oncontrol}
		{onzoom}
		{beforedelete}
		{issues}
		{reserve}
		{ongrid}
	/>
</SvelteFlowProvider>
