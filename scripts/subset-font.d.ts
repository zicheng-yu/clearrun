/** The part of subset-font (no bundled types) that scripts/build-card-fonts.ts uses. */
declare module "subset-font" {
	export default function subsetFont(font: Uint8Array, text: string, options?: { targetFormat?: "sfnt" | "truetype" | "woff" | "woff2" }): Promise<Uint8Array>;
}
