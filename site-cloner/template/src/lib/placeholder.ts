/** Returns an inline SVG data-URI placeholder image. Used for newly added sections that have no real photos. */
export function placeholderImage(label = 'Image', width = 800, height = 600, bg = '#e5e7eb', fg = '#6b7280'): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${bg}"/><text x="50%" y="50%" fill="${fg}" font-family="sans-serif" font-size="${Math.round(width / 20)}" text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
