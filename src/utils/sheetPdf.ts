import * as XLSX from 'xlsx';
import { BlockCell, Field, Source, SourceBlock, Template } from '../types';
import { cellsOf, cellText, childEl, childEls, parseXml, setCellText, topTables } from './hwpx';
import { persistTemplate } from './storage';
import { fieldMap, iso } from './tokens';

export function cellStr(cell: any): string {
  if (!cell) return '';
  const v = cell.w != null ? cell.w : cell.v != null ? String(cell.v) : '';
  return v
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

export function oneLine(s: string, n: number): string {
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function mkBlock(title: string, cells: BlockCell[]): SourceBlock | null {
  const tx = cells.filter((a) => a.text);
  if (!tx.length) return null;
  const r0 = Math.min(...tx.map((a) => a.r));
  const r1 = Math.max(...tx.map((a) => a.r + a.rs - 1));
  const c0 = Math.min(...tx.map((a) => a.c));
  const c1 = Math.max(...tx.map((a) => a.c + a.cs - 1));
  const cs = cells.filter((a) => a.r >= r0 && a.r <= r1 && a.c <= c1 && a.c + a.cs - 1 >= c0 && a.c >= c0);
  return {
    title,
    rows: r1 - r0 + 1,
    cols: c1 - c0 + 1,
    cells: cs.map((a) => ({
      r: a.r - r0,
      c: a.c - c0,
      rs: Math.min(a.rs, r1 - a.r + 1),
      cs: Math.min(a.cs, c1 - a.c + 1),
      text: a.text,
    })),
  };
}

export function splitBlocks(sheet: string, anchors: BlockCell[]): SourceBlock[] {
  const rowsSet = new Set<number>();
  for (const a of anchors) {
    if (a.text) {
      for (let r = a.r; r < a.r + a.rs; r++) rowsSet.add(r);
    }
  }
  const rows = [...rowsSet].sort((a, b) => a - b);
  const groups: Array<{ r0: number; r1: number }> = [];
  for (const r of rows) {
    const g = groups[groups.length - 1];
    if (g && r === g.r1 + 1) g.r1 = r;
    else groups.push({ r0: r, r1: r });
  }
  const out: SourceBlock[] = [];
  for (const g of groups) {
    const cs = anchors.filter((a) => a.r >= g.r0 && a.r <= g.r1).sort((x, y) => x.r - y.r || x.c - y.c);
    if (cs.filter((a) => a.text).length < 2) continue;
    const b = mkBlock(`${sheet} › ${oneLine(cs.find((a) => a.text)!.text, 16)}`, cs);
    if (b) out.push(b);
  }
  if (out.length > 1) {
    const w = mkBlock(`${sheet} (시트 전체)`, anchors);
    if (w) out.unshift(w);
  } else if (!out.length) {
    const w = mkBlock(sheet, anchors);
    if (w) out.push(w);
  }
  return out;
}

export async function parseSheet(buf: ArrayBuffer): Promise<SourceBlock[]> {
  const wb = XLSX.read(buf, { type: 'array' });
  const blocks: SourceBlock[] = [];
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    if (!ws || !ws['!ref']) continue;
    const R = XLSX.utils.decode_range(ws['!ref']);
    const cov = new Set<string>();
    const anchors: BlockCell[] = [];
    for (const m of ws['!merges'] || []) {
      anchors.push({ r: m.s.r, c: m.s.c, rs: m.e.r - m.s.r + 1, cs: m.e.c - m.s.c + 1, text: '' });
      for (let r = m.s.r; r <= m.e.r; r++) {
        for (let c = m.s.c; c <= m.e.c; c++) cov.add(r + ':' + c);
      }
    }
    for (let r = R.s.r; r <= R.e.r; r++) {
      for (let c = R.s.c; c <= R.e.c; c++) {
        if (!cov.has(r + ':' + c)) anchors.push({ r, c, rs: 1, cs: 1, text: '' });
      }
    }
    for (const a of anchors) {
      a.text = cellStr(ws[XLSX.utils.encode_cell({ r: a.r, c: a.c })]);
    }
    blocks.push(...splitBlocks(sn, anchors));
  }
  return blocks;
}

const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/';
function loadScript(src: string): Promise<void> {
  return new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = src;
    sc.onload = () => res();
    sc.onerror = () => {
      sc.remove();
      rej(new Error('PDF 읽기 도구를 불러오지 못했습니다.'));
    };
    document.head.appendChild(sc);
  });
}

async function ensurePdfJs(): Promise<any> {
  const w = window as any;
  if (!w.pdfjsLib) {
    await loadScript(CDN + 'pdf.js/3.11.174/pdf.min.js');
  }
  if (!w.pdfjsWorker) {
    try {
      await loadScript(CDN + 'pdf.js/3.11.174/pdf.worker.min.js');
    } catch (e) {}
  }
  if (w.pdfjsLib && !w.pdfjsLib.GlobalWorkerOptions?.workerSrc) {
    w.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN + 'pdf.js/3.11.174/pdf.worker.min.js';
  }
  return w.pdfjsLib;
}

export function joinItems(its: any[], x1?: number | null): string {
  if (!its.length) return '';
  const rows: Array<{ y: number; items: any[] }> = [];
  const sorted = [...its].sort((a, b) => b.y - a.y || a.x - b.x);
  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(1.5, it.h * 0.45));
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  const ls = rows
    .sort((a, b) => b.y - a.y)
    .map((r) => {
      r.items.sort((a, b) => a.x - b.x);
      let s = '',
        end: number | null = null,
        h = 0;
      for (const it of r.items) {
        const gap = end == null ? 0 : it.x - end;
        s += (end != null && gap > it.h * 0.2 ? ' ' : '') + it.s;
        end = it.x + it.w;
        h = Math.max(h, it.h);
      }
      return { s: s.trim(), end, h };
    })
    .filter((l) => l.s);

  let out = '';
  ls.forEach((l, i) => {
    if (i === 0) {
      out = l.s;
      return;
    }
    const p = ls[i - 1];
    const wrapped = x1 != null && p.end != null && p.end > x1 - 1.8 * p.h;
    if (!wrapped) {
      out += '\n' + l.s;
      return;
    }
    const first = (l.s.match(/^[^\s(]+/) || [''])[0];
    const glue =
      /^[\/),.~]/.test(l.s) ||
      (/[가-힣]$/.test(p.s) && /^[가-힣]/.test(l.s) && first.length <= 1) ||
      /[\/(~]$/.test(p.s)
        ? ''
        : ' ';
    out += glue + l.s;
  });
  return out;
}

export function pdfTables(ol: any, view: number[], pdfjsLib: any) {
  const O = pdfjsLib.OPS;
  const pw = view[2] - view[0],
    ph = view[3] - view[1];
  let ctm = [1, 0, 0, 1, 0, 0];
  const st: any[] = [];
  let pend: any[] = [];
  const H: any[] = [],
    V: any[] = [];
  const mul = (m: number[], a: number[]) => [
    m[0] * a[0] + m[2] * a[1],
    m[1] * a[0] + m[3] * a[1],
    m[0] * a[2] + m[2] * a[3],
    m[1] * a[2] + m[3] * a[3],
    m[0] * a[4] + m[2] * a[5] + m[4],
    m[1] * a[4] + m[3] * a[5] + m[5],
  ];
  const tp = (x: number, y: number) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
  const PAINT = new Set([
    O.stroke,
    O.closeStroke,
    O.fill,
    O.eoFill,
    O.fillStroke,
    O.eoFillStroke,
    O.closeFillStroke,
    O.closeEOFillStroke,
  ]);
  const commit = () => {
    for (const s of pend) {
      if (s.r) {
        const xs = s.r.map((p: any) => p[0]);
        const ys = s.r.map((p: any) => p[1]);
        const x0 = Math.min(...xs),
          x1 = Math.max(...xs),
          y0 = Math.min(...ys),
          y1 = Math.max(...ys),
          w = x1 - x0,
          h = y1 - y0;
        if (w > pw * 0.95 && h > ph * 0.95) continue;
        if (w <= 2.5 && h > 2) V.push({ x: (x0 + x1) / 2, a: y0, b: y1 });
        else if (h <= 2.5 && w > 2) H.push({ y: (y0 + y1) / 2, a: x0, b: x1 });
        else if (w > 2 && h > 2) {
          H.push({ y: y0, a: x0, b: x1 }, { y: y1, a: x0, b: x1 });
          V.push({ x: x0, a: y0, b: y1 }, { x: x1, a: y0, b: y1 });
        }
      } else {
        const [p, q] = s.l;
        if (Math.abs(p[1] - q[1]) < 1 && Math.abs(p[0] - q[0]) > 2)
          H.push({ y: (p[1] + q[1]) / 2, a: Math.min(p[0], q[0]), b: Math.max(p[0], q[0]) });
        else if (Math.abs(p[0] - q[0]) < 1 && Math.abs(p[1] - q[1]) > 2)
          V.push({ x: (p[0] + q[0]) / 2, a: Math.min(p[1], q[1]), b: Math.max(p[1], q[1]) });
      }
    }
    pend = [];
  };

  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i],
      a = ol.argsArray[i];
    if (fn === O.save) st.push(ctm);
    else if (fn === O.restore) ctm = st.pop() || ctm;
    else if (fn === O.transform) ctm = mul(ctm, a);
    else if (fn === O.constructPath) {
      const ops = a[0],
        args = a[1];
      let k = 0,
        cp: any = null,
        start: any = null;
      for (const op of ops) {
        if (op === O.rectangle) {
          const [x, y, w, h] = args.slice(k, k + 4);
          k += 4;
          pend.push({ r: [tp(x, y), tp(x + w, y), tp(x + w, y + h), tp(x, y + h)] });
        } else if (op === O.moveTo) {
          cp = tp(args[k], args[k + 1]);
          start = cp;
          k += 2;
        } else if (op === O.lineTo) {
          const q = tp(args[k], args[k + 1]);
          k += 2;
          if (cp) pend.push({ l: [cp, q] });
          cp = q;
        } else if (op === O.curveTo) {
          k += 6;
          cp = null;
        } else if (op === O.curveTo2 || op === O.curveTo3) {
          k += 4;
          cp = null;
        } else if (op === O.closePath) {
          if (cp && start) pend.push({ l: [cp, start] });
          cp = start;
        }
      }
    }
    if (PAINT.has(fn)) commit();
    else if (fn === O.endPath) pend = [];
  }

  const segs = [...H.map((h) => ({ h, v: undefined })), ...V.map((v) => ({ v, h: undefined }))];
  const par = segs.map((_, i) => i);
  const f = (i: number): number => (par[i] === i ? i : (par[i] = f(par[i])));
  const T = 2;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const A = segs[i],
        B = segs[j];
      let hit = false;
      if ((A.h && B.v) || (A.v && B.h)) {
        const h = A.h || B.h,
          v = A.v || B.v;
        hit = v!.x >= h!.a - T && v!.x <= h!.b + T && h!.y >= v!.a - T && h!.y <= v!.b + T;
      } else if (A.h && B.h) {
        hit = Math.abs(A.h.y - B.h.y) <= T && A.h.a <= B.h.b + T && B.h.a <= A.h.b + T;
      } else {
        hit = Math.abs(A.v!.x - B.v!.x) <= T && A.v!.a <= B.v!.b + T && B.v!.a <= A.v!.b + T;
      }
      if (hit) par[f(i)] = f(j);
    }
  }

  const groups = new Map<number, { H: any[]; V: any[] }>();
  segs.forEach((s, i) => {
    const r = f(i);
    if (!groups.has(r)) groups.set(r, { H: [], V: [] });
    if (s.h) groups.get(r)!.H.push(s.h);
    else groups.get(r)!.V.push(s.v);
  });

  const clus = (vals: number[], desc?: boolean) => {
    vals = [...vals].sort((a, b) => a - b);
    const out: any[] = [];
    for (const v of vals) {
      const l = out[out.length - 1];
      if (l && v - l.max <= T) {
        l.max = v;
        l.sum += v;
        l.n++;
      } else out.push({ max: v, sum: v, n: 1 });
    }
    const r = out.map((o) => o.sum / o.n);
    return desc ? r.reverse() : r;
  };

  const tables: any[] = [];
  for (const g of groups.values()) {
    if (g.H.length < 2 || g.V.length < 2) continue;
    const xs = clus(g.V.map((v) => v.x));
    const ys = clus(
      g.H.map((h) => h.y),
      true
    );
    const R = ys.length - 1,
      C = xs.length - 1;
    if (R < 1 || C < 1 || R * C < 2) continue;
    const hasV = (x: number, ym: number) => g.V.some((v) => Math.abs(v.x - x) <= T && v.a < ym && v.b > ym);
    const hasH = (y: number, xm: number) => g.H.some((h) => Math.abs(h.y - y) <= T && h.a < xm && h.b > xm);
    const id = (i: number, j: number) => i * C + j;
    const P = [...Array(R * C).keys()];
    const F = (i: number): number => (P[i] === i ? i : (P[i] = F(P[i])));

    for (let i = 0; i < R; i++) {
      for (let j = 0; j < C; j++) {
        const ym = (ys[i] + ys[i + 1]) / 2,
          xm = (xs[j] + xs[j + 1]) / 2;
        if (j < C - 1 && !hasV(xs[j + 1], ym)) P[F(id(i, j))] = F(id(i, j + 1));
        if (i < R - 1 && !hasH(ys[i + 1], xm)) P[F(id(i, j))] = F(id(i + 1, j));
      }
    }
    const reg = new Map();
    for (let i = 0; i < R; i++) {
      for (let j = 0; j < C; j++) {
        const r = F(id(i, j));
        const e = reg.get(r);
        if (!e) reg.set(r, { i0: i, i1: i, j0: j, j1: j });
        else {
          e.i0 = Math.min(e.i0, i);
          e.i1 = Math.max(e.i1, i);
          e.j0 = Math.min(e.j0, j);
          e.j1 = Math.max(e.j1, j);
        }
      }
    }
    const cells = [...reg.values()]
      .map((e) => ({
        r: e.i0,
        c: e.j0,
        rs: e.i1 - e.i0 + 1,
        cs: e.j1 - e.j0 + 1,
        x0: xs[e.j0],
        x1: xs[e.j1 + 1],
        y1: ys[e.i0],
        y0: ys[e.i1 + 1],
      }))
      .sort((a, b) => a.r - b.r || a.c - b.c);
    tables.push({ rows: R, cols: C, top: ys[0], cells });
  }
  return tables.sort((a, b) => b.top - a.top);
}

export function heuristicBlock(items: any[], title: string): SourceBlock {
  items = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Array<{ y: number; items: any[] }> = [];
  for (const it of items) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(2, it.h * 0.45));
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  rows.sort((a, b) => b.y - a.y);
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    const m: any[] = [];
    for (const it of row.items) {
      const l = m[m.length - 1];
      const gap = l ? it.x - (l.x + l.w) : 1e9;
      if (l && gap < it.h * 0.9) {
        l.s += (gap > it.h * 0.2 ? ' ' : '') + it.s;
        l.w = it.x + it.w - l.x;
      } else m.push({ ...it });
    }
    row.items = m;
  }
  const xs = rows.flatMap((r) => r.items.map((i) => i.x)).sort((a, b) => a - b);
  const cols: Array<{ min: number; max: number }> = [];
  for (const x of xs) {
    const l = cols[cols.length - 1];
    if (!l || x - l.max > 12) cols.push({ min: x, max: x });
    else l.max = x;
  }
  const colOf = (x: number) => {
    let k = 0;
    for (let i = 0; i < cols.length; i++) {
      if (x >= cols[i].min - 1) k = i;
    }
    return k;
  };
  const cells: BlockCell[] = [];
  rows.forEach((row, ri) => {
    const by: Record<number, string> = {};
    for (const it of row.items) {
      const k = colOf(it.x);
      by[k] = by[k] ? by[k] + ' ' + it.s : it.s;
    }
    for (let c = 0; c < cols.length; c++) {
      cells.push({ r: ri, c, rs: 1, cs: 1, text: (by[c] || '').trim() });
    }
  });
  return { title, rows: rows.length, cols: cols.length, cells };
}

export async function parsePdf(buf: ArrayBuffer): Promise<SourceBlock[]> {
  const pdfjsLib = await ensurePdfJs();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const blocks: SourceBlock[] = [];
  for (let pn = 1; pn <= pdf.numPages; pn++) {
    const page = await pdf.getPage(pn);
    const tc = await page.getTextContent();
    const items = tc.items
      .filter((i: any) => i.str && i.str.trim())
      .map((i: any) => ({
        x: i.transform[4],
        y: i.transform[5],
        w: i.width,
        h: Math.abs(i.transform[3]) || Math.abs(i.transform[2]) || 10,
        s: i.str,
      }));
    if (!items.length) continue;
    let tables: any[] = [];
    try {
      tables = pdfTables(await page.getOperatorList(), page.view, pdfjsLib);
    } catch (e) {
      tables = [];
    }
    let k = 0;
    for (const tb of tables) {
      const cells: BlockCell[] = tb.cells.map((c: any) => {
        const its = items.filter((it: any) => {
          const cx = it.x + Math.min(it.w, it.h) / 2,
            cy = it.y + it.h * 0.35;
          return cx > c.x0 && cx < c.x1 && cy > c.y0 && cy < c.y1;
        });
        return { r: c.r, c: c.c, rs: c.rs, cs: c.cs, text: joinItems(its, c.x1) };
      });
      if (cells.filter((c) => c.text).length < 2) continue;
      k++;
      blocks.push({
        title: `${pn}쪽 표 ${k} · ${oneLine(cells.find((c) => c.text)!.text, 14)}`,
        rows: tb.rows,
        cols: tb.cols,
        cells,
      });
    }
    if (!k) blocks.push(heuristicBlock(items, `${pn}쪽 (선 없음 · 위치로 추정)`));
  }
  return blocks;
}

export const norm = (s: any) => String(s || '').replace(/\s+/g, '');

export function hwpCells(t: Template, si: number, ti: number) {
  const doc = parseXml(t.cache.sections[si].xml);
  const tbl = topTables(doc)[ti];
  return tbl ? cellsOf(tbl).map((c) => ({ r: c.r, c: c.c, complex: c.complex, text: cellText(c) })) : [];
}

export function bestOffset(hc: Array<{ r: number; c: number; text: string }>, block: SourceBlock) {
  const idx = new Map<string, BlockCell[]>();
  for (const s of block.cells) {
    const k = norm(s.text);
    if (!k) continue;
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k)!.push(s);
  }
  const votes = new Map<string, number>();
  for (const h of hc) {
    const k = norm(h.text);
    if (!k || k.length > 40) continue;
    for (const s of idx.get(k) || []) {
      const o = s.r - h.r + ',' + (s.c - h.c);
      votes.set(o, (votes.get(o) || 0) + 1);
    }
  }
  let best: string | null = null,
    n = 0;
  for (const [o, v] of votes) {
    if (v > n) {
      n = v;
      best = o;
    }
  }
  if (!best) return { dr: 0, dc: 0, n: 0 };
  const [dr, dc] = best.split(',').map(Number);
  return { dr, dc, n };
}

export function fillTable(t: Template, si: number, ti: number, block: SourceBlock, dr: number, dc: number) {
  const hc = hwpCells(t, si, ti);
  const pos = new Map(block.cells.map((s) => [s.r + ':' + s.c, s]));
  let filled = 0,
    changedN = 0;
  for (const h of hc) {
    if (h.complex) continue;
    const s = pos.get(h.r + dr + ':' + (h.c + dc));
    if (!s) continue;
    const k = `${si}:${ti}:${h.r}:${h.c}`;
    filled++;
    if (s.text !== h.text) {
      t.cells[k] = s.text;
      changedN++;
    } else delete t.cells[k];
  }
  persistTemplate(t);
  return { filled, changed: changedN };
}

export function blockOf(v: string, sources: Source[]) {
  const [a, b] = String(v || '').split(':').map(Number);
  const s = sources[a];
  return s && s.blocks[b] ? { src: s, block: s.blocks[b] } : null;
}

export function datesFromSource(src: Source, fields: Field[]): string[] {
  const txt = src.blocks.map((b) => b.cells.map((c) => c.text).join('\n')).join('\n');
  const sy =
    +((/(\d{4})학년도/.exec(txt) || [])[1]) || +(fieldMap(fields)['학년도']?.value) || new Date().getFullYear();
  const set = new Set<string>();
  for (const m of txt.matchAll(/(?<!\d)(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)) set.add(`${m[1]}-${m[2]}`);
  for (const m of txt.matchAll(/(?<![\d.])(\d{1,2})\s*\.\s*(\d{1,2})\s*\.?\s*\([월화수목금토일]\)/g))
    set.add(`${m[1]}-${m[2]}`);
  let ds = [...set]
    .map((k) => {
      const [mo, da] = k.split('-').map(Number);
      return mo >= 1 && mo <= 12 && da >= 1 && da <= 31 ? new Date(sy + (mo < 3 ? 1 : 0), mo - 1, da) : null;
    })
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  let best: Date[] = [],
    curr: Date[] = [];
  for (const d of ds) {
    if (curr.length && (d.getTime() - curr[curr.length - 1].getTime()) / 864e5 > 4) {
      if (curr.length > best.length) best = curr;
      curr = [];
    }
    curr.push(d);
  }
  if (curr.length > best.length) best = curr;
  return best.length >= 2 && best.length <= 15 ? best.map(iso) : [];
}
