import react from '@vitejs/plugin-react';
import { createServer, type ViteDevServer } from 'vite';
import { config, ROOT } from './config';
import { ensureModules } from './project';

interface Running {
  server: ViteDevServer;
  url: string;
}

const running = new Map<string, Running>();
let nextPort = config.previewPortStart;

/** Start (or reuse) a Vite dev server with HMR for a generated site and return its URL. */
export async function startPreview(siteDir: string): Promise<string> {
  ensureModules(siteDir);
  const existing = running.get(siteDir);
  if (existing) return existing.url;
  const server = await createServer({
    root: siteDir,
    configFile: false,
    plugins: [react()],
    clearScreen: false,
    logLevel: 'warn',
    server: { host: '127.0.0.1', port: nextPort++, strictPort: false, fs: { allow: [ROOT, siteDir] } },
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0]?.replace(/\/$/, '') ?? `http://127.0.0.1:${server.config.server.port}`;
  running.set(siteDir, { server, url });
  return url;
}

export async function stopPreview(siteDir: string) {
  const r = running.get(siteDir);
  if (!r) return;
  running.delete(siteDir);
  await r.server.close();
}

export async function stopAllPreviews() {
  await Promise.all([...running.keys()].map(stopPreview));
}
