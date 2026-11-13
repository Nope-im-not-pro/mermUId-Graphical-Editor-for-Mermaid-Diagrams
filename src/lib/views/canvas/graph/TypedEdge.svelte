<script lang="ts">
	import { EdgeReconnectAnchor, type EdgeProps } from '@xyflow/svelte';
	import { linePattern } from '../../../services/shapes';
	import { t } from '../../shell/i18n.svelte';
	import { anchorPoint, edgeGeometry } from './edges';
	import type { FlowEdge } from './mapping';

	let {
		sourceX,
		sourceY,
		targetX,
		targetY,
		sourcePosition,
		targetPosition,
		data,
		selected
	}: EdgeProps<FlowEdge> = $props();

	const LINE = 16;
	/** Umhäng-Griffe (F-03): Größe und Abstand vom Kantenende nach außen. */
	const ANCHOR = 16;
	const ANCHOR_GAP = 12;
	const from = $derived({ x: sourceX, y: sourceY, position: sourcePosition });
	const to = $derived({ x: targetX, y: targetY, position: targetPosition });
	const geo = $derived(edgeGeometry(from, to, data?.arrowHead ?? 'none'));
	const pattern = $derived(linePattern(data?.lineStyle ?? 'solid'));
	const texts = $derived([
		...(data?.lines ?? []),
		...(data?.issues ?? []).map((i) => `${i.icon} ${i.text}`)
	]);
	const firstY = $derived(geo.labelY - ((texts.length - 1) * LINE) / 2);
</script>

<path class="hit" d={geo.path} />
{#if pattern.visible}
	<path
		class="line"
		class:selected
		d={geo.path}
		stroke-width={pattern.width}
		stroke-dasharray={pattern.dasharray}
		style:--edge-stroke={data?.style?.stroke}
		style:stroke-width={data?.style?.strokeWidth}
		style:stroke-dasharray={data?.style?.strokeDasharray}
	/>
	{#each geo.markers as m, i (i)}
		<path
			class="marker"
			class:filled={m.filled}
			d={m.path}
			transform={m.transform}
			style:--edge-stroke={data?.style?.stroke}
		/>
	{/each}
{/if}
{#if texts.length > 0}
	<text
		class="label"
		text-anchor="middle"
		dominant-baseline="middle"
		style:--edge-color={data?.style?.color}
	>
		{#each texts as line, i (i)}
			<tspan x={geo.labelX} y={firstY + i * LINE}>{line}</tspan>
		{/each}
	</text>
{/if}

{#if selected}
	<!-- Nur an der ausgewählten Kante: sonst überdecken die Griffe die Verbinden-Handles. -->
	<EdgeReconnectAnchor
		type="source"
		position={anchorPoint(from, ANCHOR_GAP)}
		size={ANCHOR}
		title={t('canvas.edge.reconnectSource')}
		aria-label={t('canvas.edge.reconnectSource')}
	>
		<span class="knob"></span>
	</EdgeReconnectAnchor>
	<EdgeReconnectAnchor
		type="target"
		position={anchorPoint(to, ANCHOR_GAP)}
		size={ANCHOR}
		title={t('canvas.edge.reconnectTarget')}
		aria-label={t('canvas.edge.reconnectTarget')}
	>
		<span class="knob"></span>
	</EdgeReconnectAnchor>
{/if}

<style>
	.hit {
		fill: none;
		stroke: transparent;
		stroke-width: 16;
	}
	.line {
		fill: none;
		stroke: var(--edge-stroke, var(--edge, #333));
	}
	.line.selected {
		stroke: var(--focus, #1a5fb4);
	}
	.marker {
		fill: none;
		stroke: var(--edge-stroke, var(--edge, #333));
		stroke-width: 1.5;
	}
	.marker.filled {
		fill: var(--edge-stroke, var(--edge, #333));
	}
	.knob {
		display: block;
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		border-radius: 50%;
		background: var(--canvas-bg, #fff);
		border: 2px solid var(--focus, #1a5fb4);
	}
	.label {
		font: 12px sans-serif;
		fill: var(--edge-color, var(--edge-label, #000));
		paint-order: stroke;
		stroke: var(--canvas-bg, #fff);
		stroke-width: 4px;
	}
</style>
