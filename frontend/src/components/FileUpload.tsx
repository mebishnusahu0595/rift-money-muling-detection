import React, { useCallback, useRef, useState } from "react";

interface Props {
  onUpload: (file: File) => void;
  uploading: boolean;
  polling: boolean;
  centered?: boolean;
}

const FileUpload: React.FC<Props> = ({ onUpload, uploading, polling, centered = false }: Props) => {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = uploading || polling;

  const handleFile = useCallback(
    (f: File) => {
      if (busy) return;
      if (f && f.name.endsWith(".csv")) {
        onUpload(f); // auto-analyze immediately
      }
    },
    [onUpload, busy]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const handleSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  if (busy) {
    return (
      <div className={`flex flex-col items-center justify-center gap-3 ${centered ? "py-12" : "py-6"}`}>
        <div className="relative">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-red-900 border-t-red-500" />
        </div>
        <p className="text-sm font-medium text-white">
          {uploading ? "Uploading…" : "Analyzing transactions…"}
        </p>
        <p className="text-xs text-gray-500">This may take a moment for large datasets</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`group flex flex-col items-center justify-center rounded-xl border-2 border-dashed cursor-pointer transition-all duration-300 ${
          centered ? "p-12" : "p-8"
        } ${
          dragOver
            ? "border-red-500 bg-red-950/30 scale-[1.02]"
            : "border-gray-600 hover:border-red-500/60 hover:bg-red-950/10 bg-black/30"
        }`}
      >
        <svg
          className={`mb-3 text-gray-400 transition-colors group-hover:text-red-400 ${centered ? "w-14 h-14" : "w-10 h-10"}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        <p className={`font-medium text-white ${centered ? "text-base" : "text-sm"}`}>
          Drag &amp; drop a <span className="font-bold text-red-400">.csv</span> file
        </p>
        <p className="text-xs text-gray-500 mt-1">or click to browse · Auto-analyzes on drop</p>
        <input
          id="csv-input-trigger"
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleSelect}
        />
      </div>
    </div>
  );
};

export default FileUpload;
