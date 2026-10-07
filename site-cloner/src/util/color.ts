export type RGB = [number, number, number];

export const NAMED_COLORS: Record<string, string> = {
  blue: '#2563eb', 'light blue': '#38bdf8', 'sky blue': '#0ea5e9', 'dark blue': '#1e3a8a', navy: '#1e3a8a', 'royal blue': '#1d4ed8',
  red: '#dc2626', crimson: '#be123c', maroon: '#7f1d1d', 'dark red': '#991b1b',
  green: '#16a34a', 'light green': '#4ade80', 'dark green': '#166534', emerald: '#059669', lime: '#65a30d', olive: '#4d7c0f', forest: '#166534',
  orange: '#ea580c', amber: '#d97706', coral: '#f97316', peach: '#fb923c',
  yellow: '#eab308', gold: '#ca8a04', mustard: '#ca8a04',
  purple: '#7c3aed', violet: '#7c3aed', indigo: '#4f46e5', lavender: '#a78bfa', magenta: '#c026d3',
  pink: '#db2777', 'hot pink': '#ec4899', rose: '#e11d48',
  teal: '#0d9488', turquoise: '#14b8a6', cyan: '#0891b2', aqua: '#06b6d4',
  brown: '#92400e', tan: '#d6b88a', beige: '#e7d9c3', cream: '#f5efe0', chocolate: '#7c3f1d',
  black: '#111827', white: '#ffffff', gray: '#6b7280', grey: '#6b7280', silver: '#9ca3af', slate: '#475569',
};

export function parseColor(input: string): string | null {
  const s = input.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return '#' + m[1].split('').map((c) => c + c).join('');
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(s);
  if (m) return '#' + m[1];
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,\/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (a < 1) return null;
    return toHex([+m[1], +m[2], +m[3]]);
  }
  return NAMED_COLORS[s] ?? null;
}

export function toRgb(hex: string): RGB {
  const h = parseColor(hex) ?? '#000000';
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

export function toHex([r, g, b]: RGB): string {
  const c = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = toRgb(a);
  const [br, bg, bb] = toRgb(b);
  return toHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function saturation(hex: string): number {
  const [r, g, b] = toRgb(hex);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/** Readable text colour (white or near-black) for a given background. */
export function contrastText(bg: string): string {
  return luminance(bg) > 0.45 ? '#111827' : '#ffffff';
}

/** Replace every colour literal in a CSS string by `map[normalisedColour]` (a CSS value such as var(--x)). */
export function replaceColors(css: string, map: Record<string, string>): string {
  return css.replace(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g, (lit) => {
    const norm = parseColor(lit);
    return norm && map[norm] ? map[norm] : lit;
  });
}
