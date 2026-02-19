import React, { useState, useCallback } from "react";
import FileUpload from "../components/FileUpload";
import GraphViz from "../components/GraphViz";
import RingTable from "../components/RingTable";
import NodeDetails from "../components/NodeDetails";
import JsonDownload from "../components/JsonDownload";
import { useAnalysis } from "../hooks/useAnalysis";
import type { SuspiciousAccount } from "../types";

const Dashboard: React.FC = () => {
  const { uploading, polling, analysisId, result, graphData, error, upload, downloadJson } =
    useAnalysis();

  const [selectedAccount, setSelectedAccount] = useState<SuspiciousAccount | null>(null);

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      if (!result) return;
      // First check suspicious accounts (have full detail)
      const suspicious = result.suspicious_accounts.find((a) => a.account_id === nodeId);
      if (suspicious) {
        setSelectedAccount(suspicious);
        return;
      }
      // Fall back to graph node data for clean/normal accounts
      const graphNode = graphData?.nodes.find((n) => n.id === nodeId);
      if (graphNode) {
        setSelectedAccount({
          account_id: graphNode.id,
          suspicion_score: graphNode.suspicion_score,
          detected_patterns: graphNode.detected_patterns,
          ring_id: "",
          account_type: "individual",
          total_inflow: graphNode.total_inflow,
          total_outflow: graphNode.total_outflow,
          transaction_count: graphNode.transaction_count,
          connected_accounts: [],
          ring_ids: graphNode.ring_ids,
        });
      }
    },
    [result, graphData]
  );

  const handleRingClick = useCallback(
    (ringId: string) => {
      if (!result) return;
      const ring = result.fraud_rings.find((r) => r.ring_id === ringId);
      if (ring && ring.member_accounts.length > 0) {
        const acct =
          result.suspicious_accounts.find((a) => a.account_id === ring.member_accounts[0]) ?? null;
        setSelectedAccount(acct);
      }
    },
    [result]
  );

  const isAnalysing = uploading || polling;

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-600 text-lg font-bold">
              M
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Money Muling Detector</h1>
              <p className="text-xs text-gray-400">Financial Forensics Engine &middot; RIFT 2026</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {result && analysisId && (
              <JsonDownload analysisId={analysisId} onDownload={downloadJson} />
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6 p-6">
        {/* Upload section — shown when no result yet */}
        {!result && (
          <section className="mx-auto w-full max-w-xl">
            <FileUpload onUpload={upload} uploading={uploading} polling={polling} />
            {polling && (
              <div className="mt-4 flex items-center justify-center gap-2 text-sm text-blue-400">
                <svg
                  className="h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
                Analysing transactions…
              </div>
            )}
          </section>
        )}

        {error && (
          <div className="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Results */}
        {result && (
          <>
            {/* Summary stats */}
            <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                [
                  "Total Accounts",
                  result.summary.total_accounts_analyzed.toLocaleString(),
                  "text-gray-100",
                ],
                [
                  "Suspicious",
                  result.summary.suspicious_accounts_flagged.toLocaleString(),
                  "text-yellow-400",
                ],
                [
                  "Fraud Rings",
                  result.summary.fraud_rings_detected.toLocaleString(),
                  "text-red-400",
                ],
                [
                  "Total Volume",
                  "$" + result.summary.total_transaction_volume.toLocaleString(),
                  "text-green-400",
                ],
              ].map(([label, value, color]) => (
                <div
                  key={label}
                  className="rounded-xl border border-gray-800 bg-gray-900/60 p-4"
                >
                  <p className="text-xs uppercase tracking-wider text-gray-400">{label}</p>
                  <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
                </div>
              ))}
            </section>

            {/* Graph + Details */}
            <section className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-3">
              {/* Graph */}
              <div className="lg:col-span-2" style={{ minHeight: "450px" }}>
                {graphData ? (
                  <GraphViz data={graphData} onNodeClick={handleNodeClick} />
                ) : (
                  <div className="flex h-full items-center justify-center rounded-xl bg-gray-900/60 text-gray-500">
                    Loading graph…
                  </div>
                )}
              </div>

              {/* Node details sidebar */}
              <div className="lg:col-span-1">
                {selectedAccount ? (
                  <NodeDetails
                    account={selectedAccount}
                    onClose={() => setSelectedAccount(null)}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-gray-700 bg-gray-900/30 p-6 text-center text-sm text-gray-500">
                    Click a node in the graph or a row in the table to view account details.
                  </div>
                )}
              </div>
            </section>

            {/* Ring table */}
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
                Detected Fraud Rings
              </h2>
              <RingTable rings={result.fraud_rings} onRingClick={handleRingClick} />
            </section>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-4 text-center text-xs text-gray-600">
        Money Muling Detector &middot; RIFT 2026 Hackathon &middot; Financial Forensics Engine
      </footer>
    </div>
  );
};

export default Dashboard;
