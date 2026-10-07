import path from 'node:path';
import ts from 'typescript';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { ROOT } from '../config';

export interface Issue {
  source: 'tsc' | 'vite' | 'runtime';
  /** Path relative to the site dir (e.g. src/sections/Hero.tsx) when known. */
  file?: string;
  line?: number;
  message: string;
}

const relTo = (dir: string, f: string) => path.relative(dir, f).split(path.sep).join('/');

export function typecheck(siteDir: string): Issue[] {
  const cfgPath = path.join(siteDir, 'tsconfig.json');
  const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, siteDir);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, noEmit: true } });
  const issues: Issue[] = [];
  for (const d of ts.getPreEmitDiagnostics(program)) {
    if (d.category !== ts.DiagnosticCategory.Error) continue;
    const message = ts.flattenDiagnosticMessageText(d.messageText, ' ');
    if (d.file) {
      const { line } = d.file.getLineAndCharacterOfPosition(d.start ?? 0);
      const rel = relTo(siteDir, d.file.fileName);
      if (rel.startsWith('..')) continue; // errors inside node_modules typings etc.
      issues.push({ source: 'tsc', file: rel, line: line + 1, message: `TS${d.code}: ${message}` });
    } else {
      issues.push({ source: 'tsc', message: `TS${d.code}: ${message}` });
    }
  }
  return issues;
}

/** Production build in memory: catches bad imports, CSS syntax errors, JSX the bundler cannot parse. */
export async function viteCheck(siteDir: string): Promise<Issue[]> {
  try {
    await build({
      root: siteDir,
      configFile: false,
      logLevel: 'silent',
      plugins: [react()],
      build: { write: false, minify: false, reportCompressedSize: false, chunkSizeWarningLimit: 5000 },
      server: { fs: { allow: [ROOT] } },
    });
    return [];
  } catch (e) {
    const err = e as { message?: string; id?: string; loc?: { file?: string; line?: number }; frame?: string };
    const file = err.loc?.file ?? err.id;
    const rel = file ? relTo(siteDir, file.split('?')[0]) : undefined;
    return [{ source: 'vite', file: rel && !rel.startsWith('..') ? rel : undefined, line: err.loc?.line, message: (err.message ?? String(e)).split('\n')[0].slice(0, 300) }];
  }
}

export async function staticChecks(siteDir: string): Promise<Issue[]> {
  const ts_ = typecheck(siteDir);
  // Only run the (slower) bundler check when types are clean, otherwise errors are duplicated.
  const v = ts_.length ? [] : await viteCheck(siteDir);
  return [...ts_, ...v];
}

/** Map an issue to the section component name it belongs to, if any. */
export function sectionNameOf(issue: Issue): string | undefined {
  const m = issue.file && /^src\/sections\/([A-Za-z0-9_]+)\.(tsx|css)$/.exec(issue.file);
  return m ? m[1] : undefined;
}
