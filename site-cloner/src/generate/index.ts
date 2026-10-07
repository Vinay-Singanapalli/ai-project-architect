import type { SiteAnalysis } from '../analyze/types';
import { countNodes } from '../analyze/tree';
import { emitter, type Emit } from '../util/events';
import type { LLM } from '../ollama';
import { type ManifestEntry, type Manifest, type Project, sectionOf } from '../project';
import { treeToComponent } from './fallback';
import { generateSectionWithLLM } from './section';
import { scaffold } from './scaffold';

export type GenerateMode = 'hybrid' | 'deterministic';

export interface GenerateOptions {
  mode?: GenerateMode;
}

/** Scaffold the project and write one component per detected section. */
export async function generateSite(
  project: Project,
  analysis: SiteAnalysis,
  llm: LLM | null,
  emit: Emit,
  opts: GenerateOptions = {},
): Promise<Manifest> {
  const log = emitter(emit, 'generate');
  scaffold(project, analysis);
  const entries: ManifestEntry[] = [];
  const total = analysis.sections.length;

  for (let i = 0; i < total; i++) {
    const spec = analysis.sections[i];
    const entry = sectionOf(spec);
    const nodes = countNodes(spec.tree, () => true);
    const useLLM = !!llm && opts.mode !== 'deterministic' && nodes > 3;
    let done = false;

    if (useLLM) {
      log.info(`(${i + 1}/${total}) Writing ${spec.name} with ${llm!.models.code}…`, { index: i, total, name: spec.name, source: 'llm' });
      try {
        const res = await generateSectionWithLLM(llm!, spec, analysis.tokens);
        if ('component' in res) {
          project.writeSection(spec.name, res.component.tsx, res.component.css);
          entry.source = 'llm';
          done = true;
          log.ok(`${spec.name} generated${res.attempts > 1 ? ' (2nd attempt)' : ''}${res.skeletonLevel ? ' from a condensed skeleton' : ''}`, { name: spec.name });
        } else {
          log.warn(`${spec.name}: model output rejected (${res.error.slice(0, 120)}); using deterministic renderer`);
        }
      } catch (e) {
        log.warn(`${spec.name}: ${(e as Error).message.split('\n')[0]}; using deterministic renderer`);
        if (/Cannot reach Ollama|not found/.test((e as Error).message)) throw e;
      }
    }
    if (!done) {
      const c = treeToComponent(spec, analysis.tokens);
      project.writeSection(spec.name, c.tsx, c.css);
      entry.source = 'fallback';
      if (!useLLM) log.info(`(${i + 1}/${total}) ${spec.name} built deterministically`, { index: i, total, name: spec.name, source: 'fallback' });
    }
    entries.push(entry);
  }

  const manifest: Manifest = { url: analysis.url, title: analysis.title, sections: entries, history: [] };
  project.writeManifest(manifest);
  return manifest;
}
