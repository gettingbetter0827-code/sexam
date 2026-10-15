import React, { useRef } from 'react';
import { Field, Template } from '../types';
import { examDays, expand, tokenValue } from '../utils/tokens';
import { Download, Upload, Moon, Sun } from 'lucide-react';

interface HeaderProps {
  fields: Field[];
  templates: Template[];
  onImportConfig: (cfg: { fields?: Field[]; templates?: Array<{ name: string; rules: any[]; cells: any }> }) => void;
  onToast: (msg: string) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  fields,
  templates,
  onImportConfig,
  onToast,
  darkMode,
  onToggleDarkMode,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const days = examDays(fields);
  const startDay = days[0];
  let ddayText = '';
  if (startDay) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const n = Math.round((startDay.getTime() - today.getTime()) / 864e5);
    ddayText = n > 0 ? `D-${n}` : n === 0 ? 'D-DAY' : `D+${-n}`;
  }

  const exportConfig = () => {
    const cfg = {
      fields,
      templates: templates.map((t) => ({
        name: t.name,
        rules: t.rules,
        cells: t.cells,
      })),
    };
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '고사계_설정.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 2000);
    onToast('설정을 파일로 내보냈습니다.');
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const cfg = JSON.parse(text);
      onImportConfig(cfg);
      onToast('설정을 성공적으로 불러왔습니다.');
    } catch (err: any) {
      onToast('설정 파일을 읽지 못했습니다: ' + err.message);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <header className="top">
      <div className="wrap">
        <div className="logo flex items-center gap-2 text-white font-bold text-lg">
          <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
            <rect x="2" y="4" width="28" height="24" rx="7" fill="#fff" />
            <path d="M9 12h14M9 17h14M9 22h8" stroke="var(--band)" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          <span className="tracking-tight text-xl font-extrabold">고사계 양식</span>
        </div>

        <div className="flex items-center gap-2.5 text-white/90 text-sm font-medium flex-wrap">
          <span className="bg-white/15 px-2.5 py-0.5 rounded font-semibold text-white">
            {expand('{학년도}학년도 {학기}학기 {고사명}', undefined, fields)}
          </span>
          {startDay && (
            <>
              <span className="text-white/80 text-xs">
                {tokenValue('고사기간', undefined, undefined, fields)} · {days.length}일간
              </span>
              <span className="bg-white text-blue-700 font-mono font-bold px-2 py-0.5 rounded text-xs">
                {ddayText}
              </span>
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleDarkMode}
            className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition"
            title={darkMode ? '라이트 모드로 전환' : '다크 모드로 전환'}
            aria-label="테마 전환"
          >
            {darkMode ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button
            type="button"
            onClick={exportConfig}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white transition"
            title="현재 학사 일정 및 규칙을 JSON 파일로 저장합니다"
          >
            <Download size={14} />
            <span>설정 내보내기</span>
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white transition"
            title="이전에 저장한 설정 JSON 파일을 불러옵니다"
          >
            <Upload size={14} />
            <span>설정 불러오기</span>
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImportFile}
            accept=".json"
            className="hidden"
          />
        </div>
      </div>
    </header>
  );
};
