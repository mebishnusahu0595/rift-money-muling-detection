import React from "react";

interface Props {
  analysisId: string;
  onDownload: () => void;
  disabled?: boolean;
}

const JsonDownload: React.FC<Props> = ({ analysisId, onDownload, disabled }: Props) => {
  return (
    <button
      onClick={onDownload}
      disabled={disabled}
      className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3"
        />
      </svg>
      Download JSON Report
    </button>
  );
};

export default JsonDownload;
