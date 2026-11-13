<script lang="ts">
	import { menuNavigate, type MenuItem } from '../common/contextMenu';
	import { t } from '../../shell/i18n.svelte';

	let {
		items,
		x,
		y,
		onselect,
		onclose
	}: {
		items: MenuItem[];
		x: number;
		y: number;
		onselect: (id: string) => void;
		onclose: () => void;
	} = $props();

	let active = $state(0);
	let menu: HTMLUListElement;

	$effect(() => {
		menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[active]?.focus();
	});

	function onkeydown(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Escape' || e.key === 'Tab') {
			e.preventDefault();
			onclose();
			return;
		}
		const next = menuNavigate(active, e.key, items.length);
		if (next !== active || e.key === 'Home' || e.key === 'End') {
			e.preventDefault();
			active = next;
		}
	}

	function onfocusout(e: FocusEvent) {
		if (!menu.contains(e.relatedTarget as Node | null)) onclose();
	}
</script>

<ul
	bind:this={menu}
	class="context-menu"
	role="menu"
	aria-label={t('canvas.menu.label')}
	style:left="{x}px"
	style:top="{y}px"
	{onkeydown}
	{onfocusout}
>
	{#each items as item, i (item.id)}
		<li role="none">
			<button
				type="button"
				role="menuitem"
				tabindex={i === active ? 0 : -1}
				onclick={() => onselect(item.id)}>{item.label}</button
			>
		</li>
	{/each}
</ul>

<style>
	.context-menu {
		position: absolute;
		z-index: 20;
		margin: 0;
		padding: 3px;
		list-style: none;
		background: var(--panel-bg, #fff);
		border: 1px solid var(--line, #888);
		border-radius: 10px;
		box-shadow: var(--shadow, none);
		color: var(--text, inherit);
		font-size: 13px;
	}
	button {
		display: block;
		width: 100%;
		padding: 6px 12px;
		border: 0;
		border-radius: 7px;
		background: none;
		color: inherit;
		text-align: left;
		font: inherit;
		cursor: pointer;
	}
	button:hover {
		background: var(--surface-3, #eee);
	}
	button:focus {
		background: var(--accent-soft, #dbe7ff);
		outline: 2px solid var(--focus, #1c5fd1);
		outline-offset: -2px;
	}
</style>
