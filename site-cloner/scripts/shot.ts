import path from 'node:path';
import { chromium } from 'playwright';
import { launchBrowser } from '../src/analyze/browser';
import { projectFor } from '../src/pipeline';
import { startPreview, stopAllPreviews } from '../src/preview';

const [slug, width = '1440', out = `/tmp/${slug}-${width}.png`] = process.argv.slice(2);
void chromium;
const project = projectFor(slug);
const url = await startPreview(project.dir);
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: +width, height: 900 } });
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(800);
await page.screenshot({ path: out, fullPage: true });
console.log('saved', path.resolve(out));
await browser.close();
await stopAllPreviews();
process.exit(0);
