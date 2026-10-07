import type { SectionType, TNode } from './types';

export const isNode = (c: TNode | string): c is TNode => typeof c !== 'string';

export function walkTree(n: TNode, fn: (n: TNode, depth: number) => void, depth = 0) {
  fn(n, depth);
  for (const c of n.c ?? []) if (isNode(c)) walkTree(c, fn, depth + 1);
}

export function textOf(n: TNode | string, max = 4000): string {
  if (typeof n === 'string') return n;
  const parts: string[] = [];
  const rec = (x: TNode | string) => {
    if (parts.join(' ').length > max) return;
    if (typeof x === 'string') parts.push(x);
    else for (const c of x.c ?? []) rec(c);
  };
  rec(n);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function countNodes(n: TNode, pred: (n: TNode) => boolean): number {
  let k = 0;
  walkTree(n, (x) => { if (pred(x)) k++; });
  return k;
}

/** Remove empty style/attr objects, hoist trivial single-child wrappers. */
export function simplify(n: TNode): TNode {
  const kids = (n.c ?? []).map((c) => (isNode(c) ? simplify(c) : c));
  const out: TNode = { ...n };
  if (!out.s || !Object.keys(out.s).length) delete out.s;
  if (!out.m || !Object.keys(out.m).length) delete out.m;
  if (!out.a || !Object.keys(out.a).length) delete out.a;
  if (kids.length) out.c = kids; else delete out.c;
  // hoist: <div|span> with no style/attrs and exactly one element child and no text
  if ((out.t === 'div' || out.t === 'span') && !out.s && !out.a && !out.m && kids.length === 1 && isNode(kids[0])) return kids[0];
  return out;
}

export function classifySection(
  idx: number,
  total: number,
  tag: string,
  height: number,
  tree: TNode,
  heading: string,
): SectionType {
  const text = textOf(tree).toLowerCase();
  const h = heading.toLowerCase();
  const links = countNodes(tree, (x) => x.t === 'a');
  const buttons = countNodes(tree, (x) => x.t === 'button' || (x.t === 'a' && !!x.s?.['background-color']));
  const imgs = countNodes(tree, (x) => x.t === 'img');
  const h1s = countNodes(tree, (x) => x.t === 'h1');
  const headings = countNodes(tree, (x) => /^h[2-4]$/.test(x.t));

  if ((tag === 'header' || tag === 'nav') && height < 280 && idx <= 1) return 'navbar';
  if (idx === 0 && height < 170 && links >= 3 && h1s === 0) return 'navbar';
  if (tag === 'footer' || (idx >= total - 2 && /©|copyright|all rights reserved|privacy policy/.test(text) && links >= 3)) return 'footer';
  if (h1s > 0 && idx <= 2) return 'hero';
  if (/pricing|plans?\b/.test(h) || (/\$\s?\d+|\/\s?(mo|month|year)/.test(text) && headings >= 2 && /plan|month|year|billed/.test(text))) return 'pricing';
  const quotes = countNodes(tree, (x) => x.t === 'blockquote');
  if (/testimonial|customers? say|clients? say|what people|reviews?|loved by/.test(h) || quotes > 0 || (/[“"”]/.test(text) && /ceo|cto|cfo|coo|founder|manager|director|engineer|customer|head of|vp /.test(text) && headings <= 4)) return 'testimonials';
  if (/faq|frequently asked|questions/.test(h)) return 'faq';
  if (/contact|get in touch|reach us|talk to/.test(h) && countNodes(tree, (x) => x.t === 'input' || x.t === 'textarea') > 0) return 'contact';
  const numbers = (textOf(tree).match(/(?:^|\s)[\d.,]+\s?(?:[kKmMbB]|%|\+)(?=\s|$)/g) ?? []).length;
  if (numbers >= 3 && text.length < 600) return 'stats';
  if (imgs >= 4 && text.length < 160) return 'logos';
  if (imgs >= 6) return 'gallery';
  if (text.length < 320 && buttons >= 1 && headings + h1s <= 2 && imgs <= 1 && idx > 0) return 'cta';
  if (headings >= 3) return 'features';
  return 'content';
}
