import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config';
import { buildIconsModule } from '../analyze/svg';
import { themeCss } from '../analyze/tokens';
import type { SiteAnalysis } from '../analyze/types';
import { ensureModules, type Project } from '../project';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Create the Vite + React + TS project skeleton, theme tokens and icon components for an analysed site. */
export function scaffold(project: Project, a: SiteAnalysis) {
  const tplDir = path.join(ROOT, 'template');
  const keep = new Set(['.cloner', 'public']);
  fs.mkdirSync(project.dir, { recursive: true });
  for (const e of fs.readdirSync(project.dir)) if (!keep.has(e)) fs.rmSync(project.p(e), { recursive: true, force: true });
  fs.cpSync(tplDir, project.dir, { recursive: true });
  ensureModules(project.dir);

  const fonts = a.fontLinks.filter((h) => /\/css|family=|\.css/.test(h));
  const head = [
    fonts.length ? '    <link rel="preconnect" href="https://fonts.googleapis.com" />\n    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />' : '',
    ...fonts.map((h) => `    <link rel="stylesheet" href="${esc(h)}" />`),
    a.favicon ? `    <link rel="icon" href="${esc(a.favicon)}" />` : '',
    a.themeColor ? `    <meta name="theme-color" content="${esc(a.themeColor)}" />` : '',
  ].filter(Boolean).join('\n');

  const fill = (rel: string, map: Record<string, string>) => {
    let t = project.read(rel);
    for (const [k, v] of Object.entries(map)) t = t.split(`{{${k}}}`).join(v);
    project.write(rel, t);
  };
  fill('index.html', {
    LANG: esc(a.lang || 'en'), TITLE: esc(a.title || a.slug), DESCRIPTION: esc(a.description || ''), HEAD_EXTRA: head ? head + '\n' : '',
  });
  fill('package.json', { SLUG: a.slug });

  project.write('src/theme.css', themeCss(a.tokens));
  project.write('src/icons.tsx', buildIconsModule(a.svgs).source);
  fs.mkdirSync(project.p('public'), { recursive: true });
}
