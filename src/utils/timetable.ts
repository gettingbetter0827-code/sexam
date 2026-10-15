import JSZip from 'jszip';
import { BlockCell, Field, Source, SourceBlock, Template, TTData, TTEntry } from '../types';
import {
  allRules,
  buildMatcher,
  cellsOf,
  cellParas,
  cellText,
  childEl,
  childEls,
  closest,
  dropLineseg,
  ln,
  outName,
  ownedTs,
  paraNodes,
  parseXml,
  replacePara,
  setCellText,
  templateGrade,
  topTables,
  xmlDecl,
} from './hwpx';
import { expand, fieldMap, fmtDate, mimic } from './tokens';

const ser = new XMLSerializer();

export const DATE_CELL = /(\d{1,2})\s*월\s*(\d{1,2})\s*일|(?<![\d.])(\d{1,2})\s*\.\s*(\d{1,2})\s*\.?\s*\(\s*[월화수목금토일]/;

export function cellMD(t: string): [number, number] | null {
  const m = DATE_CELL.exec(t || '');
  if (!m) return null;
  return m[1] ? [+m[1], +m[2]] : [+m[3], +m[4]];
}

export const nk = (s: any): string => String(s || '').replace(/\s+/g, '');
export const nk2 = (s: any): string =>
  nk(s)
    .replace(/Ⅰ/g, 'I')
    .replace(/Ⅱ/g, 'II')
    .replace(/Ⅲ/g, 'III')
    .replace(/\(.*?\)/g, '');

export function parseGrid(cells: BlockCell[]) {
  const rows = new Map<number, BlockCell[]>();
  for (const c of cells) {
    if (!rows.has(c.r)) rows.set(c.r, []);
    rows.get(c.r)!.push(c);
  }
  const R = Math.max(-1, ...cells.map((c) => c.r + c.rs - 1)) + 1;
  const at = (r: number, k: number) =>
    cells.find((c) => r >= c.r && r < c.r + c.rs && k >= c.c && k < c.c + c.cs);
  const heads: Array<{ r: number; ds: BlockCell[] }> = [];
  for (const [r, cs] of rows) {
    const ds = cs.filter((c) => cellMD(c.text) && nk(c.text).length <= 16);
    if (ds.length >= 2) heads.push({ r, ds: ds.sort((a, b) => a.c - b.c) });
  }
  heads.sort((a, b) => a.r - b.r);
  const out: any[] = [];

  heads.forEach((h, hi) => {
    const hr = h.r,
      dEnd = Math.max(...h.ds.map((d) => d.r + d.rs));
    const pc = (rows.get(hr) || []).find((c) => nk(c.text) === '교시');
    const bc = (rows.get(hr) || []).find((c) => nk(c.text) === '본령');
    if (!pc) return;
    const pcol = pc.c,
      bcol = bc ? bc.c : null;
    const gRow = (rows.get(dEnd) || []).some((c) => /^[1-3]학년$/.test(nk(c.text))) ? dEnd : null;
    const start = gRow != null ? gRow + 1 : dEnd;
    const stop = hi + 1 < heads.length ? heads[hi + 1].r : R;
    const sec = {
      head: h,
      gRow,
      bcol,
      pcol,
      dates: h.ds.map((d) => ({ md: cellMD(d.text)!, c0: d.c, c1: d.c + d.cs - 1, cell: d })),
      body: [] as any[],
    };

    for (let r = start; r < stop; r++) {
      const pcell = at(r, pcol);
      if (!pcell || (pcell.r !== r && pcell.rs === 1)) continue;
      const pm = /^(\d)(?:교시)?(?:\(.*\))?$/.exec(nk(pcell.text));
      if (!pm) continue;
      const period = +pm[1];
      const bcell = bcol != null ? at(r, bcol) : null;
      const items: any[] = [];

      for (const c of rows.get(r) || []) {
        if (c.c === pcol || c.c === bcol || c.c < Math.min(...sec.dates.map((d) => d.c0))) continue;
        const keys: any[] = [];
        for (let k = c.c; k < c.c + c.cs; k++) {
          const di = sec.dates.findIndex((d) => k >= d.c0 && k <= d.c1);
          if (di < 0) continue;
          const g = gRow != null ? (/([1-3])학년/.exec(nk(at(gRow, k)?.text)) || [])[1] : null;
          keys.push({ di, grade: g ? +g : null });
        }
        const uniq: any[] = [];
        for (const x of keys) {
          if (!uniq.some((y) => y.di === x.di && y.grade === x.grade)) uniq.push(x);
        }
        if (uniq.length) items.push({ cell: c, keys: uniq });
      }
      sec.body.push({ r, period, pcell, bcell, items });
    }
    out.push(sec);
  });
  return out;
}

export function parseSubj(text: string) {
  const t = text.replace(/\s+/g, ' ').trim();
  const mm = /(\d+)\s*분/.exec(t);
  const w = /※\s*(\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})\s*대기/.exec(t);
  const rest = w ? t.slice(0, w.index) + t.slice(w.index + w[0].length) : t;
  const tm = [...rest.matchAll(/(\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})/g)].pop();
  let cut = t.search(/\(\s*\d+\s*분/);
  if (cut < 0) cut = t.search(/\(\s*\d{1,2}:\d{2}/);
  const subjRaw = (cut >= 0 ? t.slice(0, cut) : t.split(' (')[0]).trim();
  const names = subjRaw
    .split('/')
    .map((x) => x.replace(/\([^)]*\)/g, '').trim())
    .filter(Boolean);
  const after = tm ? rest.slice(rest.indexOf(tm[0]) + tm[0].length).replace(/^\s*\)\s*/, '').trim() : '';
  return {
    subj: subjRaw,
    names,
    min: mm ? +mm[1] : null,
    start: tm ? tm[1] : null,
    end: tm ? tm[2] : null,
    wait: w ? ([w[1], w[2]] as [string, string]) : null,
    teachers: after,
  };
}

export function parseRange(b: SourceBlock) {
  const H = b.cells.filter((c) => c.r <= 2);
  const colName = (k: number) => {
    const hs = H.filter((c) => k >= c.c && k < c.c + c.cs)
      .sort((a, b) => a.r - b.r)
      .map((c) => nk(c.text))
      .filter(Boolean);
    return hs[hs.length - 1] || '';
  };
  const C = Math.max(...b.cells.map((c) => c.c + c.cs));
  const names: string[] = [];
  for (let k = 0; k < C; k++) names.push(colName(k));
  const map: Record<string, number> = {};
  names.forEach((n, k) => {
    if (n === '과목명') map['과목명'] = k;
    else if (/코드/.test(n)) map['과목코드'] = k;
    else if (/시간/.test(n)) map['시간'] = k;
    else if (/선택형/.test(n)) map['선택형'] = k;
    else if (/서논술/.test(n)) map['서논술형'] = k;
    else if (/범위/.test(n)) map['범위'] = k;
    else if (/교사/.test(n)) map['교사'] = k;
  });
  if (map['과목명'] == null) return null;
  const hr = Math.max(...H.filter((c) => /과목명|배점|범위/.test(c.text)).map((c) => c.r + c.rs - 1)) + 1;
  const rows: any[] = [];
  const byR = new Map<number, Record<number, string>>();
  for (const c of b.cells) {
    if (c.r < hr) continue;
    if (!byR.has(c.r)) byR.set(c.r, {});
    byR.get(c.r)![c.c] = c.text;
  }
  for (const [, o] of [...byR].sort((a, b) => a[0] - b[0])) {
    const first = Object.entries(o).sort((a, b) => +a[0] - +b[0])[0];
    if (first && /예시/.test(first[1])) continue;
    const nm = o[map['과목명']];
    if (!nm || !nm.trim()) continue;
    const x: Record<string, string> = {};
    for (const k in map) x[k] = (o[map[k]] || '').trim();
    rows.push(x);
  }
  return rows.length ? { rows } : null;
}

export function getTT(sources: Source[], fields: Field[]): TTData | null {
  const sy = +(fieldMap(fields)['학년도']?.value) || new Date().getFullYear();
  const ent: any[] = [];
  const bon: Record<number, string> = {};
  const mds = new Set<string>();
  const ranges: any[] = [];
  const codes: Record<string, string> = {};

  for (const src of sources) {
    for (const b of src.blocks) {
      const secs = parseGrid(b.cells);
      for (const sec of secs) {
        for (const d of sec.dates) mds.add(d.md.join('-'));
        for (const row of sec.body) {
          if (row.bcell && row.bcell.text.trim()) {
            bon[row.period] = bon[row.period] || row.bcell.text.trim();
          }
          for (const it of row.items) {
            const txt = it.cell.text.trim();
            if (!txt) continue;
            for (const k of it.keys) {
              ent.push({
                md: sec.dates[k.di].md.join('-'),
                grade: k.grade,
                period: row.period,
                text: txt,
              });
            }
          }
        }
      }
      const hdr = b.cells.filter((c) => c.r <= 1);
      if (hdr.some((c) => nk(c.text) === '과목명') && hdr.some((c) => /범위/.test(c.text))) {
        const g =
          +((/([1-3])학년/.exec(b.title + ' ' + b.cells.map((c) => c.text).join(' ')) || [])[1]) || null;
        const rg: any = parseRange(b);
        if (rg) {
          rg.grade = g;
          ranges.push(rg);
          for (const x of rg.rows) {
            if (x['과목코드']) codes[nk2(x['과목명'])] = x['과목코드'];
          }
        }
      }
    }
  }

  if (!ent.length && !ranges.length) return null;
  const days = [...mds]
    .map((k) => {
      const [m, d] = k.split('-').map(Number);
      return { k, date: new Date(sy + (m < 3 ? 1 : 0), m - 1, d) };
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const seen = new Set<string>();
  const entries: TTEntry[] = ent
    .filter((e) => {
      const k = e.md + '|' + e.grade + '|' + e.period;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((e) => ({
      ...e,
      day: days.findIndex((d) => d.k === e.md),
      ...parseSubj(e.text),
    }));

  return { days, entries, bon, ranges, codes };
}

export function allTables(doc: Document): Element[] {
  return [...doc.getElementsByTagNameNS('*', 'tbl')];
}

export function tcCells(tbl: Element) {
  return cellsOf(tbl).map((c) => ({ ...c, text: cellText(c) }));
}

export function setTc(c: any, text: string, skip: Set<Element>, changed: Set<Element>) {
  if (c.complex) return;
  if (cellText(c) === text) return;
  setCellText(c, text);
  for (const p of cellParas(c)) {
    skip.add(p);
    changed.add(p);
  }
}

export function pad2(t: string): string {
  return t.replace(/^(\d):/, '0$1:');
}

export function autoFill(
  doc: Document,
  t: Template,
  tt: TTData,
  skip: Set<Element>,
  changed: Set<Element>
) {
  for (const tbl of allTables(doc)) {
    const cells = tcCells(tbl);
    if (!cells.length) continue;
    const hdr = cells.filter((c) => c.r === 0).map((c) => nk(c.text));
    if (hdr.includes('시험일') && hdr.includes('교시') && hdr.some((h) => /과목/.test(h))) {
      if (t.grade && tt.entries.length) fillList(tbl, cells, t, tt, skip, changed);
      continue;
    }
    if (hdr.some((h) => /등교/.test(h)) && hdr.some((h) => /시작/.test(h))) {
      fillArrive(cells, t, tt, skip, changed);
      continue;
    }
    if (hdr.includes('과목명') && hdr.some((h) => /범위/.test(h))) {
      fillRange(tbl, cells, t, tt, skip, changed);
      continue;
    }
    if (tt.entries.length) {
      const secs = parseGrid(cells as any);
      if (secs.length) fillGrid(secs, tt, skip, changed);
    }
  }
}

export function fillGrid(secs: any[], tt: TTData, skip: Set<Element>, changed: Set<Element>) {
  for (const sec of secs) {
    sec.dates.forEach((d: any, i: number) => {
      const nd = tt.days[i];
      if (nd) setTc(d.cell, mimic(d.cell.text.trim(), nd.date), skip, changed);
    });
    for (const row of sec.body) {
      if (row.bcell && tt.bon[row.period]) setTc(row.bcell, tt.bon[row.period], skip, changed);
      for (const it of row.items) {
        const texts: string[] = [];
        for (const k of it.keys) {
          const e = tt.entries.find(
            (e) =>
              e.day === k.di &&
              e.period === row.period &&
              (k.grade == null || e.grade === k.grade || e.grade == null)
          );
          if (e && !texts.includes(e.text)) texts.push(e.text);
        }
        setTc(it.cell, texts.join('\n'), skip, changed);
      }
    }
  }
}

export function subjInfo(cells: any[]) {
  const map: Record<string, { name: string; unit: string; code: string }> = {};
  const byR = new Map<number, any[]>();
  for (const c of cells) {
    if (!byR.has(c.r)) byR.set(c.r, []);
    byR.get(c.r)!.push(c);
  }
  const hdr = cells.filter((c) => c.r === 0);
  const col = (re: RegExp) => hdr.find((c) => re.test(nk(c.text)))?.c;
  const sc = col(/과목명/);
  const cc = col(/코드/);

  for (const [r, cs] of byR) {
    if (r === 0) continue;
    const s = cs.find((c) => c.c === sc);
    const k = cs.find((c) => c.c === cc);
    if (!s) continue;
    const ls = s.text.split('\n');
    const ks = (k?.text || '').split(/\n|\s+/).filter(Boolean);
    ls.forEach((l: string, i: number) => {
      const m = /^(.*?)\s*\((\d+)\)\s*$/.exec(l.trim());
      const nm = m ? m[1] : l.trim();
      if (!nm) return;
      map[nk2(nm)] = { name: nm.trim(), unit: m ? m[2] : '', code: ks[i] || '' };
    });
  }
  return map;
}

export function rebuildBody(
  tbl: Element,
  hdrN: number,
  data: any[][],
  skip: Set<Element>,
  changed: Set<Element>
) {
  const trs = childEls(tbl, 'tr');
  const body = trs.slice(hdrN);
  if (!body.length || !data.length) return;

  const proto: Record<number, Element> = {};
  for (const tr of body) {
    for (const tc of childEls(tr, 'tc')) {
      const c = +childEl(tc, 'cellAddr')!.getAttribute('colAddr')!;
      const sp = childEl(tc, 'cellSpan');
      if (
        !proto[c] &&
        (+sp!.getAttribute('colSpan')! || 1) === 1 &&
        (+sp!.getAttribute('rowSpan')! || 1) === 1 &&
        !tc.getElementsByTagNameNS('*', 'tbl').length
      ) {
        proto[c] = tc;
      }
    }
  }
  for (const tr of body) {
    for (const tc of childEls(tr, 'tc')) {
      const c = +childEl(tc, 'cellAddr')!.getAttribute('colAddr')!;
      if (!proto[c]) proto[c] = tc;
    }
  }

  const anchor = body[body.length - 1].nextSibling;
  const trProto = body[0];
  for (const tr of body) tbl.removeChild(tr);

  data.forEach((row, i) => {
    const tr = trProto.cloneNode(false) as Element;
    let rowH = 0;
    for (const cell of row) {
      const p = proto[cell.c];
      if (!p) continue;
      const tc = p.cloneNode(true) as Element;
      const rs = cell.rs || 1;
      childEl(tc, 'cellAddr')!.setAttribute('rowAddr', String(hdrN + i));
      childEl(tc, 'cellSpan')!.setAttribute('rowSpan', String(rs));
      const sz = childEl(tc, 'cellSz');
      const ph = +(childEl(p, 'cellSz')?.getAttribute('height') || 1400);
      const lines = String(cell.text).split('\n').length;
      const h = Math.max(ph / (+childEl(p, 'cellSpan')!.getAttribute('rowSpan')! || 1), 1200 * lines + 300);
      if (sz) sz.setAttribute('height', String(Math.round(h * rs)));
      if (rs === 1) rowH = Math.max(rowH, h);
      const obj = { sub: childEl(tc, 'subList') };
      setCellText(obj, String(cell.text));
      for (const q of cellParas(obj)) {
        skip.add(q);
        changed.add(q);
      }
      tr.appendChild(tc);
    }
    tbl.insertBefore(tr, anchor);
  });
  tbl.setAttribute('rowCnt', String(hdrN + data.length));
}

export function fillList(
  tbl: Element,
  cells: any[],
  t: Template,
  tt: TTData,
  skip: Set<Element>,
  changed: Set<Element>
) {
  const hdr = cells.filter((c) => c.r === 0);
  const col = (re: RegExp) => hdr.find((c) => re.test(nk(c.text)))?.c;
  const cD = col(/시험일/),
    cP = col(/^교시/),
    cS = col(/과목명/),
    cC = col(/코드/),
    cT = col(/시간/);
  const info = subjInfo(cells);
  const es = tt.entries.filter((e) => e.grade === t.grade && e.day >= 0);
  if (!es.length) return;
  const data: any[][] = [];
  const byDay = new Map<number, TTEntry[]>();
  for (const e of es) {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day)!.push(e);
  }

  for (const [di, list] of [...byDay].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => a.period - b.period);
    list.forEach((e, k) => {
      const row: any[] = [];
      if (k === 0 && cD != null) {
        row.push({
          c: cD,
          rs: list.length,
          text: `제${di + 1}일\n${fmtDate(tt.days[di].date, '짧게')}`,
        });
      }
      if (cP != null) row.push({ c: cP, text: `${e.period}교시` });
      const nm = e.names.length ? e.names : [e.subj];
      if (cS != null) {
        row.push({
          c: cS,
          text: nm
            .map((n) => {
              const x = info[nk2(n)];
              const nn = x?.name || n;
              return x?.unit ? `${nn}(${x.unit})` : nn;
            })
            .join('\n'),
        });
      }
      if (cC != null) {
        row.push({
          c: cC,
          text: nm.map((n) => tt.codes[nk2(n)] || info[nk2(n)]?.code || '').join('\n'),
        });
      }
      if (cT != null && e.start) {
        const tm = `${pad2(e.start)}~${pad2(e.end || '')}${e.min ? ` (${e.min}분)` : ''}`;
        row.push({
          c: cT,
          text: e.wait ? `※대기 ${e.wait[0]}~${e.wait[1]}\n${tm}` : tm,
        });
      } else if (cT != null) row.push({ c: cT, text: '' });
      data.push(row);
    });
  }
  rebuildBody(tbl, 1, data, skip, changed);
}

export function fillArrive(
  cells: any[],
  t: Template,
  tt: TTData,
  skip: Set<Element>,
  changed: Set<Element>
) {
  const hdr = cells.filter((c) => c.r === 0);
  const cA = hdr.find((c) => /등교/.test(c.text))?.c,
    cS = hdr.find((c) => /시작/.test(c.text))?.c;
  for (const c of cells) {
    if (c.r === 0) continue;
    const g = /([1-3])학년/.exec(nk(c.text));
    if (!g || c.c !== 0) continue;
    const es = tt.entries.filter((e) => e.grade === +g[1]);
    if (!es.length) continue;
    const p = Math.min(...es.map((e) => e.period));
    const st = (tt.bon[p] || es.find((e) => e.period === p)?.start || '').match(/(\d{1,2}):(\d{2})/);
    if (!st) continue;
    const m = +st[1] * 60 + +st[2],
      a = m - 20;
    const fmt = (orig: string, mins: number) => {
      const hh = String(Math.floor(mins / 60)).padStart(2, '0');
      const mm = String(mins % 60).padStart(2, '0');
      return / : /.test(orig) ? `${hh} : ${mm}` : `${hh}:${mm}`;
    };
    const sc = cells.find((x) => x.r === c.r && x.c === cS);
    const ac = cells.find((x) => x.r === c.r && x.c === cA);
    if (sc) setTc(sc, fmt(sc.text, m), skip, changed);
    if (ac) setTc(ac, fmt(ac.text, a), skip, changed);
  }
}

export function fillRange(
  tbl: Element,
  cells: any[],
  t: Template,
  tt: TTData,
  skip: Set<Element>,
  changed: Set<Element>
) {
  const rg =
    tt.ranges.find((r) => r.grade === t.grade) ||
    (tt.ranges.length === 1 ? tt.ranges[0] : null);
  if (!rg) return;
  const hN = Math.max(...cells.filter((c) => c.r === 0).map((c) => c.rs));
  const C = Math.max(...cells.map((c) => c.c + c.cs));
  const H = cells.filter((c) => c.r < hN);
  const leaf = (k: number) => {
    const hs = H.filter((c) => k >= c.c && k < c.c + c.cs)
      .sort((a, b) => a.r - b.r)
      .map((c) => nk(c.text));
    return hs[hs.length - 1] || '';
  };
  const key = (n: string) =>
    n === '과목명'
      ? '과목명'
      : /코드/.test(n)
      ? '과목코드'
      : /시간/.test(n)
      ? '시간'
      : /선택형/.test(n)
      ? '선택형'
      : /서논술/.test(n)
      ? '서논술형'
      : /범위/.test(n)
      ? '범위'
      : /교사/.test(n)
      ? '교사'
      : null;
  const cols: Array<{ c: number; kk: string }> = [];
  for (let k = 0; k < C; k++) {
    const kk = key(leaf(k));
    if (kk) cols.push({ c: k, kk });
  }
  const sample = cells.find((c) => c.r >= hN && cols.find((x) => x.kk === '시간' && x.c === c.c));
  const withMin = sample ? /분/.test(sample.text) : true;
  const data = rg.rows.map((x: any) =>
    cols.map(({ c, kk }) => ({
      c,
      text:
        kk === '시간' && withMin && x[kk] && !/분/.test(x[kk])
          ? x[kk] + '분'
          : x[kk] || '',
    }))
  );
  rebuildBody(tbl, hN, data, skip, changed);
}

export function transform(
  t: Template,
  fields: Field[],
  tt?: TTData | null,
  options?: { counter?: Record<string, number> }
) {
  const matcher = buildMatcher(allRules(t, fields), t);
  const out: Array<{ name: string; doc: Document; decl: string }> = [];
  const changed = new Set<Element>();
  t.grade = t.grade ?? templateGrade(t);

  t.cache.sections.forEach((sec, si) => {
    const doc = parseXml(sec.xml);
    const skip = new Set<Element>();
    if (tt) {
      try {
        autoFill(doc, t, tt, skip, changed);
      } catch (e) {
        console.warn(e);
      }
    }
    topTables(doc).forEach((tbl, ti) => {
      for (const cell of cellsOf(tbl)) {
        const k = `${si}:${ti}:${cell.r}:${cell.c}`;
        if (k in t.cells && !cell.complex) {
          setCellText(cell, expand(t.cells[k], {}, fields));
          for (const p of cellParas(cell)) {
            skip.add(p);
            changed.add(p);
          }
        }
      }
    });

    const map = ownedTs(doc);
    for (const [p, ts] of map) {
      if (skip.has(p)) continue;
      if (replacePara(paraNodes(ts), matcher, options?.counter, fields)) {
        dropLineseg(p);
        changed.add(p);
      }
    }
    out.push({ name: sec.name, doc, decl: xmlDecl(sec.xml) });
  });

  return { docs: out, changed };
}

export async function buildHwpx(t: Template, fields: Field[], tt?: TTData | null): Promise<Blob> {
  const { docs } = transform(t, fields, tt);
  const zip = await JSZip.loadAsync(t.data);
  const plain: string[] = [];
  for (const d of docs) {
    zip.file(
      d.name,
      (d.decl || '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>') +
        ser.serializeToString(d.doc).replace(/^\s*<\?xml[^>]*\?>/, ''),
      { createFolders: false }
    );
    const map = ownedTs(d.doc);
    for (const [p, ts] of map) {
      if (!closest(p, 'tbl')) {
        plain.push(
          paraNodes(ts)
            .map((n) => n.nodeValue || '')
            .join('')
        );
      }
    }
  }
  if (zip.file('mimetype')) {
    const mt = await zip.file('mimetype')!.async('string');
    zip.file('mimetype', mt, { compression: 'STORE', createFolders: false });
  }
  if (zip.file('Preview/PrvText.txt')) {
    zip.file('Preview/PrvText.txt', plain.join('\r\n').slice(0, 1024), { createFolders: false });
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/hwp+zip' });
}

export function zipBase(fields: Field[]): string {
  return expand('{학년도}학년도 {학기}학기 {고사명} 양식', undefined, fields).replace(/[\\/:*?"<>|]/g, '_');
}

export async function saveFiles(files: Array<{ name: string; blob: Blob }>, fields: Field[]): Promise<string> {
  if (files.length === 1) {
    anchor(files[0].name, files[0].blob);
    return `${files[0].name} 다운로드 완료`;
  }
  const z = new JSZip();
  for (const f of files) z.file(f.name, f.blob);
  const zipName = `${zipBase(fields)}.zip`;
  anchor(zipName, await z.generateAsync({ type: 'blob' }));
  return `${files.length}개 파일 (${zipName}) 다운로드 완료`;
}

function anchor(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 2000);
}
