import { useRef, useState } from "react";
import type { ShareMeta } from "../shared/types.ts";

const ghost = "min-h-11 rounded-[10px] border border-line px-4 text-sm font-medium text-ink hover:border-marquee disabled:opacity-50";
const primary = "min-h-11 rounded-[10px] bg-marquee px-4 text-sm font-semibold text-marquee-ink hover:brightness-110 disabled:opacity-50";

/**
 * Share: the link, and the card its preview shows on social sites and in chat apps (the same image they fetch), with copy, the
 * system share sheet where there is one, and a download. `load` returns the link's preview; for a custom plan it first saves the
 * plan as a link.
 */
export function ShareButton({ load, label = "Share", note, file }: { load: () => Promise<ShareMeta>; label?: string; note?: string; file: string }) {
	const dialog = useRef<HTMLDialogElement>(null);
	const [state, setState] = useState<{ meta?: ShareMeta; error?: string; copied?: boolean; image?: "loading" | "ready" | "failed" }>({});
	const open = () => {
		dialog.current?.showModal();
		setState({});
		load()
			.then((meta) => setState({ meta, image: "loading" }))
			.catch((e: unknown) => setState({ error: e instanceof Error ? e.message : String(e) }));
	};
	const copy = (url: string) => {
		navigator.clipboard
			?.writeText(url)
			.then(() => setState((s) => ({ ...s, copied: true })))
			.catch(() => undefined);
	};
	const meta = state.meta;
	const host = meta ? new URL(meta.url).host : "";

	return (
		<>
			<button type="button" onClick={open} className={ghost}>
				<span className="inline-flex items-center gap-2">
					<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
						<path d="M8 10.5V2M4.5 5.5 8 2l3.5 3.5M3 9v4.5h10V9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
					{label}
				</span>
			</button>
			<dialog
				ref={dialog}
				aria-labelledby="share-title"
				onClick={(e) => e.target === dialog.current && dialog.current?.close()}
				className="m-auto w-[min(720px,calc(100%-32px))] rounded-[18px] border border-line bg-stage p-0 text-ink backdrop:bg-black/70"
			>
				<div className="flex flex-col gap-4 p-5 sm:p-6">
					<div className="flex items-start justify-between gap-4">
						<div className="flex flex-col gap-1">
							<p className="font-mono text-[11px] tracking-[0.16em] text-marquee uppercase">Share</p>
							<h2 id="share-title" className="font-display text-3xl leading-none tracking-wide">
								The link and its card
							</h2>
						</div>
						<button
							type="button"
							onClick={() => dialog.current?.close()}
							aria-label="Close"
							className="flex size-10 items-center justify-center rounded-full text-muted hover:bg-line/60 hover:text-ink"
						>
							<svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true">
								<path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
							</svg>
						</button>
					</div>

					{state.error && <p className="text-sm text-hot">{state.error}</p>}
					{!meta && !state.error && <p className="text-sm text-muted">Making the link…</p>}
					{meta && (
						<>
							{/* What a chat app or social site shows when the link is pasted. */}
							<figure className="overflow-hidden rounded-xl border border-line bg-house">
								<div className="relative aspect-[1200/630] w-full">
									{state.image !== "ready" && (
										<p className="absolute inset-0 flex items-center justify-center text-sm text-muted">
											{state.image === "failed" ? "The card couldn't be drawn right now." : "Drawing the card…"}
										</p>
									)}
									<img
										src={meta.image}
										alt={meta.alt}
										width={1200}
										height={630}
										onLoad={() => setState((s) => ({ ...s, image: "ready" }))}
										onError={() => setState((s) => ({ ...s, image: "failed" }))}
										className={`absolute inset-0 size-full ${state.image === "ready" ? "" : "opacity-0"}`}
									/>
								</div>
								<figcaption className="flex flex-col gap-0.5 border-t border-line px-4 py-3">
									<span className="font-mono text-[11px] text-muted">{host}</span>
									<span className="text-sm font-semibold text-ink">{meta.title}</span>
									<span className="line-clamp-2 text-xs text-ink-2">{meta.description}</span>
								</figcaption>
							</figure>
							<div className="flex flex-col gap-2 sm:flex-row">
								<input
									readOnly
									value={meta.url}
									aria-label="Share link"
									onFocus={(e) => e.currentTarget.select()}
									className="h-11 min-w-0 rounded-[10px] border border-line bg-house px-3 font-mono text-xs sm:flex-1 text-ink-2 focus:border-marquee focus:outline-none"
								/>
								<button type="button" onClick={() => copy(meta.url)} className={primary}>
									{state.copied ? "Copied" : "Copy link"}
								</button>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								{typeof navigator.share === "function" && (
									<button type="button" onClick={() => navigator.share({ title: meta.title, text: meta.description, url: meta.url }).catch(() => undefined)} className={ghost}>
										Share…
									</button>
								)}
								<a href={meta.image} download={file} className={`${ghost} inline-flex items-center`}>
									Download card
								</a>
								<span role="status" className="text-xs text-muted">
									{state.copied ? "Link copied." : ""}
								</span>
							</div>
							{note && <p className="text-xs text-muted">{note}</p>}
							<p className="text-[11px] text-muted">The card is drawn from the same live data as the page. Text a visitor types, such as an agent question, never appears on it.</p>
						</>
					)}
				</div>
			</dialog>
		</>
	);
}
