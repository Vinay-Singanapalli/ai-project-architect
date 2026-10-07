import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { sha } from '../util/text';
import type { TNode } from './types';

const EXT: Record<string, string> = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
  'image/svg+xml': '.svg', 'image/avif': '.avif', 'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico',
};

export function collectAssetUrls(trees: TNode[]): string[] {
  const urls = new Set<string>();
  const rec = (n: TNode) => {
    if (n.a?.src && /^https?:/.test(n.a.src)) urls.add(n.a.src);
    const bg = n.s?.['background-image'];
    const m = bg && /url\((https?:[^)]+)\)/.exec(bg);
    if (m) urls.add(m[1]);
    for (const c of n.c ?? []) if (typeof c !== 'string') rec(c);
  };
  trees.forEach(rec);
  return [...urls];
}

/** Download images into <siteDir>/public/assets. Failures are tolerated: the remote URL stays in place. */
export async function downloadAssets(urls: string[], siteDir: string, referer: string): Promise<Record<string, string>> {
  const dir = path.join(siteDir, 'public', 'assets');
  fs.mkdirSync(dir, { recursive: true });
  const out: Record<string, string> = {};
  const queue = urls.slice(0, config.maxAssets);
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { referer, 'user-agent': 'Mozilla/5.0 site-cloner' } });
        if (!res.ok) continue;
        const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
        const fromUrl = path.extname(new URL(url).pathname).toLowerCase();
        const ext = EXT[type] ?? (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif', '.ico'].includes(fromUrl) ? fromUrl : '');
        if (!ext) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > config.maxAssetBytes || buf.length === 0) continue;
        const name = `${sha(url, 12)}${ext}`;
        fs.writeFileSync(path.join(dir, name), buf);
        out[url] = `/assets/${name}`;
      } catch {
        /* keep remote url */
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}

export function rewriteAssets(n: TNode, map: Record<string, string>) {
  if (n.a?.src && map[n.a.src]) n.a.src = map[n.a.src];
  const bg = n.s?.['background-image'];
  if (bg) {
    n.s!['background-image'] = bg.replace(/url\((https?:[^)]+)\)/, (all, u: string) => (map[u] ? `url(${map[u]})` : all));
  }
  for (const c of n.c ?? []) if (typeof c !== 'string') rewriteAssets(c, map);
}
