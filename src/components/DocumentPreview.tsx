import React, { useEffect, useRef, useState } from 'react';
import { Field, Template, TTData } from '../types';
import {
  ALIGN,
  cellsOf,
  cellParas,
  childEl,
  childEls,
  closest,
  headerStyles,
  HU,
  ln,
  paraNodes,
  pText,
  templateImages,
  u32,
} from '../utils/hwpx';
import { transform } from '../utils/timetable';

interface DocumentPreviewProps {
  template: Template;
  fields: Field[];
  tt?: TTData | null;
}

const esc = (s: any) =>
  String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));

export const DocumentPreview: React.FC<DocumentPreviewProps> = ({ template, fields, tt }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const render = async () => {
      setLoading(true);
      setError(null);
      try {
        const { docs, changed } = transform(template, fields, tt);
        template.styles = template.styles || headerStyles(template.cache.header);
        const img = await templateImages(template);

        if (!active || !containerRef.current) return;

        const html = renderDocHTML(docs, template.styles, img, changed);
        containerRef.current.innerHTML = `<div class="docwrap"><div class="docscale">${html}</div></div>`;
        paginate(containerRef.current);
        fitDoc(containerRef.current);
      } catch (err: any) {
        if (active) setError(err.message || '문서를 렌더링하지 못했습니다.');
      } finally {
        if (active) setLoading(false);
      }
    };

    render();

    const handleResize = () => {
      if (containerRef.current) fitDoc(containerRef.current);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      active = false;
      window.removeEventListener('resize', handleResize);
    };
  }, [template, fields, tt]);

  return (
    <div ref={containerRef} className="docv">
      {loading && (
        <div className="docwrap">
          <div className="hint p-6 text-center text-muted">문서 미리보기를 생성하는 중…</div>
        </div>
      )}
      {error && (
        <div className="docwrap">
          <div className="hint p-6 text-center text-red-500">{error}</div>
        </div>
      )}
    </div>
  );
};

function renderDocHTML(
  docs: Array<{ name: string; doc: Document; decl: string }>,
  st: any,
  img: Record<string, string>,
  changed: Set<Element>
): string {
  const px = (v: number) => (v / HU).toFixed(1) + 'px';
  let curCols = 1;
  let curColW = 1e9;
  const spanSkip = new Set<Element>();

  const runHTML = (run: Element): string => {
    const c = st.char[run.getAttribute('charPrIDRef') || ''] || { size: 10, color: '#000' };
    let inner = '';
    for (const n of Array.from(run.childNodes)) {
      if (n.nodeType !== 1) continue;
      const el = n as Element;
      const k = ln(el);
      if (k === 't') {
        for (const x of Array.from(el.childNodes)) {
          if (x.nodeType === 3) inner += esc(x.nodeValue);
          else if (x.nodeType === 1) {
            const kk = ln(x as Element);
            if (kk === 'tab') inner += '<span class="tab"></span>';
            else if (kk === 'lineBreak') inner += '<br>';
            else if (/Space$/.test(kk)) inner += ' ';
          }
        }
      } else if (k === 'tbl') {
        if (!spanSkip.has(el)) inner += '</span>' + tblHTML(el) + '<span>';
      } else if (k === 'pic') {
        const ref = el.getElementsByTagNameNS('*', 'img')[0]?.getAttribute('binaryItemIDRef') || '';
        const sz = childEl(el, 'curSz') || childEl(el, 'sz');
        const w = +(sz?.getAttribute('width') || 3000);
        const h = +(sz?.getAttribute('height') || 3000);
        inner += img[ref]
          ? `<img src="${img[ref]}" style="width:${px(w)};height:${px(h)};vertical-align:bottom" alt="">`
          : `<span class="noimg" style="width:${px(w)};height:${px(h)}"></span>`;
      } else if (k === 'ctrl') {
        const an = childEl(el, 'autoNum');
        if (an && an.getAttribute('numType') === 'PAGE') inner += '<span class="pgnum"></span>';
      } else if (k === 'rect' || k === 'container') {
        for (const p of Array.from(el.getElementsByTagNameNS('*', 'p'))) {
          if (closest(p, ln(el)) === el) inner += paraHTML(p);
        }
      }
    }
    const fs = (c.size * 96) / 72;
    return `<span style="font-size:${fs.toFixed(1)}px;color:${c.color};${c.bold ? 'font-weight:700;' : ''}${
      c.italic ? 'font-style:italic;' : ''
    }${c.under ? 'text-decoration:underline;' : ''}${
      c.sp ? `letter-spacing:${(c.sp / 100).toFixed(2)}em;` : ''
    }${c.font ? `font-family:'${c.font}',var(--doc-font);` : ''}">${inner}</span>`;
  };

  const paraHTML = (p: Element): string => {
    const ps = st.para[p.getAttribute('paraPrIDRef') || ''] || { align: 'justify', ls: 160 };
    for (const k of ['left', 'right', 'indent', 'prev', 'next']) ps[k] = u32(ps[k]);
    const runs = childEls(p, 'run');
    let maxFs = 0;
    for (const r of runs) {
      const c = st.char[r.getAttribute('charPrIDRef') || ''];
      if (c) maxFs = Math.max(maxFs, c.size);
    }
    const ml = (ps.left || 0) + (ps.indent < 0 ? -ps.indent : 0);
    const style = `text-align:${ALIGN[ps.align] || 'justify'};margin:${px(ps.prev || 0)} ${px(
      ps.right || 0
    )} ${px(ps.next || 0)} ${px(ml)};${ps.indent ? `text-indent:${px(ps.indent)};` : ''}line-height:${(
      (ps.ls / 100) *
      1.0
    ).toFixed(2)};${maxFs ? `min-height:${(((maxFs * 96) / 72) * (ps.ls / 100)).toFixed(1)}px;` : ''}`;

    let extra = '';
    if (p.getAttribute('columnBreak') === '1' || p.getAttribute('pageBreak') === '1') {
      extra += 'break-before:column;';
    }

    let pre = '';
    if (curCols > 1) {
      for (const tb of [...p.getElementsByTagNameNS('*', 'tbl')].filter((x) => closest(x, 'p') === p)) {
        const pos = childEl(tb, 'pos');
        const sz = childEl(tb, 'sz');
        if (pos && pos.getAttribute('treatAsChar') === '0' && +(sz?.getAttribute('width') || 0) > curColW * 1.1) {
          spanSkip.add(tb);
          pre += `<div class="hspan" style="column-span:all">${tblHTML(tb)}</div>`;
        }
      }
    }
    const inner = runs.map(runHTML).join('');
    const onlyCtrl =
      pre &&
      !pText(p).trim() &&
      !p.getElementsByTagNameNS('*', 'pic').length &&
      ![...p.getElementsByTagNameNS('*', 'tbl')].some((x) => closest(x, 'p') === p && !spanSkip.has(x));
    return (
      pre +
      (onlyCtrl ? '' : `<div class="hp${changed.has(p) ? ' chg' : ''}" style="${style}${extra}">${inner || '&#8203;'}</div>`)
    );
  };

  const tblHTML = (tbl: Element): string => {
    const cells = cellsOf(tbl);
    if (!cells.length) return '';
    const C = Math.max(...cells.map((c) => c.c + c.cs));
    const R = Math.max(...cells.map((c) => c.r + c.rs));
    const colW = new Array(C).fill(null);
    for (const c of cells) {
      if (c.cs === 1) {
        const w = +(childEl(c.tc, 'cellSz')?.getAttribute('width') || 0);
        if (w && colW[c.c] == null) colW[c.c] = w;
      }
    }
    for (let pass = 0; pass < 3; pass++) {
      for (const c of cells) {
        const w = +(childEl(c.tc, 'cellSz')?.getAttribute('width') || 0);
        if (!w) continue;
        const ks = [...Array(c.cs).keys()].map((k) => c.c + k);
        const unk = ks.filter((k) => colW[k] == null);
        if (unk.length === 1) {
          const known = ks.filter((k) => colW[k] != null).reduce((a, k) => a + colW[k], 0);
          colW[unk[0]] = Math.max(200, w - known);
        }
      }
    }
    for (let k = 0; k < C; k++) {
      if (colW[k] == null) colW[k] = 3000;
    }
    const total = colW.reduce((a, b) => a + b, 0);

    let h = `<table class="ht" style="width:${px(total)}"><colgroup>${colW
      .map((w) => `<col style="width:${px(w)}">`)
      .join('')}</colgroup>`;

    const byR = new Map<number, any[]>();
    for (const c of cells) {
      if (!byR.has(c.r)) byR.set(c.r, []);
      byR.get(c.r)!.push(c);
    }
    for (let r = 0; r < R; r++) {
      h += '<tr>';
      for (const c of (byR.get(r) || []).sort((a, b) => a.c - b.c)) {
        const bf = st.bf[c.tc.getAttribute('borderFillIDRef') || ''] || {};
        const sz = childEl(c.tc, 'cellSz');
        const m =
          c.tc.getAttribute('hasMargin') === '1'
            ? childEl(c.tc, 'cellMargin')
            : childEl(tbl, 'inMargin') || childEl(c.tc, 'cellMargin');
        const mv = (k: string) => Math.max(0, u32(m?.getAttribute(k)));
        const va = (c.sub?.getAttribute('vertAlign') || 'CENTER').toLowerCase();
        h += `<td rowspan="${c.rs}" colspan="${c.cs}" style="border-left:${bf.l || 'none'};border-right:${
          bf.r || 'none'
        };border-top:${bf.t || 'none'};border-bottom:${bf.b || 'none'};${
          bf.fill ? `background:${bf.fill};` : ''
        }vertical-align:${va === 'top' ? 'top' : va === 'bottom' ? 'bottom' : 'middle'};height:${px(
          +(sz?.getAttribute('height') || 1000)
        )};padding:${
          m ? `${px(mv('top'))} ${px(mv('right'))} ${px(mv('bottom'))} ${px(mv('left'))}` : '2px 4px'
        }">${cellParas(c).map(paraHTML).join('')}</td>`;
      }
      h += '</tr>';
    }
    return h + '</table>';
  };

  return docs
    .map((d) => {
      const root = d.doc.documentElement;
      const pp = root.getElementsByTagNameNS('*', 'pagePr')[0];
      const mg = pp ? childEl(pp, 'margin') : null;
      const land = pp?.getAttribute('landscape') === 'NARROWLY';
      const W = (land ? +(pp?.getAttribute('height') || 0) : +(pp?.getAttribute('width') || 0)) || 59528;
      const H = (land ? +(pp?.getAttribute('width') || 0) : +(pp?.getAttribute('height') || 0)) || 84188;

      const g = (k: string) => Math.max(0, u32(mg?.getAttribute(k)));
      const L = g('left') || 5669,
        Rm = g('right') || 5669,
        T = g('top') || 4252,
        B = g('bottom') || 4252,
        HD = g('header'),
        FT = g('footer');
      const bodyW = W - L - Rm,
        bodyH = H - T - B - HD - FT;

      const cp = root.getElementsByTagNameNS('*', 'colPr')[0];
      const cols = Math.max(1, +(cp?.getAttribute('colCount') || 1));
      const gap = cols > 1 ? +(cp.getAttribute('sameGap') || 1134) : 0;
      const cl = cp ? childEl(cp, 'colLine') : null;
      const rule = cl && cl.getAttribute('type') !== 'NONE' ? `column-rule:1px solid ${cl.getAttribute('color') || '#000'};` : '';

      curCols = cols;
      curColW = (bodyW - gap * (cols - 1)) / cols;

      const hf = (name: string) => {
        const e = [...root.getElementsByTagNameNS('*', name)][0];
        const sub = e ? childEl(e, 'subList') : null;
        return sub ? childEls(sub, 'p').map(paraHTML).join('') : '';
      };

      const body = childEls(root, 'p').map(paraHTML).join('');
      const head = hf('header'),
        foot = hf('footer');
      curCols = 1;
      curColW = 1e9;

      return `<div class="hsec" data-w="${W}" data-h="${H}" data-l="${L}" data-t="${T}" data-hd="${HD}" data-ft="${FT}" data-b="${B}" data-bw="${bodyW}" data-bh="${bodyH}" data-gap="${gap}" data-cols="${cols}">
      <div class="flow" style="width:${px(bodyW)};height:${px(bodyH)};column-count:${cols};column-gap:${px(
        gap
      )};${rule}">${body}</div>
      <div class="hhead" hidden>${head}</div><div class="hfoot" hidden>${foot}</div></div>`;
    })
    .join('');
}

function paginate(box: HTMLElement) {
  const px = (v: number) => v / HU + 'px';
  let pageNo = 0;
  for (const sec of Array.from(box.querySelectorAll('.hsec')) as HTMLElement[]) {
    const d = sec.dataset as any;
    const flow = sec.querySelector('.flow') as HTMLElement;
    if (!flow) continue;
    const bw = +d.bw / HU,
      gap = +d.gap / HU,
      cols = +d.cols;

    if (cols === 1) {
      const pg = document.createElement('div');
      pg.className = 'hpage';
      pg.style.width = px(+d.w);
      pg.style.minHeight = px(+d.h);
      pg.style.padding = `${px(+d.t + +d.hd)} 0 ${px(+d.b + +d.ft)} ${px(+d.l)}`;
      flow.style.height = 'auto';
      flow.style.columnCount = '';
      flow.style.position = 'relative';
      pg.appendChild(flow);
      pageNo++;

      const head = sec.querySelector('.hhead')?.innerHTML || '',
        foot = sec.querySelector('.hfoot')?.innerHTML || '';
      if (head) {
        const h = document.createElement('div');
        h.className = 'hhf';
        h.style.cssText = `left:${px(+d.l)};top:${px(+d.t)};width:${px(+d.bw)}`;
        h.innerHTML = head;
        pg.appendChild(h);
      }
      if (foot) {
        const h = document.createElement('div');
        h.className = 'hhf';
        h.style.cssText = `left:${px(+d.l)};bottom:${px(+d.b)};width:${px(+d.bw)}`;
        h.innerHTML = foot;
        pg.appendChild(h);
      }
      pg.querySelectorAll('.hhf .pgnum').forEach((x) => (x.textContent = String(pageNo)));
      sec.replaceWith(pg);
      continue;
    }

    const used = Math.max(1, Math.round((flow.scrollWidth + gap) / ((bw - gap * (cols - 1)) / cols + gap)));
    const pages = Math.max(1, Math.ceil(used / cols));
    const head = sec.querySelector('.hhead')?.innerHTML || '',
      foot = sec.querySelector('.hfoot')?.innerHTML || '';
    const frag = document.createDocumentFragment();

    for (let k = 0; k < pages; k++) {
      pageNo++;
      const pg = document.createElement('div');
      pg.className = 'hpage';
      pg.style.width = px(+d.w);
      pg.style.height = px(+d.h);

      const vp = document.createElement('div');
      vp.className = 'hbody';
      vp.style.cssText = `left:${px(+d.l)};top:${px(+d.t + +d.hd)};width:${px(+d.bw)};height:${px(+d.bh)}`;
      const f = flow.cloneNode(true) as HTMLElement;
      f.style.position = 'absolute';
      f.style.left = -k * (bw + gap) + 'px';
      f.style.top = '0';
      vp.appendChild(f);
      pg.appendChild(vp);

      if (head) {
        const h = document.createElement('div');
        h.className = 'hhf';
        h.style.cssText = `left:${px(+d.l)};top:${px(+d.t)};width:${px(+d.bw)}`;
        h.innerHTML = head;
        pg.appendChild(h);
      }
      if (foot) {
        const h = document.createElement('div');
        h.className = 'hhf';
        h.style.cssText = `left:${px(+d.l)};bottom:${px(+d.b)};width:${px(+d.bw)}`;
        h.innerHTML = foot;
        pg.appendChild(h);
      }
      pg.querySelectorAll('.hhf .pgnum').forEach((x) => (x.textContent = String(pageNo)));
      frag.appendChild(pg);
    }
    sec.replaceWith(frag);
  }
}

function fitDoc(box: HTMLElement) {
  const wrap = box.querySelector('.docwrap') as HTMLElement;
  if (!wrap) return;
  const avail = wrap.clientWidth - 48;
  for (const pg of Array.from(box.querySelectorAll('.hpage')) as HTMLElement[]) {
    (pg.style as any).zoom = '';
    const k = Math.min(1, avail / pg.offsetWidth);
    if (k < 1) {
      (pg.style as any).zoom = k.toFixed(3);
    }
  }
}
