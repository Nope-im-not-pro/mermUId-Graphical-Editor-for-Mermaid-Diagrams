import { expect, test, type Page } from '@playwright/test';

/** Liest den Mermaid-Text über das Code-Panel (nur lesen) und kehrt zu den Eigenschaften zurück. */
async function readCode(page: Page): Promise<string> {
	await page.getByRole('tab', { name: 'Code' }).click();
	const lines = await page.locator('#shell-code .cm-line').allInnerTexts();
	await page.getByRole('tab', { name: 'Eigenschaften' }).click();
	return lines.join('\n').trimEnd();
}

test('T135 C1 sequence: Nummerierung schalten, break-Block anlegen, je ein Undo-Schritt', async ({
	page
}) => {
	await page.goto('/');
	await page.locator('.svelte-flow__pane').waitFor();

	const dataTransfer = await page.evaluateHandle(() => {
		const dt = new DataTransfer();
		dt.items.add(
			new File(['sequenceDiagram\n    A->>B: x\n'], 'extras.mmd', { type: 'text/plain' })
		);
		return dt;
	});
	await page.locator('.shell').dispatchEvent('drop', { dataTransfer });
	await expect(page.getByTestId('message')).toContainText('extras.mmd');

	const tools = page.getByRole('toolbar', { name: 'Sequenz-Werkzeuge' });
	const surface = page.getByRole('application', { name: 'Sequenzdiagramm' });
	const undo = page.getByRole('button', { name: 'Rückgängig', exact: true });
	const numbering = tools.getByRole('button', { name: 'Nummerierung', exact: true });

	await expect(numbering).toHaveAttribute('aria-pressed', 'false');
	await numbering.click();
	await expect(numbering).toHaveAttribute('aria-pressed', 'true');
	await expect(surface.getByRole('button', { name: 'Nachricht 1: x', exact: true })).toBeVisible();
	expect(await readCode(page)).toBe('sequenceDiagram\n    autonumber\n    A->>B: x');
	await expect(page.getByTestId('raw-blocks')).toHaveCount(0);

	await tools.getByLabel('Blockart').selectOption('break');
	await tools.getByRole('button', { name: '+ Block', exact: true }).click();
	await expect(
		surface.getByRole('button', { name: 'Block break: Abbruch', exact: true })
	).toBeVisible();
	expect(await readCode(page)).toBe(
		'sequenceDiagram\n    autonumber\n    A->>B: x\n    break Abbruch\n    end'
	);

	await undo.click();
	expect(await readCode(page)).toBe('sequenceDiagram\n    autonumber\n    A->>B: x');
	await undo.click();
	expect(await readCode(page)).toBe('sequenceDiagram\n    A->>B: x');
	await expect(numbering).toHaveAttribute('aria-pressed', 'false');
});

test('T135 C2 sequence: Teilnehmer-Gruppe anlegen, zuordnen, färben, umbenennen, auflösen, je ein Undo-Schritt', async ({
	page
}) => {
	await page.goto('/');
	await page.locator('.svelte-flow__pane').waitFor();

	const dataTransfer = await page.evaluateHandle(() => {
		const dt = new DataTransfer();
		dt.items.add(new File(['sequenceDiagram\n    A->>B: x\n'], 'box.mmd', { type: 'text/plain' }));
		return dt;
	});
	await page.locator('.shell').dispatchEvent('drop', { dataTransfer });
	await expect(page.getByTestId('message')).toContainText('box.mmd');

	const tools = page.getByRole('toolbar', { name: 'Sequenz-Werkzeuge' });
	const surface = page.getByRole('application', { name: 'Sequenzdiagramm' });
	const item = (label: string) => surface.getByRole('button', { name: label, exact: true });
	const undo = page.getByRole('button', { name: 'Rückgängig', exact: true });
	const member = tools.getByLabel('Gruppe des Teilnehmers', { exact: true });
	const color = tools.getByLabel('Farbe der Gruppe', { exact: true });
	const ungroup = tools.getByRole('button', { name: 'Gruppe auflösen', exact: true });
	const lines = (...l: string[]) => l.join('\n');

	const created = lines(
		'sequenceDiagram',
		'    box transparent Gruppe',
		'        participant A',
		'    end',
		'    A->>B: x'
	);
	const joined = lines(
		'sequenceDiagram',
		'    box transparent Gruppe',
		'        participant A',
		'        participant B',
		'    end',
		'    A->>B: x'
	);
	const colored = joined.replace('box transparent Gruppe', 'box lightblue Gruppe');
	const renamed = colored.replace('box lightblue Gruppe', 'box lightblue Team');

	// Ohne gewählte Gruppe sind Farbe und Auflösen gesperrt.
	await expect(color).toBeDisabled();
	await expect(ungroup).toBeDisabled();

	// Anlegen mit gewähltem Teilnehmer A.
	await item('Teilnehmer: A').focus();
	await tools.getByRole('button', { name: 'Gruppe anlegen', exact: true }).click();
	await expect(item('Gruppe: Gruppe (1 Teilnehmer)')).toBeVisible();
	await expect.poll(() => readCode(page)).toBe(created);

	// B in die Gruppe.
	await item('Teilnehmer: B').focus();
	await expect(member).toBeEnabled();
	await member.selectOption({ label: 'Gruppe' });
	await expect(item('Gruppe: Gruppe (2 Teilnehmer)')).toBeVisible();
	await expect.poll(() => readCode(page)).toBe(joined);

	// Farbe nur aus der Allow-Liste (keine freie Eingabe).
	await item('Gruppe: Gruppe (2 Teilnehmer)').focus();
	await expect(color).toBeEnabled();
	const values = await color
		.locator('option')
		.evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
	expect(values).toContain('transparent');
	expect(values.some((v) => /url\(|[;#]/.test(v))).toBe(false);
	await color.selectOption('lightblue');
	await expect.poll(() => readCode(page)).toBe(colored);
	await expect(item('Gruppe: Gruppe (2 Teilnehmer)').locator('rect.frame')).toHaveCSS(
		'fill',
		'rgb(173, 216, 230)'
	);

	// Umbenennen per F2.
	await item('Gruppe: Gruppe (2 Teilnehmer)').focus();
	await page.keyboard.press('F2');
	const editor = page.getByLabel('Label bearbeiten');
	await editor.fill('Team');
	await editor.press('Enter');
	await expect.poll(() => readCode(page)).toBe(renamed);

	// Auflösen: Mitglieder bleiben als Deklarationen an ihrer Stelle.
	await item('Gruppe: Team (2 Teilnehmer)').focus();
	await ungroup.click();
	await expect(item('Gruppe: Team (2 Teilnehmer)')).toHaveCount(0);
	await expect
		.poll(() => readCode(page))
		.toBe(lines('sequenceDiagram', '    participant A', '    participant B', '    A->>B: x'));

	// Je Aktion genau ein Undo-Schritt.
	for (const expected of [renamed, colored, joined, created, 'sequenceDiagram\n    A->>B: x']) {
		await undo.click();
		await expect.poll(() => readCode(page)).toBe(expected);
	}

	// Gruppe für B: A wird vorab deklariert, die Spaltenreihenfolge A, B bleibt.
	await item('Teilnehmer: B').focus();
	await tools.getByRole('button', { name: 'Gruppe anlegen', exact: true }).click();
	await expect(item('Gruppe: Gruppe (1 Teilnehmer)')).toBeVisible();
	await expect
		.poll(() => readCode(page))
		.toBe(
			lines(
				'sequenceDiagram',
				'    participant A',
				'    box transparent Gruppe',
				'        participant B',
				'    end',
				'    A->>B: x'
			)
		);
	const a = await item('Teilnehmer: A').boundingBox();
	const b = await item('Teilnehmer: B').boundingBox();
	expect(a!.x).toBeLessThan(b!.x);
	await undo.click();
	await expect.poll(() => readCode(page)).toBe('sequenceDiagram\n    A->>B: x');
});

test('T135 C3 sequence: Teilnehmer erzeugen und zerstören als Nachrichten-Option, je ein Undo-Schritt', async ({
	page
}) => {
	await page.goto('/');
	await page.locator('.svelte-flow__pane').waitFor();

	const text = 'sequenceDiagram\n    A->>B: a\n    B->>C: c\n    A-xB: weg\n';
	const dataTransfer = await page.evaluateHandle((t) => {
		const dt = new DataTransfer();
		dt.items.add(new File([t], 'life.mmd', { type: 'text/plain' }));
		return dt;
	}, text);
	await page.locator('.shell').dispatchEvent('drop', { dataTransfer });
	await expect(page.getByTestId('message')).toContainText('life.mmd');

	const tools = page.getByRole('toolbar', { name: 'Sequenz-Werkzeuge' });
	const surface = page.getByRole('application', { name: 'Sequenzdiagramm' });
	const item = (label: string) => surface.getByRole('button', { name: label, exact: true });
	const undo = page.getByRole('button', { name: 'Rückgängig', exact: true });
	const life = tools.getByLabel('Teilnehmer erzeugen/zerstören', { exact: true });
	const lines = (...l: string[]) => l.join('\n');

	const start = text.trimEnd();
	const created = lines(
		'sequenceDiagram',
		'    A->>B: a',
		'    create participant C',
		'    B->>C: c',
		'    A-xB: weg'
	);
	const destroyed = lines(
		'sequenceDiagram',
		'    A->>B: a',
		'    create participant C',
		'    B->>C: c',
		'    destroy B',
		'    A-xB: weg'
	);

	// Ohne gewählte Nachricht gesperrt.
	await expect(life).toBeDisabled();

	await item('Nachricht: c').focus();
	await life.selectOption('create');
	await expect.poll(() => readCode(page)).toBe(created);
	await expect(page.getByTestId('raw-blocks')).toHaveCount(0);

	await item('Nachricht: weg').focus();
	await life.selectOption('destroyTarget');
	await expect.poll(() => readCode(page)).toBe(destroyed);

	// Je Aktion genau ein Undo-Schritt.
	for (const expected of [created, start]) {
		await undo.click();
		await expect.poll(() => readCode(page)).toBe(expected);
	}
});
