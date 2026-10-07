// Runs INSIDE the page at the mobile viewport; returns per-element style differences vs. desktop.
() => {
  const MOBILE_PROPS = ['display', 'flex-direction', 'flex-wrap', 'grid-template-columns', 'text-align', 'font-size', 'padding', 'margin', 'width', 'max-width', 'gap', 'position', 'justify-content', 'align-items', 'order'];
  const px0 = (v) => !v || v === '0px' || v === '0';
  const box = (s, prop) => {
    const t = s.getPropertyValue(prop + '-top'), r = s.getPropertyValue(prop + '-right'), b = s.getPropertyValue(prop + '-bottom'), l = s.getPropertyValue(prop + '-left');
    if ([t, r, b, l].every(px0)) return null;
    if (t === b && r === l) return t === r ? t : t + ' ' + r;
    return [t, r, b, l].join(' ');
  };
  const trackList = (v) => {
    if (!v || v === 'none') return null;
    const parts = v.split(' ').filter(Boolean);
    if (parts.length > 1 && parts.every((p) => p === parts[0])) return 'repeat(' + parts.length + ', 1fr)';
    return v;
  };
  const out = {};
  const els = window.__cloneEls, desk = window.__cloneDesk;
  for (let i = 0; i < els.length; i++) {
    const s = getComputedStyle(els[i]);
    const d = {};
    for (const p of MOBILE_PROPS) {
      let v;
      if (p === 'padding') v = box(s, 'padding') || '0';
      else if (p === 'margin') v = box(s, 'margin') || '0';
      else if (p === 'gap') v = s.getPropertyValue('row-gap') + ' ' + s.getPropertyValue('column-gap');
      else if (p === 'grid-template-columns') v = trackList(s.getPropertyValue(p)) || 'none';
      else v = s.getPropertyValue(p);
      // width / margin differences caused by plain fluid layout are noise; keep only meaningful layout changes
      if (v !== desk[i][p]) {
        if ((p === 'width' || p === 'margin') && s.display !== 'none') continue;
        d[p] = v;
      }
    }
    if (Object.keys(d).length) out[i] = d;
  }
  return out;
}
