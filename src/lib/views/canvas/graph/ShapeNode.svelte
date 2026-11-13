<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import type { FlowNode } from './mapping';
	import { t } from '../../shell/i18n.svelte';
	import { labelArea } from '../../../services/shapes';

	let { data, selected }: NodeProps<FlowNode> = $props();

	const LINE = 18;
	/** Label mittig in der Fläche der Form (neue Formen: neben Welle, Rundung, Deckel). */
	const area = $derived(labelArea(data.shape, data.width, data.height));
	const centerX = $derived(area.x + area.w / 2);
	const firstY = $derived(area.y + area.h / 2 - ((data.lines.length - 1) * LINE) / 2);
</script>

<div
	class="shape"
	class:selected
	style:width="{data.width}px"
	style:height="{data.height}px"
	style:--shape-fill={data.style.fill}
	style:--shape-stroke={data.style.stroke}
	style:--shape-stroke-width={data.style.strokeWidth}
	style:--shape-dash={data.style.strokeDasharray}
>
	<svg width={data.width} height={data.height} aria-hidden="true">
		<path class="outline" d={data.path} />
	</svg>
	<svg class="label" width={data.width} height={data.height} style:color={data.textColor}>
		<text text-anchor="middle" dominant-baseline="middle">
			{#each data.lines as line, i (i)}
				<tspan x={centerX} y={firstY + i * LINE}>{line}</tspan>
			{/each}
		</text>
	</svg>
	{#each data.issues as issue, i (i)}
		<span class="issue {issue.severity}" role="note">{issue.icon} {issue.text}</span>
	{/each}
	<Handle type="source" id="n" position={Position.Top} aria-label={t('panels.handle.n')} />
	<Handle type="source" id="e" position={Position.Right} aria-label={t('panels.handle.e')} />
	<Handle type="source" id="s" position={Position.Bottom} aria-label={t('panels.handle.s')} />
	<Handle type="source" id="w" position={Position.Left} aria-label={t('panels.handle.w')} />
</div>

<style>
	.shape {
		position: relative;
	}
	svg {
		position: absolute;
		inset: 0;
		overflow: visible;
	}
	.outline {
		fill: var(--shape-fill, var(--node-fill, #fff));
		stroke: var(--shape-stroke, var(--node-stroke, #333));
		stroke-width: var(--shape-stroke-width, 1.5);
		stroke-dasharray: var(--shape-dash, none);
	}
	.selected .outline {
		stroke: var(--focus, #1a5fb4);
		stroke-width: 2;
		filter: drop-shadow(0 0 10px color-mix(in srgb, var(--focus, #1a5fb4) 45%, transparent));
	}
	text {
		font: 14px sans-serif;
		fill: currentColor;
	}
	.issue {
		position: absolute;
		top: 100%;
		left: 0;
		font-size: 12px;
		white-space: nowrap;
	}
	.issue.error {
		color: var(--err, #a51d2d);
	}
</style>
