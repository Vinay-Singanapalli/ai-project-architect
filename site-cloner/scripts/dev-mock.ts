// Full LLM-path smoke test against a fake Ollama (no real model needed).
delete process.env.OLLAMA_HOST;
import { startMockOllama } from '../tests/helpers/mock-ollama';
const mock = await startMockOllama({ breakSection: 'Pricing' });
process.env.OLLAMA_HOST = mock.host;
const { Session } = await import('../src/session');
const { consoleEmit } = await import('../src/util/events');
const { stopAllPreviews } = await import('../src/preview');
const s = new Session();
await s.init();
console.log('models', s.llm?.models);
await s.clone(process.argv[2], consoleEmit, { mode: 'hybrid' });
for (const p of process.argv.slice(3)) {
  console.log('\n>>>', p);
  const r = await s.modify(p, consoleEmit);
  console.log(r.ok ? 'OK' : 'FAILED', r.summary);
}
console.log('\nmodel calls', mock.calls.length, 'systems:', [...new Set(mock.calls.map((c) => c.system.slice(0, 30)))]);
console.log(JSON.stringify(s.current!.project.readManifest().sections.map((x) => `${x.id}:${x.source}`)));
await s.close(); await stopAllPreviews(); await mock.close(); process.exit(0);
