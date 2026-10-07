import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config, ROOT } from './config';
import { stopAllPreviews } from './preview';
import { Session } from './session';
import type { AgentEvent } from './util/events';

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(ROOT, 'ui')));

const session = new Session();
const clients = new Set<express.Response>();
const buffer: { id: number; e: AgentEvent }[] = [];
let seq = 0;

function emit(e: AgentEvent) {
  const item = { id: ++seq, e };
  buffer.push(item);
  if (buffer.length > 400) buffer.shift();
  for (const c of clients) c.write(`id: ${item.id}\ndata: ${JSON.stringify(e)}\n\n`);
  console.log(`[${e.stage}] ${e.message}`);
}

app.get('/api/events', (req, res) => {
  res.set({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.flushHeaders();
  const last = Number(req.header('last-event-id') ?? 0);
  for (const it of buffer) if (it.id > last) res.write(`id: ${it.id}\ndata: ${JSON.stringify(it.e)}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});

function listSites(): string[] {
  if (!fs.existsSync(config.sitesDir)) return [];
  return fs.readdirSync(config.sitesDir).filter((d) => fs.existsSync(path.join(config.sitesDir, d, '.cloner', 'manifest.json')));
}

function siteInfo() {
  const cur = session.current;
  if (!cur) return null;
  const m = cur.project.readManifest();
  return {
    slug: cur.slug,
    url: m.url,
    previewUrl: cur.previewUrl,
    sections: m.sections,
    history: m.history.slice(-10),
    canUndo: cur.project.snapshots().length > 0,
    hasOriginal: fs.existsSync(cur.project.p('.cloner', 'analysis', 'desktop.png')),
    dir: cur.project.dir,
  };
}

app.get('/api/status', (_req, res) => {
  res.json({
    llm: session.llm ? { code: session.llm.models.code, fast: session.llm.models.fast, stats: session.llm.stats } : null,
    llmError: session.llmError,
    busy: session.busy,
    sites: listSites(),
    site: siteInfo(),
  });
});

app.post('/api/reconnect', async (_req, res) => {
  await session.init();
  res.json({ ok: !!session.llm, error: session.llmError });
});

const run = (fn: () => Promise<unknown>) => {
  void fn().catch((err: Error) => emit({ stage: 'error', level: 'error', message: err.message.split('\n')[0] }));
};

app.post('/api/clone', (req, res) => {
  const url = String(req.body?.url ?? '').trim();
  if (!url) return void res.status(400).json({ error: 'url is required' });
  try { new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`); } catch { return void res.status(400).json({ error: 'That does not look like a valid URL' }); }
  if (session.busy) return void res.status(409).json({ error: 'A job is already running' });
  res.status(202).json({ ok: true });
  run(async () => {
    if (!session.llm) await session.init();
    if (!session.llm && req.body?.mode !== 'deterministic') {
      emit({ stage: 'setup', level: 'warn', message: `${session.llmError ?? 'Ollama unavailable'} — continuing without a model (deterministic rebuild).` });
    }
    await session.clone(url, emit, { mode: req.body?.mode === 'deterministic' ? 'deterministic' : 'hybrid', forceStatic: !!req.body?.forceStatic });
  });
});

app.post('/api/modify', (req, res) => {
  const prompt = String(req.body?.prompt ?? '').trim();
  if (!prompt) return void res.status(400).json({ error: 'prompt is required' });
  if (!session.current) return void res.status(400).json({ error: 'Clone a site first' });
  if (session.busy) return void res.status(409).json({ error: 'A job is already running' });
  res.status(202).json({ ok: true });
  run(async () => {
    if (!session.llm) await session.init();
    const r = await session.modify(prompt, emit);
    emit({ stage: 'done', level: r.ok ? 'success' : 'error', message: r.ok ? `Applied: ${r.summary}` : `Not applied: ${r.summary}`, data: { modified: true, ok: r.ok } });
  });
});

app.post('/api/undo', (_req, res) => {
  try {
    const ok = session.undo(emit);
    emit({ stage: 'done', level: ok ? 'success' : 'warn', message: ok ? 'Undid the last change' : 'Nothing to undo', data: { modified: true } });
    res.json({ ok });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post('/api/open', async (req, res) => {
  try {
    await session.open(String(req.body?.slug ?? ''));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.get('/api/original/:kind.png', (req, res) => {
  const cur = session.current;
  const kind = req.params.kind === 'mobile' ? 'mobile' : 'desktop';
  if (!cur) return void res.status(404).end();
  const f = cur.project.p('.cloner', 'analysis', `${kind}.png`);
  fs.existsSync(f) ? res.sendFile(f) : res.status(404).end();
});

const server = app.listen(config.uiPort, '127.0.0.1', async () => {
  console.log(`\n  Site Cloner UI → http://localhost:${config.uiPort}\n`);
  await session.init();
  if (session.llm) console.log(`  Ollama OK · code model: ${session.llm.models.code} · fast model: ${session.llm.models.fast}`);
  else console.log(`  ! ${session.llmError}\n    (the UI still works; clones use the deterministic renderer until Ollama is available)`);
});

async function shutdown() {
  server.close();
  await session.close();
  await stopAllPreviews();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
