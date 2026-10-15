import React, { useState } from 'react';
import { Template, Source } from '../types';
import { FileText, FileSpreadsheet, Settings2 } from 'lucide-react';

interface TemplateShelfProps {
  templates: Template[];
  sources: Source[];
  viewSrc: boolean;
  onToggleViewSrc: (val: boolean) => void;
  onToggleTemplatePick: (id: string) => void;
  onDeleteTemplate: (id: string) => void;
  onDeleteSource: (id: string) => void;
  hiddenCount: number;
  onRestoreBuiltins: () => void;
  onSelectTemplateDetail: (t: Template) => void;
}

export const TemplateShelf: React.FC<TemplateShelfProps> = ({
  templates,
  sources,
  viewSrc,
  onToggleViewSrc,
  onToggleTemplatePick,
  onDeleteTemplate,
  onDeleteSource,
  hiddenCount,
  onRestoreBuiltins,
  onSelectTemplateDetail,
}) => {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleDeleteClick = (e: React.MouseEvent, id: string, type: 'template' | 'source') => {
    e.stopPropagation();
    if (deleteConfirmId !== id) {
      setDeleteConfirmId(id);
      setTimeout(() => {
        setDeleteConfirmId((curr) => (curr === id ? null : curr));
      }, 2500);
      return;
    }
    setDeleteConfirmId(null);
    if (type === 'template') onDeleteTemplate(id);
    else onDeleteSource(id);
  };

  if (!templates.length && !sources.length && hiddenCount === 0) {
    return (
      <div className="p-8 text-center text-muted bg-surface rounded-xl border border-line">
        <p className="font-semibold text-base mb-1">등록된 양식이 없습니다</p>
        <p className="text-xs">위 상자에 hwpx 공문 양식이나 엑셀·PDF 시간표를 올려주세요.</p>
      </div>
    );
  }

  return (
    <div className="shelf">
      {/* 템플릿 목록 (HWPX) */}
      {templates.map((t) => {
        const isPicked = t.pick === true;
        const isConfirming = deleteConfirmId === t.id;

        return (
          <div
            key={t.id}
            className={`frow ${isPicked ? 'bg-accent-soft' : ''}`}
            onClick={() => onToggleTemplatePick(t.id)}
            role="button"
            tabIndex={0}
          >
            <input
              type="checkbox"
              checked={isPicked}
              title="한번에 받기 및 미리보기에 포함"
              onChange={(e) => {
                e.stopPropagation();
                onToggleTemplatePick(t.id);
              }}
              onClick={(e) => e.stopPropagation()}
            />
            <span className="fi text-accent">
              <FileText size={18} />
            </span>
            <span className="fn" title={t.name}>
              {t.name}
            </span>

            {/* 규칙 설정 버튼 */}
            <button
              type="button"
              className="icon-btn text-muted hover:text-accent hover:bg-surface px-2 py-1 text-xs font-semibold rounded gap-1 flex items-center"
              title="이 양식의 규칙 및 표 설정"
              onClick={(e) => {
                e.stopPropagation();
                onSelectTemplateDetail(t);
              }}
            >
              <Settings2 size={13} />
              <span className="hidden sm:inline">설정</span>
            </button>

            {/* 삭제 버튼 */}
            <button
              type="button"
              className={`del ${isConfirming ? 'warn font-bold text-red-600' : 'text-muted hover:text-red-600'}`}
              title="양식 삭제"
              onClick={(e) => handleDeleteClick(e, t.id, 'template')}
            >
              {isConfirming ? '삭제?' : '✕'}
            </button>
          </div>
        );
      })}

      {/* 업로드된 자료 목록 (엑셀·PDF) */}
      {sources.map((s) => {
        const isConfirming = deleteConfirmId === s.id;

        return (
          <div
            key={s.id}
            className={`frow ${viewSrc ? 'bg-accent-soft' : ''}`}
            onClick={() => onToggleViewSrc(!viewSrc)}
            role="button"
            tabIndex={0}
          >
            <input
              type="checkbox"
              checked={viewSrc}
              title="시간표 시각화 포함"
              onChange={(e) => {
                e.stopPropagation();
                onToggleViewSrc(e.target.checked);
              }}
              onClick={(e) => e.stopPropagation()}
            />
            <span className="fi fs text-green-600">
              <FileSpreadsheet size={18} />
            </span>
            <span className="fn font-medium" title={s.name}>
              {s.name}
            </span>
            <span className="badge">{s.kind === 'pdf' ? 'PDF' : 'XLS'}</span>

            {/* 삭제 버튼 */}
            <button
              type="button"
              className={`del ${isConfirming ? 'warn font-bold text-red-600' : 'text-muted hover:text-red-600'}`}
              title="자료 삭제"
              onClick={(e) => handleDeleteClick(e, s.id, 'source')}
            >
              {isConfirming ? '삭제?' : '✕'}
            </button>
          </div>
        );
      })}

      {/* 기본 양식 복원 버튼 */}
      {hiddenCount > 0 && (
        <button type="button" className="restore" onClick={onRestoreBuiltins}>
          ＋ 기본 양식 복원 ({hiddenCount}개)
        </button>
      )}
    </div>
  );
};
