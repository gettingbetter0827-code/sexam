import JSZip from 'jszip';
import { Field, Rule, Template, TemplateCache } from '../types';
import { expand, expandRule, customRules, tokenValue, parseLoose, iso } from './tokens';

export const ln = (n: Element | Node): string => (n as Element).localName || '';

export function closest(el: Node | null, name: string): Element | null {
  let p: Node | null = el ? el.parentNode : null;
  while (p && p.nodeType === 1) {
    if (ln(p) === name) return p as Element;
    p = p.parentNode;
  }
  return null;
}

export function ownedTs(doc: Document): Map<Element, Element[]> {
  const map = new Map<Element, Element[]>();
  const ts = doc.getElementsByTagNameNS('*', 't');
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    const p = closest(t, 'p');
    if (!p) continue;
    if (!map.has(p)) map.set(p, []);
    map.get(p)!.push(t);
  }
  return map;
}

export function paraNodes(ts: Element[]): Node[] {
  const segs: Node[] = [];
  for (const t of ts) {
    for (let i = 0; i < t.childNodes.length; i++) {
      const c = t.childNodes[i];
      if (c.nodeType === 3) segs.push(c);
    }
  }
  return segs;
}

export function dropLineseg(p: Element) {
  for (const c of [...p.childNodes]) {
    if (c.nodeType === 1 && ln(c) === 'linesegarray') {
      p.removeChild(c);
    }
  }
}

export function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface Matcher {
  re: RegExp;
  lookup: Map<string, Rule>;
  t?: Template;
}

export function buildMatcher(rules: Rule[], t?: Template): Matcher {
  const act = rules.filter((r) => r.on && r.find);
  act.sort((a, b) => b.find.length - a.find.length);
  const alts = ['\\{\\{\\s*([^{}|]+?)\\s*(?:\\|\\s*([^{}]+?))?\\s*\\}\\}'].concat(
    act.map((r) => escRe(r.find))
  );
  const lookup = new Map(act.map((r) => [r.find, r]));
  return { re: new RegExp(alts.join('|'), 'g'), lookup, t };
}

export function replInfo(m: RegExpExecArray, matcher: Matcher, fields: Field[]): string | null {
  if (m[1] != null) {
    const v = tokenValue(m[1], m[2], {}, fields);
    return v == null ? null : v;
  }
  const r = matcher.lookup.get(m[0]);
  return r ? expandRule(r, matcher.t, fields) : null;
}

// 문단의 여러 텍스트 조각에 걸쳐 있어도 치환 (원래 글자 모양 유지: 첫 조각에 결과를 넣음)
export function replacePara(
  segs: Node[],
  matcher: Matcher,
  counter?: Record<string, number>,
  fields: Field[] = []
): boolean {
  const vals = segs.map((n) => n.nodeValue || '');
  const full = vals.join('');
  if (!full) return false;

  const ms: Array<{ s: number; e: number; rep: string }> = [];
  matcher.re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = matcher.re.exec(full))) {
    if (!m[0].length) {
      matcher.re.lastIndex++;
      continue;
    }
    const rep = replInfo(m, matcher, fields);
    if (rep == null || rep === m[0]) continue;
    ms.push({ s: m.index, e: m.index + m[0].length, rep });
    if (counter) {
      const k = m[1] != null ? '{{}}' : m[0];
      counter[k] = (counter[k] || 0) + 1;
    }
  }
  if (!ms.length) return false;

  const starts: number[] = [];
  let acc = 0;
  for (const v of vals) {
    starts.push(acc);
    acc += v.length;
  }

  const loc = (pos: number) => {
    for (let i = vals.length - 1; i >= 0; i--) {
      if (pos >= starts[i] && (pos < starts[i] + vals[i].length || i === vals.length - 1)) {
        return i;
      }
    }
    return 0;
  };

  for (let k = ms.length - 1; k >= 0; k--) {
    const { s, e, rep } = ms[k];
    const a = loc(s);
    const b = loc(e - 1);
    if (a === b) {
      const v = vals[a];
      const o = s - starts[a];
      vals[a] = v.slice(0, o) + rep + v.slice(o + (e - s));
    } else {
      vals[a] = vals[a].slice(0, s - starts[a]) + rep;
      for (let i = a + 1; i < b; i++) vals[i] = '';
      vals[b] = vals[b].slice(e - starts[b]);
    }
  }

  segs.forEach((n, i) => {
    if (n.nodeValue !== vals[i]) n.nodeValue = vals[i];
  });
  return true;
}

export function topTables(doc: Document): Element[] {
  return [...doc.getElementsByTagNameNS('*', 'tbl')].filter((t) => !closest(t, 'tbl'));
}

export function childEl(el: Node, name: string): Element | null {
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes[i];
    if (c.nodeType === 1 && ln(c) === name) return c as Element;
  }
  return null;
}

export function childEls(el: Node, name: string): Element[] {
  return [...el.childNodes].filter((c) => c.nodeType === 1 && ln(c) === name) as Element[];
}

export interface CellInfo {
  tc: Element;
  sub: Element | null;
  r: number;
  c: number;
  rs: number;
  cs: number;
  complex: boolean;
  text?: string;
}

export function cellsOf(tbl: Element): CellInfo[] {
  const out: CellInfo[] = [];
  for (const tr of childEls(tbl, 'tr')) {
    for (const tc of childEls(tr, 'tc')) {
      const ad = childEl(tc, 'cellAddr');
      const sp = childEl(tc, 'cellSpan');
      const sub = childEl(tc, 'subList');
      out.push({
        tc,
        sub,
        r: +(ad?.getAttribute('rowAddr') || 0),
        c: +(ad?.getAttribute('colAddr') || 0),
        rs: +(sp?.getAttribute('rowSpan') || 1),
        cs: +(sp?.getAttribute('colSpan') || 1),
        complex: !!tc.getElementsByTagNameNS('*', 'tbl').length,
      });
    }
  }
  return out;
}

export function cellParas(cell: { sub: Element | null }): Element[] {
  return cell.sub ? childEls(cell.sub, 'p') : [];
}

export function pText(p: Element, tsMap?: Map<Element, Element[]>): string {
  const ts = tsMap ? tsMap.get(p) : null;
  const list = ts || [...p.getElementsByTagNameNS('*', 't')].filter((t) => closest(t, 'p') === p);
  return paraNodes(list)
    .map((n) => n.nodeValue || '')
    .join('');
}

export function cellText(cell: { sub: Element | null }, tsMap?: Map<Element, Element[]>): string {
  return cellParas(cell)
    .map((p) => pText(p, tsMap))
    .join('\n');
}

export function setParaText(p: Element, text: string) {
  const doc = p.ownerDocument;
  const ts = [...p.getElementsByTagNameNS('*', 't')].filter((t) => closest(t, 'p') === p);
  if (ts.length) {
    const t = ts[0];
    while (t.firstChild) t.removeChild(t.firstChild);
    t.appendChild(doc.createTextNode(text));
    for (const x of ts.slice(1)) {
      if (x.parentNode) x.parentNode.removeChild(x);
    }
  } else if (text) {
    let run = childEl(p, 'run');
    const pre = p.prefix ? p.prefix + ':' : '';
    if (!run) {
      run = doc.createElementNS(p.namespaceURI, pre + 'run');
      run.setAttribute('charPrIDRef', '0');
      const ls = childEl(p, 'linesegarray');
      p.insertBefore(run, ls);
    }
    const rp = run.prefix ? run.prefix + ':' : '';
    const t = doc.createElementNS(run.namespaceURI, rp + 't');
    t.appendChild(doc.createTextNode(text));
    run.appendChild(t);
  }
  dropLineseg(p);
}

export function setCellText(cell: { sub: Element | null }, text: string) {
  const lines = text.split('\n');
  let ps = cellParas(cell);
  if (!ps.length) return;
  for (let i = 0; i < lines.length; i++) {
    if (i < ps.length) {
      setParaText(ps[i], lines[i]);
    } else {
      const last = ps[ps.length - 1];
      const np = last.cloneNode(true) as Element;
      if (last.parentNode) last.parentNode.insertBefore(np, last.nextSibling);
      setParaText(np, lines[i]);
      ps = cellParas(cell);
    }
  }
  for (let i = lines.length; i < ps.length; i++) {
    if (i >= 1 && ps[i].parentNode) {
      ps[i].parentNode!.removeChild(ps[i]);
    }
  }
}

export async function readTemplate(buf: ArrayBuffer): Promise<TemplateCache> {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files)
    .filter((n) => /^Contents\/section\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const ma = a.match(/\d+/);
      const mb = b.match(/\d+/);
      return (ma ? +ma[0] : 0) - (mb ? +mb[0] : 0);
    });
  if (!names.length) {
    throw new Error('본문(section) 파일을 찾지 못했습니다. 한글에서 hwpx로 저장한 파일인지 확인하세요.');
  }
  const sections: Array<{ name: string; xml: string }> = [];
  for (const n of names) {
    sections.push({ name: n, xml: await zip.file(n)!.async('string') });
  }
  const hf = zip.file('Contents/header.xml');
  return { sections, header: hf ? await hf.async('string') : '' };
}

const parser = new DOMParser();
const ser = new XMLSerializer();

export function parseXml(s: string): Document {
  const d = parser.parseFromString(s, 'application/xml');
  if (d.getElementsByTagName('parsererror').length) {
    throw new Error('XML 해석 실패');
  }
  return d;
}

export function xmlDecl(s: string): string {
  const m = /^\s*<\?xml[^>]*\?>/.exec(s);
  return m ? m[0] : '';
}

export function allRules(t: Template, fields: Field[]): Rule[] {
  return [...t.rules, ...customRules(fields)];
}

export function outName(t: Template, fields: Field[]): string {
  const matcher = buildMatcher(allRules(t, fields), t);
  const fake = [{ nodeValue: t.name.replace(/\.hwpx$/i, '') }];
  replacePara(fake as any, matcher, undefined, fields);
  return fake[0].nodeValue!.replace(/[\\/:*?"<>|]/g, '_') + '.hwpx';
}

export function countTables(cache: TemplateCache): number {
  let n = 0;
  for (const s of cache.sections) {
    n += topTables(parseXml(s.xml)).length;
  }
  return n;
}

export const DATE_RES = [
  /\d{4}[ \t]*\.[ \t]*\d{1,2}[ \t]*\.[ \t]*\d{1,2}[ \t]*\.?(?:[ \t]*\([월화수목금토일]\))?/g,
  /\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일(?:\s*\([월화수목금토일]\))?/g,
  /(?<![년\d])\d{1,2}\s*월\s*\d{1,2}\s*일(?:\s*\([월화수목금토일]\))?/g,
  /(?<![\d.])\d{1,2}\s*\.\s*\d{1,2}\s*\.?\s*\([월화수목금토일]\)/g,
];

export function docText(cache: TemplateCache): string {
  const texts: string[] = [];
  for (const s of cache.sections) {
    const d = parseXml(s.xml);
    for (const [, ts] of ownedTs(d)) {
      texts.push(
        paraNodes(ts)
          .map((n) => n.nodeValue || '')
          .join('')
      );
    }
  }
  return texts.join('\n');
}

export function eachLine(all: string, re: RegExp, fn: (m: RegExpExecArray, idx: number) => void) {
  let off = 0;
  for (const line of all.split('\n')) {
    re.lastIndex = 0;
    for (const m of line.matchAll(re)) {
      fn(m, off + (m.index || 0));
    }
    off += line.length + 1;
  }
}

export function findDates(all: string): Array<{ s: string; i: number }> {
  const hits: Array<{ s: string; i: number }> = [];
  const cov: Array<[number, number]> = [];
  for (const re of DATE_RES) {
    eachLine(all, re, (m, a) => {
      const b = a + m[0].length;
      if (cov.some(([x, y]) => a < y && b > x)) return;
      cov.push([a, b]);
      hits.push({ s: m[0].trim(), i: a });
    });
  }
  return hits.sort((x, y) => x.i - y.i);
}

export function analyzeDates(all: string) {
  const sy = +((/(\d{4})학년도/.exec(all) || [])[1]) || null;
  const hits = findDates(all)
    .map((h) => ({ ...h, d: parseLoose(h.s, sy) }))
    .filter((h): h is { s: string; i: number; d: Date } => h.d !== null);

  const D = '(?:\\d{4}\\s*[.년]\\s*)?\\d{1,2}\\s*[.월]\\s*\\d{1,2}\\s*[.일]?\\s*(?:\\([월화수목금토일]\\))?';
  let best: { a: Date; b: Date; score: number } | null = null;
  for (const m of all.matchAll(new RegExp(`(${D})\\s*~\\s*(${D})`, 'g'))) {
    const a = parseLoose(m[1], sy);
    let b = parseLoose(m[2], sy);
    if (!a || !b) continue;
    if (!/\d{4}/.test(m[2]) && /\d{4}/.test(m[1])) b.setFullYear(a.getFullYear());
    const span = (b.getTime() - a.getTime()) / 864e5;
    if (span < 1 || span > 21) continue;
    const ctxt = all.slice(Math.max(0, (m.index || 0) - 30), m.index).replace(/\n/g, ' ');
    const strong = /(중간고사|기말고사|지필|고사|시험)[^~]{0,8}(실시|기간)|기\s*간\s*:/.test(ctxt);
    const inside = new Set(hits.filter((h) => h.d >= a && h.d <= b).map((h) => h.d.getTime())).size;
    const score = (strong ? 10 : 0) + inside;
    if (!best || score > best.score) best = { a, b, score };
  }

  if (!best) return { sy, hits, days: [] };
  const days = [...new Set(hits.filter((h) => h.d >= best!.a && h.d <= best!.b).map((h) => h.d.getTime()))]
    .sort((x, y) => x - y)
    .map((x) => new Date(x));
  return { sy, hits, days };
}

export function rid(): string {
  return Math.random().toString(36).slice(2, 9);
}

export function suggest(cache: TemplateCache, t?: Partial<Template>): Rule[] {
  const all = docText(cache);
  const rules: Rule[] = [];
  const seen = new Set<string>();
  const add = (find: string, rep: string, on: boolean, note?: string) => {
    find = find.trim();
    if (!find || seen.has(find)) return;
    seen.add(find);
    rules.push({ id: rid(), find, rep, on, note });
  };
  const L = (re: RegExp, rep: string) => eachLine(all, re, (m) => add(m[0], rep, true));

  L(/[12]학기[ \t]*[1-4]차[ \t]*지필[ \t]*(?:평가|고사)|[12]학기[ \t]*(?:중간|기말)[ \t]*고사/g, '{학기}학기 {고사명}');
  L(/\d{4}학년도/g, '{학년도}학년도');
  L(/(?<!학기[ \t]*)[1-4]차[ \t]*지필[ \t]*(?:평가|고사)/g, '{고사명}');
  L(/(?<!학기[ \t]*)(?:중간|기말)고사/g, '{고사명}');
  L(/(?<!\d)[12]학기(?![ \t]*(?:[1-4]차|중간|기말))/g, '{학기}학기');
  L(/[가-힣]{1,10}고등학교/g, '{학교명}');
  L(/제[ \t]*\d{2}[ \t]*-[ \t]*\d+[ \t]*호/g, '{문서번호}');

  const an = analyzeDates(all);
  const O = an.days;
  if (t) {
    t.year = an.sy;
    t.oldDays = O.map(iso);
    t.oldStart = O.length ? iso(O[0]) : null;
  }
  if (O.length) L(/\([ \t]*\d+[ \t]*일간[ \t]*\)/g, '({고사일수}일간)');
  for (const h of an.hits) {
    if (seen.has(h.s)) continue;
    const i = O.findIndex((d) => d.getTime() === h.d.getTime());
    if (i >= 0) {
      add(h.s, i === O.length - 1 && i > 0 ? '{고사종료일|원본}' : `{${i + 1}일차|원본}`, true, 'date');
    } else if (O.length) {
      add(h.s, '{주이동|원본}', true, 'date');
    } else {
      add(h.s, '', false, 'date');
    }
  }
  return rules.slice(0, 80);
}

export function templateGrade(t: Template): number | null {
  try {
    const m = /([1-3])학년\s*[12]학기/.exec(docText(t.cache));
    return m ? +m[1] : null;
  } catch (e) {
    return null;
  }
}

const imgCache = new Map<string, Record<string, string>>();
export async function templateImages(t: Template): Promise<Record<string, string>> {
  if (imgCache.has(t.id)) return imgCache.get(t.id)!;
  const out: Record<string, string> = {};
  try {
    const zip = await JSZip.loadAsync(t.data);
    for (const n of Object.keys(zip.files)) {
      const m = /^BinData\/([^/]+)\.(png|jpe?g|gif|bmp|wmf|emf)$/i.exec(n);
      if (!m || /wmf|emf/i.test(m[2])) continue;
      const type = /png/i.test(m[2])
        ? 'image/png'
        : /gif/i.test(m[2])
        ? 'image/gif'
        : /bmp/i.test(m[2])
        ? 'image/bmp'
        : 'image/jpeg';
      out[m[1]] = URL.createObjectURL(new Blob([(await zip.file(n)!.async('uint8array')) as any], { type }));
    }
  } catch (e) {}
  imgCache.set(t.id, out);
  return out;
}

export const HU = 75; // HWPUNIT -> px (7200 / 96)
export const u32 = (v: any) => {
  v = +v || 0;
  return v > 2147483647 ? v - 4294967296 : v;
};

export function headerStyles(xml: string) {
  const st: {
    char: Record<string, any>;
    para: Record<string, any>;
    bf: Record<string, any>;
    font: Record<string, string>;
  } = { char: {}, para: {}, bf: {}, font: {} };
  if (!xml) return st;
  const d = parseXml(xml);

  for (const ff of d.getElementsByTagNameNS('*', 'fontface')) {
    if (ff.getAttribute('lang') === 'HANGUL') {
      for (const f of childEls(ff, 'font')) {
        st.font[f.getAttribute('id') || ''] = f.getAttribute('face') || '';
      }
    }
  }
  for (const c of d.getElementsByTagNameNS('*', 'charPr')) {
    const o: any = {
      size: (+c.getAttribute('height')! || 1000) / 100,
      color: c.getAttribute('textColor') || '#000',
    };
    o.bold = !!childEl(c, 'bold');
    o.italic = !!childEl(c, 'italic');
    const u = childEl(c, 'underline');
    o.under = u && u.getAttribute('type') !== 'NONE';
    const fr = childEl(c, 'fontRef');
    o.font = fr ? st.font[fr.getAttribute('hangul') || ''] : null;
    const sp = childEl(c, 'spacing');
    o.sp = sp ? +sp.getAttribute('hangul')! : 0;
    const ra = childEl(c, 'ratio');
    o.ratio = ra ? +ra.getAttribute('hangul')! : 100;
    st.char[c.getAttribute('id') || ''] = o;
  }
  for (const p of d.getElementsByTagNameNS('*', 'paraPr')) {
    const a = childEl(p, 'align');
    const g = (k: string) => {
      const e = p.getElementsByTagNameNS('*', k)[0];
      return e ? +e.getAttribute('value')! || 0 : 0;
    };
    const ls = p.getElementsByTagNameNS('*', 'lineSpacing')[0];
    st.para[p.getAttribute('id') || ''] = {
      align: (a?.getAttribute('horizontal') || 'JUSTIFY').toLowerCase(),
      left: g('left'),
      right: g('right'),
      indent: g('intent'),
      prev: g('prev'),
      next: g('next'),
      ls: ls && ls.getAttribute('type') === 'PERCENT' ? +ls.getAttribute('value')! : 160,
    };
  }
  for (const b of d.getElementsByTagNameNS('*', 'borderFill')) {
    const side = (k: string) => {
      const e = childEl(b, k);
      if (!e || e.getAttribute('type') === 'NONE') return 'none';
      const w = parseFloat(e.getAttribute('width') || '0.12') || 0.12;
      const t = e.getAttribute('type');
      return `${Math.max(1, Math.round(w * 3.78 * 10) / 10)}px ${
        t === 'DOUBLE_SLIM' || t === 'DOUBLE' ? 'double' : t === 'DASH' || t === 'DOT' ? 'dashed' : 'solid'
      } ${e.getAttribute('color') || '#000'}`;
    };
    const wb = b.getElementsByTagNameNS('*', 'winBrush')[0];
    const fc = wb?.getAttribute('faceColor');
    st.bf[b.getAttribute('id') || ''] = {
      l: side('leftBorder'),
      r: side('rightBorder'),
      t: side('topBorder'),
      b: side('bottomBorder'),
      fill: fc && fc !== 'none' ? fc : null,
    };
  }
  return st;
}

export const ALIGN: Record<string, string> = {
  justify: 'justify',
  center: 'center',
  right: 'right',
  left: 'left',
  distribute: 'justify',
  distribute_space: 'justify',
};
