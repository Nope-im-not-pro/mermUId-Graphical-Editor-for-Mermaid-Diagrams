<script lang="ts">
	import { untrack } from 'svelte';
	import { editorKey } from '../common/shortcuts';
	import { t } from '../../shell/i18n.svelte';
	import type { EditTarget } from './interaction';

	let {
		target,
		zoom = 1,
		oncommit,
		oncancel
	}: {
		target: EditTarget;
		/** Canvas-Zoom: Schrift wächst wie die Box mit, lesbar ab 10px. */
		zoom?: number;
		oncommit: (text: string) => void;
		oncancel: () => void;
	} = $props();

	// Startwert genügt: der Editor wird je Ziel neu eingehängt.
	let text = $state(untrack(() => target.text));
	let done = false;
	let area: HTMLTextAreaElement;

	$effect(() => {
		queueMicrotask(() => {
			area.focus();
			area.select();
		});
	});

	function finish(commit: boolean) {
		if (done) return;
		done = true;
		if (commit) oncommit(text);
		else oncancel();
	}

	function onkeydown(e: KeyboardEvent) {
		e.stopPropagation();
		const k = editorKey(e);
		if (!k) return;
		e.preventDefault();
		finish(k === 'commit');
	}
</script>

<textarea
	bind:this={area}
	bind:value={text}
	class="inline-editor"
	aria-label={t('canvas.editLabel')}
	style:left="{target.box.x}px"
	style:top="{target.box.y}px"
	style:width="{Math.max(target.box.w, 120)}px"
	style:height="{Math.max(target.box.h, 40)}px"
	style:font-size="{Math.max(10, 14 * zoom)}px"
	{onkeydown}
	onpointerdown={(e) => e.stopPropagation()}
	onblur={() => finish(true)}></textarea>

<style>
	.inline-editor {
		position: absolute;
		box-sizing: border-box;
		font: 14px sans-serif;
		text-align: center;
		resize: none;
		z-index: 10;
	}
</style>
