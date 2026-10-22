// Secrets are uploaded separately (never committed) and may be absent; without them the app
// serves the latest stored snapshot and refuses live calls.
interface Env {
	QLOO_API_KEY?: string;
	OPENROUTER_API_KEY?: string;
	ADMIN_TOKEN?: string;
}
