<!--
	Strich-Icons der Shell (Entwurf A). Rein dekorativ: der zugängliche Name kommt immer vom
	Button (sichtbarer Text oder aria-label).
-->
<script lang="ts" module>
	export const ICONS = {
		file: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5',
		open: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
		save: 'M5 3h11l5 5v11a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zM7 3v5h8M7 21v-7h10v7',
		undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
		redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3',
		minus: 'M5 12h14',
		plus: 'M12 5v14M5 12h14',
		fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
		search: 'M11 5a6 6 0 100 12 6 6 0 000-12zM20 20l-4.5-4.5',
		code: 'M8 7l-5 5 5 5M16 7l5 5-5 5',
		export: 'M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6',
		help: 'M12 3a9 9 0 100 18 9 9 0 000-18zM9.5 9a2.5 2.5 0 015 .5c0 2-2.5 2-2.5 4M12 17h.01',
		sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
		moon: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z',
		select: 'M4 4h4M4 4v4M20 4h-4M20 4v4M4 20h4M4 20v-4M20 20h-4M20 20v-4M9 9h6v6H9z',
		eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z'
	} as const;

	export type IconName = keyof typeof ICONS;
</script>

<script lang="ts">
	let { name, size = 18 }: { name: IconName; size?: number } = $props();
</script>

<svg
	class="icon"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	aria-hidden="true"
	focusable="false"
>
	<path d={ICONS[name]} />
</svg>

<style>
	.icon {
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
