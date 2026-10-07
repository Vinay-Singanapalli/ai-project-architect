import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function normalizeHost(raw: string | undefined): string {
  let h = (raw ?? 'http://127.0.0.1:11434').trim();
  if (!/^https?:\/\//.test(h)) h = `http://${h}`;
  if (!/:\d+$/.test(h.replace(/^https?:\/\//, ''))) h += ':11434';
  return h.replace(/\/$/, '');
}

/** Everything is overridable through environment variables; there are no API keys anywhere. */
export const config = {
  ollamaHost: normalizeHost(process.env.OLLAMA_HOST),
  /** Model that writes React/CSS. Leave unset to auto-pick the best installed model. */
  codeModel: process.env.CODE_MODEL || undefined,
  /** Small model for routing / classification. Leave unset to auto-pick. */
  fastModel: process.env.FAST_MODEL || undefined,
  /** Ollama silently truncates prompts to its default context, so we always set it explicitly. */
  numCtx: Number(process.env.NUM_CTX ?? 8192),
  maxOutputTokens: Number(process.env.MAX_OUTPUT_TOKENS ?? 3500),
  sitesDir: path.resolve(process.env.SITES_DIR ?? path.join(ROOT, 'sites')),
  cacheDir: path.join(ROOT, '.cloner-cache'),
  uiPort: Number(process.env.PORT ?? 3000),
  previewPortStart: Number(process.env.PREVIEW_PORT ?? 5200),
  viewport: { width: 1440, height: 900 },
  mobileViewport: { width: 390, height: 844 },
  maxSections: 14,
  maxNodesPerSection: 450,
  skeletonBudgetChars: 7000,
  maxAssets: 40,
  maxAssetBytes: 3_000_000,
  repairRounds: 2,
  /** Model-written sections scoring below this (0..1) against the original are compared with the deterministic rebuild. */
  fidelityMin: Number(process.env.FIDELITY_MIN ?? 0.85),
  /** Optional: path of a Chromium/Chrome binary to use instead of Playwright's download. */
  chromiumPath: process.env.CHROMIUM_PATH || undefined,
};
