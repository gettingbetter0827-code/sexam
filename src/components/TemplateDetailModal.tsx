import React, { useState, useMemo } from 'react';
import { Field, Rule, Source, Template } from '../types';
import { cellsOf, cellText, childEls, outName, parseXml, rid, suggest, topTables } from '../utils/hwpx';
import { dateOptions, expand, ruleOut } from '../utils/tokens';
import { bestOffset, fillTable, hwpCells } from '../utils/sheetPdf';
import { transform } from '../utils/timetable';
import { X, Plus, RotateCcw, Sparkles } from 'lucide-react';

interface TemplateDetailModalProps {
  template: Template;
  fields: Field[];
  sources: Source[];
  onClose: () => void;
  onUpdateTemplate: (updated: Template) => void;
  onToast: (msg: string) => void;
}

export const TemplateDetailModal: React.FC<TemplateDetailModalProps> = ({
  template,
  fields,
  sources,
  onClose,
  onUpdateTemplate,
  onToast,
}) => {
  const [tab, setTab] = useState<'rules' | 'tables' | 'preview'>('rules');
  const [tblSel, setTblSel] = useState<number>(0);
  const [showSrc, setShowSrc] = useState<boolean>(false);
  const [srcChoice, setSrcChoice] = useState<string>('');
  const [selectedText, setSelectedText] = useState<string>('');
  const [gridFocus, setGridFocus] = useState<{ r: number; c: number } | null>(null);

  // Calculate occurrences counter
  const counter: Record<string, number> = useMemo(() => {
    const c: Record<string, number> = {};
    try {
      transform(template, fields, null, { counter: c });
    } catch (e) {}
    return c;
  }, [template, fields]);

  // Compute table tabs for the template
  const tableTabs = useMemo(() => {
    const list: Array<{ si: number; ti: number; tbl: Element; doc: Document }> = [];
    template.cache.sections.forEach((sec, si) => {
      try {
        const doc = parseXml(sec.xml);
        topTables(doc).forEach((tbl, ti) => list.push({ si, ti, tbl, doc }));
      } catch (e) {}
    });
    return list;
  }, [template]);

  const handleToggleRule = (idx: number, on: boolean) => {
    const nextRules = [...template.rules];
    nextRules[idx] = { ...nextRules[idx], on };
    onUpdateTemplate({ ...template, rules: nextRules });
  };

  const handleUpdateRuleFind = (idx: number, find: string) => {
    const nextRules = [...template.rules];
    nextRules[idx] = { ...nextRules[idx], find };
    onUpdateTemplate({ ...template, rules: nextRules });
  };

  const handleUpdateRuleRep = (idx: number, rep: string) => {
    const nextRules = [...template.rules];
    const target = nextRules[idx];
    const nextOn = rep ? true : target.note === 'date' ? false : target.on;
    nextRules[idx] = { ...target, rep, on: nextOn };
    onUpdateTemplate({ ...template, rules: nextRules });
  };

  const handleDeleteRule = (idx: number) => {
    const nextRules = template.rules.filter((_, i) => i !== idx);
    onUpdateTemplate({ ...template, rules: nextRules });
  };

  const handleAddRule = (initialFind = '', initialRep = '') => {
    const newRule: Rule = {
      id: rid(),
      find: initialFind,
      rep: initialRep,
      on: true,
    };
    onUpdateTemplate({ ...template, rules: [...template.rules, newRule] });
  };

  const handleReSuggest = () => {
    const have = new Set(template.rules.map((r) => r.find));
    const add = suggest(template.cache, template).filter((r) => !have.has(r.find));
    if (add.length > 0) {
      onUpdateTemplate({ ...template, rules: [...template.rules, ...add] });
      onToast(`새 문구 ${add.length}개를 찾았습니다.`);
    } else {
      onToast('새로 찾은 문구가 없습니다.');
    }
  };

  // Cell edits
  const handleCellChange = (k: string, val: string, origVal: string) => {
    const nextCells = { ...template.cells };
    if (val !== origVal) {
      nextCells[k] = val;
    } else {
      delete nextCells[k];
    }
    onUpdateTemplate({ ...template, cells: nextCells });
  };

  const handleResetCurrentTable = (si: number, ti: number) => {
    const prefix = `${si}:${ti}:`;
    const nextCells = { ...template.cells };
    let cleared = 0;
    for (const k of Object.keys(nextCells)) {
      if (k.startsWith(prefix)) {
        delete nextCells[k];
        cleared++;
      }
    }
    onUpdateTemplate({ ...template, cells: nextCells });
    onToast(`표 입력을 원래대로 되돌렸습니다 (${cleared}칸).`);
  };

  // TSV paste handler
  const handlePasteTSV = (
    e: React.ClipboardEvent,
    startR: number,
    startC: number,
    R: number,
    C: number,
    pos: Record<string, any>,
    si: number,
    ti: number
  ) => {
    const txt = e.clipboardData.getData('text') || '';
    if (!/[\t\n]/.test(txt.replace(/\n$/, ''))) return;
    e.preventDefault();

    const rows = parseTSV(txt);
    const nextCells = { ...template.cells };

    rows.forEach((row, dr) => {
      let col = startC;
      row.forEach((val) => {
        let cc = pos[`${startR + dr}:${col}`];
        while (cc && (cc.r !== startR + dr || cc.c !== col) && col < C) {
          col++;
          cc = pos[`${startR + dr}:${col}`];
        }
        if (cc && !cc.complex) {
          nextCells[`${si}:${ti}:${cc.r}:${cc.c}`] = val;
        }
        col = cc ? cc.c + cc.cs : col + 1;
      });
    });

    onUpdateTemplate({ ...template, cells: nextCells });
    onToast(`${rows.length}줄을 표에 붙여 넣었습니다.`);
  };

  const handleTextSelection = () => {
    const s = String(window.getSelection() || '').trim();
    if (s && s.length <= 80) {
      setSelectedText(s);
    } else {
      setSelectedText('');
    }
  };

  const handleAddSelectedTextAsRule = () => {
    if (!selectedText) return;
    if (template.rules.some((r) => r.find === selectedText)) {
      onToast('이미 있는 문구입니다.');
      return;
    }
    handleAddRule(selectedText, '');
    setTab('rules');
    setSelectedText('');
    onToast(`'${selectedText}' 문구를 추가했습니다. 바꿀 내용을 입력하세요.`);
  };

  const dateOpts = useMemo(() => dateOptions(template, fields), [template, fields]);

  // Selected table
  const curTbl = tableTabs[tblSel];
  const { tableCells, R, C, posMap } = useMemo(() => {
    if (!curTbl) return { tableCells: [], R: 0, C: 0, posMap: {} };
    const cells = cellsOf(curTbl.tbl);
    const maxR = Math.max(-1, ...cells.map((c) => c.r + c.rs - 1)) + 1;
    const maxC = Math.max(-1, ...cells.map((c) => c.c + c.cs - 1)) + 1;
    const map: Record<string, any> = {};
    for (const c of cells) {
      for (let r = c.r; r < c.r + c.rs; r++) {
        for (let k = c.c; k < c.c + c.cs; k++) {
          map[`${r}:${k}`] = c;
        }
      }
    }
    return { tableCells: cells, R: maxR, C: maxC, posMap: map };
  }, [curTbl]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-surface border border-line rounded-xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-surface">
          <div className="min-w-0 pr-4">
            <h2 className="text-base font-bold text-ink truncate">{outName(template, fields)}</h2>
            <p className="text-xs text-muted truncate">양식 원본: {template.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="icon-btn hover:text-ink text-muted p-1"
            title="닫기"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="tabs bg-surface">
          <button
            type="button"
            className="tab"
            aria-selected={tab === 'rules'}
            onClick={() => setTab('rules')}
          >
            치환 규칙 <span className="n font-mono">({template.rules.length})</span>
          </button>
          <button
            type="button"
            className="tab"
            aria-selected={tab === 'tables'}
            onClick={() => setTab('tables')}
          >
            표 직접 입력 <span className="n font-mono">({tableTabs.length})</span>
          </button>
          <button
            type="button"
            className="tab"
            aria-selected={tab === 'preview'}
            onClick={() => setTab('preview')}
          >
            텍스트 미리보기
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-5 overflow-y-auto flex-1 bg-surface">
          {tab === 'rules' && (
            <div>
              <div className="rules">
                <div className="rule head">
                  <span></span>
                  <span className="font-semibold">양식 문구</span>
                  <span></span>
                  <span className="font-semibold">바꿀 값</span>
                  <span className="font-semibold">결과 미리보기</span>
                  <span className="font-semibold text-right">횟수</span>
                  <span></span>
                </div>

                {template.rules.map((r, i) => {
                  const warn = (r.on && !r.rep) || (!r.on && r.note === 'date' && !r.rep);
                  const isDateRule = r.note === 'date';
                  const known = isDateRule && dateOpts.some((o) => o[0] === r.rep);
                  const isCustomDate = isDateRule && r.rep && !known;

                  return (
                    <div
                      key={r.id}
                      className={`rule ${r.on ? '' : 'off'} ${warn ? 'warn' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={r.on}
                        onChange={(e) => handleToggleRule(i, e.target.checked)}
                        title="규칙 사용"
                      />
                      <input
                        type="text"
                        value={r.find}
                        onChange={(e) => handleUpdateRuleFind(i, e.target.value)}
                        className="find text-xs"
                        aria-label="양식에 있는 문구"
                      />
                      <span className="arrow">→</span>

                      {isDateRule ? (
                        <div className="repbox">
                          <select
                            className="dsel text-xs"
                            value={isCustomDate ? '__c' : r.rep || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === '__c') return;
                              handleUpdateRuleRep(i, val);
                            }}
                          >
                            <option value="">그대로 두기</option>
                            {dateOpts.map((o) => (
                              <option key={o[0]} value={o[0]}>
                                {o[1]}
                              </option>
                            ))}
                            <option value="__c">직접 입력</option>
                          </select>
                          {isCustomDate && (
                            <input
                              type="text"
                              value={r.rep}
                              onChange={(e) => handleUpdateRuleRep(i, e.target.value)}
                              className="rep text-xs"
                              placeholder="바꿀 내용"
                            />
                          )}
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={r.rep}
                          onChange={(e) => handleUpdateRuleRep(i, e.target.value)}
                          className="rep text-xs"
                          placeholder="바꿀 내용"
                        />
                      )}

                      <span className="out font-mono" title={ruleOut(r, template, fields)}>
                        {ruleOut(r, template, fields)}
                      </span>
                      <span className="cnt">{counter[r.find] || 0}</span>
                      <button
                        type="button"
                        className="icon-btn hover:text-red-500"
                        title="규칙 삭제"
                        onClick={() => handleDeleteRule(i)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-2.5 mt-4 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleAddRule()}
                  className="btn text-xs py-1.5"
                >
                  <Plus size={14} /> 문구 추가
                </button>
                <button
                  type="button"
                  onClick={handleReSuggest}
                  className="btn text-xs py-1.5"
                >
                  <Sparkles size={14} /> 다시 찾기
                </button>
              </div>
            </div>
          )}

          {tab === 'tables' && (
            <div>
              {tableTabs.length === 0 ? (
                <p className="hint p-6 text-center">이 양식에는 표가 없습니다.</p>
              ) : (
                <>
                  <div className="tables-nav flex gap-1.5 flex-wrap mb-3">
                    {tableTabs.map((x, i) => {
                      const cs = cellsOf(x.tbl);
                      const tR = Math.max(...cs.map((c) => c.r + c.rs));
                      const tC = Math.max(...cs.map((c) => c.c + c.cs));
                      const first = cs.map((c) => cellText(c)).find((s) => s.trim()) || '';
                      return (
                        <button
                          key={i}
                          type="button"
                          className="chip"
                          aria-pressed={i === tblSel}
                          onClick={() => setTblSel(i)}
                        >
                          표 {i + 1} · {tR}×{tC}
                          {first ? ` · ${first.slice(0, 10)}` : ''}
                        </button>
                      );
                    })}
                  </div>

                  {curTbl && (
                    <div className="gridwrap mb-3">
                      <table className="grid">
                        <tbody>
                          {Array.from({ length: R }).map((_, r) => (
                            <tr key={r}>
                              {Array.from({ length: C }).map((_, k) => {
                                const c = posMap[`${r}:${k}`];
                                if (!c || c.r !== r || c.c !== k) return null;
                                const kk = `${curTbl.si}:${curTbl.ti}:${c.r}:${c.c}`;
                                const isOverridden = kk in template.cells;
                                const origVal = cellText(c);
                                const currentVal = isOverridden ? template.cells[kk] : origVal;

                                return (
                                  <td
                                    key={k}
                                    rowSpan={c.rs}
                                    colSpan={c.cs}
                                    className={`${isOverridden ? 'ov' : ''} ${c.complex ? 'ro' : ''}`}
                                  >
                                    <textarea
                                      rows={Math.max(1, currentVal.split('\n').length)}
                                      value={currentVal}
                                      disabled={c.complex}
                                      aria-label={`${r + 1}행 ${k + 1}열`}
                                      onChange={(e) => handleCellChange(kk, e.target.value, origVal)}
                                      onFocus={() => setGridFocus({ r: c.r, c: c.c })}
                                      onPaste={(e) =>
                                        handlePasteTSV(
                                          e,
                                          r,
                                          k,
                                          R,
                                          C,
                                          posMap,
                                          curTbl.si,
                                          curTbl.ti
                                        )
                                      }
                                    />
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      className="btn text-xs py-1.5"
                      onClick={() => curTbl && handleResetCurrentTable(curTbl.si, curTbl.ti)}
                    >
                      <RotateCcw size={14} /> 이 표 되돌리기
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'preview' && (
            <div onMouseUp={handleTextSelection}>
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="text-xs text-muted">
                  미리보기 본문에서 바꿀 글자를 마우스로 드래그하여 선택하세요.
                </span>
                <button
                  type="button"
                  className="btn primary text-xs py-1.5"
                  disabled={!selectedText}
                  onClick={handleAddSelectedTextAsRule}
                >
                  선택한 글자 바꾸기
                </button>
              </div>

              <div className="preview bg-sunk p-4 rounded-xl max-h-[60vh] overflow-y-auto">
                <div className="page bg-white text-black p-8 rounded shadow max-w-2xl mx-auto text-xs leading-relaxed font-serif">
                  {template.cache.sections.map((sec, si) => {
                    const doc = parseXml(sec.xml);
                    const root = doc.documentElement;
                    return (
                      <div key={si} className="mb-6">
                        {childEls(root, 'p').map((p, pi) => {
                          const txt = cellText({ sub: p as any });
                          return (
                            <p key={pi} className="mb-1 min-h-[1em] whitespace-pre-wrap">
                              {txt || '\u200B'}
                            </p>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-line bg-surface flex justify-end">
          <button type="button" className="btn primary" onClick={onClose}>
            완료
          </button>
        </div>
      </div>
    </div>
  );
};

function parseTSV(s: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    f = '',
    q = false;
  s = s.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += ch;
    } else if (ch === '"' && f === '') q = true;
    else if (ch === '\t') {
      row.push(f);
      f = '';
    } else if (ch === '\n') {
      row.push(f);
      rows.push(row);
      row = [];
      f = '';
    } else f += ch;
  }
  row.push(f);
  rows.push(row);
  return rows;
}
