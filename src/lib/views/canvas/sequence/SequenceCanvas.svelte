<script lang="ts" module>
	/**
	 * Steuerung für die Shell (T21): Auswahl setzen und Element in den Blick holen. Zoom wie
	 * `CanvasControl` des Graph-Canvas (T124, Naht T126). `viewport` x/y bedeutungsgleich zu
	 * `CanvasControl`: Modellpunkt = (Client - linke obere Ecke `.surface` - x) / zoom.
	 */
	export type SequenceControl = {
		zoomIn(): void;
		zoomOut(): void;
		fit(): void;
		viewport(): { x: number; y: number; zoom: number };
		select(id: string, focus?: boolean): void;
		focus(): void;
	};
</script>

<script lang="ts">
	import { flushSync, tick, untrack } from 'svelte';
	import type { Command } from '../../../controllers/commands/history';
	import { sequenceGrammar, type SyncController } from '../../../controllers/sync';
	import { ARROW_TOKENS, arrowLabel, withToken } from './arrows';
	import {
		addActivation,
		addBox,
		addContainer,
		addMessage,
		addNote,
		addParticipant,
		addSection,
		deleteElements,
		locate,
		rename,
		setAutonumber,
		lifecycleModes,
		lifecycleOf,
		setBoxColor,
		setLifecycle,
		setMessage,
		setParticipantBox,
		ungroupBox,
		type BlockKind,
		type LifecycleMode,
		type Placement
	} from './commands';
	import {
		editTarget,
		focusRing,
		keyIntent,
		stepCommand,
		toModelDelta,
		toScreenBox,
		type EditTarget
	} from './interaction';
	import {
		parseSectionId,
		textMeasure,
		toSequence,
		type OutlineEntry,
		type SeqItem
	} from './mapping';
	import {
		dropTarget,
		moveTo,
		participantIndexAt,
		participantOrder,
		reorderParticipants
	} from './order';
	import SequenceEditor from './SequenceEditor.svelte';
	import { clampZoom, fitZoom, ZOOM_STEP, zoomPercent, zoomScroll } from '../common/viewport';
	import { fitFrame, type Reserve } from '../graph/fit';
	import { t } from '../../shell/i18n.svelte';
	import type { MessageKey } from '../../../services/i18n';

	let {
		sync,
		onselect,
		oncontrol,
		onzoom,
		reserve,
		beforedelete
	}: {
		sync: SyncController;
		onselect?: (ids: string[]) => void;
		oncontrol?: (control: SequenceControl) => void;
		/** Aktueller Zoom als Prozent-Text, wie `GraphCanvas` `onzoom`. */
		onzoom?: (percent: string) => void;
		/** Von der Vorschau-Karte belegter Rand der Shell-Fläche (M-12 a), wie `GraphCanvas`. */
		reserve?: Reserve | null;
		/** Rückfrage vor dem Löschen; `force` = Shift-Entf. `false` bricht ab. */
		beforedelete?: (ids: string[], force: boolean) => boolean | Promise<boolean>;
	} = $props();

	const uid = $props.id();
	/** Hinweis am gesperrten Schalter "Nummerierung" (O-175). */
	const fixedHintId = `${uid}-autonumber-fixed`;
	const LINE = 18;
	const DRAG_MIN = 4;
	const PLACEMENTS: Placement[] = ['over', 'left of', 'right of'];
	const BLOCKS: BlockKind[] = ['loop', 'alt', 'opt', 'par', 'critical', 'rect', 'break'];
	const HEADS = ['arrow', 'open', 'cross', 'half'];
	/**
	 * Ohne Nachricht alle Optionen (Auswahl deaktiviert): gleiche Breite wie bei Auswahl, sonst bricht
	 * die Leiste beim ersten Klick um und verschiebt die Fläche mitten im Doppelklick.
	 */
	const ALL_LIFECYCLE: LifecycleMode[] = ['', 'create', 'destroySource', 'destroyTarget'];
	/** Bezeichnungen wie im Eigenschaften-Panel (`panels/properties.ts`), V-16. */
	const PLACEMENT_KEYS = {
		over: 'panels.placement.over',
		'left of': 'panels.placement.leftOf',
		'right of': 'panels.placement.rightOf'
	} as const satisfies Record<Placement, MessageKey>;
	const BLOCK_KEYS = {
		loop: 'panels.block.loop',
		alt: 'panels.block.alt',
		opt: 'panels.block.opt',
		par: 'panels.block.par',
		critical: 'panels.block.critical',
		rect: 'panels.block.rect',
		break: 'services.sequence.block.break'
	} as const satisfies Record<BlockKind, MessageKey>;
	const VERTICAL = new Set(['message', 'note', 'activate', 'deactivate', 'container']);

	const commands = $derived(sync.commands);
	const doc = $derived($commands.doc);
	const view = $derived(toSequence(doc, $sync.errors, textMeasure));

	let root: HTMLDivElement;
	let container: HTMLDivElement;
	let selected = $state<string | null>(null);
	let editing = $state<EditTarget | null>(null);
	let status = $state('');
	/** CSS-Skalierung der Fläche (M-07 a): SVG-Anzeigegröße = Modellgröße x Zoom, Pan = Scrollen. */
	let zoom = $state(1);
	let from = $state('');
	let to = $state('');
	let arrow = $state('->>');
	let placement = $state<Placement>('over');
	let blockKind = $state<BlockKind>('loop');
	let drag = $state<{
		item: SeqItem;
		x0: number;
		y0: number;
		dx: number;
		dy: number;
		moved: boolean;
	} | null>(null);

	const current = $derived(view.items.find((i) => i.id === selected) ?? null);
	const fromId = $derived(view.participants.includes(from) ? from : (view.participants[0] ?? ''));
	const toId = $derived(
		view.participants.includes(to) ? to : (view.participants[1] ?? view.participants[0] ?? '')
	);
	const message = $derived(
		current?.type === 'message' ? doc.edges.find((e) => e.id === current.id) : undefined
	);
	/** Teilnehmer-Gruppen (`box`, T135 C2) und Auswahl dazu. */
	const groups = $derived(doc.containers.filter((c) => c.kind === 'box'));
	const box = $derived(
		current?.type === 'box' ? groups.find((c) => c.id === current.id) : undefined
	);
	const person = $derived(
		current?.type === 'participant' || current?.type === 'actor' ? current.id : null
	);
	const personBox = $derived(
		person ? (groups.find((c) => c.sections[0].memberIds.includes(person))?.id ?? '') : ''
	);
	const boxColor = $derived(String(box?.props.color ?? ''));
	/** Farbliste: Auswahl der Allow-Liste, eine abweichende zulässige Farbe aus dem Code dazu. */
	const colors = $derived(
		boxColor && !sequenceGrammar.boxColors.includes(boxColor)
			? [...sequenceGrammar.boxColors, boxColor]
			: sequenceGrammar.boxColors
	);
	const blockId = $derived(
		current?.type === 'section'
			? parseSectionId(current.id)!.containerId
			: current?.type === 'container'
				? current.id
				: null
	);

	/** Auswahl an die Shell melden (Abschnitt als sein Block), nur bei echter Änderung. */
	let reported = '';
	$effect(() => {
		const ids = current ? [blockId ?? current.id] : [];
		const key = ids.join('\n');
		if (key === reported) return;
		reported = key;
		if (onselect) untrack(() => onselect(ids));
	});

	$effect(() => onzoom?.(zoomPercent(zoom)));

	/** Neuer Zoom; die Mitte des sichtbaren Ausschnitts bleibt stehen. */
	function zoomTo(next: number) {
		const from = zoom;
		zoom = clampZoom(next);
		flushSync();
		root.scrollLeft = zoomScroll(root.scrollLeft, root.clientWidth, from, zoom);
		root.scrollTop = zoomScroll(root.scrollTop, root.clientHeight, from, zoom);
	}

	/**
	 * Rand der Karte bezogen auf die Scroll-Fläche: der Rand gilt ab Kante der Bezugsbox (Shell-
	 * Fläche, Elternelement), die Fläche endet um Outline/Status (unten) bzw. Rand (rechts) früher
	 * oder steht bei min-height über (O-141).
	 */
	function surfaceReserve(): Reserve | null {
		if (!reserve) return null;
		const outer = (container.parentElement ?? container).getBoundingClientRect();
		const inner = root.getBoundingClientRect();
		return {
			right: reserve.right - (outer.right - inner.right),
			bottom: reserve.bottom - (outer.bottom - inner.bottom)
		};
	}

	/** Einpassen links oben; die Karte unten rechts wird ausgespart (T126 C3, wie Graph M-12). */
	function fit() {
		const frame = { width: root.clientWidth, height: root.clientHeight };
		zoom = fitZoom(view, fitFrame(frame, surfaceReserve()));
		flushSync();
		root.scrollLeft = 0;
		root.scrollTop = 0;
	}

	untrack(() =>
		oncontrol?.({
			zoomIn: () => zoomTo(zoom * ZOOM_STEP),
			zoomOut: () => zoomTo(zoom / ZOOM_STEP),
			fit,
			viewport: () => ({
				x: -root.scrollLeft - view.minX * zoom,
				y: -root.scrollTop - view.minY * zoom,
				zoom
			}),
			select: (id, focus = true) => {
				selected = id;
				flushSync();
				if (focus) root.querySelector<SVGGElement>(`[data-id="${CSS.escape(id)}"]`)?.focus();
			},
			focus: () => root.focus()
		})
	);

	async function remove(id: string, force: boolean) {
		if (beforedelete && !(await beforedelete([id], force))) return;
		await run(deleteElements([id]), null);
	}

	/** Jede Änderung als Command über den Sync-Controller; Fehler als Status. */
	async function run(command: Command, focusId: string | null = selected) {
		try {
			await sync.execute(command);
			status = '';
		} catch (err) {
			status = t('canvas.commandFailed', {
				label: command.label,
				error: err instanceof Error ? err.message : String(err)
			});
		}
		await tick();
		const el = focusId
			? root.querySelector<SVGGElement>(`[data-id="${CSS.escape(focusId)}"]`)
			: null;
		(el ?? root).focus();
	}

	function openEditor(id: string) {
		editing = editTarget(doc, view, id);
	}

	function commit(text: string) {
		const target = editing!;
		editing = null;
		if (text !== target.text) void run(rename(target.id, text), target.id);
		else root.focus();
	}

	function cancel() {
		const id = editing!.id;
		editing = null;
		root.querySelector<SVGGElement>(`[data-id="${CSS.escape(id)}"]`)?.focus();
	}

	function onkeydown(e: KeyboardEvent) {
		const id = (e.target as Element).closest('[data-id]')?.getAttribute('data-id') ?? null;
		const action = keyIntent(e, { canvasFocused: id !== null, editing: editing !== null });
		if (!action || !id) return;
		if (action.type === 'edit') {
			e.preventDefault();
			openEditor(id);
		} else if (action.type === 'delete') {
			e.preventDefault();
			void remove(id, e.shiftKey);
		} else {
			const command = stepCommand(doc, view, id, action.axis, action.dir);
			if (!command) return;
			e.preventDefault();
			void run(command, id);
		}
	}

	function onpointerdown(e: PointerEvent, item: SeqItem) {
		if (e.button !== 0 || editing) return;
		selected = item.id;
		drag = { item, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, moved: false };
	}

	function onpointermove(e: PointerEvent) {
		if (!drag) return;
		drag.dx = e.clientX - drag.x0;
		drag.dy = e.clientY - drag.y0;
		drag.moved ||= Math.hypot(drag.dx, drag.dy) >= DRAG_MIN;
	}

	function onpointerup() {
		const d = drag;
		drag = null;
		if (!d?.moved) return;
		const { item } = d;
		const { dx, dy } = toModelDelta(d.dx, d.dy, zoom);
		if (item.type === 'participant' || item.type === 'actor') {
			const x = item.box.x + item.box.w / 2 + dx;
			const order = participantOrder(doc).filter((id) => id !== item.id);
			order.splice(participantIndexAt(view, item.id, x), 0, item.id);
			void run(reorderParticipants(order), item.id);
		} else if (VERTICAL.has(item.type)) {
			const target = dropTarget(doc, view, item.id, item.box.y + dy);
			const at = locate(doc, item.id);
			if (
				at &&
				at.parent === target.parent &&
				at.section === target.section &&
				at.index === target.index
			)
				return;
			void run(moveTo(item.id, target), item.id);
		}
	}

	/** Vorschau-Verschiebung im SVG (Modell-Einheiten); `drag.dx/dy` sind Bildschirm-Pixel. */
	const offset = (item: SeqItem) => {
		if (!drag?.moved || drag.item.id !== item.id) return undefined;
		const { dx, dy } = toModelDelta(drag.dx, drag.dy, zoom);
		return item.type === 'participant' || item.type === 'actor'
			? `translate(${dx} 0)`
			: `translate(0 ${dy})`;
	};

	const vertical = (item: SeqItem | null) =>
		item && VERTICAL.has(item.type) ? item.id : undefined;

	function addBlock() {
		if (current?.type === 'section') void run(addContainer(blockKind, current.id));
		else void run(addContainer(blockKind, undefined, vertical(current)));
	}

	function addNoteHere() {
		const ps = placement === 'over' && toId && toId !== fromId ? [fromId, toId] : [fromId];
		void run(addNote(placement, ps, current?.id));
	}

	const centerX = (item: SeqItem) => item.box.x + item.box.w / 2;
	const lineY = (item: SeqItem, i: number) =>
		item.box.y + item.box.h / 2 + (i - (item.lines.length - 1) / 2) * LINE + 5;
</script>

<svelte:window {onpointermove} {onpointerup} />

{#snippet tree(entries: OutlineEntry[])}
	<ul>
		{#each entries as entry (entry.id)}
			<li>
				{entry.aria}
				{#if entry.children.length > 0}{@render tree(entry.children)}{/if}
			</li>
		{/each}
	</ul>
{/snippet}

<div class="sequence-canvas" bind:this={container}>
	<div class="toolbar" role="toolbar" aria-label={t('canvas.seq.toolbar')}>
		<button type="button" onclick={() => run(addParticipant('participant'))}
			>{t('canvas.seq.addParticipant')}</button
		>
		<button type="button" onclick={() => run(addParticipant('actor'))}
			>{t('canvas.seq.addActor')}</button
		>
		<select
			aria-label={t('canvas.seq.from')}
			value={fromId}
			onchange={(e) => (from = e.currentTarget.value)}
		>
			{#each view.participants as id (id)}<option value={id}>{id}</option>{/each}
		</select>
		<select
			aria-label={t('canvas.seq.to')}
			value={toId}
			onchange={(e) => (to = e.currentTarget.value)}
		>
			{#each view.participants as id (id)}<option value={id}>{id}</option>{/each}
		</select>
		<select
			aria-label={t('canvas.seq.arrow')}
			value={arrow}
			onchange={(e) => (arrow = e.currentTarget.value)}
		>
			{#each ARROW_TOKENS as token (token)}<option value={token}>{arrowLabel(token)}</option>{/each}
		</select>
		<button
			type="button"
			disabled={!fromId}
			onclick={() => run(addMessage(fromId, toId, arrow, vertical(current) ?? current?.id))}
			>{t('canvas.seq.addMessage')}</button
		>
		<select
			aria-label={t('canvas.seq.placement')}
			value={placement}
			onchange={(e) => (placement = e.currentTarget.value as Placement)}
		>
			{#each PLACEMENTS as p (p)}<option value={p}>{withToken(t(PLACEMENT_KEYS[p]), p)}</option
				>{/each}
		</select>
		<button type="button" disabled={!fromId} onclick={addNoteHere}>{t('canvas.seq.addNote')}</button
		>
		<button
			type="button"
			disabled={!fromId}
			onclick={() => run(addActivation(fromId, vertical(current)))}
			>{t('canvas.seq.addActivation')}</button
		>
		<select
			aria-label={t('canvas.seq.blockKind')}
			value={blockKind}
			onchange={(e) => (blockKind = e.currentTarget.value as BlockKind)}
		>
			{#each BLOCKS as kind (kind)}<option value={kind}
					>{withToken(t(BLOCK_KEYS[kind]), kind)}</option
				>{/each}
		</select>
		<button type="button" onclick={addBlock}>{t('canvas.seq.addBlock')}</button>
		<button type="button" disabled={!blockId} onclick={() => blockId && run(addSection(blockId))}
			>{t('canvas.seq.addSection')}</button
		>
		<button type="button" disabled={!current} onclick={() => current && remove(current.id, false)}
			>{t('canvas.seq.delete')}</button
		>
		<button type="button" onclick={() => run(addBox(person ?? undefined))}
			>{t('services.sequence.box.add')}</button
		>
		<select
			aria-label={t('services.sequence.box.member')}
			disabled={!person}
			value={personBox}
			onchange={(e) => {
				const value = e.currentTarget.value;
				// Modellwert zurück: ein abgelehntes Command ändert `personBox` nicht.
				e.currentTarget.value = personBox;
				if (person) run(setParticipantBox(person, value || null), person);
			}}
		>
			<option value="">{t('services.sequence.box.none')}</option>
			{#each groups as g (g.id)}<option value={g.id}>{g.label || g.id}</option>{/each}
		</select>
		<select
			aria-label={t('services.sequence.box.color')}
			disabled={!box}
			value={boxColor}
			onchange={(e) => {
				const value = e.currentTarget.value;
				e.currentTarget.value = boxColor;
				if (box) run(setBoxColor(box.id, value), box.id);
			}}
		>
			<option value="">{t('services.sequence.box.noColor')}</option>
			{#each colors as c (c)}<option value={c}>{c}</option>{/each}
		</select>
		<button type="button" disabled={!box} onclick={() => box && run(ungroupBox(box.id), null)}
			>{t('services.sequence.box.ungroup')}</button
		>
		<button
			type="button"
			aria-pressed={view.autonumber}
			disabled={view.autonumberFixed}
			aria-describedby={view.autonumberFixed ? fixedHintId : undefined}
			onclick={() => run(setAutonumber(!view.autonumber))}
			>{t('services.sequence.autonumber')}</button
		>
		{#if view.autonumberFixed}<span class="hint" id={fixedHintId} data-testid="autonumber-fixed"
				>{t('services.sequence.autonumberFixed')}</span
			>{/if}
		<!-- Immer vorhanden (ohne Nachricht deaktiviert): Auswahl ändert die Leistenhöhe nicht, sonst
		     verschiebt der erste Klick eines Doppelklicks die Fläche unter dem Zeiger. -->
		<select
			aria-label={t('canvas.seq.messageFrom')}
			disabled={!message}
			value={message?.sourceId ?? ''}
			onchange={(e) =>
				message && run(setMessage(message.id, { sourceId: e.currentTarget.value }), message.id)}
		>
			{#each view.participants as id (id)}<option value={id}>{id}</option>{/each}
		</select>
		<select
			aria-label={t('canvas.seq.messageTo')}
			disabled={!message}
			value={message?.targetId ?? ''}
			onchange={(e) =>
				message && run(setMessage(message.id, { targetId: e.currentTarget.value }), message.id)}
		>
			{#each view.participants as id (id)}<option value={id}>{id}</option>{/each}
		</select>
		<select
			aria-label={t('canvas.seq.messageArrow')}
			disabled={!message}
			value={message ? String(message.props.arrow) : ''}
			onchange={(e) =>
				message && run(setMessage(message.id, { arrow: e.currentTarget.value }), message.id)}
		>
			{#each ARROW_TOKENS as token (token)}<option value={token}>{arrowLabel(token)}</option>{/each}
		</select>
		<select
			aria-label={t('services.sequence.lifecycle')}
			disabled={!message}
			value={message ? lifecycleOf(message) : ''}
			onchange={(e) =>
				message &&
				run(setLifecycle(message.id, e.currentTarget.value as LifecycleMode), message.id)}
		>
			{#each message ? lifecycleModes(message) : ALL_LIFECYCLE as mode (mode)}<option value={mode}
					>{t(`services.sequence.lifecycle.${mode || 'none'}`)}</option
				>{/each}
		</select>
	</div>

	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<div
		class="surface"
		role="application"
		aria-label={t('canvas.seq.label')}
		tabindex="0"
		bind:this={root}
		{onkeydown}
	>
		<svg
			width={view.width * zoom}
			height={view.height * zoom}
			viewBox="{view.minX} {view.minY} {view.width} {view.height}"
			aria-hidden="false"
		>
			<defs>
				{#each HEADS as head (head)}
					<marker
						id="{uid}-{head}"
						viewBox="0 0 10 10"
						refX="10"
						refY="5"
						markerWidth="8"
						markerHeight="8"
						orient="auto-start-reverse"
					>
						{#if head === 'arrow'}<path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
						{:else if head === 'open'}<path
								d="M0,0 L10,5 L0,10"
								fill="none"
								stroke="currentColor"
							/>
						{:else if head === 'cross'}<path d="M0,0 L10,10 M10,0 L0,10" stroke="currentColor" />
						{:else}<path d="M0,0 L10,5 L0,5 z" fill="currentColor" />{/if}
					</marker>
				{/each}
			</defs>
			{#each view.lifelines as l (l.id)}
				<line class="lifeline" x1={l.x} y1={l.y1} x2={l.x} y2={l.y2} />
			{/each}
			{#each view.bars as bar, i (i)}
				<rect class="bar" x={bar.x} y={bar.y} width={bar.w} height={bar.h} />
			{/each}
			{#each view.items as item (item.id)}
				{@const ring = focusRing(item.box, zoom)}
				<g
					data-id={item.id}
					class="item {item.type}"
					class:selected={item.id === selected}
					tabindex="0"
					role="button"
					aria-label={item.aria}
					transform={offset(item)}
					onfocus={() => (selected = item.id)}
					ondblclick={() => openEditor(item.id)}
					onpointerdown={(e) => onpointerdown(e, item)}
				>
					{#if item.type === 'message'}
						<rect
							class="hit"
							x={item.box.x}
							y={item.box.y}
							width={item.box.w}
							height={item.box.h}
						/>
						<path
							d={item.path}
							stroke-dasharray={item.dashed ? '4 3' : undefined}
							marker-end={item.head ? `url(#${uid}-${item.head})` : undefined}
							marker-start={item.tail ? `url(#${uid}-${item.tail})` : undefined}
						/>
						<text x={item.labelX} y={item.labelY} text-anchor="middle">{item.lines[0]}</text>
						{#if item.number}<text
								class="number"
								x={item.numberX}
								y={(item.numberY ?? 0) - 4}
								text-anchor="middle">{item.number}</text
							>{/if}
					{:else if item.type === 'section'}
						<line x1={item.box.x} y1={item.box.y} x2={item.box.x + item.box.w} y2={item.box.y} />
						<text x={item.box.x + 4} y={item.box.y + 14}>{item.lines[0]}</text>
					{:else if item.type === 'box'}
						<!-- Füllfarbe nur aus der Allow-Liste (`isBoxColor` in `toSequence`). -->
						<rect
							class="frame"
							x={item.box.x}
							y={item.box.y}
							width={item.box.w}
							height={item.box.h}
							style:fill={item.fill}
						/>
						<text x={item.box.x + item.box.w / 2} y={item.box.y + 16} text-anchor="middle"
							>{item.lines[0]}</text
						>
					{:else if item.type === 'container'}
						<rect x={item.box.x} y={item.box.y} width={item.box.w} height={item.box.h} />
						<text x={item.box.x + 4} y={item.box.y + 14}>{item.lines[0]}</text>
					{:else}
						<rect
							x={item.box.x}
							y={item.box.y}
							width={item.box.w}
							height={item.box.h}
							rx={item.type === 'actor' ? 12 : 0}
						/>
						{#each item.lines as line, i (i)}
							<text x={centerX(item)} y={lineY(item, i)} text-anchor="middle">{line}</text>
						{/each}
					{/if}
					<rect
						class="ring"
						x={ring.x}
						y={ring.y}
						width={ring.w}
						height={ring.h}
						aria-hidden="true"
					/>
				</g>
			{/each}
		</svg>
		{#if editing}
			<SequenceEditor
				target={{
					...editing,
					box: toScreenBox(editing.box, { x: view.minX, y: view.minY }, zoom)
				}}
				{zoom}
				oncommit={commit}
				oncancel={cancel}
			/>
		{/if}
	</div>

	{#if view.issues.length > 0}
		<ul class="issues" data-testid="canvas-issues" role="status">
			{#each view.issues as issue, i (i)}<li>⚠ {issue}</li>{/each}
		</ul>
	{/if}
	{#if view.rawBlocks.length > 0}
		<ul class="raw" data-testid="raw-blocks">
			{#each view.rawBlocks as block (block.id)}
				<li><code>{block.text}</code> <em>{block.note}</em></li>
			{/each}
		</ul>
	{/if}
	<nav class="outline" data-testid="outline" aria-label={t('canvas.seq.outline')}>
		{@render tree(view.outline)}
	</nav>
	<p class="status" role="status" aria-live="polite">{status}</p>
</div>

<style>
	.sequence-canvas {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		min-height: 300px;
		font-size: 12px;
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		padding: 4px;
	}
	/* Gedrückter Schalter (Nummerierung) sichtbar wie in Palette und Leiste (T135). */
	.toolbar button[aria-pressed='true'] {
		color: var(--accent);
		border-color: var(--accent);
		background: var(--accent-soft);
		box-shadow: 0 0 0 1px var(--accent) inset;
		font-weight: 600;
	}
	.toolbar .hint {
		align-self: center;
		color: var(--text-3, #888);
	}
	.surface {
		position: relative;
		flex: 1;
		overflow: auto;
	}
	svg {
		display: block;
		font: 14px var(--font, sans-serif);
	}
	svg :global(text) {
		fill: var(--text, currentColor);
	}
	marker {
		color: var(--text-2, #222);
	}
	.lifeline {
		stroke: var(--text-3, #888);
		stroke-dasharray: 3 3;
	}
	.bar {
		fill: var(--surface-2, #f4f4f4);
		stroke: var(--node-line, #666);
	}
	.item rect {
		fill: var(--node, #eef);
		stroke: var(--node-line, #446);
	}
	.item.note rect {
		fill: var(--note-fill, #fff5ad);
	}
	.item.container rect {
		fill: none;
		stroke-dasharray: 2 2;
	}
	/* Teilnehmer-Gruppe (box): Rahmen hinter den Spalten, Farbe aus dem Code halbtransparent. */
	.item.box .frame {
		fill: none;
		fill-opacity: 0.35;
		stroke-dasharray: 6 3;
	}
	.item.activate rect,
	.item.deactivate rect {
		fill: var(--node-line, #446);
	}
	.item.message path,
	.item.section line {
		fill: none;
		stroke: var(--text-2, #222);
	}
	.item.section line {
		stroke-dasharray: 4 2;
	}
	.item .hit {
		fill: transparent;
		stroke: none;
	}
	/* Eigener Ring statt Outline (V-32): nur bei Tastatur-Fokus, Strich unabhängig vom Zoom. */
	.item:focus {
		outline: none;
	}
	.item.selected rect {
		stroke: var(--focus, #1c5fd1);
		stroke-width: 2;
	}
	.item.selected path {
		stroke: var(--focus, #1c5fd1);
	}
	.item rect.ring {
		fill: none;
		stroke: none;
		pointer-events: none;
	}
	.item:focus-visible rect.ring {
		stroke: var(--focus, #1c5fd1);
		stroke-width: 2px;
		stroke-dasharray: none;
		vector-effect: non-scaling-stroke;
	}
	ul {
		margin: 0;
		padding: 2px 8px 2px 16px;
	}
	.issues,
	.raw {
		list-style: none;
	}
	/* Outline und Status enden links der Vorschau-Karte; die Shell setzt den Rand (T126 C1). */
	.outline {
		margin-right: var(--reserve-right, 0);
	}
	.status {
		margin: 0;
		margin-right: var(--reserve-right, 0);
		min-height: 1em;
	}
</style>
