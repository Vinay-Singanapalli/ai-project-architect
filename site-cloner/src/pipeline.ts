import fs from 'node:fs';
import path from 'node:path';
import { analyzeSite, normalizeUrl } from './analyze';
import { launchBrowser } from './analyze/browser';
import { config } from './config';
import { generateSite, type GenerateMode } from './generate';
import type { LLM } from './ollama';
import { Project } from './project';
import { startPreview } from './preview';
import { slugify } from './util/text';
import { emitter, type Emit } from './util/events';
import { fidelityPass, type FidelityReport } from './validate/fidelity';
import { validateAndRepair, type ValidateResult } from './validate/repair';

export interface CloneOptions {
  url: string;
  emit: Emit;
  llm: LLM | null;
  mode?: GenerateMode;
  forceStatic?: boolean;
  /** Skip the headless-browser render check and visual fidelity pass. */
  skipRender?: boolean;
}

export interface CloneResult {
  project: Project;
  slug: string;
  previewUrl: string;
  validation: ValidateResult;
  fidelity?: FidelityReport;
  warnings: string[];
}

export function projectFor(slug: string): Project {
  return new Project(path.join(config.sitesDir, slug));
}

export async function cloneSite(o: CloneOptions): Promise<CloneResult> {
  const url = normalizeUrl(o.url);
  const slug = slugify(new URL(url).hostname.replace(/^www\./, ''));
  const project = projectFor(slug);
  fs.rmSync(project.p('.cloner', 'snapshots'), { recursive: true, force: true });

  const t0 = Date.now();
  // 1) analyse
  const { analysis } = await analyzeSite(url, project.dir, o.emit, { forceStatic: o.forceStatic });
  analysis.slug = slug;
  for (const w of analysis.warnings) emitter(o.emit, 'analyze').warn(w);

  // 2) generate
  const plan = emitter(o.emit, 'plan');
  plan.info(`Design tokens: primary ${analysis.tokens.colors.primary}, background ${analysis.tokens.colors.bg}, text ${analysis.tokens.colors.text}`, { tokens: analysis.tokens });
  await generateSite(project, analysis, o.llm, o.emit, { mode: o.mode });

  // 3) preview + validate
  const prev = emitter(o.emit, 'preview');
  const previewUrl = await startPreview(project.dir);
  prev.info(`Preview server running at ${previewUrl}`, { previewUrl });

  let browser = null;
  if (!o.skipRender) {
    try {
      browser = await launchBrowser();
    } catch (e) {
      emitter(o.emit, 'validate').warn(`Render check skipped: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  let validation: ValidateResult;
  let fidelity: FidelityReport | undefined;
  try {
    validation = await validateAndRepair({ project, llm: o.llm, emit: o.emit, analysis, previewUrl, browser });
    if (browser && validation.ok) {
      fidelity = await fidelityPass({ project, analysis, browser, previewUrl, emit: o.emit });
      // the swap writes new files; make sure they still validate
      if (fidelity.swapped.length) validation = await validateAndRepair({ project, llm: o.llm, emit: o.emit, analysis, previewUrl, browser });
    }
  } finally {
    await browser?.close();
  }

  const secs = (Date.now() - t0) / 1000;
  const stats = o.llm?.stats;
  emitter(o.emit, 'done').ok(
    `Done in ${secs.toFixed(0)}s${stats ? ` · ${stats.calls} model calls (${stats.cacheHits} cached), ${stats.promptTokens + stats.outputTokens} tokens` : ' · no model calls'}`,
    { previewUrl, slug, seconds: secs, validation: { ok: validation.ok, repaired: validation.repaired, fellBack: validation.fellBack }, fidelity, stats },
  );
  return { project, slug, previewUrl, validation, fidelity, warnings: analysis.warnings };
}
