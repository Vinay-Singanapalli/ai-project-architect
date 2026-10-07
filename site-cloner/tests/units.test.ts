import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseColor, replaceColors, contrastText } from '../src/util/color';
import { extractFence, extractJson, stripThink } from '../src/util/text';
import { pickModel } from '../src/ollama';
import { svgToJsx } from '../src/analyze/svg';
import { parseComponentReply, sanityCheck, normalizeComponent } from '../src/generate/check';
import { skeleton } from '../src/generate/skeleton';
import { ruleBasedPlan } from '../src/modify/intents';
import { resolveStrict } from '../src/modify/resolve';
import type { Manifest } from '../src/project';
import type { TNode } from '../src/analyze/types';

const manifest: Manifest = {
  url: 'x', title: 'x', history: [],
  sections: [
    { id: 'navbar', name: 'Navbar', label: 'Navbar', type: 'navbar', source: 'llm' },
    { id: 'hero', name: 'Hero', label: 'Hero – Ship faster', type: 'hero', source: 'llm' },
    { id: 'pricing', name: 'Pricing', label: 'Pricing – Simple pricing', type: 'pricing', source: 'llm' },
    { id: 'footer', name: 'Footer', label: 'Footer', type: 'footer', source: 'llm' },
  ],
};

test('colors: parse names, hex, rgb; rewrite literals to theme vars', () => {
  assert.equal(parseColor('blue'), '#2563eb');
  assert.equal(parseColor('#ABC'), '#aabbcc');
  assert.equal(parseColor('rgb(79, 70, 229)'), '#4f46e5');
  assert.equal(parseColor('rgba(0,0,0,.5)'), null);
  assert.equal(replaceColors('a{color:rgb(79,70,229);b:#4F46E5;c:#000}', { '#4f46e5': 'var(--p)' }), 'a{color:var(--p);b:var(--p);c:#000}');
  assert.equal(contrastText('#ffffff'), '#111827');
  assert.equal(contrastText('#111827'), '#ffffff');
});

test('text helpers: fences, json repair, think-stripping', () => {
  assert.equal(extractFence('x\n```tsx\nA\n```\n```css\nB\n```', ['css']), 'B\n');
  assert.equal(extractFence('```tsx\ncut off', ['tsx']), 'cut off\n');
  assert.deepEqual(extractJson('sure!\n```json\n{"a":1,}\n```'), { a: 1 });
  assert.equal(stripThink('<think>hmm</think>ok'), 'ok');
});

test('model picker prefers coder models for code, skips embedding/vision models', () => {
  const installed = ['nomic-embed-text:latest', 'llava:7b', 'llama3.2:3b', 'qwen2.5-coder:7b', 'mistral:7b'];
  assert.equal(pickModel(installed, undefined, 'code'), 'qwen2.5-coder:7b');
  assert.equal(pickModel(installed, undefined, 'fast'), 'llama3.2:3b');
  assert.throws(() => pickModel(installed, 'missing:1b', 'code'), /ollama pull missing:1b/);
  assert.throws(() => pickModel(['nomic-embed-text'], undefined, 'code'), /No chat model/);
});

test('svg → JSX converts attributes and strips unsafe ones', () => {
  const jsx = svgToJsx('<svg width="24" height="24" class="a" onclick="x()" viewBox="0 0 24 24"><path stroke-width="2" d="M0 0"/></svg>')!;
  assert.match(jsx, /<svg className="a" viewBox="0 0 24 24" \{\.\.\.props\}/);
  assert.match(jsx, /strokeWidth="2"/);
  assert.doesNotMatch(jsx, /onclick|width="24"/);
});

test('sanity check catches syntax errors, bad imports and unbalanced CSS', () => {
  const good = parseComponentReply('```tsx\nimport \'./A.css\';\nexport default function A(){return <div/>}\n```\n```css\n.a{}\n```')!;
  assert.deepEqual(sanityCheck('A', good), []);
  assert.ok(sanityCheck('A', { tsx: 'export default function A(){return <div>}', css: '.a{}' }).some((p) => /Syntax/.test(p)));
  assert.ok(sanityCheck('A', { tsx: 'import x from "lodash";\nexport default function A(){return <div/>}', css: '.a{}' }).some((p) => /not allowed/.test(p)));
  assert.ok(sanityCheck('A', { tsx: good.tsx, css: '.a{' }).some((p) => /unbalanced/.test(p)));
  const n = normalizeComponent('A', { tsx: 'export default function A(){return null}', css: 'body{margin:0}\n.a{color:#4f46e5}' }, { '#4f46e5': 'var(--color-primary)' });
  assert.match(n.tsx, /import '\.\/A\.css'/);
  assert.doesNotMatch(n.css, /body/);
  assert.match(n.css, /var\(--color-primary\)/);
});

test('skeleton stays within budget and collapses repeats', () => {
  const card = (i: number): TNode => ({ t: 'li', s: { padding: '8px' }, c: [{ t: 'h3', c: [`Item ${i}`] }, { t: 'p', c: ['x'.repeat(300)] }] });
  const tree: TNode = { t: 'ul', c: Array.from({ length: 30 }, (_, i) => card(i)) };
  const sk = skeleton(tree, 2000);
  assert.ok(sk.text.length <= 2100);
  assert.ok(sk.level >= 1);
  assert.match(sk.text, /omitted|truncated/);
});

test('rule-based planner handles the common requests without a model', () => {
  const plan = (s: string) => ruleBasedPlan(s, manifest);
  assert.deepEqual(plan('Change the primary color to blue'), [{ op: 'set_theme', vars: { '--color-primary': '#2563eb' } }]);
  assert.deepEqual(plan('make the primary colour #ff0066'), [{ op: 'set_theme', vars: { '--color-primary': '#ff0066' } }]);
  assert.deepEqual(plan('Remove the pricing section'), [{ op: 'remove_section', target: 'pricing' }]);
  assert.deepEqual(plan('delete the footer'), [{ op: 'remove_section', target: 'footer' }]);
  const sticky = plan('Make the navbar sticky')!;
  assert.equal(sticky[0].op, 'global_css');
  assert.match((sticky[0] as { css: string }).css, /data-section="navbar"[^}]*position: sticky/);
  assert.deepEqual(plan('move the footer to the top'), [{ op: 'move_section', target: 'footer', position: 'start' }]);
  assert.deepEqual(plan('move pricing before hero'), [{ op: 'move_section', target: 'pricing', position: 'before:hero' }]);
  const add = plan('Add a testimonials section')!;
  assert.equal(add[0].op, 'add_section');
  assert.equal((add[0] as { position: string }).position, 'before:footer');
  assert.equal((plan('Replace the hero section with a bakery hero')![0] as { description: string }).description, 'a bakery hero');
  assert.equal(plan('make the hero headline bigger'), null); // needs the model
  assert.equal(plan('remove the carousel section'), null); // unknown target -> model decides
  assert.equal(resolveStrict(manifest, 'navigation bar')?.id, 'navbar');
});
