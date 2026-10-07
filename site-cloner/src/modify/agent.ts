import fs from 'node:fs';
import type { Browser } from 'playwright';
import type { SiteAnalysis } from '../analyze/types';
import { contrastText, parseColor } from '../util/color';
import { EDIT_SYSTEM, NEW_SECTION_SYSTEM, editUser, newSectionUser, ROUTER_SYSTEM, routerUser } from '../generate/prompts';
import { requestComponent } from '../generate/section';
import type { LLM } from '../ollama';
import type { Manifest, ManifestEntry, Project } from '../project';
import { emitter, type Emit } from '../util/events';
import { extractJson, pascal } from '../util/text';
import { validateAndRepair } from '../validate/repair';
import { ruleBasedPlan, defaultPosition } from './intents';
import { Op, THEME_VARS } from './ops';
import { resolveFuzzy, typeOfTopic } from './resolve';

export interface ModifyContext {
  project: Project;
  llm: LLM | null;
  emit: Emit;
  previewUrl?: string;
  browser?: Browser | null;
}

export interface ModifyResult {
  ok: boolean;
  summary: string;
  ops: Op[];
  usedModel: boolean;
}

const COLOR_VARS = new Set(['--color-primary', '--color-bg', '--color-surface', '--color-text', '--color-muted', '--color-border']);

function loadAnalysis(project: Project): SiteAnalysis | undefined {
  try {
    return project.readAnalysis();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------------
// planning
// ---------------------------------------------------------------------------------------------------
function currentTheme(project: Project): Record<string, string> {
  const css = project.read('src/theme.css');
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) if (THEME_VARS.has(m[1])) out[m[1]] = m[2].trim();
  return out;
}

function sanitizeOps(raw: unknown, m: Manifest): Op[] {
  const list = Array.isArray((raw as { ops?: unknown })?.ops) ? ((raw as { ops: unknown[] }).ops) : [];
  const ops: Op[] = [];
  const target = (v: unknown) => (typeof v === 'string' ? resolveFuzzy(m, v) : undefined);
  for (const o of list as Record<string, unknown>[]) {
    switch (o?.op) {
      case 'set_theme': {
        const vars: Record<string, string> = {};
        for (const [k, v] of Object.entries((o.vars ?? {}) as Record<string, unknown>)) {
          if (!THEME_VARS.has(k) || typeof v !== 'string') continue;
          if (COLOR_VARS.has(k)) {
            const c = parseColor(v);
            if (c) vars[k] = c;
          } else vars[k] = v.replace(/[;{}]/g, '').slice(0, 200);
        }
        if (Object.keys(vars).length) ops.push({ op: 'set_theme', vars });
        break;
      }
      case 'remove_section': { const t = target(o.target); if (t) ops.push({ op: 'remove_section', target: t.id }); break; }
      case 'edit_section': { const t = target(o.target); if (t && typeof o.instruction === 'string') ops.push({ op: 'edit_section', target: t.id, instruction: o.instruction }); break; }
      case 'replace_section': { const t = target(o.target); if (t && typeof o.description === 'string') ops.push({ op: 'replace_section', target: t.id, description: o.description }); break; }
      case 'move_section': { const t = target(o.target); if (t && typeof o.position === 'string') ops.push({ op: 'move_section', target: t.id, position: String(o.position) }); break; }
      case 'add_section':
        if (typeof o.name === 'string' && typeof o.description === 'string') ops.push({ op: 'add_section', name: pascal(o.name, 'NewSection'), description: o.description, position: typeof o.position === 'string' ? o.position : undefined });
        break;
      case 'global_css':
        if (typeof o.css === 'string' && o.css.trim() && !/[<>]|@import|javascript:/i.test(o.css)) ops.push({ op: 'global_css', css: o.css.slice(0, 2000) });
        break;
    }
  }
  return ops;
}

async function plan(ctx: ModifyContext, instruction: string, m: Manifest): Promise<{ ops: Op[]; usedModel: boolean }> {
  const rule = ruleBasedPlan(instruction, m);
  if (rule) return { ops: rule, usedModel: false };
  if (!ctx.llm) throw new Error('This request needs a language model, but Ollama is not available. Start Ollama and retry.');
  const log = emitter(ctx.emit, 'modify');
  log.info(`Planning with ${ctx.llm.models.fast}…`);
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await ctx.llm.chat({
      model: ctx.llm.models.fast,
      system: ROUTER_SYSTEM,
      user: routerUser(instruction, m.sections.map((s) => ({ id: s.id, type: s.type, label: s.label })), currentTheme(ctx.project)),
      json: true,
      temperature: attempt ? 0.4 : 0,
      numPredict: 700,
    });
    const ops = sanitizeOps(extractJson(reply), m);
    if (ops.length) return { ops, usedModel: true };
  }
  // Last resort: treat it as a free-form edit of the best-matching section.
  const t = resolveFuzzy(m, instruction);
  if (t) return { ops: [{ op: 'edit_section', target: t.id, instruction }], usedModel: true };
  throw new Error('I could not turn that into a concrete change. Try naming a section (e.g. "make the hero headline larger").');
}

// ---------------------------------------------------------------------------------------------------
// execution
// ---------------------------------------------------------------------------------------------------
function insertAt(m: Manifest, entry: ManifestEntry, position: string | undefined) {
  const pos = position || defaultPosition(entry.type, m);
  const ref = /^(before|after):(.+)$/.exec(pos);
  if (pos === 'start') m.sections.unshift(entry);
  else if (ref) {
    const i = m.sections.findIndex((s) => s.id === ref[2]);
    if (i < 0) m.sections.push(entry);
    else m.sections.splice(ref[1] === 'before' ? i : i + 1, 0, entry);
  } else m.sections.push(entry);
}

function uniqueName(m: Manifest, base: string): { name: string; id: string } {
  let name = base, n = 2;
  while (m.sections.some((s) => s.name === name)) name = `${base}${n++}`;
  return { name, id: name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase() };
}

function setThemeVars(project: Project, vars: Record<string, string>) {
  let css = project.read('src/theme.css');
  const next = { ...vars };
  if (next['--color-primary']) next['--color-primary-contrast'] = contrastText(next['--color-primary']);
  for (const [k, v] of Object.entries(next)) {
    const re = new RegExp(`(${k}\\s*:\\s*)[^;]+;`);
    css = re.test(css) ? css.replace(re, `$1${v};`) : css.replace(/\}\s*$/, `  ${k}: ${v};\n}\n`);
  }
  project.write('src/theme.css', css);
}

function appendGlobalCss(project: Project, css: string, key?: string) {
  let cur = project.read('src/overrides.css');
  if (key) {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cur = cur.replace(new RegExp(`\\n?/\\* @begin ${esc} \\*/[\\s\\S]*?/\\* @end \\*/\\n?`, 'g'), '\n');
  }
  const block = key ? `/* @begin ${key} */\n${css.trim()}\n/* @end */\n` : `${css.trim()}\n`;
  project.write('src/overrides.css', `${cur.trimEnd()}\n\n${block}`);
}

async function execute(ctx: ModifyContext, op: Op, analysis: SiteAnalysis | undefined): Promise<string> {
  const { project, llm } = ctx;
  const m = project.readManifest();
  const tokens = analysis?.tokens;
  const need = (): LLM => {
    if (!llm) throw new Error('This change needs a language model, but Ollama is not available.');
    return llm;
  };
  const log = emitter(ctx.emit, 'modify');
  const tokensOrThrow = () => {
    if (!tokens) throw new Error('Design tokens are missing for this project (analysis.json not found).');
    return tokens;
  };

  switch (op.op) {
    case 'set_theme': {
      setThemeVars(project, op.vars);
      return `Updated theme: ${Object.entries(op.vars).map(([k, v]) => `${k.replace('--', '')} → ${v}`).join(', ')}`;
    }
    case 'global_css': {
      appendGlobalCss(project, op.css, op.key);
      return op.key?.startsWith('sticky:') ? (op.css.includes('static') ? `Navbar is no longer sticky` : `Made ${op.key.slice(7)} sticky`) : 'Added custom CSS rules';
    }
    case 'remove_section': {
      const e = m.sections.find((s) => s.id === op.target);
      if (!e) throw new Error(`No section "${op.target}"`);
      m.sections = m.sections.filter((s) => s !== e);
      project.removeSection(e.name);
      project.writeManifest(m);
      return `Removed the ${e.label} section`;
    }
    case 'move_section': {
      const e = m.sections.find((s) => s.id === op.target);
      if (!e) throw new Error(`No section "${op.target}"`);
      m.sections = m.sections.filter((s) => s !== e);
      insertAt(m, e, op.position);
      project.writeManifest(m);
      return `Moved ${e.label} (${op.position})`;
    }
    case 'edit_section': {
      const e = m.sections.find((s) => s.id === op.target);
      if (!e) throw new Error(`No section "${op.target}"`);
      log.info(`Editing ${e.name} with ${need().models.code}…`);
      const res = await requestComponent({
        llm: need(), system: EDIT_SYSTEM, name: e.name, tokens: tokensOrThrow(),
        user: editUser(e.name, fs.readFileSync(project.sectionFile(e.name, 'tsx'), 'utf8'), fs.readFileSync(project.sectionFile(e.name, 'css'), 'utf8'), op.instruction, tokensOrThrow()),
      });
      if ('error' in res) throw new Error(`The model's edit of ${e.name} was rejected: ${res.error.slice(0, 160)}`);
      project.writeSection(e.name, res.component.tsx, res.component.css);
      e.source = 'ai-edit';
      project.writeManifest(m);
      return `Edited ${e.label}: ${op.instruction.slice(0, 80)}`;
    }
    case 'replace_section': {
      const e = m.sections.find((s) => s.id === op.target);
      if (!e) throw new Error(`No section "${op.target}"`);
      log.info(`Writing a new ${e.name} with ${need().models.code}…`);
      const res = await requestComponent({
        llm: need(), system: NEW_SECTION_SYSTEM, name: e.name, tokens: tokensOrThrow(),
        user: newSectionUser(e.name, e.id, op.description, tokensOrThrow(), neighbourCss(project, m, e)),
      });
      if ('error' in res) throw new Error(`The model's new ${e.name} was rejected: ${res.error.slice(0, 160)}`);
      project.writeSection(e.name, res.component.tsx, res.component.css);
      e.source = 'ai-added';
      project.writeManifest(m);
      return `Replaced ${e.label} with: ${op.description.slice(0, 80)}`;
    }
    case 'add_section': {
      const { name, id } = uniqueName(m, op.name);
      const type = typeOfTopic(op.name);
      log.info(`Writing new ${name} section with ${need().models.code}…`);
      const res = await requestComponent({
        llm: need(), system: NEW_SECTION_SYSTEM, name, tokens: tokensOrThrow(),
        user: newSectionUser(name, id, op.description, tokensOrThrow(), neighbourCss(project, m, undefined)),
      });
      if ('error' in res) throw new Error(`The model's ${name} section was rejected: ${res.error.slice(0, 160)}`);
      project.writeSection(name, res.component.tsx, res.component.css);
      insertAt(m, { id, name, label: name, type, source: 'ai-added' }, op.position);
      project.writeManifest(m);
      return `Added a ${name} section`;
    }
  }
}

function neighbourCss(project: Project, m: Manifest, exclude: ManifestEntry | undefined): string {
  const pick = m.sections.find((s) => s !== exclude && /features|content|pricing/.test(s.type)) ?? m.sections.find((s) => s !== exclude);
  if (!pick) return '';
  try {
    return fs.readFileSync(project.sectionFile(pick.name, 'css'), 'utf8').slice(0, 900);
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------------------------------
export async function modifySite(ctx: ModifyContext, instruction: string): Promise<ModifyResult> {
  const log = emitter(ctx.emit, 'modify');
  const { project } = ctx;
  if (!project.exists()) throw new Error('No generated site found. Clone a website first.');
  const analysis = loadAnalysis(project);
  const manifest = project.readManifest();
  log.info(`Request: “${instruction}”`);

  let planned: { ops: Op[]; usedModel: boolean };
  try {
    planned = await plan(ctx, instruction, manifest);
  } catch (e) {
    log.error((e as Error).message);
    return { ok: false, summary: (e as Error).message, ops: [], usedModel: false };
  }
  const { ops, usedModel } = planned;
  log.info(`Plan (${usedModel ? 'model' : 'rules, no tokens used'}): ${ops.map((o) => o.op + ('target' in o ? `(${o.target})` : '')).join(', ')}`, { ops });

  const snap = project.snapshot();
  const summaries: string[] = [];
  try {
    for (const op of ops) summaries.push(await execute(ctx, op, analysis));
    const v = await validateAndRepair({ project, llm: ctx.llm, emit: ctx.emit, analysis, previewUrl: ctx.previewUrl, browser: ctx.browser });
    if (!v.ok) throw new Error(`The change did not pass validation: ${v.issues[0]?.message.slice(0, 200) ?? 'unknown error'}`);
  } catch (e) {
    project.restore(snap);
    project.dropSnapshot(snap);
    log.error(`${(e as Error).message} — change rolled back, your site is unchanged.`);
    return { ok: false, summary: (e as Error).message, ops, usedModel };
  }
  const m = project.readManifest();
  const summary = summaries.join('; ');
  m.history.push({ at: new Date().toISOString(), prompt: instruction, summary });
  project.writeManifest(m);
  log.ok(summary);
  return { ok: true, summary, ops, usedModel };
}

export function undoLast(project: Project, emit: Emit): boolean {
  const last = project.snapshots().at(-1);
  if (last === undefined) {
    emitter(emit, 'modify').warn('Nothing to undo');
    return false;
  }
  project.restore(last);
  project.dropSnapshot(last);
  emitter(emit, 'modify').ok('Restored the previous version');
  return true;
}
