import type { DesignTokens, SectionSpec, TNode } from '../analyze/types';
import { isNode } from '../analyze/tree';
import { replaceColors } from '../util/color';
import { themeColorMap } from '../analyze/tokens';

const VOID = new Set(['img', 'input', 'br', 'hr']);
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
const attrVal = (v: string) => (/["\\\n&{}<>]/.test(v) ? `{${JSON.stringify(v)}}` : `"${v}"`);

const ATTR_MAP: Record<string, string> = { 'aria-label': 'aria-label', href: 'href', src: 'src', alt: 'alt', type: 'type', placeholder: 'placeholder', value: 'defaultValue' };

/**
 * Deterministic renderer: turns the captured element tree directly into a React component + CSS.
 * It always compiles, so it is the safety net for the LLM path (and the baseline for visual comparison).
 */
export function treeToComponent(spec: SectionSpec, tokens: DesignTokens): { tsx: string; css: string } {
  const root = kebab(spec.name);
  const rules: string[] = [];
  const media: string[] = [];
  let n = 0;
  const colorMap = themeColorMap(tokens);
  const headFont = tokens.fontHeading.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
  const bodyFont = tokens.fontBody.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
  const icons = new Set<number>();

  const decl = (s: Record<string, string>, node: TNode): string[] => {
    const out: string[] = [];
    for (const [k0, v0] of Object.entries(s)) {
      let k = k0, v = replaceColors(v0, colorMap);
      if (k === 'font-family') {
        const first = v.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
        if (first === headFont && headFont !== bodyFont) v = 'var(--font-heading)';
        else if (first === bodyFont) v = 'var(--font-body)';
      }
      if (node.t === 'img' && k === 'width' && !s['object-fit']) { out.push(`  width: ${v};`, '  max-width: 100%;'); continue; }
      if (node.t === 'img' && k === 'height' && !s['object-fit']) { out.push('  height: auto;'); continue; }
      out.push(`  ${k}: ${v};`);
    }
    return out;
  };

  const jsx = (node: TNode, depth: number, isRoot: boolean): string => {
    const pad = '  '.repeat(depth);
    const cls = isRoot ? root : `${root}__${++n}`;
    const s = node.s ?? {};
    const hasStyle = Object.keys(s).length > 0 || (node.m && Object.keys(node.m).length > 0);
    if (hasStyle || isRoot) {
      const d = decl(s, node);
      if (d.length) rules.push(`.${cls} {\n${d.join('\n')}\n}`);
      if (node.m && Object.keys(node.m).length) {
        media.push(`  .${cls} {\n${Object.entries(node.m).map(([k, v]) => `    ${k}: ${replaceColors(v, colorMap)};`).join('\n')}\n  }`);
      }
    }
    const attrs: string[] = [];
    if (hasStyle || isRoot) attrs.push(`className="${cls}"`);

    if (node.t === 'svg' && node.ref !== undefined) {
      icons.add(node.ref);
      return `${pad}<Icon${node.ref} ${attrs.join(' ')} aria-hidden="true" />`;
    }
    let tag = node.t;
    if (isRoot && !['section', 'header', 'footer', 'nav', 'div', 'aside', 'article', 'main'].includes(tag)) tag = 'section';
    if (tag === 'main') tag = 'div';
    for (const [k, v] of Object.entries(node.a ?? {})) {
      if (k === 'id') continue;
      const name = ATTR_MAP[k];
      if (!name) continue;
      attrs.push(`${name}=${attrVal(v)}`);
    }
    if (tag === 'button' && !node.a?.type) attrs.push('type="button"');
    if (tag === 'form') attrs.push('onSubmit={(e) => e.preventDefault()}');
    if (tag === 'a' && /^https?:/.test(node.a?.href ?? '')) attrs.push('rel="noreferrer"');
    const open = `${pad}<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}`;
    if (VOID.has(tag) || !(node.c && node.c.length)) {
      return VOID.has(tag) ? `${open} />` : `${open}></${tag}>`;
    }
    const kids = node.c;
    const parts = kids.map((k, i) => {
      if (isNode(k)) return jsx(k, depth + 1, false);
      const t = k.replace(/\s+/g, ' ');
      const lead = t.startsWith(' ') && i > 0 ? `{' '}` : '';
      const trail = t.endsWith(' ') && i < kids.length - 1 ? `{' '}` : '';
      return `${pad}  ${lead}${escText(t.trim())}${trail}`;
    });
    return `${open}>\n${parts.join('\n')}\n${pad}</${tag}>`;
  };

  const body = jsx(spec.tree, 2, true);
  const iconList = [...icons].sort((a, b) => a - b).map((i) => `Icon${i}`);
  const imports = [`import './${spec.name}.css';`, iconList.length ? `import { ${iconList.join(', ')} } from '../icons';` : ''].filter(Boolean).join('\n');
  const tsx = `${imports}\n\nexport default function ${spec.name}() {\n  return (\n${body}\n  );\n}\n`;
  const css = `${rules.join('\n\n')}\n${media.length ? `\n@media (max-width: 768px) {\n${media.join('\n')}\n}\n` : ''}`;
  return { tsx, css };
}
