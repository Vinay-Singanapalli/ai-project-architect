import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { config } from './config';
import { launchBrowser } from './analyze/browser';
import { listModels, OllamaError, pickModel } from './ollama';
import { stopAllPreviews } from './preview';
import { Session } from './session';
import { consoleEmit } from './util/events';

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function doctor(): Promise<number> {
  let bad = 0;
  const line = (ok: boolean, msg: string) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) bad++; };
  const major = Number(process.versions.node.split('.')[0]);
  line(major >= 18, `Node ${process.versions.node} (needs ≥ 18.18)`);
  try {
    const models = await listModels();
    line(true, `Ollama reachable at ${config.ollamaHost} (${models.length} model${models.length === 1 ? '' : 's'}: ${models.join(', ') || 'none'})`);
    try {
      console.log(`  → code model: ${pickModel(models, opt('code-model') ?? config.codeModel, 'code')}`);
      console.log(`  → fast model: ${pickModel(models, opt('fast-model') ?? config.fastModel, 'fast')}`);
    } catch (e) { line(false, (e as Error).message); }
  } catch (e) {
    line(false, (e as Error).message);
  }
  try {
    const b = await launchBrowser();
    await b.close();
    line(true, 'Headless browser available');
  } catch (e) {
    line(false, (e as Error).message + '\n  (without a browser the agent falls back to lower-fidelity static analysis)');
  }
  return bad ? 1 : 0;
}

async function repl(session: Session) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  console.log('\nType a change in plain English (e.g. "change the primary color to teal"). Commands: undo, sections, quit\n');
  for (;;) {
    let line: string;
    try { line = (await rl.question('modify> ')).trim(); } catch { break; }
    if (!line) continue;
    if (/^(quit|exit|q)$/i.test(line)) break;
    if (line === 'undo') { session.undo(consoleEmit); continue; }
    if (line === 'sections') { console.log(session.current!.project.readManifest().sections.map((s) => `  ${s.id} [${s.type}, ${s.source}]`).join('\n')); continue; }
    try { await session.modify(line, consoleEmit); } catch (e) { console.log(`✗ ${(e as Error).message}`); }
  }
  rl.close();
}

async function main() {
  if (cmd === 'doctor') process.exit(await doctor());

  if (cmd === 'clone' || cmd === 'modify') {
    const session = new Session();
    await session.init({ code: opt('code-model'), fast: opt('fast-model') });
    if (session.llm) console.log(`Using Ollama models → code: ${session.llm.models.code}, fast: ${session.llm.models.fast}`);
    else console.log(`! ${session.llmError}\n  Continuing without a model (deterministic rebuild; natural-language edits limited to rule-based commands).`);

    if (cmd === 'clone') {
      const url = args[1];
      if (!url) throw new Error('Usage: npm run clone -- <url> [--static] [--no-ai] [--no-repl]');
      const r = await session.clone(url, consoleEmit, { mode: flag('no-ai') ? 'deterministic' : 'hybrid', forceStatic: flag('static') });
      console.log(`\nPreview: ${r.previewUrl}\nProject: ${r.project.dir}`);
    } else {
      const slug = args[1];
      const prompt = args.slice(2).filter((a) => !a.startsWith('--')).join(' ');
      if (!slug) throw new Error('Usage: npm run modify -- <site-slug> "<instruction>"');
      await session.open(slug);
      if (prompt) await session.modify(prompt, consoleEmit);
    }
    if (!flag('no-repl') && stdin.isTTY) await repl(session);
    await session.close();
    await stopAllPreviews();
    process.exit(0);
  }

  console.log(`Site Cloner\n\n  npm start                                 web UI at http://localhost:${config.uiPort}\n  npm run clone -- <url>                    clone a site, then edit it in a prompt loop\n  npm run modify -- <slug> "<instruction>"  edit an existing clone\n  npm run doctor                            check Ollama, models and browser`);
}

main().catch((e) => {
  console.error(e instanceof OllamaError ? `\n✗ ${e.message}` : e);
  process.exit(1);
});
