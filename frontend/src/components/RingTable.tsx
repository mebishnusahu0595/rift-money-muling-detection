import React, { useMemo, useState } from "react";
import type { FraudRing } from "../types";

interface Props {
  rings: FraudRing[];
  onRingClick: (ringId: string) => void;
}

type SortKey = "ring_id" | "pattern_type" | "member_count" | "risk_score";
type SortDir = "asc" | "desc";

const RingTable: React.FC<Props> = ({ rings, onRingClick }: Props) => {
  const [sortKey, setSortKey] = useState<SortKey>("risk_score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return rings;
    const q = search.toLowerCase();
    return rings.filter(
      (r) =>
        r.ring_id.toLowerCase().includes(q) ||
        r.pattern_type.toLowerCase().includes(q) ||
        r.member_accounts.some((a) => a.toLowerCase().includes(q))
    );
  }, [rings, search]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
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
  }, [filtered, sortKey, sortDir]);

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const riskBadge = (score: number) => {
    if (score > 30) return "bg-red-600 text-red-100";
    if (score > 12) return "bg-yellow-600 text-yellow-100";
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
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-800/60">
      {/* Search bar */}
      <div className="shrink-0 border-b border-gray-700 px-3 py-2">
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search rings, patterns, accounts…"
            className="w-full rounded-md border border-gray-700 bg-gray-900/60 py-1.5 pl-8 pr-3 text-xs text-gray-200 placeholder-gray-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Scrollable table */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="min-w-full text-sm text-gray-200">
          <thead className="sticky top-0 z-10 border-b border-gray-700 bg-gray-900 text-xs uppercase tracking-wider text-gray-400">
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
            {sorted.map((ring, idx) => (
              <tr
                key={`${ring.ring_id}_${ring.pattern_type}_${idx}`}
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
            {sorted.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500 text-xs">
                  No rings match &quot;{search}&quot;
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default RingTable;
