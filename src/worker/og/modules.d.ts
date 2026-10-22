/** Non-JavaScript modules the Cloudflare Vite plugin bundles: compiled Wasm and raw bytes. */
declare module "*.wasm" {
	const module: WebAssembly.Module;
	export default module;
}

declare module "*.bin" {
	const data: ArrayBuffer;
	export default data;
}
