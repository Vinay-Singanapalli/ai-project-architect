import { config } from '../config';
import type { DesignTokens, SectionSpec } from '../analyze/types';
import { themeColorMap } from '../analyze/tokens';
import type { LLM } from '../ollama';
import { type Component, normalizeComponent, parseComponentReply, sanityCheck } from './check';
import { sectionUser, SECTION_SYSTEM } from './prompts';
import { skeleton } from './skeleton';

export interface LLMSectionResult {
  component: Component;
  skeletonLevel: number;
  attempts: number;
}

/** Ask the code model for one section. Returns null if it never produced something that passes the sanity checks. */
export async function generateSectionWithLLM(
  llm: LLM,
  spec: SectionSpec,
  tokens: DesignTokens,
  onProgress?: (tokens: number) => void,
): Promise<LLMSectionResult | { error: string }> {
  const colorMap = themeColorMap(tokens);
  const sk = skeleton(spec.tree, config.skeletonBudgetChars, colorMap);
  let hint = '';
  let last = 'no output';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const reply = await llm.chat({
      model: llm.models.code,
      system: SECTION_SYSTEM,
      user: sectionUser(spec, tokens, sk.text, sk.level, hint),
      temperature: attempt === 1 ? 0.2 : 0.5,
      onProgress,
    });
    const parsed = parseComponentReply(reply);
    if (!parsed) {
      last = 'reply did not contain both a ```tsx and a ```css block';
      hint = `\nIMPORTANT: your previous reply was invalid (${last}). Reply with ONLY the two fenced code blocks.\n`;
      continue;
    }
    const comp = normalizeComponent(spec.name, parsed, colorMap);
    const problems = sanityCheck(spec.name, comp);
    if (!problems.length) return { component: comp, skeletonLevel: sk.level, attempts: attempt };
    last = problems.join('; ');
    hint = `\nIMPORTANT: your previous attempt had problems: ${last}. Fix them.\n`;
  }
  return { error: last };
}

/** Generic "ask for a component" helper used by edits, replacements and new sections (with one self-correcting retry). */
export async function requestComponent(opts: {
  llm: LLM;
  system: string;
  user: string;
  name: string;
  tokens: DesignTokens;
  onProgress?: (tokens: number) => void;
}): Promise<{ component: Component } | { error: string }> {
  const colorMap = themeColorMap(opts.tokens);
  let hint = '';
  let last = 'no output';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const reply = await opts.llm.chat({
      model: opts.llm.models.code,
      system: opts.system,
      user: opts.user + hint,
      temperature: attempt === 1 ? 0.2 : 0.5,
      onProgress: opts.onProgress,
    });
    const parsed = parseComponentReply(reply);
    if (!parsed) {
      last = 'reply did not contain both a ```tsx and a ```css block';
      hint = `\nIMPORTANT: your previous reply was invalid (${last}). Reply with ONLY the two fenced code blocks.\n`;
      continue;
    }
    const comp = normalizeComponent(opts.name, parsed, colorMap);
    const problems = sanityCheck(opts.name, comp);
    if (!problems.length) return { component: comp };
    last = problems.join('; ');
    hint = `\nIMPORTANT: your previous attempt had problems: ${last}. Fix them.\n`;
  }
  return { error: last };
}
