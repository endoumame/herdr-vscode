/**
 * Renders images/icon.png, the 128x128 Marketplace icon.
 *
 * The Marketplace only accepts raster icons, and this repository has no image
 * toolchain, so the mark is defined as signed distance fields and rasterised
 * here with plain Node. Run `npm run icon` after editing anything below.
 *
 * The mark: a speech bubble (a review comment) whose body holds a terminal
 * prompt (the agent it is sent to).
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 128;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'images', 'icon.png');

const BG_TOP = [0x25, 0x2b, 0x40];
const BG_BOTTOM = [0x13, 0x16, 0x22];
const BUBBLE_TOP = [0x7d, 0xb0, 0xff];
const BUBBLE_BOTTOM = [0x4c, 0x7d, 0xf0];
const GLYPH = [0x13, 0x16, 0x22];

// --- signed distance fields (negative inside, in pixel units) ----------------

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function sdRoundRect(x, y, x0, y0, x1, y1, r) {
	const cx = (x0 + x1) / 2;
	const cy = (y0 + y1) / 2;
	const hx = (x1 - x0) / 2 - r;
	const hy = (y1 - y0) / 2 - r;
	const dx = Math.abs(x - cx) - hx;
	const dy = Math.abs(y - cy) - hy;
	const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
	return outside + Math.min(Math.max(dx, dy), 0) - r;
}

/** Distance to a capsule: a segment of the given width with round caps. */
function sdSegment(x, y, ax, ay, bx, by, width) {
	const pax = x - ax;
	const pay = y - ay;
	const bax = bx - ax;
	const bay = by - ay;
	const t = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
	return Math.hypot(pax - bax * t, pay - bay * t) - width / 2;
}

/** Distance to a triangle, exact outside and a usable approximation inside. */
function sdTriangle(x, y, p) {
	let inside = true;
	let best = Infinity;
	for (let i = 0; i < 3; i++) {
		const a = p[i];
		const b = p[(i + 1) % 3];
		best = Math.min(best, sdSegment(x, y, a[0], a[1], b[0], b[1], 0));
		const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
		if (cross < 0) {
			inside = false;
		}
	}
	return inside ? -best : best;
}

// --- rasteriser -------------------------------------------------------------

/** 1px analytic antialiasing: coverage falls off across the shape's edge. */
const coverage = d => clamp(0.5 - d, 0, 1);

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Source-over of a straight (non-premultiplied) colour onto the buffer. */
function blend(px, i, rgb, alpha) {
	if (alpha <= 0) {
		return;
	}
	const dstA = px[i + 3] / 255;
	const outA = alpha + dstA * (1 - alpha);
	for (let c = 0; c < 3; c++) {
		const src = rgb[c] * alpha;
		const dst = px[i + c] * dstA * (1 - alpha);
		px[i + c] = outA === 0 ? 0 : Math.round((src + dst) / outA);
	}
	px[i + 3] = Math.round(outA * 255);
}

function render() {
	const px = new Uint8Array(SIZE * SIZE * 4);

	// The bubble tail is unioned into the bubble so the seam between them never
	// shows as a hairline of background.
	const tail = [
		[44, 78],
		[74, 78],
		[41, 108],
	];

	for (let y = 0; y < SIZE; y++) {
		for (let x = 0; x < SIZE; x++) {
			const i = (y * SIZE + x) * 4;
			const px_ = x + 0.5;
			const py = y + 0.5;

			blend(px, i, mix(BG_TOP, BG_BOTTOM, py / SIZE), coverage(sdRoundRect(px_, py, 0, 0, SIZE, SIZE, 26)));

			const bubble = Math.min(
				sdRoundRect(px_, py, 14, 18, 114, 84, 18),
				sdTriangle(px_, py, tail),
			);
			blend(px, i, mix(BUBBLE_TOP, BUBBLE_BOTTOM, (py - 18) / 66), coverage(bubble));

			const prompt = Math.min(
				sdSegment(px_, py, 40, 39, 56, 51, 8),
				sdSegment(px_, py, 56, 51, 40, 63, 8),
				sdSegment(px_, py, 66, 63, 90, 63, 8),
			);
			blend(px, i, GLYPH, coverage(prompt));
		}
	}
	return px;
}

// --- PNG container ----------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) {
		c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	}
	return c >>> 0;
});

function crc32(buf) {
	let c = 0xffffffff;
	for (const byte of buf) {
		c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(data.length, 0);
	head.write(type, 4, 'ascii');
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
	return Buffer.concat([head, data, crc]);
}

function toPng(px) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(SIZE, 0);
	ihdr.writeUInt32BE(SIZE, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // truecolour with alpha
	// Filter type 0 on every scanline: the image is a smooth gradient, so the
	// gain from adaptive filtering is not worth the extra code here.
	const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
	for (let y = 0; y < SIZE; y++) {
		raw[y * (SIZE * 4 + 1)] = 0;
		Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, toPng(render()));
console.log(`wrote ${OUT}`);
