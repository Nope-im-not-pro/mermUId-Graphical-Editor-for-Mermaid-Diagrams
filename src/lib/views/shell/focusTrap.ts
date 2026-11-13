/**
 * Fokus-Falle für Shell-Dialoge (T21 C3, Muster wie HelpPanel): Fokus beim Öffnen auf das mit
 * `data-autofocus` markierte Element (T101 C2, V-03), sonst auf das erste Bedienelement,
 * Tab/Shift-Tab zyklisch im Dialog, Esc schließt, beim Schließen Fokus zurück zum Auslöser.
 * Behandelt Tasten in der Capture-Phase am Dokument, damit Shell-Kürzel nicht greifen.
 */
import type { Attachment } from 'svelte/attachments';

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapTab(dialog: HTMLElement, e: KeyboardEvent): void {
	const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
	const first = items[0] ?? dialog;
	const last = items[items.length - 1] ?? dialog;
	const active = document.activeElement;
	const inside = active !== dialog && dialog.contains(active);
	if (inside && active !== (e.shiftKey ? first : last)) return;
	e.preventDefault();
	(e.shiftKey ? last : first).focus();
}

export function focusTrap(onclose: () => void): Attachment<HTMLElement> {
	return (dialog) => {
		const previous = document.activeElement;
		const start =
			dialog.querySelector<HTMLElement>('[data-autofocus]') ??
			dialog.querySelector<HTMLElement>(FOCUSABLE);
		(start ?? dialog).focus();
		const onkeydown = (e: KeyboardEvent): void => {
			if (e.key === 'Tab') trapTab(dialog, e);
			else if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				onclose();
			}
		};
		document.addEventListener('keydown', onkeydown, true);
		return () => {
			document.removeEventListener('keydown', onkeydown, true);
			if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
		};
	};
}
