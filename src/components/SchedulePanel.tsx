import React from 'react';
import { Field } from '../types';
import { examDays, fmtDate, iso, parseDate } from '../utils/tokens';
import { Plus, X } from 'lucide-react';

interface SchedulePanelProps {
  fields: Field[];
  onChange: (fields: Field[]) => void;
}

export const SchedulePanel: React.FC<SchedulePanelProps> = ({ fields, onChange }) => {
  const updateField = (key: string, value: any) => {
    const next = fields.map((f) => (f.key === key ? { ...f, value } : f));
    onChange(next);
  };

  const yearField = fields.find((f) => f.key === '학년도') || { key: '학년도', value: '2026' };
  const semField = fields.find((f) => f.key === '학기') || { key: '학기', value: '2' };
  const examField = fields.find((f) => f.key === '고사명') || { key: '고사명', value: '기말고사' };
  const datesField = fields.find((f) => f.key === '시험일') || { key: '시험일', type: 'dates', value: [] };
  const customList = fields.filter((f) => f.type === 'custom');

  const examDateList: string[] = Array.isArray(datesField.value) ? datesField.value : [];
  const days = examDays(fields);

  const handleYearDelta = (delta: number) => {
    const current = +yearField.value || new Date().getFullYear();
    updateField('학년도', String(current + delta));
  };

  const handleAddDay = () => {
    const lastStr = examDateList[examDateList.length - 1];
    const last = parseDate(lastStr);
    let nextDate: Date;
    if (last) {
      nextDate = new Date(last);
      do {
        nextDate.setDate(nextDate.getDate() + 1);
      } while (nextDate.getDay() % 6 === 0); // skip Sat/Sun
    } else {
      nextDate = new Date();
    }
    const updated = [...examDateList, iso(nextDate)].sort();
    updateField('시험일', updated);
  };

  const handleRemoveDay = (index: number) => {
    const updated = examDateList.filter((_, idx) => idx !== index);
    updateField('시험일', updated);
  };

  const handleDateChange = (index: number, val: string) => {
    const updated = [...examDateList];
    updated[index] = val;
    updateField('시험일', updated.filter(Boolean).sort());
  };

  const handleAddCustom = () => {
    const next = [...fields, { key: '', value: '', type: 'custom' as const }];
    onChange(next);
  };

  const handleCustomChange = (index: number, keyVal: string, textVal: string) => {
    let customIdx = 0;
    const next = fields.map((f) => {
      if (f.type === 'custom') {
        if (customIdx === index) {
          customIdx++;
          return { ...f, key: keyVal, value: textVal };
        }
        customIdx++;
      }
      return f;
    });
    onChange(next);
  };

  const handleRemoveCustom = (index: number) => {
    let customIdx = 0;
    const next = fields.filter((f) => {
      if (f.type === 'custom') {
        const match = customIdx === index;
        customIdx++;
        return !match;
      }
      return true;
    });
    onChange(next);
  };

  return (
    <aside>
      <section className="panel">
        <div className="hd">
          <h2>학사 일정</h2>
        </div>
        <div className="bd">
          <div className="fields">
            {/* 학년도 */}
            <div className="field">
              <label htmlFor="f_year">
                <span>학년도</span>
              </label>
              <div className="stepper">
                <button
                  type="button"
                  className="st"
                  onClick={() => handleYearDelta(-1)}
                  aria-label="1년 앞으로"
                >
                  ▼
                </button>
                <input
                  id="f_year"
                  type="number"
                  inputMode="numeric"
                  min="2000"
                  max="2100"
                  value={yearField.value || ''}
                  onChange={(e) => {
                    if (/^\d{0,4}$/.test(e.target.value)) {
                      updateField('학년도', e.target.value);
                    }
                  }}
                />
                <button
                  type="button"
                  className="st"
                  onClick={() => handleYearDelta(1)}
                  aria-label="1년 뒤로"
                >
                  ▲
                </button>
              </div>
            </div>

            {/* 학기 */}
            <div className="field">
              <label htmlFor="f_sem">
                <span>학기</span>
              </label>
              <select
                id="f_sem"
                className="pick"
                value={semField.value || '2'}
                onChange={(e) => updateField('학기', e.target.value)}
              >
                <option value="1">1학기</option>
                <option value="2">2학기</option>
              </select>
            </div>

            {/* 고사명 */}
            <div className="field">
              <label htmlFor="f_exam">
                <span>고사명</span>
              </label>
              <select
                id="f_exam"
                className="pick"
                value={examField.value || '기말고사'}
                onChange={(e) => updateField('고사명', e.target.value)}
              >
                <option value="중간고사">중간고사</option>
                <option value="기말고사">기말고사</option>
                <option value="1차 지필평가">1차 지필평가</option>
                <option value="2차 지필평가">2차 지필평가</option>
              </select>
            </div>

            {/* 시험일 */}
            <div className="field">
              <label>
                <span title="공휴일을 빼고 실제 시험 보는 날만 입력">시험일</span>
              </label>
              <div className="flex flex-col gap-2">
                {examDateList.map((dStr, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <span className="font-mono text-xs text-muted w-11 shrink-0 font-semibold">
                      {idx + 1}일차
                    </span>
                    <input
                      type="date"
                      value={dStr}
                      aria-label={`${idx + 1}일차 시험일`}
                      onChange={(e) => handleDateChange(idx, e.target.value)}
                      className="flex-1 text-xs"
                    />
                    <button
                      type="button"
                      className="icon-btn text-muted hover:text-red-500"
                      onClick={() => handleRemoveDay(idx)}
                      title="이 날 빼기"
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={handleAddDay}
                  className="btn text-xs py-1.5 mt-1 border border-line bg-surface hover:border-accent text-accent font-semibold"
                >
                  <Plus size={14} /> 날짜 추가
                </button>
              </div>
            </div>

            {/* 시험일 요약 표시 */}
            {days.length > 0 && (
              <div className="exd flex items-center justify-between text-xs">
                <span>
                  {fmtDate(days[0], '짧게')} ~ {fmtDate(days[days.length - 1], '짧게')}
                </span>
                <span className="bg-accent-soft text-accent px-2 py-0.5 rounded font-bold">
                  총 {days.length}일
                </span>
              </div>
            )}
          </div>

          {/* 추가 정보 (글자 치환 규칙) */}
          <div className="xhd">
            <h3>추가 정보</h3>
            <button
              type="button"
              className="icon-btn text-xs font-semibold text-accent hover:bg-accent-soft px-2 py-1 rounded"
              onClick={handleAddCustom}
            >
              ＋ 추가
            </button>
          </div>
          <div className="xlist">
            {customList.length === 0 ? (
              <p className="hint xempty text-xs leading-relaxed text-muted">
                양식 속 특정 문구를 바꿀 때 추가하세요.
                <br />
                예) 제26-154호 → 제26-201호
              </p>
            ) : (
              customList.map((c, i) => (
                <div key={i} className="xrow">
                  <input
                    type="text"
                    placeholder="양식 속 글자"
                    value={c.key || ''}
                    onChange={(e) => handleCustomChange(i, e.target.value, c.value || '')}
                    aria-label="양식 속 글자"
                  />
                  <span className="xar">→</span>
                  <input
                    type="text"
                    placeholder="바꿀 글자"
                    value={c.value || ''}
                    onChange={(e) => handleCustomChange(i, c.key || '', e.target.value)}
                    aria-label="바꿀 글자"
                  />
                  <button
                    type="button"
                    className="icon-btn hover:text-red-500"
                    title="삭제"
                    onClick={() => handleRemoveCustom(i)}
                  >
                    <X size={15} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </aside>
  );
};
