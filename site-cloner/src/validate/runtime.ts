import fs from 'node:fs';
import path from 'node:path';
import type { Browser } from 'playwright';
import { config } from '../config';
import type { Issue } from './check';

export interface RenderReport {
  issues: Issue[];
  /** section id -> PNG of that section as rendered by the generated site */
  shots: Record<string, string>;
}

/** Load the preview in a headless browser, collect runtime errors and per-section screenshots. */
export async function renderCheck(
  browser: Browser,
  url: string,
  outDir: string,
  sections: { id: string; name: string }[],
  opts: { screenshots: boolean },
): Promise<RenderReport> {
  fs.mkdirSync(outDir, { recursive: true });
  const ctx = await browser.newContext({ viewport: config.viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForFunction("(document.getElementById('root') ? document.getElementById('root').childElementCount : 0) > 0", undefined, { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(500);
    const secErrors = (await page.evaluate('window.__sectionErrors || []')) as { id: string; message: string }[];

    const issues: Issue[] = [];
    for (const e of secErrors) {
      const sec = sections.find((s) => s.id === e.id);
      issues.push({ source: 'runtime', file: sec ? `src/sections/${sec.name}.tsx` : undefined, message: `Runtime error while rendering: ${e.message}`.slice(0, 300) });
    }
    if (!secErrors.length) for (const m of pageErrors.slice(0, 3)) issues.push({ source: 'runtime', message: `Uncaught error: ${m}`.slice(0, 300) });

    const shots: Record<string, string> = {};
    if (opts.screenshots) {
      for (const s of sections) {
        const file = path.join(outDir, `${s.id}.png`);
        try {
          await page.locator(`[data-section="${s.id}"]`).first().screenshot({ path: file, timeout: 6000, animations: 'disabled' });
          shots[s.id] = file;
        } catch {
          /* hidden / zero-size sections have no screenshot */
        }
      }
    }
    return { issues, shots };
  } finally {
    await ctx.close();
  }
}
