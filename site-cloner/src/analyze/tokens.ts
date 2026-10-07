import { clamp } from '../util/text';
import { contrastText, luminance, mix, saturation } from '../util/color';
import type { ColorSample, DesignTokens, RawCapture } from './types';

const top = (m: Record<string, number>, pred: (k: string) => boolean = () => true): string | undefined =>
  Object.entries(m).filter(([k]) => pred(k)).sort((a, b) => b[1] - a[1])[0]?.[0];

const neutral = (c: string) => saturation(c) < 28;

export function fontStack(name: string | undefined, fallbackKind: 'sans' | 'serif' = 'sans'): string {
  if (!name) return 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  // A full stack captured from the page is kept verbatim so unavailable web fonts fall back exactly as on the original.
  if (name.includes(',')) return name.trim();
  const generic = /serif|georgia|times|garamond|playfair|merriweather|lora|cambria|baskerville/i.test(name) && !/sans/i.test(name) ? 'serif' : fallbackKind;
  const tail = generic === 'serif' ? 'Georgia, "Times New Roman", serif' : 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  if (/^(system-ui|-apple-system|sans-serif|serif|ui-sans-serif|blinkmacsystemfont|segoe ui)$/i.test(name)) return tail;
  return `"${name}", ${tail}`;
}

export function computeTokens(raw: RawCapture): DesignTokens {
  const s = raw.samples;
  const bg = raw.bodyBg || '#ffffff';
  const text = raw.bodyColor && raw.bodyColor[0] === '#' ? raw.bodyColor : topOr(s.fg, '#111827');

  const primary =
    top(s.cta, (c) => !neutral(c)) ??
    top(s.link, (c) => !neutral(c)) ??
    top(s.bg, (c) => !neutral(c)) ??
    top(s.cta) ??
    '#2563eb';

  const surfaceCandidate = top(s.bg, (c) => c !== bg && neutral(c) && Math.abs(luminance(c) - luminance(bg)) < 0.25);
  const surface = surfaceCandidate ?? (luminance(bg) > 0.5 ? mix(bg, '#000000', 0.04) : mix(bg, '#ffffff', 0.06));

  const mutedCandidate = top(s.fg, (c) => c !== text && Math.abs(luminance(c) - luminance(text)) > 0.08 && Math.abs(luminance(c) - luminance(bg)) > 0.12);
  const muted = mutedCandidate ?? mix(text, bg, 0.4);
  const border = mix(bg, text, 0.14);

  const bodyFont = top(s.fonts) ?? top(s.headingFonts);
  const headFont = top(s.headingFonts) ?? bodyFont;
  const container = parseFloat(top(s.containers) ?? '1200') || 1200;
  const radius = parseFloat(top(s.radii) ?? '8') || 8;

  return {
    colors: { primary, bg, surface, text, muted, border },
    fontBody: fontStack(bodyFont),
    fontHeading: fontStack(headFont),
    baseFontSize: clamp(raw.bodyFontSize || 16, 12, 20),
    container: clamp(container, 720, 1600),
    radius: clamp(radius, 0, 32),
  };
}

function topOr(m: ColorSample, d: string) {
  return top(m) ?? d;
}

export function themeCss(t: DesignTokens): string {
  const c = t.colors;
  return `/* Design tokens extracted from the source site. Edit these to re-theme everything. */
:root {
  --color-primary: ${c.primary};
  --color-primary-contrast: ${contrastText(c.primary)};
  --color-bg: ${c.bg};
  --color-surface: ${c.surface};
  --color-text: ${c.text};
  --color-muted: ${c.muted};
  --color-border: ${c.border};
  --font-body: ${t.fontBody};
  --font-heading: ${t.fontHeading};
  --radius: ${t.radius}px;
  --container: ${t.container}px;
  --base-font-size: ${t.baseFontSize}px;
}
`;
}

/** Map of normalised colour literal -> CSS var(), used to wire generated CSS to the theme. */
export function themeColorMap(t: DesignTokens): Record<string, string> {
  const c = t.colors;
  const map: Record<string, string> = {};
  // Order matters when two tokens share a value: earlier wins.
  for (const [k, v] of [['primary', c.primary], ['bg', c.bg], ['text', c.text], ['surface', c.surface], ['muted', c.muted], ['border', c.border]] as const) {
    if (!(v in map)) map[v] = `var(--color-${k})`;
  }
  return map;
}
