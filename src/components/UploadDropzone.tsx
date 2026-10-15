import React, { useRef, useState } from 'react';
import { Upload } from 'lucide-react';

interface UploadDropzoneProps {
  onFilesSelected: (files: File[]) => void;
}

export const UploadDropzone: React.FC<UploadDropzoneProps> = ({ onFilesSelected }) => {
  const [isOver, setIsOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(false);
    if (e.dataTransfer?.files?.length) {
      onFilesSelected(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      onFilesSelected(Array.from(e.target.files));
      e.target.value = '';
    }
  };

  return (
    <>
      <label
        className={`upload ${isOver ? 'over' : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <span className="ic" aria-hidden="true">
          <Upload size={22} strokeWidth={2.4} />
        </span>
        <span className="tx text-center sm:text-left">
          <div className="t1">hwpx · 엑셀 · PDF</div>
          <div className="t2">파일을 끌어다 놓거나 눌러서 선택하세요</div>
        </span>
      </label>
      <input
        type="file"
        ref={inputRef}
        onChange={handleFileInput}
        accept=".hwpx,.xlsx,.xlsm,.xls,.csv,.pdf"
        multiple
        className="hidden"
      />
    </>
  );
};
