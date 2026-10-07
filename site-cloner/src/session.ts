import type { Browser } from 'playwright';
import { launchBrowser } from './analyze/browser';
import { modifySite, undoLast } from './modify/agent';
import { cloneSite, projectFor } from './pipeline';
import { createOllama, type LLM } from './ollama';
import { startPreview } from './preview';
import type { Project } from './project';
import type { Emit } from './util/events';

/** Holds the long-lived pieces (model client, browser) shared by the web UI and CLI. */
export class Session {
  llm: LLM | null = null;
  llmError: string | null = null;
  private browser: Browser | null | undefined;
  current?: { project: Project; slug: string; previewUrl: string };
  busy = false;

  async init(overrides: { code?: string; fast?: string } = {}) {
    try {
      this.llm = await createOllama(overrides);
      this.llmError = null;
    } catch (e) {
      this.llm = null;
      this.llmError = (e as Error).message;
    }
    return this.llm;
  }

  async getBrowser(): Promise<Browser | null> {
    if (this.browser === undefined) {
      try {
        this.browser = await launchBrowser();
      } catch {
        this.browser = null;
      }
    }
    return this.browser;
  }

  async clone(url: string, emit: Emit, opts: { mode?: 'hybrid' | 'deterministic'; forceStatic?: boolean } = {}) {
    if (this.busy) throw new Error('Another job is already running.');
    this.busy = true;
    try {
      const r = await cloneSite({ url, emit, llm: this.llm, mode: this.llm ? opts.mode : 'deterministic', forceStatic: opts.forceStatic });
      this.current = { project: r.project, slug: r.slug, previewUrl: r.previewUrl };
      return r;
    } finally {
      this.busy = false;
    }
  }

  async open(slug: string) {
    const project = projectFor(slug);
    if (!project.exists()) throw new Error(`No generated site "${slug}"`);
    const previewUrl = await startPreview(project.dir);
    this.current = { project, slug, previewUrl };
    return this.current;
  }

  async modify(prompt: string, emit: Emit) {
    if (!this.current) throw new Error('Clone or open a site first.');
    if (this.busy) throw new Error('Another job is already running.');
    this.busy = true;
    try {
      return await modifySite({ project: this.current.project, llm: this.llm, emit, previewUrl: this.current.previewUrl, browser: await this.getBrowser() }, prompt);
    } finally {
      this.busy = false;
    }
  }

  undo(emit: Emit) {
    if (!this.current) throw new Error('Clone or open a site first.');
    return undoLast(this.current.project, emit);
  }

  async close() {
    await this.browser?.close();
  }
}
