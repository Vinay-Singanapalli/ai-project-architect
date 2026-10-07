import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { emitter, type Emit } from '../util/events';
import { pascal, slugify } from '../util/text';
import { captureWithBrowser, BrowserUnavailable } from './browser';
import { captureStatic } from './static';
import { buildIconsModule } from './svg';
import { collectAssetUrls, downloadAssets, rewriteAssets } from './assets';
import { computeTokens } from './tokens';
import { classifySection, simplify, textOf, walkTree } from './tree';
import type { RawCapture, SectionSpec, SectionType, SiteAnalysis, TNode } from './types';

export function normalizeUrl(input: string): string {
  const u = input.trim();
  const withScheme = /^https?:\/\//i.test(u) ? u : `https://${u}`;
  return new URL(withScheme).href;
}

const BASE_NAME: Partial<Record<SectionType, string>> = {
  navbar: 'Navbar', hero: 'Hero', features: 'Features', pricing: 'Pricing', testimonials: 'Testimonials', faq: 'Faq',
  cta: 'CallToAction', logos: 'Logos', stats: 'Stats', gallery: 'Gallery', contact: 'Contact', footer: 'Footer',
};

export interface AnalyzeOptions {
  forceStatic?: boolean;
}

export async function analyzeSite(urlInput: string, siteDir: string, emit: Emit, opts: AnalyzeOptions = {}): Promise<{ analysis: SiteAnalysis; mobileShot?: string; desktopShot?: string }> {
  const log = emitter(emit, 'analyze');
  const url = normalizeUrl(urlInput);
  const warnings: string[] = [];
  const analysisDir = path.join(siteDir, '.cloner', 'analysis');
  fs.mkdirSync(analysisDir, { recursive: true });

  let raw: RawCapture | undefined;
  let sectionShots: Record<number, string> = {};
  let desktopShot: string | undefined;
  let mobileShot: string | undefined;

  if (!opts.forceStatic) {
    try {
      const cap = await captureWithBrowser(url, analysisDir, (m) => log.info(m));
      raw = cap.raw; sectionShots = cap.sectionShots; desktopShot = cap.desktopShot; mobileShot = cap.mobileShot;
      if (raw.sections.length === 0) {
        warnings.push('Browser capture found no visible sections; falling back to static HTML analysis.');
        raw = undefined;
      }
    } catch (e) {
      const msg = (e as Error).message.split('\n')[0];
      warnings.push(e instanceof BrowserUnavailable ? msg : `Browser capture failed (${msg}); using static HTML analysis.`);
      log.warn(warnings[warnings.length - 1]);
    }
  }
  if (!raw) {
    log.info('Analysing static HTML/CSS (no computed layout available)…');
    raw = await captureStatic(url);
    if (!raw.sections.length) throw new Error('Could not find any page content to analyse. The site may require JavaScript or block automated access.');
    warnings.push('Static mode: layout and spacing are inferred by the model, so fidelity will be lower. Install a browser with "npx playwright install chromium" for best results.');
  }

  // ---- sections: simplify, classify, name ----
  const total = raw.sections.length;
  const used = new Set<string>();
  const specs: SectionSpec[] = raw.sections.map((rs, i) => {
    const tree = simplify(rs.tree);
    const type = classifySection(i, total, rs.tag, rs.height, tree, rs.headingText);
    let base = BASE_NAME[type] ?? pascal(rs.headingText, `Section${i + 1}`);
    let name = base, n = 2;
    while (used.has(name)) name = `${base}${n++}`;
    used.add(name);
    const id = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    return {
      id, name, label: rs.headingText ? `${BASE_NAME[type] ?? name} – ${rs.headingText}` : (BASE_NAME[type] ?? name),
      type, y: rs.y, height: rs.height, bg: rs.bg, tree, text: textOf(tree, 1200),
      screenshot: sectionShots[i] ? path.relative(siteDir, sectionShots[i]) : undefined,
      anchor: rs.htmlId && /^[A-Za-z][\w-]*$/.test(rs.htmlId) ? rs.htmlId : undefined,
    };
  });

  // ---- inline SVG -> icon components (drop ones that cannot be represented) ----
  const { available } = buildIconsModule(raw.svgs);
  for (const s of specs) {
    walkTree(s.tree, (n) => {
      if (n.t === 'svg' && (n.ref === undefined || !available.has(n.ref))) { n.t = 'span'; delete n.ref; n.s = { display: 'inline-block', width: n.s?.width ?? '24px', height: n.s?.height ?? '24px' }; }
    });
  }

  // ---- assets ----
  const urls = collectAssetUrls(specs.map((s) => s.tree));
  let assets: Record<string, string> = {};
  if (urls.length) {
    log.info(`Downloading ${Math.min(urls.length, config.maxAssets)} image assets…`);
    assets = await downloadAssets(urls, siteDir, url);
    for (const s of specs) rewriteAssets(s.tree, assets);
    log.info(`Saved ${Object.keys(assets).length}/${Math.min(urls.length, config.maxAssets)} assets locally`);
  }
  let favicon = raw.favicon;
  if (favicon && /^https?:/.test(favicon)) {
    const got = await downloadAssets([favicon], siteDir, url);
    favicon = got[favicon] ?? favicon;
  }

  const analysis: SiteAnalysis = {
    url, slug: slugify(new URL(url).hostname.replace(/^www\./, '')),
    title: raw.title, lang: raw.lang || 'en', description: raw.description, themeColor: raw.themeColor, favicon,
    fontLinks: raw.fontLinks, tokens: computeTokens(raw), sections: specs, svgs: raw.svgs, mode: raw.mode, warnings, assets, pageHeight: raw.pageHeight,
  };
  fs.writeFileSync(path.join(analysisDir, 'analysis.json'), JSON.stringify(analysis, null, 2));
  log.ok(`Found ${specs.length} sections: ${specs.map((s) => s.type).join(' → ')}`, { sections: specs.map((s) => ({ id: s.id, type: s.type, label: s.label })) });
  return { analysis, mobileShot, desktopShot };
}
