import fs from 'node:fs';
import path from 'node:path';
import type { SectionSpec, SiteAnalysis } from './analyze/types';
import { ROOT } from './config';

export type SectionSource = 'llm' | 'fallback' | 'ai-edit' | 'ai-added';

export interface ManifestEntry {
  id: string;
  name: string;
  label: string;
  type: string;
  anchor?: string;
  source: SectionSource;
}

export interface Manifest {
  url: string;
  title: string;
  sections: ManifestEntry[];
  history: { at: string; prompt: string; summary: string }[];
}

export class Project {
  constructor(public readonly dir: string) {}

  p(...parts: string[]) {
    return path.join(this.dir, ...parts);
  }
  get src() {
    return this.p('src');
  }
  get manifestPath() {
    return this.p('.cloner', 'manifest.json');
  }
  get analysisPath() {
    return this.p('.cloner', 'analysis', 'analysis.json');
  }
  sectionFile(name: string, ext: 'tsx' | 'css') {
    return this.p('src', 'sections', `${name}.${ext}`);
  }
  rel(abs: string) {
    return path.relative(this.dir, abs).split(path.sep).join('/');
  }
  exists() {
    return fs.existsSync(this.manifestPath);
  }

  readManifest(): Manifest {
    return JSON.parse(fs.readFileSync(this.manifestPath, 'utf8')) as Manifest;
  }
  writeManifest(m: Manifest) {
    fs.mkdirSync(path.dirname(this.manifestPath), { recursive: true });
    fs.writeFileSync(this.manifestPath, JSON.stringify(m, null, 2));
    this.writeSectionsIndex(m);
  }
  readAnalysis(): SiteAnalysis {
    return JSON.parse(fs.readFileSync(this.analysisPath, 'utf8')) as SiteAnalysis;
  }

  read(rel: string): string {
    return fs.readFileSync(this.p(rel), 'utf8');
  }
  write(rel: string, content: string) {
    fs.mkdirSync(path.dirname(this.p(rel)), { recursive: true });
    fs.writeFileSync(this.p(rel), content);
  }

  writeSection(name: string, tsx: string, css: string) {
    this.write(`src/sections/${name}.tsx`, tsx);
    this.write(`src/sections/${name}.css`, css);
  }
  removeSection(name: string) {
    for (const ext of ['tsx', 'css'] as const) fs.rmSync(this.sectionFile(name, ext), { force: true });
  }

  /** src/sections/index.ts is derived from the manifest so adds / removes / reorders never need an LLM. */
  writeSectionsIndex(m: Manifest) {
    const imports = m.sections.map((s) => `import ${s.name} from './${s.name}';`).join('\n');
    const rows = m.sections
      .map((s) => `  { id: ${JSON.stringify(s.id)}, name: ${JSON.stringify(s.name)}, type: ${JSON.stringify(s.type)}, ${s.anchor ? `anchor: ${JSON.stringify(s.anchor)}, ` : ''}Component: ${s.name} },`)
      .join('\n');
    this.write(
      'src/sections/index.ts',
      `import type { ComponentType } from 'react';\n${imports}\n\n// Ordered page layout. Managed by the agent: add / remove / reorder entries to change the page.\nexport const sections: { id: string; name: string; type: string; anchor?: string; Component: ComponentType }[] = [\n${rows}\n];\n`,
    );
  }

  /** Files an editing agent may touch. */
  editableFiles(): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else if (/\.(tsx?|css)$/.test(e.name)) out.push(this.rel(f));
      }
    };
    walk(this.src);
    return out.sort();
  }

  // ---- snapshots (undo / rollback) ----
  private snapDir(n: number) {
    return this.p('.cloner', 'snapshots', String(n));
  }
  snapshots(): number[] {
    const d = this.p('.cloner', 'snapshots');
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
  }
  snapshot(): number {
    const n = (this.snapshots().at(-1) ?? 0) + 1;
    const dest = this.snapDir(n);
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(this.src, path.join(dest, 'src'), { recursive: true });
    fs.copyFileSync(this.manifestPath, path.join(dest, 'manifest.json'));
    // keep the last 20
    for (const old of this.snapshots().slice(0, -20)) fs.rmSync(this.snapDir(old), { recursive: true, force: true });
    return n;
  }
  restore(n: number) {
    const from = this.snapDir(n);
    fs.rmSync(this.src, { recursive: true, force: true });
    fs.cpSync(path.join(from, 'src'), this.src, { recursive: true });
    fs.copyFileSync(path.join(from, 'manifest.json'), this.manifestPath);
  }
  dropSnapshot(n: number) {
    fs.rmSync(this.snapDir(n), { recursive: true, force: true });
  }
}

export const sectionOf = (spec: SectionSpec): ManifestEntry => ({
  id: spec.id, name: spec.name, label: spec.label, type: spec.type, anchor: spec.anchor, source: 'llm',
});

/**
 * Generated sites resolve react / vite / typescript from this repo's node_modules (so cloning needs no per-site
 * `npm install`). When SITES_DIR lives outside the repo, link node_modules in so resolution still works.
 */
export function ensureModules(siteDir: string) {
  const rel = path.relative(ROOT, siteDir);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) return;
  const link = path.join(siteDir, 'node_modules');
  if (fs.existsSync(link)) return;
  fs.mkdirSync(siteDir, { recursive: true });
  fs.symlinkSync(path.join(ROOT, 'node_modules'), link, 'junction');
}
