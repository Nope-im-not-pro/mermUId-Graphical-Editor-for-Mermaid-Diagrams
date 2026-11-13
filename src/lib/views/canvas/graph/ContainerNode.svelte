<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import type { FlowNode } from './mapping';
	import { t } from '../../shell/i18n.svelte';

	let { data, selected }: NodeProps<FlowNode> = $props();
</script>

<!-- CSS-Rahmen kennt kein Strichmuster: `stroke-dasharray` wird als `dashed` angenähert. -->
<div
	class="container"
	class:selected
	style:width="{data.width}px"
	style:height="{data.height}px"
	style:--ct-fill={data.style.fill}
	style:--ct-stroke={data.style.stroke}
	style:--ct-stroke-width={data.style.strokeWidth === undefined
		? undefined
		: `${data.style.strokeWidth}px`}
	style:--ct-border-style={data.style.strokeDasharray ? 'dashed' : undefined}
>
	<div class="title" style:color={data.textColor}>
		{#each data.lines as line, i (i)}<span>{line}</span>{/each}
	</div>
	{#each data.issues as issue, i (i)}
		<span class="issue {issue.severity}" role="note">{issue.icon} {issue.text}</span>
	{/each}
	<Handle type="source" id="n" position={Position.Top} aria-label={t('panels.handle.n')} />
	<Handle type="source" id="e" position={Position.Right} aria-label={t('panels.handle.e')} />
	<Handle type="source" id="s" position={Position.Bottom} aria-label={t('panels.handle.s')} />
	<Handle type="source" id="w" position={Position.Left} aria-label={t('panels.handle.w')} />
</div>

<style>
	.container {
		box-sizing: border-box;
		border: var(--ct-stroke-width, 1.5px) var(--ct-border-style, solid)
			var(--ct-stroke, var(--node-stroke, #333));
		background: var(--ct-fill, var(--container-fill, rgba(240, 240, 255, 0.4)));
		border-radius: 4px;
	}
	.selected {
		border: 3px solid var(--focus, #1a5fb4);
	}
	.title {
		display: flex;
		flex-direction: column;
		padding: 4px 8px;
		font: 600 13px sans-serif;
	}
	.issue {
		display: block;
		padding: 0 8px;
		font-size: 12px;
	}
	.issue.error {
		color: var(--err, #a51d2d);
	}
</style>
