import { Session } from '../src/session';
import { consoleEmit } from '../src/util/events';
import { stopAllPreviews } from '../src/preview';
const s = new Session();
await s.init();
await s.clone(process.argv[2], consoleEmit, { mode: 'deterministic' });
for (const p of process.argv.slice(3)) {
  console.log('\n>>>', p);
  const r = await s.modify(p, consoleEmit);
  console.log(r.ok ? 'OK' : 'FAILED', r.summary);
}
await s.close(); await stopAllPreviews(); process.exit(0);
