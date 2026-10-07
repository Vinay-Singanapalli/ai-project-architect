import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockCall { system: string; user: string; model: string; json: boolean }

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

export const comp = (name: string, text: string, extraCss = '', tsxExtra = '') =>
  '```tsx\nimport \'./' + name + '.css\';\n\nexport default function ' + name + '() {\n  return (\n    <section className="' + kebab(name) + '">\n      <h2>' + text + '</h2>\n' + tsxExtra + '    </section>\n  );\n}\n```\n```css\n.' + kebab(name) + ' { padding: 40px; color: #4f46e5; text-align: center; }\n' + extraCss + '```';

/**
 * A tiny fake Ollama that answers the agent's prompts deterministically, so the whole LLM path
 * (generation, self-repair, planning, editing) can be tested offline and in CI.
 */
export async function startMockOllama(opts: { breakSection?: string } = {}) {
  const calls: MockCall[] = [];
  const brokenOnce = new Set<string>();

  const answer = (system: string, user: string, json: boolean): string => {
    const name = /Component name:\s*(\w+)/.exec(user)?.[1] ?? /^Component (\w+) fails/m.exec(user)?.[1] ?? /CURRENT (\w+)\.tsx/.exec(user)?.[1] ?? 'Mock';
    if (json) {
      const req = /REQUEST:\s*(.*)$/m.exec(user)?.[1] ?? '';
      if (/headline|bigger|larger/i.test(req)) return JSON.stringify({ ops: [{ op: 'edit_section', target: 'hero', instruction: req }] });
      if (/green/i.test(req)) return JSON.stringify({ ops: [{ op: 'set_theme', vars: { '--color-primary': 'green' } }] });
      return JSON.stringify({ ops: [] });
    }
    if (system.startsWith('You fix compile errors')) return comp(name, `Repaired ${name}`);
    if (system.startsWith('You edit an existing')) {
      const tsx = /CURRENT \w+\.tsx\n```tsx\n([\s\S]*?)```/.exec(user)?.[1] ?? '';
      const css = /CURRENT \w+\.css\n```css\n([\s\S]*?)```/.exec(user)?.[1] ?? '';
      return '```tsx\n' + tsx + '```\n```css\n' + css + '\n.hero h1, .hero__title { font-size: 80px; }\n```';
    }
    if (system.includes('write a new section') || system.includes('You write a new section')) {
      const desc = /"([^"]+)"/.exec(user)?.[1] ?? name;
      return comp(name, desc.slice(0, 60));
    }
    // section generation
    if (opts.breakSection && name === opts.breakSection && !brokenOnce.has(name)) {
      brokenOnce.add(name);
      // valid syntax, but a type error that only tsc finds
      return comp(name, 'broken', '', '      <p>{(42).toUpperCase()}</p>\n');
    }
    return comp(name, `Generated ${name}`);
  };

  const server = http.createServer((req, res) => {
    if (req.url === '/api/tags') {
      res.setHeader('content-type', 'application/json');
      return void res.end(JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }, { name: 'nomic-embed-text:latest' }, { name: 'llama3.2:3b' }] }));
    }
    if (req.url === '/api/chat' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const j = JSON.parse(body);
        const system = j.messages[0].content as string;
        const user = j.messages[1].content as string;
        calls.push({ system, user, model: j.model, json: j.format === 'json' });
        const text = answer(system, user, j.format === 'json');
        res.setHeader('content-type', 'application/x-ndjson');
        for (let i = 0; i < text.length; i += 40) res.write(JSON.stringify({ message: { content: text.slice(i, i + 40) }, done: false }) + '\n');
        res.end(JSON.stringify({ message: { content: '' }, done: true, prompt_eval_count: 100, eval_count: Math.ceil(text.length / 4) }) + '\n');
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { host: `http://127.0.0.1:${port}`, calls, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}
