// Runs INSIDE the page (via page.evaluate). Plain JS on purpose: no transpiler helpers may leak in.
// Input:  { maxNodes, maxDepth, maxSections }
// Output: RawCapture-like object (see types.ts) for the desktop viewport.
(opts) => {
  const VW = window.innerWidth;
  const VH = window.innerHeight;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'META', 'TEMPLATE', 'TITLE', 'HEAD', 'BASE', 'IFRAME', 'OBJECT', 'EMBED', 'CANVAS', 'MAP', 'AREA', 'SOURCE', 'TRACK', 'DIALOG']);
  const HTML_OK = new Set('a abbr article aside b blockquote button caption cite code dd details div dl dt em fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr i img input label legend li main nav ol option p pre section select small span strong sub summary sup table tbody td textarea tfoot th thead tr u ul br'.split(' '));
  const VOID = new Set(['img', 'input', 'br', 'hr']);
  const MOBILE_PROPS = ['display', 'flex-direction', 'flex-wrap', 'grid-template-columns', 'text-align', 'font-size', 'padding', 'margin', 'width', 'max-width', 'gap', 'position', 'justify-content', 'align-items', 'order'];

  window.__cloneEls = [];
  window.__cloneDesk = [];

  const samples = { bg: {}, fg: {}, cta: {}, link: {}, fonts: {}, headingFonts: {}, radii: {}, containers: {} };
  const svgs = [];
  let nodeCount = 0;

  const bump = (map, key, n) => { if (key) map[key] = (map[key] || 0) + n; };
  const abs = (u) => {
    if (!u) return null;
    if (u.startsWith('data:')) return u.length < 3000 ? u : null;
    try { return new URL(u, document.baseURI).href; } catch (e) { return null; }
  };
  const hex2 = (n) => n.toString(16).padStart(2, '0');
  // Returns '#rrggbb', 'rgba(r,g,b,a)' or null when fully transparent.
  const color = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(parseFloat);
    const a = p.length > 3 ? p[3] : 1;
    if (a === 0) return null;
    if (a < 1) return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + +a.toFixed(2) + ')';
    return '#' + hex2(p[0]) + hex2(p[1]) + hex2(p[2]);
  };
  const isNeutral = (hex) => {
    if (!hex || hex[0] !== '#') return true;
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return Math.max(r, g, b) - Math.min(r, g, b) < 28;
  };
  const px0 = (v) => !v || v === '0px' || v === '0';
  const box = (s, prop) => {
    const t = s.getPropertyValue(prop + '-top'), r = s.getPropertyValue(prop + '-right'), b = s.getPropertyValue(prop + '-bottom'), l = s.getPropertyValue(prop + '-left');
    if ([t, r, b, l].every(px0)) return null;
    if (t === b && r === l) return t === r ? t : t + ' ' + r;
    return [t, r, b, l].join(' ');
  };
  const rectOf = (el) => el.getBoundingClientRect();
  const isBox = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    const r = rectOf(el);
    return r.width >= 1 && r.height >= 1;
  };
  const looksLikeToggle = (el) => {
    const label = ((el.getAttribute('aria-label') || '') + ' ' + (el.className && el.className.baseVal === undefined ? el.className : '') + ' ' + (el.getAttribute('aria-controls') || '')).toLowerCase();
    return /menu|burger|toggle|nav-open|drawer/.test(label);
  };
  const trackList = (v) => {
    if (!v || v === 'none') return null;
    const parts = v.split(' ').filter(Boolean);
    if (parts.length > 1 && parts.every((p) => p === parts[0])) return 'repeat(' + parts.length + ', 1fr)';
    return v;
  };

  function mobileSnapshot(s) {
    const o = {};
    for (const p of MOBILE_PROPS) {
      let v;
      if (p === 'padding') v = box(s, 'padding') || '0';
      else if (p === 'margin') v = box(s, 'margin') || '0';
      else if (p === 'gap') v = s.getPropertyValue('row-gap') + ' ' + s.getPropertyValue('column-gap');
      else if (p === 'grid-template-columns') v = trackList(s.getPropertyValue(p)) || 'none';
      else v = s.getPropertyValue(p);
      o[p] = v;
    }
    return o;
  }

  function styleOf(el, s, ps, tag) {
    const o = {};
    const put = (k, v) => { if (v !== undefined && v !== null && v !== '') o[k] = v; };
    const disp = s.display;
    if (disp !== 'block' && disp !== 'inline' && disp !== 'list-item' && disp !== 'table-row' && disp !== 'table-cell' && disp !== 'table') put('display', disp);
    if (disp === 'flex' || disp === 'inline-flex') {
      if (s.flexDirection !== 'row') put('flex-direction', s.flexDirection);
      if (s.flexWrap !== 'nowrap') put('flex-wrap', s.flexWrap);
      if (s.justifyContent !== 'normal' && s.justifyContent !== 'flex-start') put('justify-content', s.justifyContent);
      if (s.alignItems !== 'normal' && s.alignItems !== 'stretch') put('align-items', s.alignItems);
    }
    if (disp === 'grid' || disp === 'inline-grid') {
      put('grid-template-columns', trackList(s.gridTemplateColumns));
      if (s.alignItems !== 'normal' && s.alignItems !== 'stretch') put('align-items', s.alignItems);
      if (s.justifyItems !== 'normal' && s.justifyItems !== 'legacy') put('justify-items', s.justifyItems);
    }
    if (disp === 'flex' || disp === 'inline-flex' || disp === 'grid' || disp === 'inline-grid') {
      const rg = s.rowGap, cg = s.columnGap;
      if (!(px0(rg) || rg === 'normal') || !(px0(cg) || cg === 'normal')) put('gap', rg === cg ? rg : (rg === 'normal' ? '0px' : rg) + ' ' + (cg === 'normal' ? '0px' : cg));
    }
    const pf = s.getPropertyValue('flex-grow'), pshr = s.getPropertyValue('flex-shrink');
    const pr = el.parentElement ? getComputedStyle(el.parentElement).display : '';
    if ((pr === 'flex' || pr === 'inline-flex') && pf !== '0') put('flex-grow', pf);
    if ((pr === 'flex' || pr === 'inline-flex') && pshr === '0') put('flex-shrink', '0');
    const bgc = color(s.backgroundColor);
    if (bgc) put('background-color', bgc);
    if (s.backgroundImage && s.backgroundImage !== 'none') {
      const urlM = /url\(["']?([^"')]+)["']?\)/.exec(s.backgroundImage);
      if (urlM) {
        const u = abs(urlM[1]);
        if (u) {
          put('background-image', 'url(' + u + ')');
          put('background-size', s.backgroundSize);
          put('background-position', s.backgroundPosition);
          if (s.backgroundRepeat !== 'repeat') put('background-repeat', s.backgroundRepeat);
        }
      } else if (s.backgroundImage.length < 260) put('background-image', s.backgroundImage);
    }
    const pad = box(s, 'padding'); if (pad) put('padding', pad);
    let mar = box(s, 'margin');
    if (mar && s.maxWidth !== 'none' && s.marginLeft === s.marginRight && !px0(s.marginLeft)) {
      mar = s.marginTop + ' auto ' + s.marginBottom;
    }
    if (mar) put('margin', mar);
    const bt = s.borderTopWidth, br = s.borderRightWidth, bb = s.borderBottomWidth, bl = s.borderLeftWidth;
    const bcol = color(s.borderTopColor) || color(s.borderBottomColor) || color(s.borderLeftColor) || '#000';
    if (!px0(bt) && bt === br && br === bb && bb === bl && s.borderTopStyle !== 'none') put('border', bt + ' ' + s.borderTopStyle + ' ' + bcol);
    else {
      if (!px0(bt) && s.borderTopStyle !== 'none') put('border-top', bt + ' ' + s.borderTopStyle + ' ' + (color(s.borderTopColor) || bcol));
      if (!px0(bb) && s.borderBottomStyle !== 'none') put('border-bottom', bb + ' ' + s.borderBottomStyle + ' ' + (color(s.borderBottomColor) || bcol));
      if (!px0(bl) && s.borderLeftStyle !== 'none') put('border-left', bl + ' ' + s.borderLeftStyle + ' ' + (color(s.borderLeftColor) || bcol));
      if (!px0(br) && s.borderRightStyle !== 'none') put('border-right', br + ' ' + s.borderRightStyle + ' ' + (color(s.borderRightColor) || bcol));
    }
    if (!px0(s.borderTopLeftRadius)) put('border-radius', s.borderTopLeftRadius === s.borderBottomRightRadius ? s.borderTopLeftRadius : s.borderTopLeftRadius + ' ' + s.borderTopRightRadius + ' ' + s.borderBottomRightRadius + ' ' + s.borderBottomLeftRadius);
    if (s.boxShadow && s.boxShadow !== 'none') put('box-shadow', s.boxShadow.slice(0, 160));
    if (s.position !== 'static') {
      put('position', s.position);
      if (s.position !== 'relative') { for (const k of ['top', 'right', 'bottom', 'left']) { if (s[k] !== 'auto') put(k, s[k]); } }
      if (s.zIndex !== 'auto') put('z-index', s.zIndex);
    }
    if (s.overflowX === 'hidden' || s.overflowY === 'hidden') put('overflow', 'hidden');
    if (parseFloat(s.opacity) < 1 && parseFloat(s.opacity) > 0) put('opacity', s.opacity);
    if (s.maxWidth !== 'none') put('max-width', s.maxWidth);
    if (s.minHeight !== '0px' && s.minHeight !== 'auto' && parseFloat(s.minHeight) > 40) put('min-height', s.minHeight);
    if (tag === 'img' || tag === 'video' || tag === 'svg' || tag === 'input' || tag === 'button' || tag === 'select' || tag === 'textarea') {
      const r = rectOf(el);
      put('width', Math.round(r.width) + 'px');
      if (tag !== 'button') put('height', Math.round(r.height) + 'px');
      if (tag === 'img' && s.objectFit !== 'fill') put('object-fit', s.objectFit);
    }
    // Typography: only what differs from the parent.
    const diff = (prop, val) => { if (!ps || ps[prop] !== val) put(prop, val); };
    const col = color(s.color);
    if (col && (!ps || ps.__color !== col)) put('color', col);
    diff('font-size', s.fontSize);
    diff('font-weight', s.fontWeight);
    diff('line-height', s.lineHeight);
    diff('letter-spacing', s.letterSpacing === 'normal' ? '0px' : s.letterSpacing);
    diff('text-align', s.textAlign === 'start' ? 'left' : s.textAlign);
    diff('text-transform', s.textTransform);
    diff('font-style', s.fontStyle);
    if (!ps || ps.__ff !== s.fontFamily) put('font-family', s.fontFamily.split(',').slice(0, 3).join(',').trim());
    if (s.textDecorationLine !== 'none' && (!ps || ps['text-decoration'] !== s.textDecorationLine)) put('text-decoration', s.textDecorationLine);
    if (s.whiteSpace === 'nowrap') put('white-space', 'nowrap');
    if (s.listStyleType === 'none' && (tag === 'ul' || tag === 'ol')) put('list-style', 'none');
    return o;
  }

  function parentRecord(s) {
    return {
      'font-size': s.fontSize, 'font-weight': s.fontWeight, 'line-height': s.lineHeight,
      'letter-spacing': s.letterSpacing === 'normal' ? '0px' : s.letterSpacing,
      'text-align': s.textAlign === 'start' ? 'left' : s.textAlign,
      'text-transform': s.textTransform, 'font-style': s.fontStyle,
      'text-decoration': s.textDecorationLine,
      __color: color(s.color), __ff: s.fontFamily,
    };
  }

  function walk(el, ps, depth) {
    if (nodeCount >= opts.maxNodes) return null;
    const rawTag = el.tagName.toLowerCase();
    if (SKIP.has(el.tagName)) return null;
    const s = getComputedStyle(el);
    const hiddenButToggle = (s.display === 'none') && (rawTag === 'button' || el.getAttribute('role') === 'button') && looksLikeToggle(el);
    if (!hiddenButToggle && !isBox(el)) return null;
    nodeCount++;

    if (rawTag === 'svg') {
      const r = rectOf(el);
      if (r.width < 1 || r.height < 1) return null;
      const clone = el.cloneNode(true);
      clone.removeAttribute('style');
      let markup = clone.outerHTML;
      if (markup.length > 12000) markup = markup.slice(0, 0);
      const ref = svgs.length;
      svgs.push(markup);
      const node = { t: 'svg', ref: ref, s: {} };
      node.s.width = Math.round(r.width) + 'px';
      node.s.height = Math.round(r.height) + 'px';
      const col = color(s.color); if (col) node.s.color = col;
      const id = window.__cloneEls.length; window.__cloneEls.push(el); window.__cloneDesk.push(mobileSnapshot(s)); node.id = id;
      return node;
    }

    let tag = rawTag;
    if (rawTag === 'picture') tag = 'span';
    else if (!HTML_OK.has(rawTag)) tag = (s.display.indexOf('inline') === 0) ? 'span' : 'div';
    if (rawTag === 'video') tag = 'img';

    const node = { t: tag };
    const id = window.__cloneEls.length; window.__cloneEls.push(el); window.__cloneDesk.push(mobileSnapshot(s)); node.id = id;
    const a = {};
    if (tag === 'a') { const h = el.getAttribute('href'); if (h) a.href = h.startsWith('#') || h.startsWith('mailto:') || h.startsWith('tel:') ? h : abs(h) || '#'; }
    if (tag === 'img') {
      let src = rawTag === 'video' ? el.getAttribute('poster') : (el.currentSrc || el.getAttribute('src'));
      src = abs(src);
      if (!src) return null;
      a.src = src; a.alt = (el.getAttribute('alt') || '').slice(0, 140);
    }
    if (tag === 'input') {
      a.type = el.getAttribute('type') || 'text';
      if (el.getAttribute('placeholder')) a.placeholder = el.getAttribute('placeholder');
      if (el.value && (a.type === 'submit' || a.type === 'button')) a.value = el.value;
    }
    if (tag === 'textarea' && el.getAttribute('placeholder')) a.placeholder = el.getAttribute('placeholder');
    if (el.getAttribute('aria-label')) a['aria-label'] = el.getAttribute('aria-label').slice(0, 80);
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id) && depth <= 1) a.id = el.id;
    if (Object.keys(a).length) node.a = a;

    const st = styleOf(el, s, ps, tag);
    if (rawTag === 'picture') delete st.display;
    node.s = st;

    // token sampling
    const r = rectOf(el);
    const bgc = color(s.backgroundColor);
    if (bgc && bgc[0] === '#') bump(samples.bg, bgc, (r.width * r.height) / 1000);
    const isButtonish = tag === 'button' || (tag === 'a' && !px0(s.paddingTop) && !px0(s.paddingLeft)) || (tag === 'input' && (a.type === 'submit' || a.type === 'button'));
    if (isButtonish && bgc && bgc[0] === '#') bump(samples.cta, bgc, 1);
    if (!px0(s.borderTopLeftRadius) && (isButtonish || r.width * r.height > 8000)) bump(samples.radii, s.borderTopLeftRadius, 1);
    if (s.maxWidth !== 'none' && s.maxWidth.endsWith('px') && parseFloat(s.maxWidth) > 600 && parseFloat(s.maxWidth) < VW) bump(samples.containers, s.maxWidth, 1);

    const kids = [];
    let chars = 0;
    if (depth < opts.maxDepth && tag !== 'input' && tag !== 'img' && tag !== 'br' && tag !== 'hr') {
      const pRec = parentRecord(s);
      for (const ch of el.childNodes) {
        if (ch.nodeType === 3) {
          const tx = ch.nodeValue.replace(/\s+/g, ' ');
          if (tx.trim()) { kids.push(tx); chars += tx.trim().length; }
        } else if (ch.nodeType === 1) {
          if (rawTag === 'picture' && ch.tagName.toLowerCase() !== 'img') continue;
          const n = walk(ch, pRec, depth + 1);
          if (n) kids.push(n);
        }
      }
    }
    if (kids.length) {
      // trim edge whitespace of text nodes
      if (typeof kids[0] === 'string') kids[0] = kids[0].replace(/^\s+/, '');
      if (typeof kids[kids.length - 1] === 'string') kids[kids.length - 1] = kids[kids.length - 1].replace(/\s+$/, '');
      node.c = kids;
    }
    if (chars) {
      const fc = color(s.color);
      bump(samples.fg, fc && fc[0] === '#' ? fc : null, chars);
      const fam = s.fontFamily;
      bump(/^h[1-3]$/.test(tag) ? samples.headingFonts : samples.fonts, fam, chars);
      if (tag === 'a' && fc && !isNeutral(fc)) bump(samples.link, fc, 1);
    }
    return node;
  }

  // ---- section segmentation --------------------------------------------------------------
  const headerLike = (el) => {
    const r = rectOf(el);
    return r.top < 120 && r.width > VW * 0.6 && r.height < 220 && (el.tagName === 'HEADER' || el.tagName === 'NAV' || el.querySelector('nav, a'));
  };
  const keep = (el) => {
    if (!isBox(el)) return false;
    const s = getComputedStyle(el);
    if (s.position === 'fixed' || s.position === 'absolute') return headerLike(el);
    return rectOf(el).height >= 24;
  };
  const kidsOf = (el) => Array.prototype.filter.call(el.children, (c) => !SKIP.has(c.tagName) && keep(c));

  function sectionEls(root, depth) {
    const kids = kidsOf(root);
    if (kids.length === 1 && depth < 6) return sectionEls(kids[0], depth + 1);
    const out = [];
    for (const k of kids) {
      const r = rectOf(k);
      const landmark = k.tagName === 'HEADER' || k.tagName === 'FOOTER' || k.tagName === 'NAV';
      if (!landmark && r.height > VH * 1.4 && depth < 6) {
        const sub = kidsOf(k);
        if (sub.length >= 2) { out.push.apply(out, sectionEls(k, depth + 1)); continue; }
        if (sub.length === 1) { out.push.apply(out, sectionEls(sub[0], depth + 1)); continue; }
      }
      out.push(k);
    }
    return out;
  }

  const effBg = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const c = color(getComputedStyle(e).backgroundColor);
      if (c && c[0] === '#') return c;
    }
    return '#ffffff';
  };

  const bodyStyle = getComputedStyle(document.body);
  const bodyRec = parentRecord(bodyStyle);
  let groups = sectionEls(document.body, 0).map((e) => [e]);
  while (groups.length > opts.maxSections) {
    // merge the adjacent pair with the smallest combined height
    let best = 0, bestH = Infinity;
    for (let i = 0; i < groups.length - 1; i++) {
      const h = groups[i].concat(groups[i + 1]).reduce((a, e) => a + rectOf(e).height, 0);
      if (h < bestH) { bestH = h; best = i; }
    }
    groups.splice(best, 2, groups[best].concat(groups[best + 1]));
  }

  const sections = [];
  for (const g of groups) {
    const first = g[0];
    const r0 = rectOf(first);
    const rLast = rectOf(g[g.length - 1]);
    const trees = g.map((e) => walk(e, bodyRec, 0)).filter(Boolean);
    if (!trees.length) continue;
    const tree = trees.length === 1 ? trees[0] : { t: 'div', c: trees };
    const h = first.querySelector('h1, h2, h3');
    sections.push({
      tag: first.tagName.toLowerCase(),
      htmlId: first.id || undefined,
      y: Math.round(r0.top + window.scrollY),
      height: Math.round(rLast.bottom - r0.top),
      bg: effBg(first),
      tree: tree,
      headingText: h ? (h.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) : '',
      _els: g.length,
    });
  }

  const fontLinks = Array.prototype.map.call(document.querySelectorAll('link[rel="stylesheet"], link[rel="preconnect"]'), (l) => l.href).filter((h) => /fonts\.(googleapis|bunny)\.net|fonts\.googleapis\.com|typekit|fonts\.gstatic/.test(h));
  const icon = document.querySelector('link[rel~="icon"]');
  const theme = document.querySelector('meta[name="theme-color"]');
  const desc = document.querySelector('meta[name="description"]');

  return {
    title: document.title || '',
    lang: document.documentElement.lang || 'en',
    description: desc ? desc.content : '',
    themeColor: theme ? theme.content : undefined,
    favicon: icon ? abs(icon.getAttribute('href')) : undefined,
    fontLinks: fontLinks,
    bodyBg: effBg(document.body),
    bodyColor: color(bodyStyle.color) || '#111111',
    bodyFontSize: parseFloat(bodyStyle.fontSize) || 16,
    pageHeight: Math.round(document.documentElement.scrollHeight),
    samples: samples,
    sections: sections,
    svgs: svgs,
    mode: 'browser',
  };
}
