import { replaceColors } from '../util/color';
import type { TNode } from '../analyze/types';
import { isNode } from '../analyze/tree';

const kv = (o?: Record<string, string>) =>
  o ? Object.entries(o).map(([k, v]) => `${k}:${v}`).join(';') : '';

function cloneTree(n: TNode): TNode {
  return { ...n, c: n.c?.map((c) => (isNode(c) ? cloneTree(c) : c)) };
}

function collapseRepeats(n: TNode, keep = 3) {
  const kids = n.c ?? [];
  const elems = kids.filter(isNode);
  if (elems.length > 5) {
    const counts: Record<string, number> = {};
    elems.forEach((e) => (counts[e.t] = (counts[e.t] ?? 0) + 1));
    const [tag, cnt] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (cnt >= 5) {
      let seen = 0, omitted = 0;
      const next: (TNode | string)[] = [];
      for (const k of kids) {
        if (isNode(k) && k.t === tag) {
          if (++seen > keep) { omitted++; continue; }
        }
        next.push(k);
      }
      next.push({ t: '!', c: [`${omitted} more <${tag}> siblings with the same structure omitted`] });
      n.c = next;
    }
  }
  for (const c of n.c ?? []) if (isNode(c)) collapseRepeats(c, keep);
}

function truncate(n: TNode, maxText: number, maxDepth: number, depth = 0) {
  if (!n.c) return;
  if (depth >= maxDepth) {
    const flat: string[] = [];
    const rec = (x: TNode | string) => (typeof x === 'string' ? flat.push(x) : x.c?.forEach(rec));
    n.c.forEach(rec);
    n.c = flat.length ? [flat.join(' ').trim().slice(0, maxText)] : undefined;
    return;
  }
  n.c = n.c.map((c) => (isNode(c) ? (truncate(c, maxText, maxDepth, depth + 1), c) : c.length > maxText ? c.slice(0, maxText) + '…' : c));
}

function render(n: TNode, indent: number, withMobile: boolean, colorMap: Record<string, string>): string {
  const pad = ' '.repeat(indent);
  if (n.t === '!') return `${pad}<!-- ${n.c?.[0]} -->`;
  const name = n.t === 'svg' ? `Icon${n.ref}` : n.t;
  const attrs = Object.entries(n.a ?? {}).map(([k, v]) => `${k}="${v}"`).join(' ');
  const s = n.s && Object.keys(n.s).length ? ` s="${replaceColors(kv(n.s), colorMap)}"` : '';
  const m = withMobile && n.m && Object.keys(n.m).length ? ` m="${replaceColors(kv(n.m), colorMap)}"` : '';
  const open = `<${name}${attrs ? ' ' + attrs : ''}${s}${m}`;
  const kids = n.c ?? [];
  if (!kids.length) return `${pad}${open}/>`;
  if (kids.every((k) => typeof k === 'string')) return `${pad}${open}>${(kids as string[]).join('')}</${name}>`;
  const body = kids.map((k) => (isNode(k) ? render(k, indent + 1, withMobile, colorMap) : `${pad} ${k.trim()}`)).join('\n');
  return `${pad}${open}>\n${body}\n${pad}</${name}>`;
}

export interface Skeleton {
  text: string;
  /** 0 = lossless, 1 = text shortened, 2 = repeated siblings collapsed, 3 = deep nesting flattened */
  level: number;
}

/** Serialise a section tree as annotated pseudo-HTML that fits in `budget` characters, degrading gracefully. */
export function skeleton(tree: TNode, budget: number, colorMap: Record<string, string> = {}): Skeleton {
  for (let level = 0; level <= 3; level++) {
    const t = cloneTree(tree);
    if (level >= 1) truncate(t, level >= 3 ? 70 : 150, level >= 3 ? 8 : 99);
    if (level >= 2) collapseRepeats(t, level >= 3 ? 2 : 3);
    const text = render(t, 0, true, colorMap);
    if (text.length <= budget || level === 3) {
      return { text: text.length > budget ? text.slice(0, budget) + '\n<!-- truncated -->' : text, level };
    }
  }
  /* unreachable */
  return { text: '', level: 3 };
}
