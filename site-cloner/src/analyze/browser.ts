import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { config, ROOT } from '../config';
import type { RawCapture, TNode } from './types';

const EXTRACT = fs.readFileSync(path.join(ROOT, 'src/analyze/extract.browser.js'), 'utf8');
const MOBILE = fs.readFileSync(path.join(ROOT, 'src/analyze/mobile.browser.js'), 'utf8');

export class BrowserUnavailable extends Error {}

const extraArgs = (): string[] => (process.env.CLONER_NO_SANDBOX ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] : []);

/** Launch Playwright's Chromium, falling back to an installed Chrome / Edge. */
export async function launchBrowser(): Promise<Browser> {
  const attempts: Array<() => Promise<Browser>> = [];
  if (config.chromiumPath) attempts.push(() => chromium.launch({ headless: true, executablePath: config.chromiumPath, args: extraArgs() }));
  attempts.push(() => chromium.launch({ headless: true, args: extraArgs() }));
  attempts.push(() => chromium.launch({ headless: true, channel: 'chrome', args: extraArgs() }));
  attempts.push(() => chromium.launch({ headless: true, channel: 'msedge', args: extraArgs() }));
  let last: unknown;
  for (const a of attempts) {
    try {
      return await a();
    } catch (e) {
      last = e;
    }
  }
  throw new BrowserUnavailable(
    `No usable browser found. Run "npx playwright install chromium" (or set CHROMIUM_PATH). Last error: ${(last as Error)?.message?.split('\n')[0]}`,
  );
}

const SCROLL_SCRIPT = `(async () => {
  const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
  let y = 0;
  for (let i = 0; i < 60; i++) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 140));
    y += step;
    if (y > document.documentElement.scrollHeight + step) break;
  }
  window.scrollTo(0, 0);
})()`;

async function autoScroll(page: Page) {
  await page.evaluate(SCROLL_SCRIPT);
  await page.waitForTimeout(500);
}

function applyMobile(n: TNode, diffs: Record<string, Record<string, string>>) {
  if (n.id !== undefined && diffs[n.id]) n.m = diffs[n.id];
  for (const c of n.c ?? []) if (typeof c !== 'string') applyMobile(c, diffs);
}

export interface CaptureResult {
  raw: RawCapture;
  /** section index -> screenshot path */
  sectionShots: Record<number, string>;
  desktopShot: string;
  mobileShot?: string;
}

export async function captureWithBrowser(url: string, outDir: string, log: (m: string) => void): Promise<CaptureResult> {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await launchBrowser();
  try {
    const ctx = await browser.newContext({ viewport: config.viewport, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    log('Loading page in headless browser…');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    log('Scrolling to trigger lazy content…');
    await autoScroll(page);

    log('Extracting layout, styles and content…');
    const raw = (await page.evaluate(
      `(${EXTRACT})(${JSON.stringify({ maxNodes: config.maxNodesPerSection, maxDepth: 14, maxSections: config.maxSections })})`,
    )) as RawCapture;

    const desktopShot = path.join(outDir, 'desktop.png');
    await page.screenshot({ path: desktopShot, fullPage: true, animations: 'disabled' }).catch(() => undefined);

    const sectionShots: Record<number, string> = {};
    for (let i = 0; i < raw.sections.length; i++) {
      const s = raw.sections[i];
      const file = path.join(outDir, `section-${i}.png`);
      try {
        await page.screenshot({
          path: file,
          fullPage: true,
          animations: 'disabled',
          clip: { x: 0, y: Math.max(0, s.y), width: config.viewport.width, height: Math.min(4000, Math.max(8, s.height)) },
        });
        sectionShots[i] = file;
      } catch {
        /* screenshots are best-effort */
      }
    }

    log('Measuring responsive behaviour at mobile width…');
    await page.setViewportSize(config.mobileViewport);
    await page.waitForTimeout(700);
    const diffs = (await page.evaluate(`(${MOBILE})()`)) as Record<string, Record<string, string>>;
    for (const s of raw.sections) applyMobile(s.tree, diffs);
    const mobileShot = path.join(outDir, 'mobile.png');
    await page.screenshot({ path: mobileShot, fullPage: true, animations: 'disabled' }).catch(() => undefined);

    return { raw: { ...raw, mode: 'browser' }, sectionShots, desktopShot, mobileShot };
  } finally {
    await browser.close();
  }
}
