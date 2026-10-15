import { Field, Rule, Template } from '../types';

export const DOW = '일월화수목금토';

export function parseDate(s?: string | null): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

export function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 양식에 적힌 날짜 글자를 그대로 흉내 내어 숫자·요일만 바꿈 (예: "10.1.(목)" → "12.8.(화)")
export function mimic(orig: string, d: Date): string {
  let s = orig;
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const dd = d.getDate();
  const w = DOW[d.getDay()];

  s = s.replace(/\d{4}/, String(y));
  let i = 0;
  s = s.replace(/(?<!\d)\d{1,2}(?!\d)/g, (x) => {
    i++;
    return i === 1 ? String(m) : i === 2 ? String(dd) : x;
  });
  return s.replace(/[월화수목금토일](?=\s*\))/, w);
}

export function parseLoose(s: string, sy?: number | null): Date | null {
  let m = /(\d{4})\s*[.년]\s*(\d{1,2})\s*[.월]\s*(\d{1,2})/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);

  m = /(\d{1,2})\s*[.월]\s*(\d{1,2})/.exec(s);
  if (!m) return null;
  const mo = +m[1];
  const da = +m[2];
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;

  const y = (sy || new Date().getFullYear()) + (sy && mo < 3 ? 1 : 0);
  return new Date(y, mo - 1, da);
}

export function fmtDate(d?: Date | null, f?: string, ctx?: { orig?: string }): string {
  if (!d) return '';
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const dd = d.getDate();
  const w = DOW[d.getDay()];

  switch ((f || '').trim()) {
    case '원본':
      return ctx && ctx.orig ? mimic(ctx.orig, d) : `${y}. ${m}. ${dd}.(${w})`;
    case '월일':
      return `${m}. ${dd}.`;
    case '월일요일':
      return `${m}. ${dd}.(${w})`;
    case '짧게':
      return `${m}.${dd}(${w})`;
    case '짧게점':
      return `${m}.${dd}.(${w})`;
    case '한글':
      return `${y}년 ${m}월 ${dd}일`;
    case '한글월일':
      return `${m}월 ${dd}일`;
    case '한글월일요일':
      return `${m}월 ${dd}일(${w})`;
    case '요일':
      return w;
    case '점요일':
      return `${y}. ${m}. ${dd}.(${w})`;
    default:
      return `${y}. ${m}. ${dd}.`;
  }
}

export function fieldMap(fields: Field[]): Record<string, Field> {
  const m: Record<string, Field> = {};
  for (const f of fields) m[f.key] = f;
  return m;
}

export function examDays(fields: Field[]): Date[] {
  const f = fieldMap(fields)['시험일'];
  const arr = Array.isArray(f?.value) ? f.value : [];
  return [...new Set(arr)]
    .map((s) => parseDate(s as string))
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());
}

export function tokenValue(
  key: string,
  fmt: string | undefined,
  ctx: { orig?: string; t?: Template } | undefined,
  fields: Field[]
): string | null {
  key = key.trim();
  const fm = fieldMap(fields);
  const days = examDays(fields);

  const nd = /^(\d+)일차$/.exec(key);
  if (nd) {
    const d = days[+nd[1] - 1];
    return d ? fmtDate(d, fmt || '월일요일', ctx) : null;
  }
  if (key === '고사시작일') return days.length ? fmtDate(days[0], fmt, ctx) : null;
  if (key === '고사종료일') return days.length ? fmtDate(days[days.length - 1], fmt, ctx) : null;
  if (key === '고사일수') return days.length ? String(days.length) : null;
  if (key === '고사기간') {
    if (!days.length) return null;
    const s = days[0];
    const e = days[days.length - 1];
    return fmt === '한글'
      ? `${fmtDate(s, '한글월일요일')} ~ ${fmtDate(e, '한글월일요일')}`
      : `${fmtDate(s, '점요일')} ~ ${fmtDate(e, '월일요일')}`;
  }
  if (key === '주이동') {
    const t = ctx && ctx.t;
    if (!t || !t.oldStart || !ctx.orig || !days.length) return null;
    const od = parseLoose(ctx.orig, t.year);
    if (!od) return null;
    const oldStartDate = parseDate(t.oldStart);
    if (!oldStartDate) return null;
    const w = Math.round((days[0].getTime() - oldStartDate.getTime()) / (7 * 864e5));
    const n = new Date(od);
    n.setDate(n.getDate() + 7 * w);
    return fmtDate(n, fmt || '원본', ctx);
  }

  const f = fm[key];
  if (!f) return null;
  if (f.type === 'date') {
    const d = parseDate(f.value);
    return d ? fmtDate(d, fmt, ctx) : '';
  }
  return f.value ?? '';
}

export const TOKEN_RE = /\{\{?\s*([^{}|]+?)\s*(?:\|\s*([^{}]+?))?\s*\}\}?/g;

export function expand(str: string, ctx: { orig?: string; t?: Template } | undefined, fields: Field[]): string {
  return str.replace(TOKEN_RE, (all, k, f) => {
    const v = tokenValue(k, f, ctx, fields);
    return v == null ? all : v;
  });
}

// 규칙 결과: 값이 비었거나 없는 값을 쓰면 null → 원래 글자를 그대로 둠
export function expandRule(r: Rule, t: Template | undefined, fields: Field[]): string | null {
  if (!r.rep) return '';
  let bad = false;
  const out = r.rep.replace(TOKEN_RE, (all, k, f) => {
    const v = tokenValue(k, f, { orig: r.find, t }, fields);
    if (v == null) {
      bad = true;
      return all;
    }
    return v;
  });

  if (bad) return null;
  if (out === '' && /\{/.test(r.rep)) return null;
  return out;
}

export function ruleOut(r: Rule, t: Template | undefined, fields: Field[]): string {
  if (!r.rep) return r.note === 'date' ? '그대로' : '(지움)';
  const v = expandRule(r, t, fields);
  return v == null ? '그대로 (값 없음)' : v;
}

export function customRules(fields: Field[]): Rule[] {
  return fields
    .filter((f) => f.type === 'custom' && f.key && f.key.trim())
    .map((f, i) => ({
      id: 'c' + i,
      find: f.key,
      rep: String(f.value ?? '').replace(/[{}]/g, ''),
      on: true,
      custom: true,
    }));
}

export function dateOptions(t: Template, fields: Field[]): Array<[string, string]> {
  const days = examDays(fields);
  const n = Math.max(days.length, (t.oldDays || []).length, 1);
  const o: Array<[string, string]> = [];
  for (let k = 1; k <= n; k++) {
    const v = tokenValue(`${k}일차`, '짧게', undefined, fields);
    o.push([`{${k}일차|원본}`, `${k}일차${v ? ` · ${v}` : ''}`]);
  }
  o.push(['{고사종료일|원본}', '마지막 날']);
  if (t.oldStart) o.push(['{주이동|원본}', '일정만큼 이동']);
  for (const f of fields) {
    if (f.type === 'date') o.push([`{${f.key}|원본}`, f.key]);
  }
  return o;
}

