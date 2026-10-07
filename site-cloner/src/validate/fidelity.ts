import type { Browser } from 'playwright';
import { config } from '../config';
import { treeToComponent } from '../generate/fallback';
import type { SiteAnalysis } from '../analyze/types';
import { emitter, type Emit } from '../util/events';
import type { Project } from '../project';
import { renderCheck } from './runtime';
import { compareImages } from './visual';
import fs from 'node:fs';

export interface FidelityReport {
  before: number;
  after: number;
  perSection: Record<string, number>;
  swapped: string[];
}

const MARGIN = 0.03;

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Visual accuracy pass. Every section the model wrote is screenshotted and compared with the original. If the
 * deterministic rebuild of a weak section scores clearly higher, the more faithful version wins.
 */
export async function fidelityPass(opts: {
  project: Project;
  analysis: SiteAnalysis;
  browser: Browser;
  previewUrl: string;
  emit: Emit;
}): Promise<FidelityReport> {
  const { project, analysis, browser, previewUrl } = opts;
  const log = emitter(opts.emit, 'validate');
  const tmp = project.p('.cloner', 'tmp');
  const manifest = project.readManifest();
  const render = async () => (await renderCheck(browser, previewUrl, tmp, manifest.sections, { screenshots: true })).shots;
  const scoreAll = (shots: Record<string, string>) => {
    const out: Record<string, number> = {};
    for (const spec of analysis.sections) {
      if (!spec.screenshot || !shots[spec.id]) continue;
      try {
        out[spec.id] = compareImages(project.p(spec.screenshot), shots[spec.id]).score;
      } catch { /* unreadable screenshot */ }
    }
    return out;
  };

  const first = scoreAll(await render());
  const before = avg(Object.values(first));
  log.info(`Visual fidelity vs. original: ${(before * 100).toFixed(0)}%`, { fidelity: before, perSection: first });

  const weak = manifest.sections.filter((s) => s.source === 'llm' && (first[s.id] ?? 1) < config.fidelityMin && analysis.sections.some((a) => a.id === s.id));
  if (!weak.length) return { before, after: before, perSection: first, swapped: [] };

  const backup = new Map<string, { tsx: string; css: string }>();
  for (const s of weak) {
    backup.set(s.name, { tsx: fs.readFileSync(project.sectionFile(s.name, 'tsx'), 'utf8'), css: fs.readFileSync(project.sectionFile(s.name, 'css'), 'utf8') });
    const spec = analysis.sections.find((a) => a.id === s.id)!;
    const c = treeToComponent(spec, analysis.tokens);
    project.writeSection(s.name, c.tsx, c.css);
  }
  await new Promise((r) => setTimeout(r, 600));
  const second = scoreAll(await render());

  const swapped: string[] = [];
  for (const s of weak) {
    if ((second[s.id] ?? 0) > (first[s.id] ?? 0) + MARGIN) {
      s.source = 'fallback';
      swapped.push(s.name);
    } else {
      const b = backup.get(s.name)!;
      project.writeSection(s.name, b.tsx, b.css);
    }
  }
  project.writeManifest(manifest);
  const final = { ...first };
  for (const s of weak) if (swapped.includes(s.name)) final[s.id] = second[s.id];
  const after = avg(Object.values(final));
  if (swapped.length) log.ok(`Swapped ${swapped.join(', ')} for a more faithful build → fidelity ${(after * 100).toFixed(0)}%`, { fidelity: after, swapped });
  else log.info('Model-written components were already the closest match; none swapped');
  return { before, after, perSection: final, swapped };
}
