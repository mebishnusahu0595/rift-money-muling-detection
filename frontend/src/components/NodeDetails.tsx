import React from "react";
import type { SuspiciousAccount } from "../types";

interface Props {
  account: SuspiciousAccount | null;
  onClose: () => void;
}

const NodeDetails: React.FC<Props> = ({ account, onClose }) => {
  if (!account) return null;

  const scoreColor =
    account.suspicion_score > 70
      ? "bg-red-500"
      : account.suspicion_score > 30
      ? "bg-yellow-500"
      : "bg-green-500";

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/80 p-5 backdrop-blur">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-100">Account Details</h3>
          <p className="font-mono text-sm text-blue-400">{account.account_id}</p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-200 text-xl leading-none"
        >
          ×
        </button>
      </div>

      {/* Suspicion Score */}
      <div className="mb-5">
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="text-gray-400">Suspicion Score</span>
          <span className="font-bold text-gray-100">{account.suspicion_score}</span>
        </div>
        <div className="h-2.5 w-full rounded-full bg-gray-700">
          <div
            className={`h-full rounded-full ${scoreColor} transition-all`}
            style={{ width: `${account.suspicion_score}%` }}
          />
        </div>
      </div>

      {/* Detected Patterns */}
      <div className="mb-4">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Detected Patterns
        </h4>
        <div className="flex flex-wrap gap-2">
          {account.detected_patterns.length === 0 ? (
            <span className="text-xs text-gray-500">None</span>
          ) : (
            account.detected_patterns.map((p, i) => (
              <span
                key={i}
                className="rounded-full bg-red-900/40 px-2.5 py-0.5 text-xs font-medium text-red-300 border border-red-800/50"
              >
                {p.replace("_", " ")}
              </span>
            ))
          )}
        </div>
      </div>

      {/* Ring Membership */}
      <div className="mb-4">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Ring Membership
        </h4>
        {account.ring_ids.length === 0 ? (
          <span className="text-xs text-gray-500">Not in any ring</span>
        ) : (
          <div className="flex flex-wrap gap-2">
            {account.ring_ids.map((r) => (
              <span
                key={r}
                className="rounded-full bg-blue-900/40 px-2.5 py-0.5 text-xs font-medium text-blue-300 border border-blue-800/50"
              >
                {r}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Transaction Summary */}
      <div className="mb-4">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Transaction Summary
        </h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded bg-gray-900/60 p-2">
            <span className="text-gray-400 text-xs">Account Type</span>
            <p className="font-medium text-gray-100 capitalize">
              {account.account_type.replace("_", " ")}
            </p>
          </div>
          <div className="rounded bg-gray-900/60 p-2">
            <span className="text-gray-400 text-xs">Total Inflow</span>
            <p className="font-medium text-green-400">
              ${account.total_inflow.toLocaleString()}
            </p>
          </div>
          <div className="rounded bg-gray-900/60 p-2">
            <span className="text-gray-400 text-xs">Total Outflow</span>
            <p className="font-medium text-red-400">
              ${account.total_outflow.toLocaleString()}
            </p>
          </div>
          <div className="rounded bg-gray-900/60 p-2">
            <span className="text-gray-400 text-xs">Tx Count</span>
            <p className="font-medium text-gray-100">{account.transaction_count}</p>
          </div>
        </div>
      </div>

      {/* Connected Accounts */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Connected Accounts
        </h4>
        {account.connected_accounts.length === 0 ? (
          <span className="text-xs text-gray-500">None</span>
        ) : (
          <div className="max-h-28 overflow-y-auto">
            <div className="flex flex-wrap gap-1">
              {account.connected_accounts.map((c) => (
                <span
                  key={c}
                  className="rounded bg-gray-700 px-2 py-0.5 font-mono text-xs text-gray-300"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default NodeDetails;
