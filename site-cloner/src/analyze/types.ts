export type Style = Record<string, string>;

/** Compact, JSON-serialisable description of one DOM element (produced in the browser). */
export interface TNode {
  t: string;
  id?: number;
  a?: Record<string, string>;
  /** Computed styles that differ from the parent / initial value (desktop). */
  s?: Style;
  /** Style differences observed at the mobile viewport. */
  m?: Style;
  c?: (TNode | string)[];
  /** Index into SiteAnalysis.svgs when t === 'svg' */
  ref?: number;
}

export type SectionType =
  | 'navbar' | 'hero' | 'features' | 'pricing' | 'testimonials' | 'faq' | 'cta' | 'logos' | 'stats' | 'gallery' | 'contact' | 'footer' | 'content';

export interface ColorSample { [color: string]: number }

export interface RawSamples {
  bg: ColorSample;
  fg: ColorSample;
  cta: ColorSample;
  link: ColorSample;
  fonts: Record<string, number>;
  headingFonts: Record<string, number>;
  radii: Record<string, number>;
  containers: Record<string, number>;
}

export interface RawSection {
  tag: string;
  htmlId?: string;
  y: number;
  height: number;
  bg: string;
  tree: TNode;
  headingText: string;
}

export interface RawCapture {
  title: string;
  lang: string;
  description: string;
  themeColor?: string;
  favicon?: string;
  fontLinks: string[];
  bodyBg: string;
  bodyColor: string;
  bodyFontSize: number;
  pageHeight: number;
  samples: RawSamples;
  sections: RawSection[];
  svgs: string[];
  mode: 'browser' | 'static';
}

export interface DesignTokens {
  colors: { primary: string; bg: string; surface: string; text: string; muted: string; border: string };
  fontBody: string;
  fontHeading: string;
  baseFontSize: number;
  container: number;
  radius: number;
}

export interface SectionSpec {
  id: string;
  /** PascalCase component name, also used as the file name. */
  name: string;
  label: string;
  type: SectionType;
  y: number;
  height: number;
  bg: string;
  tree: TNode;
  text: string;
  /** Original element id from the source page (kept so #anchor links keep working). */
  anchor?: string;
  /** Path (relative to the site dir) of the original screenshot of this section, if captured. */
  screenshot?: string;
}

export interface SiteAnalysis {
  url: string;
  slug: string;
  title: string;
  lang: string;
  description: string;
  themeColor?: string;
  favicon?: string;
  fontLinks: string[];
  tokens: DesignTokens;
  sections: SectionSpec[];
  svgs: string[];
  mode: 'browser' | 'static';
  warnings: string[];
  /** original-url -> local public path */
  assets: Record<string, string>;
  pageHeight: number;
}
