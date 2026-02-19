/// <reference types="vite/client" />
import { useCallback, useRef, useState } from "react";
import axios from "axios";
import type {
  AnalysisResult,
  AnalysisStatusResponse,
  GraphData,
  UploadResponse,
} from "../types";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

interface UseAnalysisState {
  uploading: boolean;
  polling: boolean;
  analysisId: string | null;
  result: AnalysisResult | null;
  graphData: GraphData | null;
  error: string | null;
}

export function useAnalysis() {
  const [state, setState] = useState<UseAnalysisState>({
    uploading: false,
    polling: false,
    analysisId: null,
    result: null,
    graphData: null,
    error: null,
  });

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const upload = useCallback(
    async (file: File) => {
      stopPolling();
      setState((s) => ({
        ...s,
        uploading: true,
        error: null,
        result: null,
        graphData: null,
        analysisId: null,
      }));

      try {
        const form = new FormData();
        form.append("file", file);

        const { data } = await axios.post<UploadResponse>(
          `${API_BASE}/api/v1/analyze`,
          form
        );

        const id = data.analysis_id;
        setState((s) => ({ ...s, uploading: false, polling: true, analysisId: id }));

        // Start polling
        pollingRef.current = setInterval(async () => {  // 400ms fast polling
          try {
            const { data: status } = await axios.get<AnalysisStatusResponse>(
              `${API_BASE}/api/v1/analysis/${id}`
            );

            if (status.status === "complete" && status.result) {
              stopPolling();
              // Fetch graph data
              let gd: GraphData | null = null;
              try {
                const { data: graphResp } = await axios.get<GraphData>(
                  `${API_BASE}/api/v1/analysis/${id}/graph`
                );
                gd = graphResp;
              } catch {
                /* graph data optional */
              }
              // Set everything atomically — no intermediate empty render
              setState((s) => ({
                ...s,
                polling: false,
                result: status.result!,
                graphData: gd,
              }));

            } else if (status.status === "error") {
              stopPolling();
              setState((s) => ({
                ...s,
                polling: false,
                error: status.error ?? "Analysis failed.",
              }));
            }
          } catch {
            stopPolling();
            setState((s) => ({
              ...s,
              polling: false,
              error: "Lost connection to server.",
            }));
          }
        }, 400);
      } catch (err: any) {
        setState((s) => ({
          ...s,
          uploading: false,
          error: err?.response?.data?.detail ?? "Upload failed.",
        }));
      }
    },
    [stopPolling]
  );

  const downloadJson = useCallback(async () => {
    if (!state.analysisId) return;
    try {
      const response = await axios.get(
        `${API_BASE}/api/v1/analysis/${state.analysisId}/download`,
        { responseType: "blob" }
      );
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const a = document.createElement("a");
      a.href = url;
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      a.download = `analysis_${ts}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setState((s) => ({ ...s, error: "Download failed." }));
    }
  }, [state.analysisId]);

  return { ...state, upload, downloadJson };
}
