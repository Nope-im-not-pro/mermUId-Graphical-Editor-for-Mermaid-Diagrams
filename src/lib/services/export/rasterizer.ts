/**
 * Browser-Rasterizer für den PNG-Export (T20 C2): SVG als data-URL in `<img>`, Zeichnen auf
 * Canvas, `toBlob`. Einzige Datei von services/export mit DOM-Zugriff; Erzeugung von Bild und
 * Canvas ist für Tests injizierbar. Same-Origin-data-URL ohne foreignObject: kein Tainting.
 */
import { msg } from '../i18n';
import { canvasLimitError, type Rasterizer } from './png';

export interface RasterEnv {
	createImage(): HTMLImageElement;
	createCanvas(): HTMLCanvasElement;
}

function browserRasterEnv(): RasterEnv {
	return {
		createImage: () => new Image(),
		createCanvas: () => document.createElement('canvas')
	};
}

export function canvasRasterizer(env: RasterEnv = browserRasterEnv()): Rasterizer {
	return ({ svg, width, height, scale, background }) =>
		new Promise((resolve, reject) => {
			const tooLarge = canvasLimitError(width, height, scale);
			if (tooLarge) return reject(new Error(tooLarge));
			const img = env.createImage();
			img.onload = () => {
				const canvas = env.createCanvas();
				canvas.width = Math.ceil(width * scale);
				canvas.height = Math.ceil(height * scale);
				const ctx = canvas.getContext('2d');
				if (!ctx) return reject(new Error(msg('services.export.canvas2d')));
				// Hintergrund ungeskaliert über die volle Canvas: Bruchteil-Maße ließen sonst die
				// letzte Zeile/Spalte (Math.ceil) nur teilweise gedeckt.
				if (background) {
					ctx.fillStyle = background;
					ctx.fillRect(0, 0, canvas.width, canvas.height);
				}
				ctx.scale(scale, scale);
				ctx.drawImage(img, 0, 0, width, height);
				canvas.toBlob(
					(blob) => (blob ? resolve(blob) : reject(new Error(msg('services.export.pngFailed')))),
					'image/png'
				);
			};
			img.onerror = () => reject(new Error(msg('services.export.svgLoad')));
			img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
		});
}
