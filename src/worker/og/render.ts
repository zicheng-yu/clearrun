/**
 * Draws share cards: resvg compiled to WebAssembly, with the card fonts bundled (subset TrueType, SIL Open Font License; see
 * fonts/). The Worker imports this module only when a card has to be drawn, so isolates that never draw one don't load the
 * renderer (about 2.5 MB of Wasm). A card is drawn once; cold, that takes a few hundred milliseconds of CPU, so the PNG is encoded
 * with the runtime's native deflate (png.ts) rather than in Wasm.
 */
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import wasm from "@resvg/resvg-wasm/index_bg.wasm";
import display from "./fonts/BebasNeue-Regular.bin";
import text from "./fonts/Inter-Regular.bin";
import textBold from "./fonts/Inter-SemiBold.bin";
import mono from "./fonts/JetBrainsMono-Medium.bin";
import { encodePng } from "./png.ts";

const fonts = [display, text, textBold, mono].map((font) => new Uint8Array(font));
let ready: Promise<void> | undefined;

export async function renderPng(svg: string): Promise<Uint8Array> {
	ready ??= initWasm(wasm).catch((error: unknown) => {
		ready = undefined;
		throw error;
	});
	await ready;
	const resvg = new Resvg(svg, { font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: "Inter" }, fitTo: { mode: "original" } });
	try {
		const image = resvg.render();
		const { width, height, pixels } = image;
		image.free();
		return await encodePng(pixels, width, height);
	} finally {
		resvg.free();
	}
}
