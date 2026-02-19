import React, { useMemo, useState } from "react";
import type { FraudRing } from "../types";

interface Props {
  rings: FraudRing[];
  onRingClick: (ringId: string) => void;
}

type SortKey = "ring_id" | "pattern_type" | "member_count" | "risk_score";
type SortDir = "asc" | "desc";

const RingTable: React.FC<Props> = ({ rings, onRingClick }) => {
  const [sortKey, setSortKey] = useState<SortKey>("risk_score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sorted = useMemo(() => {
    const copy = [...rings];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "ring_id":
          cmp = a.ring_id.localeCompare(b.ring_id);
          break;
        case "pattern_type":
          cmp = a.pattern_type.localeCompare(b.pattern_type);
          break;
        case "member_count":
          cmp = a.member_accounts.length - b.member_accounts.length;
          break;
        case "risk_score":
          cmp = a.risk_score - b.risk_score;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rings, sortKey, sortDir]);

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const riskBadge = (score: number) => {
    if (score > 70) return "bg-red-600 text-red-100";
    if (score > 40) return "bg-yellow-600 text-yellow-100";
    return "bg-green-700 text-green-100";
  };

  if (rings.length === 0) {
    return (
      <div className="rounded-xl bg-gray-800/60 p-6 text-center text-gray-400">
        No fraud rings detected.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-700 bg-gray-800/60">
      <table className="min-w-full text-sm text-gray-200">
        <thead className="border-b border-gray-700 bg-gray-900/60 text-xs uppercase tracking-wider text-gray-400">
          <tr>
            {(
              [
                ["ring_id", "Ring ID"],
                ["pattern_type", "Pattern"],
                ["member_count", "Members"],
                ["risk_score", "Risk Score"],
              ] as [SortKey, string][]
            ).map(([key, label]) => (
              <th
                key={key}
                onClick={() => toggleSort(key)}
                className="cursor-pointer px-4 py-3 text-left hover:text-gray-200"
              >
                {label}
                {arrow(key)}
              </th>
            ))}
            <th className="px-4 py-3 text-left">Accounts</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-700">
          {sorted.map((ring) => (
            <tr
              key={ring.ring_id}
              onClick={() => onRingClick(ring.ring_id)}
              className="cursor-pointer hover:bg-gray-700/40 transition-colors"
            >
              <td className="whitespace-nowrap px-4 py-3 font-mono text-blue-400">
                {ring.ring_id}
              </td>
              <td className="whitespace-nowrap px-4 py-3 capitalize">
                {ring.pattern_type.replace("_", " ")}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-center">
                {ring.member_accounts.length}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${riskBadge(
                    ring.risk_score
                  )}`}
                >
                  {ring.risk_score}
                </span>
              </td>
              <td className="max-w-xs truncate px-4 py-3 font-mono text-xs text-gray-400">
                {ring.member_accounts.join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default RingTable;
