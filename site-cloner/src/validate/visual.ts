import fs from 'node:fs';
import { PNG } from 'pngjs';

interface Grid {
  w: number;
  h: number;
  rgb: Float32Array; // w*h*3 in 0..1
}

const GW = 96;
const GH = 64;

function load(file: string): { grid: Grid; width: number; height: number } {
  const png = PNG.sync.read(fs.readFileSync(file));
  const rgb = new Float32Array(GW * GH * 3);
  const cnt = new Float32Array(GW * GH);
  for (let y = 0; y < png.height; y++) {
    const gy = Math.min(GH - 1, Math.floor((y / png.height) * GH));
    for (let x = 0; x < png.width; x++) {
      const gx = Math.min(GW - 1, Math.floor((x / png.width) * GW));
      const i = (png.width * y + x) << 2;
      const a = png.data[i + 3] / 255;
      const o = gy * GW + gx;
      rgb[o * 3] += (png.data[i] * a + 255 * (1 - a)) / 255;
      rgb[o * 3 + 1] += (png.data[i + 1] * a + 255 * (1 - a)) / 255;
      rgb[o * 3 + 2] += (png.data[i + 2] * a + 255 * (1 - a)) / 255;
      cnt[o]++;
    }
  }
  for (let o = 0; o < GW * GH; o++) if (cnt[o]) for (let k = 0; k < 3; k++) rgb[o * 3 + k] /= cnt[o];
  return { grid: { w: GW, h: GH, rgb }, width: png.width, height: png.height };
}

const lum = (g: Grid, o: number) => 0.299 * g.rgb[o * 3] + 0.587 * g.rgb[o * 3 + 1] + 0.114 * g.rgb[o * 3 + 2];

function edges(g: Grid): Float32Array {
  const e = new Float32Array(g.w * g.h);
  for (let y = 0; y < g.h - 1; y++)
    for (let x = 0; x < g.w - 1; x++) {
      const o = y * g.w + x;
      e[o] = Math.abs(lum(g, o) - lum(g, o + 1)) + Math.abs(lum(g, o) - lum(g, o + g.w));
    }
  return e;
}

export interface VisualScore {
  /** 0..1, higher is closer to the original */
  score: number;
  color: number;
  structure: number;
  heightRatio: number;
}

/**
 * Cheap perceptual similarity between two screenshots: block-averaged colour, edge (text/image placement) map
 * and height ratio. Not a metric of "correctness" – it is used to compare two candidate renderings of the same
 * section and to report progress, so only relative values matter.
 */
export function compareImages(originalPng: string, candidatePng: string): VisualScore {
  const a = load(originalPng);
  const b = load(candidatePng);
  let dc = 0;
  for (let i = 0; i < a.grid.rgb.length; i++) dc += Math.abs(a.grid.rgb[i] - b.grid.rgb[i]);
  dc /= a.grid.rgb.length;
  const ea = edges(a.grid), eb = edges(b.grid);
  let de = 0;
  for (let i = 0; i < ea.length; i++) de += Math.abs(ea[i] - eb[i]);
  de /= ea.length;
  const color = 1 - Math.min(1, dc * 2);
  const structure = 1 - Math.min(1, de * 12);
  const heightRatio = Math.min(a.height, b.height) / Math.max(a.height, b.height, 1);
  const score = (0.4 * color + 0.35 * structure + 0.25 * heightRatio);
  return { score: Math.max(0, Math.min(1, score)), color, structure, heightRatio };
}
