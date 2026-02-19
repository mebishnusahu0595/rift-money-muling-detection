import React from "react";
import type { SuspiciousAccount } from "../types";

interface Props {
  account: SuspiciousAccount | null;
  onClose: () => void;
}

const NodeDetails: React.FC<Props> = ({ account, onClose }) => {
  if (!account) return null;

  const scoreBg =
    account.suspicion_score > 70 ? "bg-red-600" :
    account.suspicion_score > 30 ? "bg-yellow-600" : "bg-green-700";

  return (
    <div className="bg-[#10161e] px-3 py-3 text-xs">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${scoreBg}`}>
            {account.suspicion_score}
          </span>
          <span className="font-bold text-blue-400 truncate max-w-[120px]">{account.account_id}</span>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-base leading-none">×</button>
      </div>

      {/* Score bar */}
      <div className="mb-2 h-1.5 w-full rounded-full bg-gray-800">
        <div className={`h-full rounded-full ${scoreBg}`} style={{ width: `${account.suspicion_score}%` }} />
      </div>

      {/* Patterns */}
      <div className="mb-2 flex flex-wrap gap-1">
        {account.detected_patterns.length === 0
          ? <span className="text-gray-600">No patterns</span>
          : account.detected_patterns.map((p, i) => (
            <span key={i} className="rounded-full bg-red-900/40 border border-red-800/50 px-2 py-0.5 text-[10px] text-red-300">
              {p.replace(/_/g, " ")}
            </span>
          ))
        }
      </div>

      {/* Rings */}
      {account.ring_ids.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {account.ring_ids.map((r) => (
            <span key={r} className="rounded-full bg-blue-900/40 border border-blue-800/50 px-2 py-0.5 text-[10px] text-blue-300">{r}</span>
          ))}
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-1">
        <div className="rounded bg-gray-900/60 px-2 py-1.5">
          <p className="text-gray-500">Inflow</p>
          <p className="font-semibold text-green-400">₹{account.total_inflow.toLocaleString("en-IN")}</p>
        </div>
        <div className="rounded bg-gray-900/60 px-2 py-1.5">
          <p className="text-gray-500">Outflow</p>
          <p className="font-semibold text-red-400">₹{account.total_outflow.toLocaleString("en-IN")}</p>
        </div>
        <div className="rounded bg-gray-900/60 px-2 py-1.5">
          <p className="text-gray-500">Tx Count</p>
          <p className="font-semibold text-gray-100">{account.transaction_count}</p>
        </div>
        <div className="rounded bg-gray-900/60 px-2 py-1.5">
          <p className="text-gray-500">Type</p>
          <p className="font-semibold text-gray-100 capitalize">{account.account_type.replace(/_/g, " ")}</p>
        </div>
      </div>
    </div>
  );
};

export default NodeDetails;
