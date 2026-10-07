import { cloneSite } from '../src/pipeline';
import { consoleEmit } from '../src/util/events';
import { stopAllPreviews } from '../src/preview';
const r = await cloneSite({ url: process.argv[2], emit: consoleEmit, llm: null, mode: 'deterministic' });
console.log(JSON.stringify({ ok: r.validation.ok, preview: r.previewUrl, fidelity: r.fidelity }, null, 1));
await stopAllPreviews();
process.exit(0);
