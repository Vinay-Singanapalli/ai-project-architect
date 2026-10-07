import type { Manifest, ManifestEntry } from '../project';

const FILLER = new Set(['the', 'a', 'an', 'this', 'that', 'whole', 'entire', 'section', 'block', 'part', 'area', 'of', 'page', 'site', 'website', 'my', 'our']);

const SYNONYMS: Record<string, string[]> = {
  navbar: ['navbar', 'nav', 'navigation', 'navigation bar', 'nav bar', 'menu', 'top bar', 'topbar', 'header'],
  hero: ['hero', 'banner', 'hero banner', 'masthead', 'intro', 'top'],
  features: ['features', 'feature', 'benefits', 'services'],
  pricing: ['pricing', 'prices', 'price', 'plans', 'pricing plans'],
  testimonials: ['testimonials', 'testimonial', 'reviews', 'review', 'quotes', 'social proof'],
  faq: ['faq', 'faqs', 'questions'],
  cta: ['cta', 'call to action', 'calltoaction', 'call-to-action'],
  logos: ['logos', 'logo', 'clients', 'partners', 'brands'],
  stats: ['stats', 'statistics', 'numbers', 'metrics'],
  gallery: ['gallery', 'images', 'photos'],
  contact: ['contact', 'contact form'],
  footer: ['footer', 'bottom'],
};

const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 -]+/g, ' ').split(/\s+/).filter((w) => w && !FILLER.has(w)).join(' ').trim();

/** Strict match: the phrase must denote a section by id, name, type synonym or its heading text. */
export function resolveStrict(m: Manifest, phrase: string): ManifestEntry | undefined {
  const p = norm(phrase);
  if (!p) return undefined;
  const byId = m.sections.find((s) => norm(s.id.replace(/-/g, ' ')) === p || norm(s.name) === p);
  if (byId) return byId;
  for (const [type, words] of Object.entries(SYNONYMS)) {
    if (words.includes(p)) {
      const hit = m.sections.find((s) => s.type === type);
      if (hit) return hit;
    }
  }
  return m.sections.find((s) => {
    const heading = norm(s.label.split('–').slice(1).join(' '));
    return heading && (heading === p || (p.length > 4 && heading.includes(p)));
  });
}

/** Lenient match for LLM-provided targets: strict first, then best token overlap with id / label. */
export function resolveFuzzy(m: Manifest, phrase: string): ManifestEntry | undefined {
  const strict = resolveStrict(m, phrase);
  if (strict) return strict;
  const words = new Set(norm(phrase).split(' ').filter(Boolean));
  let best: { s: ManifestEntry; score: number } | undefined;
  for (const s of m.sections) {
    const hay = new Set(norm(`${s.id.replace(/-/g, ' ')} ${s.label} ${s.type}`).split(' '));
    let score = 0;
    for (const w of words) if (hay.has(w)) score++;
    if (score > (best?.score ?? 0)) best = { s, score };
  }
  return best?.s;
}

export const typeOfTopic = (topic: string): string => {
  const p = norm(topic);
  for (const [type, words] of Object.entries(SYNONYMS)) if (words.includes(p) || words.some((w) => p.includes(w))) return type;
  return 'content';
}
