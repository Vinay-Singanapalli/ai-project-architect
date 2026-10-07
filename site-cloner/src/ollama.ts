import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { sha, stripThink } from './util/text';

export interface ChatOptions {
  model: string;
  system: string;
  user: string;
  json?: boolean;
  temperature?: number;
  numPredict?: number;
  /** Called with the running count of generated tokens (for progress UIs). */
  onProgress?: (tokens: number) => void;
  /** Disable the on-disk response cache for this call. */
  noCache?: boolean;
}

export interface LLMStats {
  calls: number;
  cacheHits: number;
  promptTokens: number;
  outputTokens: number;
  seconds: number;
}

export interface LLM {
  chat(o: ChatOptions): Promise<string>;
  stats: LLMStats;
  models: { code: string; fast: string };
}

export class OllamaError extends Error {}

export async function listModels(host = config.ollamaHost): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(5000) });
  } catch {
    throw new OllamaError(
      `Cannot reach Ollama at ${host}. Start it with "ollama serve" (or open the Ollama app) and try again.`,
    );
  }
  if (!res.ok) throw new OllamaError(`Ollama responded with HTTP ${res.status} at ${host}/api/tags`);
  const json = (await res.json()) as { models?: { name: string }[] };
  return (json.models ?? []).map((m) => m.name);
}

const NOT_CHAT = /embed|bge|nomic|minilm|rerank|llava|vision|minicpm-v|moondream|-vl\b|\bvl\b|whisper/i;

function sizeB(name: string): number | null {
  const m = /(\d+(?:\.\d+)?)b\b/i.exec(name);
  return m ? parseFloat(m[1]) : null;
}

/** Choose a model for a role from the installed list, honouring an explicit request when given. */
export function pickModel(installed: string[], want: string | undefined, role: 'code' | 'fast'): string {
  if (want) {
    const hit = installed.find((n) => n === want) ?? installed.find((n) => n.split(':')[0] === want.split(':')[0] && !want.includes(':'));
    if (!hit) {
      throw new OllamaError(
        `Model "${want}" is not installed. Run: ollama pull ${want}\nInstalled: ${installed.join(', ') || '(none)'}`,
      );
    }
    return hit;
  }
  const chat = installed.filter((n) => !NOT_CHAT.test(n));
  if (!chat.length) {
    throw new OllamaError('No chat model found in Ollama. Run: ollama pull qwen2.5-coder:7b');
  }
  const score = (n: string): number => {
    const size = sizeB(n);
    let s = 0;
    if (role === 'code') {
      if (/coder|codestral|codellama|starcoder/i.test(n)) s += 100;
      if (/qwen|deepseek|llama3|gemma|mistral|phi/i.test(n)) s += 20;
      if (size !== null) s += size >= 3 && size <= 16 ? 10 + size : size > 16 ? 12 : size;
    } else {
      // Fast model: smaller is better, but not tiny.
      if (size !== null) s += size >= 1.5 ? 40 - Math.min(size, 30) : 5;
      if (/qwen|llama3|gemma|phi/i.test(n)) s += 10;
    }
    return s;
  };
  return [...chat].sort((a, b) => score(b) - score(a))[0];
}

interface StreamChunk {
  message?: { content?: string };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

export async function createOllama(overrides: { code?: string; fast?: string } = {}): Promise<LLM> {
  const installed = await listModels();
  const code = pickModel(installed, overrides.code ?? config.codeModel, 'code');
  const fast = pickModel(installed, overrides.fast ?? config.fastModel, 'fast');
  return createLLM({ code, fast });
}

export function createLLM(models: { code: string; fast: string }, host = config.ollamaHost): LLM {
  const stats: LLMStats = { calls: 0, cacheHits: 0, promptTokens: 0, outputTokens: 0, seconds: 0 };
  const cacheDir = path.join(config.cacheDir, 'llm');

  async function once(o: ChatOptions): Promise<string> {
    const ctrl = new AbortController();
    let idle: NodeJS.Timeout;
    // Model loading can take a while before the first token; after that tokens should flow steadily.
    const arm = (ms: number) => {
      clearTimeout(idle);
      idle = setTimeout(() => ctrl.abort(), ms);
    };
    arm(300_000);
    try {
      const res = await fetch(`${host}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: o.model,
          stream: true,
          keep_alive: '30m',
          format: o.json ? 'json' : undefined,
          messages: [
            { role: 'system', content: o.system },
            { role: 'user', content: o.user },
          ],
          options: {
            temperature: o.temperature ?? 0.2,
            num_ctx: config.numCtx,
            num_predict: o.numPredict ?? config.maxOutputTokens,
          },
        }),
      });
      if (res.status === 404) throw new OllamaError(`Model "${o.model}" not found. Run: ollama pull ${o.model}`);
      if (!res.ok || !res.body) throw new OllamaError(`Ollama HTTP ${res.status}: ${await res.text().catch(() => '')}`);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let out = '';
      let tokens = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        arm(90_000);
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const chunk = JSON.parse(line) as StreamChunk;
          if (chunk.error) throw new OllamaError(chunk.error);
          if (chunk.message?.content) {
            out += chunk.message.content;
            tokens++;
            if (tokens % 20 === 0) o.onProgress?.(tokens);
          }
          if (chunk.done) {
            stats.promptTokens += chunk.prompt_eval_count ?? 0;
            stats.outputTokens += chunk.eval_count ?? tokens;
          }
        }
      }
      return out;
    } finally {
      clearTimeout(idle!);
    }
  }

  return {
    stats,
    models,
    async chat(o) {
      const temp = o.temperature ?? 0.2;
      const cacheable = !o.noCache && temp <= 0.2;
      const key = sha(JSON.stringify([o.model, o.system, o.user, !!o.json, temp, o.numPredict ?? 0, config.numCtx]), 32);
      const file = path.join(cacheDir, `${key}.txt`);
      if (cacheable && fs.existsSync(file)) {
        stats.cacheHits++;
        return fs.readFileSync(file, 'utf8');
      }
      const started = Date.now();
      let lastErr: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          stats.calls++;
          const text = stripThink(await once(o));
          stats.seconds += (Date.now() - started) / 1000;
          if (cacheable && text) {
            fs.mkdirSync(cacheDir, { recursive: true });
            fs.writeFileSync(file, text);
          }
          return text;
        } catch (err) {
          lastErr = err;
          if (err instanceof OllamaError) throw err;
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
      throw new OllamaError(`Ollama request failed after retries: ${(lastErr as Error)?.message ?? lastErr}`);
    },
  };
}
