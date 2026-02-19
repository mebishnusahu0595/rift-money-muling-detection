import React, { useCallback, useRef, useState } from "react";

interface Props {
  onUpload: (file: File) => void;
  uploading: boolean;
  polling: boolean;
}

const FileUpload: React.FC<Props> = ({ onUpload, uploading, polling }) => {
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f && f.name.endsWith(".csv")) setFile(f);
    },
    []
  );

  const handleSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) setFile(f);
    },
    []
  );

  const busy = uploading || polling;

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
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors ${
          dragOver
            ? "border-blue-400 bg-blue-950/40"
            : "border-gray-600 hover:border-gray-400 bg-gray-900/50"
        }`}
      >
        <svg
          className="w-10 h-10 mb-2 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        <p className="text-sm text-gray-300">
          Drag &amp; drop a <span className="font-semibold">.csv</span> file
          here, or click to browse
        </p>
        <p className="text-xs text-gray-500 mt-1">Max 10 MB</p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleSelect}
        />
      </div>

      {file && (
        <div className="flex items-center justify-between rounded-lg bg-gray-800 px-4 py-2">
          <span className="text-sm truncate">{file.name}</span>
          <span className="text-xs text-gray-400 ml-2">
            {(file.size / 1024).toFixed(1)} KB
          </span>
        </div>
      )}

      <button
        disabled={!file || busy}
        onClick={() => file && onUpload(file)}
        className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {uploading
          ? "Uploading…"
          : polling
          ? "Analyzing…"
          : "Analyze Transactions"}
      </button>
    </div>
  );
};

export default FileUpload;
