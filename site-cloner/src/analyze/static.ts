import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import type { RawCapture, RawSamples, RawSection, Style, TNode } from './types';
import { parseColor } from '../util/color';

/**
 * Degraded-mode analyser used when no browser is available: fetches the HTML and CSS and builds the same
 * RawCapture shape, but without computed layout (styles come from inline style attributes only).
 */
const HTML_OK = new Set('a abbr article aside b blockquote button caption cite code dd details div dl dt em fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr i img input label legend li main nav ol option p pre section select small span strong sub summary sup table tbody td textarea tfoot th thead tr u ul br'.split(' '));
const SKIP = new Set(['script', 'style', 'noscript', 'link', 'meta', 'template', 'iframe', 'object', 'embed', 'canvas', 'head', 'title', 'source', 'track', 'svg', 'video']);

function parseInline(style: string | undefined): Style {
  const out: Style = {};
  for (const decl of (style ?? '').split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const k = decl.slice(0, i).trim().toLowerCase();
    const v = decl.slice(i + 1).trim();
    if (k && v && !k.startsWith('--') && !/^(animation|transition|transform|will-change|cursor)/.test(k)) out[k] = v;
  }
  return out;
}

const abs = (base: string, u?: string) => {
  if (!u) return null;
  try { return new URL(u, base).href; } catch { return null; }
};

export async function captureStatic(url: string): Promise<RawCapture> {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (site-cloner static mode)' }, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Fetching ${url} failed with HTTP ${res.status}`);
  const finalUrl = res.url || url;
  const html = await res.text();
  const $ = cheerio.load(html);

  // --- CSS sampling (very rough: counts colour declarations) ---
  let css = $('style').map((_, e) => $(e).text()).get().join('\n');
  const sheets = $('link[rel="stylesheet"]').map((_, e) => abs(finalUrl, $(e).attr('href'))).get().filter(Boolean).slice(0, 3) as string[];
  for (const s of sheets) {
    try {
      const r = await fetch(s, { signal: AbortSignal.timeout(8000) });
      const t = await r.text();
      if (t.length < 400_000) css += '\n' + t;
    } catch { /* ignore */ }
  }
  const samples: RawSamples = { bg: {}, fg: {}, cta: {}, link: {}, fonts: {}, headingFonts: {}, radii: {}, containers: {} };
  const bump = (m: Record<string, number>, k: string | null | undefined) => { if (k) m[k] = (m[k] ?? 0) + 1; };
  for (const m of css.matchAll(/(?<![-\w])color\s*:\s*([^;}]+)/g)) bump(samples.fg, parseColor(m[1].trim().split(' ')[0]));
  for (const m of css.matchAll(/background(?:-color)?\s*:\s*([^;}]+)/g)) {
    const c = /#[0-9a-fA-F]{3,6}\b|rgb\([^)]*\)/.exec(m[1]);
    bump(samples.bg, c ? parseColor(c[0]) : null);
  }
  for (const m of css.matchAll(/(?:\.btn|button|\.button|\.cta)[^{]*\{[^}]*background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,6}|rgb\([^)]*\))/g)) bump(samples.cta, parseColor(m[1]));
  for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/g)) bump(samples.fonts, m[1].split(',')[0].replace(/["']/g, '').trim());
  for (const m of css.matchAll(/border-radius\s*:\s*(\d+px)/g)) bump(samples.radii, m[1]);
  for (const m of css.matchAll(/max-width\s*:\s*(\d{3,4}px)/g)) bump(samples.containers, m[1]);

  // --- DOM -> TNode ---
  let count = 0;
  const conv = (el: AnyNode, depth: number): TNode | string | null => {
    if (el.type === 'text') {
      const t = (el as unknown as { data: string }).data.replace(/\s+/g, ' ');
      return t.trim() ? t : null;
    }
    if (el.type !== 'tag') return null;
    const e = el as Element;
    const tag = e.name.toLowerCase();
    if (SKIP.has(tag) || count++ > 500 || depth > 14) return null;
    if ($(e).attr('hidden') !== undefined || $(e).attr('aria-hidden') === 'true') return null;
    const node: TNode = { t: HTML_OK.has(tag) ? tag : 'div' };
    const a: Record<string, string> = {};
    if (tag === 'a') a.href = $(e).attr('href')?.startsWith('#') ? $(e).attr('href')! : abs(finalUrl, $(e).attr('href')) ?? '#';
    if (tag === 'img') {
      const src = abs(finalUrl, $(e).attr('src') || $(e).attr('data-src'));
      if (!src) return null;
      a.src = src; a.alt = ($(e).attr('alt') ?? '').slice(0, 140);
    }
    if (tag === 'input') { a.type = $(e).attr('type') ?? 'text'; if ($(e).attr('placeholder')) a.placeholder = $(e).attr('placeholder')!; }
    if (Object.keys(a).length) node.a = a;
    node.s = parseInline($(e).attr('style'));
    if (tag !== 'img' && tag !== 'input') {
      const kids = e.children.map((c) => conv(c, depth + 1)).filter((c): c is TNode | string => c !== null);
      if (kids.length) node.c = kids;
    }
    return node;
  };

  const kidsOf = (el: Element) => el.children.filter((c): c is Element => c.type === 'tag' && !SKIP.has((c as Element).name));
  let root = $('body').get(0) as Element;
  for (let i = 0; i < 6; i++) {
    const k = kidsOf(root);
    if (k.length === 1) root = k[0]; else break;
  }
  let els = kidsOf(root);
  const flat: Element[] = [];
  for (const e of els) {
    const inner = kidsOf(e);
    if (e.name === 'main' || (e.name === 'div' && inner.length >= 3 && !/header|footer/.test(e.name))) flat.push(...(inner.length === 1 ? kidsOf(inner[0]) : inner));
    else flat.push(e);
  }
  els = flat.slice(0, 14);

  let y = 0;
  const sections: RawSection[] = [];
  for (const e of els) {
    const tree = conv(e, 0);
    if (!tree || typeof tree === 'string') continue;
    const h = $(e).find('h1, h2, h3').first().text().replace(/\s+/g, ' ').trim().slice(0, 80);
    const height = e.name === 'header' || e.name === 'nav' ? 80 : 480;
    sections.push({ tag: e.name, htmlId: $(e).attr('id'), y, height, bg: '#ffffff', tree, headingText: h });
    y += height;
  }

  const icon = $('link[rel~="icon"]').attr('href');
  const bodyStyle = parseInline($('body').attr('style'));
  return {
    title: $('title').first().text().trim(),
    lang: $('html').attr('lang') ?? 'en',
    description: $('meta[name="description"]').attr('content') ?? '',
    themeColor: $('meta[name="theme-color"]').attr('content') ?? undefined,
    favicon: abs(finalUrl, icon) ?? undefined,
    fontLinks: $('link[href*="fonts.googleapis.com"], link[href*="fonts.bunny.net"]').map((_, e) => $(e).attr('href')).get().filter(Boolean) as string[],
    bodyBg: parseColor(bodyStyle['background-color'] ?? '') ?? '#ffffff',
    bodyColor: parseColor(bodyStyle.color ?? '') ?? '#111827',
    bodyFontSize: 16,
    pageHeight: y,
    samples,
    sections,
    svgs: [],
    mode: 'static',
  };
}
