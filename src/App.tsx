import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Field, Source, Template, TTData } from './types';
import {
  DEFAULT_FIELDS,
  hiddenBuiltins,
  idbAll,
  idbDel,
  idbDelFrom,
  idbPut,
  idbPutTo,
  initDB,
  loadFields,
  persistTemplate,
  saveFields,
  setHiddenBuiltins,
} from './utils/storage';
import { countTables, outName, readTemplate, suggest } from './utils/hwpx';
import { datesFromSource, parsePdf, parseSheet } from './utils/sheetPdf';
import { buildHwpx, getTT, saveFiles } from './utils/timetable';
import { Header } from './components/Header';
import { SchedulePanel } from './components/SchedulePanel';
import { UploadDropzone } from './components/UploadDropzone';
import { TemplateShelf } from './components/TemplateShelf';
import { TimetableGrid } from './components/TimetableGrid';
import { DocumentPreview } from './components/DocumentPreview';
import { TemplateDetailModal } from './components/TemplateDetailModal';
import { Download, Loader2 } from 'lucide-react';

export const App: React.FC = () => {
  const [fields, setFields] = useState<Field[]>(loadFields);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [viewSrc, setViewSrc] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [detailTemplate, setDetailTemplate] = useState<Template | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return (
      localStorage.getItem('gosa-theme') === 'dark' ||
      (!localStorage.getItem('gosa-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)
    );
  });

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 3200);
    return () => clearTimeout(t);
  }, [toastMessage]);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('gosa-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('gosa-theme', 'light');
    }
  }, [darkMode]);

  const toggleDarkMode = () => setDarkMode((prev) => !prev);

  // Load Database and Initial Data
  useEffect(() => {
    let active = true;

    const startup = async () => {
      await initDB();
      const loadedTemplates: Template[] = [];

      // 1. Load custom templates from IndexedDB
      try {
        const idbRecs = await idbAll<any>('t');
        for (const r of idbRecs) {
          try {
            r.cache = await readTemplate(r.data);
            r.tables = countTables(r.cache);
            r.cells = r.cells || {};
            if (!r.oldDays) {
              r.rules = r.rules?.length ? r.rules : suggest(r.cache, r);
            }
            loadedTemplates.push(r);
          } catch (e) {
            console.error('Failed to load template from IDB:', r.name, e);
          }
        }
      } catch (e) {
        console.error('Error reading templates from IDB:', e);
      }

      // 2. Load built-in templates
      try {
        const hiddenSet = new Set(hiddenBuiltins());
        const res = await fetch('/builtin-templates.json');
        if (res.ok) {
          const builtins: Array<{ id: string; name: string; b64: string }> = await res.json();
          for (const [ord, b] of builtins.entries()) {
            if (hiddenSet.has(b.id) || loadedTemplates.some((t) => t.id === b.id)) continue;
            try {
              const binStr = atob(b.b64);
              const u = new Uint8Array(binStr.length);
              for (let i = 0; i < binStr.length; i++) u[i] = binStr.charCodeAt(i);
              const data = u.buffer;
              const cache = await readTemplate(data);
              const t: Template = {
                id: b.id,
                name: b.name,
                data,
                rules: [],
                cells: {},
                pick: false,
                cache,
                builtin: true,
                ord,
              };
              t.rules = suggest(cache, t);
              t.tables = countTables(cache);
              loadedTemplates.push(t);
              idbPut(t);
            } catch (err) {
              console.error('Failed to parse builtin template:', b.name, err);
            }
          }
        }
      } catch (err) {
        console.warn('Could not fetch builtin-templates.json', err);
      }

      // Sort templates
      loadedTemplates.sort(
        (a, b) =>
          (a.builtin ? 0 : 1) - (b.builtin ? 0 : 1) ||
          (a.ord ?? 0) - (b.ord ?? 0) ||
          a.name.localeCompare(b.name, 'ko')
      );

      // 3. Load sources from IDB
      let loadedSources: Source[] = [];
      try {
        const sRecs = await idbAll<Source>('s');
        loadedSources = sRecs.filter((s) => Array.isArray(s.blocks));
      } catch (e) {
        console.error('Error reading sources from IDB:', e);
      }

      if (active) {
        if (loadedTemplates.length > 0 && !loadedTemplates.some((t) => t.pick)) {
          loadedTemplates[0].pick = true;
        }
        setTemplates(loadedTemplates);
        setSources(loadedSources);
        if (loadedSources.length > 0) setViewSrc(true);
      }
    };

    startup();

    return () => {
      active = false;
    };
  }, []);

  // Sync fields changes
  const handleFieldsChange = (newFields: Field[]) => {
    setFields(newFields);
    saveFields(newFields);
  };

  // Timetable computation from sources
  const ttData: TTData | null = useMemo(() => {
    return getTT(sources, fields);
  }, [sources, fields]);

  // Upload handler
  const handleFilesSelected = async (fileList: File[]) => {
    let okT = 0;
    let okS = 0;

    for (const f of fileList) {
      const ext = (f.name.split('.').pop() || '').toLowerCase();

      // Excel / PDF
      if (['xlsx', 'xlsm', 'xls', 'csv', 'pdf'].includes(ext)) {
        try {
          const buf = await f.arrayBuffer();
          const blocks = ext === 'pdf' ? await parsePdf(buf) : await parseSheet(buf);
          if (!blocks.length) {
            throw new Error(
              ext === 'pdf'
                ? '글자를 찾지 못했습니다. 스캔한 PDF는 읽을 수 없습니다.'
                : '표로 읽을 내용이 없습니다.'
            );
          }
          const s: Source = {
            id: Math.random().toString(36).slice(2, 9),
            name: f.name,
            kind: ext === 'pdf' ? 'pdf' : 'xlsx',
            blocks,
          };
          setSources((prev) => [...prev, s]);
          idbPutTo('s', s);
          setViewSrc(true);

          // Automatically extract exam dates
          const ds = datesFromSource(s, fields);
          if (ds.length > 0) {
            const nextFields = fields.map((field) =>
              field.key === '시험일' ? { ...field, value: ds } : field
            );
            handleFieldsChange(nextFields);
            showToast(`시간표에서 시험일 ${ds.length}일을 자동으로 적용했습니다.`);
          }
          okS++;
        } catch (e: any) {
          showToast(`${f.name}: ${e.message}`);
        }
        continue;
      }

      // HWPX
      if (ext !== 'hwpx') {
        showToast(
          ext === 'hwp'
            ? `${f.name}: hwp는 한글에서 '다른 이름으로 저장 → hwpx'로 바꿔 올려 주세요.`
            : `${f.name}: hwpx, 엑셀, PDF 파일만 올릴 수 있습니다.`
        );
        continue;
      }

      try {
        const data = await f.arrayBuffer();
        const cache = await readTemplate(data);
        const t: Template = {
          id: Math.random().toString(36).slice(2, 9),
          name: f.name,
          data,
          rules: [],
          cells: {},
          pick: true,
          cache,
        };
        t.rules = suggest(cache, t);
        t.tables = countTables(cache);
        setTemplates((prev) => [t, ...prev]);
        idbPut(t);
        okT++;
      } catch (e: any) {
        showToast(`${f.name}: ${e.message}`);
      }
    }

    if (okT || okS) {
      showToast(`${okT + okS}개 파일을 불러왔습니다.`);
    }
  };

  // Toggle template pick
  const handleToggleTemplatePick = (id: string) => {
    setTemplates((prev) =>
      prev.map((t) => {
        if (t.id === id) {
          const next = { ...t, pick: !t.pick };
          persistTemplate(next);
          return next;
        }
        return t;
      })
    );
  };

  // Delete template
  const handleDeleteTemplate = (id: string) => {
    const target = templates.find((t) => t.id === id);
    if (!target) return;
    idbDel(id);
    if (target.builtin) {
      const hidden = [...hiddenBuiltins(), id];
      setHiddenBuiltins(hidden);
    }
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    showToast(`${target.name} 양식을 삭제했습니다.`);
  };

  // Delete source
  const handleDeleteSource = (id: string) => {
    idbDelFrom('s', id);
    setSources((prev) => prev.filter((s) => s.id !== id));
    showToast('자료 파일을 삭제했습니다.');
  };

  // Restore built-in templates
  const handleRestoreBuiltins = async () => {
    setHiddenBuiltins([]);
    try {
      const res = await fetch('/builtin-templates.json');
      if (res.ok) {
        const builtins: Array<{ id: string; name: string; b64: string }> = await res.json();
        const restored: Template[] = [];
        for (const [ord, b] of builtins.entries()) {
          if (templates.some((t) => t.id === b.id)) continue;
          const binStr = atob(b.b64);
          const u = new Uint8Array(binStr.length);
          for (let i = 0; i < binStr.length; i++) u[i] = binStr.charCodeAt(i);
          const data = u.buffer;
          const cache = await readTemplate(data);
          const t: Template = {
            id: b.id,
            name: b.name,
            data,
            rules: [],
            cells: {},
            pick: false,
            cache,
            builtin: true,
            ord,
          };
          t.rules = suggest(cache, t);
          t.tables = countTables(cache);
          restored.push(t);
          idbPut(t);
        }
        setTemplates((prev) =>
          [...prev, ...restored].sort(
            (a, b) =>
              (a.builtin ? 0 : 1) - (b.builtin ? 0 : 1) ||
              (a.ord ?? 0) - (b.ord ?? 0) ||
              a.name.localeCompare(b.name, 'ko')
          )
        );
        showToast(`기본 양식 ${restored.length}개를 복원했습니다.`);
      }
    } catch (e: any) {
      showToast('기본 양식을 복원하지 못했습니다: ' + e.message);
    }
  };

  // Update template from modal
  const handleUpdateTemplate = (updated: Template) => {
    setTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    persistTemplate(updated);
  };

  // Config import
  const handleImportConfig = (cfg: {
    fields?: Field[];
    templates?: Array<{ name: string; rules: any[]; cells: any }>;
  }) => {
    if (Array.isArray(cfg.fields)) {
      handleFieldsChange(cfg.fields);
    }
    if (Array.isArray(cfg.templates)) {
      let matchCount = 0;
      setTemplates((prev) =>
        prev.map((t) => {
          const match = cfg.templates?.find((tc) => tc.name === t.name);
          if (match) {
            matchCount++;
            const next = {
              ...t,
              rules: match.rules || t.rules,
              cells: match.cells || t.cells,
            };
            persistTemplate(next);
            return next;
          }
          return t;
        })
      );
    }
  };

  // Picked templates
  const pickedTemplates = useMemo(() => templates.filter((t) => t.pick === true), [templates]);

  // Batch download handler
  const handleExportHwpx = async () => {
    if (!pickedTemplates.length) return;
    setIsExporting(true);
    try {
      const files: Array<{ name: string; blob: Blob }> = [];
      const usedNames = new Set<string>();

      for (const t of pickedTemplates) {
        let n = outName(t, fields);
        while (usedNames.has(n)) {
          n = n.replace(/\.hwpx$/i, '_2.hwpx');
        }
        usedNames.add(n);
        const blob = await buildHwpx(t, fields, ttData);
        files.push({ name: n, blob });
      }

      const msg = await saveFiles(files, fields);
      showToast(msg);
    } catch (err: any) {
      showToast('파일을 생성하지 못했습니다: ' + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  const hiddenCount = hiddenBuiltins().length;
  const showTTCard = viewSrc && sources.length > 0 && ttData && ttData.entries.length > 0;

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        fields={fields}
        templates={templates}
        onImportConfig={handleImportConfig}
        onToast={showToast}
        darkMode={darkMode}
        onToggleDarkMode={toggleDarkMode}
      />

      <div className="wrap layout flex-1">
        {/* Left Side: Academic Schedule and Variables */}
        <SchedulePanel fields={fields} onChange={handleFieldsChange} />

        {/* Right Side: Main Workspace */}
        <main className="flex flex-col gap-4 min-w-0">
          {/* Upload Dropzone */}
          <UploadDropzone onFilesSelected={handleFilesSelected} />

          {/* Template and Source Shelf */}
          <TemplateShelf
            templates={templates}
            sources={sources}
            viewSrc={viewSrc}
            onToggleViewSrc={setViewSrc}
            onToggleTemplatePick={handleToggleTemplatePick}
            onDeleteTemplate={handleDeleteTemplate}
            onDeleteSource={handleDeleteSource}
            hiddenCount={hiddenCount}
            onRestoreBuiltins={handleRestoreBuiltins}
            onSelectTemplateDetail={(t) => setDetailTemplate(t)}
          />

          {/* Work / Output Panel */}
          {(pickedTemplates.length > 0 || showTTCard) && (
            <section className="panel" id="work">
              {/* Action Bar */}
              <div className="actions">
                <span className="cur-name text-sm">
                  {pickedTemplates.length > 0 ? (
                    <span>
                      <strong className="text-accent">{pickedTemplates.length}개</strong> 양식 선택됨
                    </span>
                  ) : (
                    '선택된 양식이 없습니다'
                  )}
                </span>
                <button
                  type="button"
                  className="btn stamp flex items-center gap-2"
                  disabled={pickedTemplates.length === 0 || isExporting}
                  onClick={handleExportHwpx}
                >
                  {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  <span>
                    hwpx로 받기{pickedTemplates.length > 1 ? ` (${pickedTemplates.length}개 zip)` : ''}
                  </span>
                </button>
              </div>

              {/* Viewer: Timetable & Document Previews */}
              <div className="viewer">
                {/* Timetable Grid View */}
                {showTTCard && (
                  <div className="vsec tt-card bg-surface">
                    <div className="vhd flex items-center justify-between pb-2">
                      <span className="font-bold text-base">시험 시간표</span>
                      <span className="text-xs text-muted">
                        자료 파일({sources.map((s) => s.name).join(', ')})에서 읽은 시간표
                      </span>
                    </div>
                    <TimetableGrid tt={ttData!} />
                  </div>
                )}

                {/* Selected HWPX Document Previews */}
                {pickedTemplates.map((t) => (
                  <div key={t.id} className="vsec">
                    <div className="vhd">
                      <span className="font-bold text-base truncate">{outName(t, fields)}</span>
                      <button
                        type="button"
                        onClick={() => setDetailTemplate(t)}
                        className="btn outline text-xs py-1 px-2.5 ml-2"
                      >
                        규칙 및 표 수정
                      </button>
                    </div>
                    <DocumentPreview template={t} fields={fields} tt={ttData} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {pickedTemplates.length === 0 && !showTTCard && (
            <section className="panel p-8 text-center text-muted">
              <p className="font-semibold text-sm mb-1 text-ink">선택된 양식이 없습니다</p>
              <p className="text-xs">위 양식 목록에서 문서를 클릭하여 선택하면 실시간 문서 미리보기와 HWPX 파일 생성이 활성화됩니다.</p>
            </section>
          )}
        </main>
      </div>

      {/* Template Detail Settings Modal */}
      {detailTemplate && (
        <TemplateDetailModal
          template={detailTemplate}
          fields={fields}
          sources={sources}
          onClose={() => setDetailTemplate(null)}
          onUpdateTemplate={(up) => {
            handleUpdateTemplate(up);
            setDetailTemplate(up);
          }}
          onToast={showToast}
        />
      )}

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="toast" role="status">
          {toastMessage}
        </div>
      )}
    </div>
  );
};

export default App;
