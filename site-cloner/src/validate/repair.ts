import fs from 'node:fs';
import type { Browser } from 'playwright';
import { buildSafeIconsModule } from '../analyze/svg';
import type { SiteAnalysis } from '../analyze/types';
import { config } from '../config';
import { treeToComponent } from '../generate/fallback';
import { normalizeComponent, parseComponentReply, sanityCheck } from '../generate/check';
import { REPAIR_SYSTEM, repairUser } from '../generate/prompts';
import { themeColorMap } from '../analyze/tokens';
import type { LLM } from '../ollama';
import type { Project } from '../project';
import { emitter, type Emit } from '../util/events';
import { type Issue, sectionNameOf, staticChecks } from './check';
import { renderCheck } from './runtime';

export interface ValidateContext {
  project: Project;
  llm: LLM | null;
  emit: Emit;
  analysis?: SiteAnalysis;
  previewUrl?: string;
  browser?: Browser | null;
}

export interface ValidateResult {
  ok: boolean;
  issues: Issue[];
  repaired: string[];
  fellBack: string[];
}

async function collectIssues(ctx: ValidateContext): Promise<Issue[]> {
  const issues = await staticChecks(ctx.project.dir);
  if (issues.length || !ctx.browser || !ctx.previewUrl) return issues;
  const m = ctx.project.readManifest();
  const rep = await renderCheck(ctx.browser, ctx.previewUrl, ctx.project.p('.cloner', 'tmp'), m.sections, { screenshots: false });
  return rep.issues;
}

/** Swap a section for the deterministic render of the captured element tree. Returns false if no spec exists. */
export function useFallback(ctx: ValidateContext, name: string): boolean {
  const spec = ctx.analysis?.sections.find((s) => s.name === name);
  if (!spec || !ctx.analysis) return false;
  const c = treeToComponent(spec, ctx.analysis.tokens);
  ctx.project.writeSection(name, c.tsx, c.css);
  const m = ctx.project.readManifest();
  const e = m.sections.find((s) => s.name === name);
  if (e) e.source = 'fallback';
  ctx.project.writeManifest(m);
  return true;
}

/**
 * The self-healing loop: static checks (tsc + vite build) and a runtime render check; broken sections are sent
 * back to the model with the exact errors, and after the last round are swapped for the deterministic renderer.
 */
export async function validateAndRepair(ctx: ValidateContext): Promise<ValidateResult> {
  const log = emitter(ctx.emit, 'validate');
  const repaired = new Set<string>();
  const fellBack = new Set<string>();
  let issues: Issue[] = [];
  const colorMap = ctx.analysis ? themeColorMap(ctx.analysis.tokens) : {};

  for (let round = 0; round <= config.repairRounds + 1; round++) {
    issues = await collectIssues(ctx);
    if (!issues.length) {
      log.ok(round === 0 ? 'Type-check, build and render all pass' : `All checks pass after ${round} repair round${round > 1 ? 's' : ''}`);
      return { ok: true, issues: [], repaired: [...repaired], fellBack: [...fellBack] };
    }
    log.warn(`${issues.length} problem${issues.length > 1 ? 's' : ''} found (round ${round + 1}): ${issues[0].file ?? 'project'}: ${issues[0].message.slice(0, 140)}`);

    // Problems outside section files: the icons module is the only generated shared file that can break.
    if (issues.some((i) => i.file === 'src/icons.tsx') && ctx.analysis) {
      ctx.project.write('src/icons.tsx', buildSafeIconsModule(ctx.analysis.svgs.length));
      log.warn('Icon module was invalid; replaced with safe placeholders');
      continue;
    }

    const bySection = new Map<string, Issue[]>();
    const unattributed: Issue[] = [];
    for (const i of issues) {
      const n = sectionNameOf(i);
      if (n) bySection.set(n, [...(bySection.get(n) ?? []), i]);
      else unattributed.push(i);
    }
    if (!bySection.size) {
      // Cannot attribute to a section: swap every LLM-written section for its deterministic version, once.
      const m = ctx.project.readManifest();
      const llmOnes = m.sections.filter((s) => s.source !== 'fallback');
      if (!llmOnes.length) break;
      log.warn('Unattributed error; switching all model-written sections to the deterministic renderer');
      for (const s of llmOnes) if (useFallback(ctx, s.name)) fellBack.add(s.name);
      continue;
    }

    for (const [name, errs] of bySection) {
      const canAsk = ctx.llm && round < config.repairRounds;
      let fixed = false;
      if (canAsk) {
        const tsx = fs.readFileSync(ctx.project.sectionFile(name, 'tsx'), 'utf8');
        const css = fs.readFileSync(ctx.project.sectionFile(name, 'css'), 'utf8');
        log.info(`Asking ${ctx.llm!.models.code} to repair ${name}…`);
        try {
          const reply = await ctx.llm!.chat({
            model: ctx.llm!.models.code,
            system: REPAIR_SYSTEM,
            user: repairUser(name, tsx, css, errs.map((e) => `${e.line ? `line ${e.line}: ` : ''}${e.message}`)),
            temperature: 0.1 + round * 0.2,
          });
          const parsed = parseComponentReply(reply);
          if (parsed) {
            const comp = normalizeComponent(name, parsed, colorMap);
            if (!sanityCheck(name, comp).length) {
              ctx.project.writeSection(name, comp.tsx, comp.css);
              repaired.add(name);
              fixed = true;
            }
          }
        } catch (e) {
          log.warn(`Repair request failed: ${(e as Error).message.split('\n')[0]}`);
        }
      }
      if (!fixed && !canAsk) {
        if (useFallback(ctx, name)) {
          fellBack.add(name);
          log.warn(`${name}: still failing, replaced by the deterministic renderer`);
        }
      }
    }
    void unattributed;
  }
  return { ok: false, issues, repaired: [...repaired], fellBack: [...fellBack] };
}
