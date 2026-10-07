import { parseColor } from '../util/color';
import { pascal } from '../util/text';
import type { Manifest } from '../project';
import type { Op } from './ops';
import { resolveStrict, typeOfTopic } from './resolve';

const COLOR_WORDS = '(#[0-9a-f]{3,6}|rgb\\([^)]*\\)|[a-z]+(?: [a-z]+)?)';

function colorFrom(raw: string): string | null {
  const t = raw.trim().replace(/[.!]+$/, '').replace(/^(a |an |the )/, '').replace(/\s+(color|colour)$/, '');
  return parseColor(t) ?? parseColor(t.split(' ').slice(-1)[0]);
}

export function stickyCss(id: string, on: boolean): Op {
  const key = `sticky:${id}`;
  return {
    op: 'global_css',
    key,
    css: on
      ? `[data-section="${id}"] { position: sticky; top: 0; z-index: 100; }\n[data-section="${id}"] > * { background-color: var(--color-bg); }`
      : `[data-section="${id}"] { position: static; }`,
  };
}

/** Defaults to a sensible place in the page for a freshly added section. */
export function defaultPosition(type: string, m: Manifest): string {
  if (type === 'navbar') return 'start';
  if (type === 'hero') return m.sections[0]?.type === 'navbar' ? `after:${m.sections[0].id}` : 'start';
  const footer = m.sections.find((s) => s.type === 'footer');
  return footer ? `before:${footer.id}` : 'end';
}

/**
 * Cheap rule-based interpretation for the most common edits. Returns null when the request is not
 * unambiguous, so the LLM planner takes over. These fast paths cost zero tokens and are fully deterministic.
 */
export function ruleBasedPlan(input: string, m: Manifest): Op[] | null {
  const text = input.trim().replace(/\s+/g, ' ');

  // --- theme colours ---------------------------------------------------------------------------
  let r = new RegExp(`^(?:please )?(?:change|set|make|switch|update|turn)\\s+(?:the\\s+)?(?:(?:site|page|website)\\s+)?(primary|main|brand|accent|background|text|font)\\s*(?:colou?r)?\\s*(?:to|into|as|=)\\s+${COLOR_WORDS}\\s*(?:please)?[.!]*$`, 'i').exec(text)
    ?? new RegExp(`^(?:please )?use\\s+${COLOR_WORDS}\\s+as\\s+(?:the\\s+)?(primary|main|brand|accent|background|text)\\s*(?:colou?r)?[.!]*$`, 'i').exec(text);
  if (r) {
    const swap = /^use\s/i.test(text);
    const kind = (swap ? r[2] : r[1]).toLowerCase();
    const color = colorFrom(swap ? r[1] : r[2]);
    if (color) {
      const key = { primary: '--color-primary', main: '--color-primary', brand: '--color-primary', accent: '--color-primary', background: '--color-bg', text: '--color-text', font: '--color-text' }[kind]!;
      const vars: Record<string, string> = { [key]: color };
      if (key === '--color-bg') vars['--color-surface'] = color;
      return [{ op: 'set_theme', vars }];
    }
  }
  r = new RegExp(`^(?:please )?make\\s+(?:the\\s+)?(?:primary|main|brand|accent)\\s*(?:colou?r)?\\s+${COLOR_WORDS}[.!]*$`, 'i').exec(text);
  if (r) {
    const color = colorFrom(r[1]);
    if (color) return [{ op: 'set_theme', vars: { '--color-primary': color } }];
  }

  // --- sticky / fixed ---------------------------------------------------------------------------
  r = /^(?:please )?(?:make|set|keep|turn)\s+(?:the\s+)?(.+?)\s+(sticky|fixed)(?:\s+(?:at|to)\s+the\s+top)?[.!]*$/i.exec(text)
    ?? /^(?:please )?(?:add|enable)\s+(?:a\s+)?sticky\s+(.+?)[.!]*$/i.exec(text);
  if (r) {
    const target = resolveStrict(m, r[1]);
    if (target) return [stickyCss(target.id, true)];
  }
  r = /^(?:please )?(?:remove|disable|turn off|stop)\s+(?:the\s+)?(?:sticky|fixed)\s+(?:behaviou?r\s+)?(?:from|on|for|of)?\s*(?:the\s+)?(.+?)[.!]*$/i.exec(text)
    ?? /^(?:please )?make\s+(?:the\s+)?(.+?)\s+(?:not\s+sticky|static)[.!]*$/i.exec(text);
  if (r) {
    const target = resolveStrict(m, r[1]);
    if (target) return [stickyCss(target.id, false)];
  }

  // --- remove -----------------------------------------------------------------------------------
  r = /^(?:please )?(?:remove|delete|drop|get rid of)\s+(?:the\s+)?(.+?)(?:\s+section)?[.!]*$/i.exec(text);
  if (r) {
    const target = resolveStrict(m, r[1]);
    if (target) return [{ op: 'remove_section', target: target.id }];
  }

  // --- move -------------------------------------------------------------------------------------
  r = /^(?:please )?move\s+(?:the\s+)?(.+?)(?:\s+section)?\s+(above|before|below|after|to the top|to the bottom|to the end|to the start)(?:\s+(?:the\s+)?(.+?)(?:\s+section)?)?[.!]*$/i.exec(text);
  if (r) {
    const target = resolveStrict(m, r[1]);
    const where = r[2].toLowerCase();
    if (target) {
      if (/top|start/.test(where)) return [{ op: 'move_section', target: target.id, position: 'start' }];
      if (/bottom|end/.test(where)) return [{ op: 'move_section', target: target.id, position: 'end' }];
      const ref = r[3] ? resolveStrict(m, r[3]) : undefined;
      if (ref && ref.id !== target.id) return [{ op: 'move_section', target: target.id, position: `${/above|before/.test(where) ? 'before' : 'after'}:${ref.id}` }];
    }
  }

  // --- replace ----------------------------------------------------------------------------------
  r = /^(?:please )?replace\s+(?:the\s+)?(.+?)\s+section\s+with\s+(.+?)[.!]*$/i.exec(text);
  if (r) {
    const target = resolveStrict(m, r[1]);
    if (target) return [{ op: 'replace_section', target: target.id, description: r[2] }];
  }

  // --- add --------------------------------------------------------------------------------------
  r = /^(?:please )?(?:add|insert|create|include)\s+(?:a|an|another|some|the)?\s*(.+?)\s+section(?:\s+(after|before|below|above)\s+(?:the\s+)?(.+?)(?:\s+section)?)?(?:\s+(?:with|that|containing|showing|featuring|about)\s+.*)?[.!]*$/i.exec(text);
  if (r) {
    const topic = r[1].trim();
    const type = typeOfTopic(topic);
    let position = defaultPosition(type, m);
    if (r[2] && r[3]) {
      const ref = resolveStrict(m, r[3]);
      if (ref) position = `${/before|above/i.test(r[2]) ? 'before' : 'after'}:${ref.id}`;
    }
    return [{ op: 'add_section', name: pascal(topic, 'NewSection'), description: text, position }];
  }
  return null;
}
