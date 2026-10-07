export type Position = 'start' | 'end' | `before:${string}` | `after:${string}`;

export type Op =
  | { op: 'set_theme'; vars: Record<string, string> }
  | { op: 'remove_section'; target: string }
  | { op: 'add_section'; name: string; description: string; position?: string }
  | { op: 'replace_section'; target: string; description: string }
  | { op: 'move_section'; target: string; position: string }
  | { op: 'edit_section'; target: string; instruction: string }
  | { op: 'global_css'; css: string; key?: string };

export const THEME_VARS = new Set(['--color-primary', '--color-bg', '--color-surface', '--color-text', '--color-muted', '--color-border', '--font-heading', '--font-body', '--radius', '--container']);
