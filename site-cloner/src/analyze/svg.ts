import * as cheerio from 'cheerio';

const KEEP = new Set(['svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'defs', 'clippath', 'mask', 'lineargradient', 'radialgradient', 'stop', 'use', 'symbol']);
const CAMEL: Record<string, string> = { clippath: 'clipPath', lineargradient: 'linearGradient', radialgradient: 'radialGradient' };

function attrName(n: string): string | null {
  if (n === 'class') return 'className';
  if (n === 'style' || n.startsWith('xmlns') || n === 'xml:space' || n.startsWith('on')) return null;
  if (n === 'xlink:href') return 'xlinkHref';
  if (n.startsWith('data-') || n.startsWith('aria-')) return n;
  return n.replace(/[-:]([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Convert raw SVG markup to a JSX fragment string. Returns null if it cannot be represented safely. */
export function svgToJsx(markup: string): string | null {
  if (!markup || markup.length > 12000) return null;
  const $ = cheerio.load(markup, { xmlMode: true });
  const root = $('svg').first();
  if (!root.length) return null;
  const render = (el: any, isRoot: boolean): string => {
    const tag = (el.tagName as string).toLowerCase();
    if (!KEEP.has(tag)) return '';
    const attrs = Object.entries(el.attribs as Record<string, string>)
      .map(([k, v]) => {
        const name = attrName(k);
        if (!name) return '';
        if (isRoot && (name === 'width' || name === 'height')) return '';
        return `${name}=${JSON.stringify(v)}`;
      })
      .filter(Boolean);
    const kids = (el.children as any[]).map((c) => (c.type === 'tag' ? render(c, false) : '')).join('');
    const name = CAMEL[tag] ?? tag;
    return `<${name}${attrs.length ? ' ' + attrs.join(' ') : ''}${isRoot ? ' {...props}' : ''}${kids ? `>${kids}</${name}>` : ' />'}`;
  };
  return render(root.get(0), true);
}

/** Build src/icons.tsx. `refs` maps svg index -> component name (IconN). Indices without valid JSX are skipped. */
export function buildIconsModule(svgs: string[]): { source: string; available: Set<number> } {
  const available = new Set<number>();
  const defs: string[] = [];
  svgs.forEach((m, i) => {
    const jsx = svgToJsx(m);
    if (!jsx) return;
    available.add(i);
    defs.push(`export const Icon${i} = (props: SVGProps<SVGSVGElement>) => (\n  ${jsx}\n);\n`);
  });
  const source = `import type { SVGProps } from 'react';\n\n// Inline SVGs captured from the source site, converted to React components.\n${defs.join('\n') || 'export {};\n'}`;
  return { source, available };
}

/** Last-resort icons module: every IconN renders an empty box so dependants still compile. */
export function buildSafeIconsModule(count: number): string {
  const defs = Array.from({ length: count }, (_, i) => `export const Icon${i} = (props: SVGProps<SVGSVGElement>) => <svg viewBox="0 0 24 24" {...props} />;`);
  return `import type { SVGProps } from 'react';\n\n${defs.join('\n') || 'export {};'}\n`;
}
