/**
 * PNG encoding with the runtime's own deflate (CompressionStream), for the share cards. resvg's encoder runs inside its Wasm
 * module; native zlib is faster where the module hasn't been optimized yet (a Worker draws a card once per isolate, if ever),
 * and its output is smaller. Rows are stored unfiltered: the cards are flat colors, which deflate handles well on its own.
 */

let table: Uint32Array | undefined;

function crc32(bytes: Uint8Array): number {
	if (!table) {
		table = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			table[n] = c >>> 0;
		}
	}
	let crc = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) crc = (table[(crc ^ (bytes[i] as number)) & 0xff] as number) ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: length, type, data and the CRC of type and data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

/** An 8-bit RGBA image (straight alpha, rows top to bottom) as a PNG. */
export async function encodePng(rgba: Uint8Array, width: number, height: number): Promise<Uint8Array> {
	const stride = width * 4;
	// Each row starts with its filter type; 0 (none) leaves the row as it is.
	const raw = new Uint8Array(height * (stride + 1));
	for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
	const zlib = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	header.set([8, 6, 0, 0, 0], 8); // 8 bits per channel, RGBA, deflate, no filtering method beyond per-row, no interlace
	const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlib), chunk("IEND", new Uint8Array(0))];
	const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		png.set(p, at);
		at += p.length;
	}
	return png;
}
