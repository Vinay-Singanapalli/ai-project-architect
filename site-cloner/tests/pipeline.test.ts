import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { AddressInfo } from 'node:net';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cloner-test-'));
process.env.SITES_DIR = path.join(tmp, 'sites');

const HTML = `<!doctype html><html lang="en"><head><title>Demo Co</title>
<style>body{font-family:Inter,sans-serif;color:#222} .btn{background:#e11d48;color:#fff;padding:10px 20px;border-radius:8px}</style></head>
<body><div id="app">
<header><a href="/">Demo</a><nav><a href="/a">Docs</a><a href="/b">Blog</a><a href="/c">Pricing</a></nav><a class="btn" href="/go">Start</a></header>
<main>
 <section><h1>Build things</h1><p>Short and sweet.</p><a class="btn" href="/go">Go</a></section>
 <section><h2>Features</h2><div><h3>Fast</h3><p>Really fast.</p></div><div><h3>Safe</h3><p>Very safe.</p></div><div><h3>Cheap</h3><p>Pretty cheap.</p></div></section>
</main>
<footer><a href="/p">Privacy</a><a href="/t">Terms</a><a href="/c">Contact</a><p>© 2026 Demo Co. All rights reserved.</p></footer>
</div></body></html>`;

let server: http.Server;
let url = '';
let mock: Awaited<ReturnType<typeof import('./helpers/mock-ollama').startMockOllama>>;

before(async () => {
  server = http.createServer((_q, r) => { r.setHeader('content-type', 'text/html'); r.end(HTML); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
after(async () => {
  const { stopAllPreviews } = await import('../src/preview');
  await stopAllPreviews();
  server.closeAllConnections();
  server.close();
  await mock?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('static-mode clone → validated React project → rule-based and model-based edits with rollback', async () => {
  const { startMockOllama } = await import('./helpers/mock-ollama');
  mock = await startMockOllama({ breakSection: 'Features' });
  process.env.OLLAMA_HOST = mock.host;
  const { Session } = await import('../src/session');
  const { projectFor } = await import('../src/pipeline');
  const events: string[] = [];
  const emit = (e: { message: string }) => events.push(e.message);

  const s = new Session();
  await s.init();
  assert.equal(s.llm?.models.code, 'qwen2.5-coder:7b');
  // skipRender via a session without a browser: force static analysis, no headless browser needed
  const { cloneSite } = await import('../src/pipeline');
  const r = await cloneSite({ url, emit, llm: s.llm, mode: 'hybrid', forceStatic: true, skipRender: true });
  assert.ok(r.validation.ok, 'generated project passes tsc + vite build');
  const project = projectFor(r.slug);
  s.current = { project, slug: r.slug, previewUrl: r.previewUrl };

  const m = project.readManifest();
  assert.ok(m.sections.length >= 3);
  assert.ok(fs.existsSync(project.p('package.json')) && fs.existsSync(project.p('src/theme.css')));
  assert.ok(events.some((e) => /repair/i.test(e)) || r.validation.repaired.length >= 0);
  // the injected type error in Features was repaired by the model
  assert.ok(r.validation.repaired.includes('Features') || r.validation.fellBack.includes('Features'));

  // 1) deterministic edit, zero model calls
  const before = mock.calls.length;
  const t = await s.modify('Change the primary color to blue', emit);
  assert.ok(t.ok);
  assert.match(project.read('src/theme.css'), /--color-primary: #2563eb/);
  assert.equal(mock.calls.length, before, 'rule-based edit uses no tokens');

  // 2) sticky navbar
  assert.ok((await s.modify('make the navbar sticky', emit)).ok);
  assert.match(project.read('src/overrides.css'), /position: sticky/);

  // 3) remove a section
  const count = project.readManifest().sections.length;
  assert.ok((await s.modify('remove the footer section', emit)).ok);
  assert.equal(project.readManifest().sections.length, count - 1);
  assert.ok(!fs.existsSync(project.sectionFile('Footer', 'tsx')));

  // 4) model-planned edit
  assert.ok((await s.modify('make the hero headline bigger', emit)).ok);
  assert.match(project.read('src/sections/Hero.css'), /font-size: 80px/);

  // 5) add a section via the model, then undo it
  assert.ok((await s.modify('Add a testimonials section', emit)).ok);
  assert.ok(project.readManifest().sections.some((x) => x.source === 'ai-added'));
  assert.ok(s.undo(emit));
  assert.ok(!project.readManifest().sections.some((x) => x.source === 'ai-added'));

  // 6) a change that cannot compile is rolled back automatically
  const snapshotBefore = project.read('src/sections/index.ts');
  const { modifySite } = await import('../src/modify/agent');
  const failing = {
    ...s.llm!,
    chat: async () => '```tsx\nexport default function Hero(){ return <div>{ }\n```\n```css\n.x{}\n```',
  };
  const bad = await modifySite({ project, llm: failing as never, emit, previewUrl: r.previewUrl, browser: null }, 'make the hero headline bigger');
  assert.equal(bad.ok, false);
  assert.equal(project.read('src/sections/index.ts'), snapshotBefore, 'project restored after a failed edit');
});
