import { createHash } from 'node:crypto';

export const sha = (s: string, n = 16) => createHash('sha256').update(s).digest('hex').slice(0, n);

export function stripThink(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, (m) => (m.includes('<think>') ? '' : m)).trim();
}

/** Returns the body of the first fenced block whose info string starts with one of `langs`. */
export function extractFence(text: string, langs: string[]): string | null {
  const re = /```([a-zA-Z0-9_+-]*)[^\n]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (langs.includes(m[1].toLowerCase())) return m[2].trimEnd() + '\n';
  }
  // Unterminated final fence (model hit the token limit): take what is there.
  const open = new RegExp('```(' + langs.join('|') + ')[^\\n]*\\n([\\s\\S]*)$', 'i').exec(text);
  return open ? open[2].trimEnd() + '\n' : null;
}

export function extractJson<T = unknown>(text: string): T | null {
  const t = stripThink(text);
  const fenced = extractFence(t, ['json']);
  const candidate = fenced ?? t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1);
  if (!candidate) return null;
  for (const c of [candidate, candidate.replace(/,\s*([}\]])/g, '$1')]) {
    try {
      return JSON.parse(c) as T;
    } catch {
      /* try next repair */
    }
  }
  return null;
}

export const slugify = (s: string) =>
  s.toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'site';

export function pascal(s: string, fallback = 'Section'): string {
  const words = s.replace(/[^A-Za-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean).slice(0, 3);
  const name = words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');
  return /^[A-Za-z]/.test(name) ? name : fallback;
}

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
