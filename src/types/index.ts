export interface Field {
  key: string;
  value: any;
  type?: 'text' | 'date' | 'dates' | 'custom';
}

export interface Rule {
  id: string;
  find: string;
  rep: string;
  on: boolean;
  note?: string;
  custom?: boolean;
}

export interface TemplateSection {
  name: string;
  xml: string;
}

export interface TemplateCache {
  sections: TemplateSection[];
  header: string;
}

export interface Template {
  id: string;
  name: string;
  data: ArrayBuffer;
  rules: Rule[];
  cells: Record<string, string>;
  pick?: boolean;
  cache: TemplateCache;
  builtin?: boolean;
  ord?: number;
  grade?: number | null;
  year?: number | null;
  oldDays?: string[];
  oldStart?: string | null;
  tables?: number;
  styles?: any;
}

export interface BlockCell {
  r: number;
  c: number;
  rs: number;
  cs: number;
  text: string;
}

export interface SourceBlock {
  title: string;
  rows: number;
  cols: number;
  cells: BlockCell[];
}

export interface Source {
  id: string;
  name: string;
  kind: 'pdf' | 'xlsx';
  blocks: SourceBlock[];
}

export interface TTEntry {
  md: string;
  grade: number | null;
  period: number;
  text: string;
  day: number;
  subj: string;
  names: string[];
  min: number | null;
  start: string | null;
  end: string | null;
  wait: [string, string] | null;
  teachers: string;
}

export interface TTData {
  days: Array<{ k: string; date: Date }>;
  entries: TTEntry[];
  bon: Record<number, string>;
  ranges: any[];
  codes: Record<string, string>;
}
