import ts from 'typescript';
import { replaceColors } from '../util/color';
import { extractFence } from '../util/text';

export interface Component {
  tsx: string;
  css: string;
}

const ALLOWED_IMPORT = (name: string) => (spec: string) =>
  spec === 'react' || spec === `./${name}.css` || spec === '../icons' || spec === '../lib/placeholder';

/** Pull the tsx + css blocks out of a model reply. */
export function parseComponentReply(reply: string): Component | null {
  const tsx = extractFence(reply, ['tsx', 'jsx', 'typescript', 'ts', 'javascript', 'js']);
  const css = extractFence(reply, ['css']);
  if (!tsx || !css) return null;
  return { tsx, css };
}

/** Cheap, in-process sanity checks (syntax, imports, balance) before we spend time on the full build. */
export function sanityCheck(name: string, c: Component): string[] {
  const problems: string[] = [];
  if (!/export\s+default/.test(c.tsx)) problems.push('Missing "export default" component.');
  if (/dangerouslySetInnerHTML/.test(c.tsx)) problems.push('dangerouslySetInnerHTML is not allowed.');
  const out = ts.transpileModule(c.tsx, {
    fileName: `${name}.tsx`,
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  });
  for (const d of out.diagnostics ?? []) {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ');
    const line = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0;
    problems.push(`Syntax error${line ? ` on line ${line}` : ''}: ${msg}`);
  }
  const ok = ALLOWED_IMPORT(name);
  for (const m of c.tsx.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) {
    if (!ok(m[1])) problems.push(`Import "${m[1]}" is not allowed (only react, ./${name}.css, ../icons, ../lib/placeholder).`);
  }
  const open = (c.css.match(/\{/g) ?? []).length;
  const close = (c.css.match(/\}/g) ?? []).length;
  if (open !== close) problems.push(`CSS braces are unbalanced ({ ${open} vs } ${close}).`);
  if (!c.css.trim()) problems.push('CSS is empty.');
  return problems;
}

/** Make sure the component imports its stylesheet, and wire literal colours to the theme variables. */
export function normalizeComponent(name: string, c: Component, colorMap: Record<string, string>): Component {
  let tsx = c.tsx;
  if (!tsx.includes(`./${name}.css`)) tsx = `import './${name}.css';\n${tsx}`;
  const css = replaceColors(c.css, colorMap)
    // drop global resets the model sometimes adds; they would leak into other sections
    .replace(/(^|\})\s*(?:\*|html|body)\s*(?:,\s*(?:\*|html|body)\s*)*\{[^}]*\}/g, '$1');
  return { tsx, css };
}
