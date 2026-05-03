"use client";

import { useEffect, useState, useCallback } from "react";
import { Eye, RefreshCw, Loader2, ChevronDown, ChevronRight, BarChart2 } from "lucide-react";
import { Pagination } from "@/components/ui/pagination";
import { getCached, setCached } from "@/lib/cache";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import api from "@/lib/api";

interface SentLog {
  id: number;
  outreach_email_id: number;
  recipient_email: string;
  blog_name: string | null;
  subject: string;
  sent_at: string;
  status: string;
  open_count: number;
  last_opened_at: string | null;
  retry_count: number;
  reply_sentiment: string | null;
}

interface DateGroup {
  date: string;
  rawDate: Date;
  emails: SentLog[];
}

function groupByDate(emails: SentLog[]): DateGroup[] {
  const map = new Map<string, SentLog[]>();
  for (const email of emails) {
    const date = new Date(email.sent_at).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    if (!map.has(date)) map.set(date, []);
    map.get(date)!.push(email);
  }
  return Array.from(map.entries())
    .map(([date, group]) => ({
      date,
      rawDate: new Date(group[0].sent_at),
      emails: group,
    }))
    .sort((a, b) => b.rawDate.getTime() - a.rawDate.getTime());
}

function isWithinDays(date: Date, days: number): boolean {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return date >= cutoff;
}

function SentimentBadge({ sentiment }: { sentiment: string | null }) {
  if (sentiment === "positive") return <Badge variant="success">Positive</Badge>;
  if (sentiment === "negative") return <Badge variant="destructive">Negative</Badge>;
  if (sentiment === "neutral") return <Badge variant="warning">Neutral</Badge>;
  return <span className="text-gray-400 text-xs">—</span>;
}

function EmailRow({
  log,
  retryingId,
  onRetry,
}: {
  log: SentLog;
  retryingId: number | null;
  onRetry: (id: number) => void;
}) {
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3 font-medium text-gray-900">{log.recipient_email}</td>
      <td className="px-4 py-3 text-gray-500">{log.blog_name || "—"}</td>
      <td className="px-4 py-3 text-gray-700 max-w-[200px] truncate">{log.subject}</td>
      <td className="px-4 py-3 text-gray-500">{new Date(log.sent_at).toLocaleTimeString()}</td>
      <td className="px-4 py-3">
        <Badge variant={log.status === "sent" ? "success" : "destructive"}>{log.status}</Badge>
      </td>
      <td className="px-4 py-3">
        {log.open_count > 0 ? (
          <span className="flex items-center gap-1 text-green-600">
            <Eye className="h-3.5 w-3.5" /> {log.open_count}
          </span>
        ) : (
          <span className="text-gray-400">0</span>
        )}
      </td>
      <td className="px-4 py-3">
        <SentimentBadge sentiment={log.reply_sentiment} />
      </td>
      <td className="px-4 py-3">
        {log.status === "failed" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRetry(log.id)}
            loading={retryingId === log.id}
          >
            <RefreshCw className="h-3 w-3" /> Retry
          </Button>
        )}
      </td>
    </tr>
  );
}

export default function SentPage() {
  const [logs, setLogs] = useState<SentLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const load = useCallback(async () => {
    const key = `sent_${statusFilter}`;
    const cached = getCached<SentLog[]>(key);
    if (cached) { setLogs(cached); setLoading(false); }
    else setLoading(true);
    setPage(1);
    try {
      const params = statusFilter ? `?status_filter=${statusFilter}` : "";
      const { data } = await api.get<SentLog[]>(`/sent${params}`);
      setLogs(data);
      setCached(key, data);
    } catch {
      // keep cached data on network failure
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function handleRetry(logId: number) {
    setRetryingId(logId);
    try {
      await api.post(`/sent/${logId}/retry`);
      await load();
    } catch { /* ignore */ } finally {
      setRetryingId(null);
    }
  }

  function toggleCollapse(date: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });
  }

  const filtered = logs.filter(
    (l) =>
      l.recipient_email.toLowerCase().includes(search.toLowerCase()) ||
      l.subject.toLowerCase().includes(search.toLowerCase())
  );

  const paginatedLogs = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const groups = groupByDate(paginatedLogs);

  // Summary stats
  const totalSent = logs.filter((l) => l.status === "sent").length;
  const totalOpens = logs.reduce((sum, l) => sum + l.open_count, 0);
  const openRate = totalSent > 0 ? Math.round((totalOpens / totalSent) * 100) : 0;
  const totalReplied = logs.filter((l) => l.reply_sentiment !== null).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Sent Log</h1>
        <p className="text-gray-500 mt-1">Track sent emails, opens, and retry failures.</p>
      </div>

      {/* Summary bar */}
      {!loading && logs.length > 0 && (
        <div className="flex items-center gap-6 bg-indigo-50 border border-indigo-100 rounded-lg px-5 py-3 text-sm flex-wrap">
          <span className="flex items-center gap-1.5">
            <BarChart2 className="h-4 w-4 text-indigo-500" />
            <span className="text-gray-500">Total sent:</span>
            <span className="font-semibold text-gray-900">{totalSent}</span>
          </span>
          <span className="text-gray-300">|</span>
          <span>
            <span className="text-gray-500">Opens:</span>{" "}
            <span className="font-semibold text-gray-900">{totalOpens}</span>
          </span>
          <span className="text-gray-300">|</span>
          <span>
            <span className="text-gray-500">Open rate:</span>{" "}
            <span className="font-semibold text-gray-900">{openRate}%</span>
          </span>
          <span className="text-gray-300">|</span>
          <span>
            <span className="text-gray-500">Replied:</span>{" "}
            <span className="font-semibold text-gray-900">{totalReplied}</span>
          </span>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40">
          <option value="">All Statuses</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        </div>
      ) : groups.length === 0 ? (
        <p className="py-16 text-center text-sm text-gray-500">No sent emails found.</p>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => {
            const isRecent = isWithinDays(group.rawDate, 7);
            const isOpen = !collapsed.has(group.date) && isRecent;
            // For older groups, collapsed by default; for recent, expanded by default
            const actuallyOpen = collapsed.has(group.date) ? false : isRecent;

            return (
              <Card key={group.date} className="overflow-hidden">
                {/* Date header */}
                <button
                  onClick={() => toggleCollapse(group.date)}
                  className="w-full flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-200 hover:bg-gray-100 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    {actuallyOpen ? (
                      <ChevronDown className="h-4 w-4 text-gray-500" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-gray-500" />
                    )}
                    <span className="font-semibold text-gray-900">{group.date}</span>
                    <span className="text-sm text-gray-500">
                      · {group.emails.length} email{group.emails.length !== 1 ? "s" : ""} sent
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span>
                      Opens:{" "}
                      <strong>{group.emails.reduce((s, e) => s + e.open_count, 0)}</strong>
                    </span>
                    <span>
                      Replied:{" "}
                      <strong>{group.emails.filter((e) => e.reply_sentiment !== null).length}</strong>
                    </span>
                  </div>
                </button>

                {/* Email rows */}
                {actuallyOpen && (
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="border-b border-gray-100 bg-white">
                          <tr>
                            <th className="px-4 py-2.5 text-left font-medium text-gray-600">Recipient</th>
                            <th className="px-4 py-2.5 text-left font-medium text-gray-600">Blog</th>
                            <th className="px-4 py-2.5 text-left font-medium text-gray-600">Subject</th>
                            <th className="px-4 py-2.5 text-left font-medium text-gray-600">Time</th>
                            <th className="px-4 py-2.5 text-left font-medium text-gray-600">Status</th>
                            <th className="px-4 py-2.5 text-left font-medium text-gray-600">Opens</th>
                            <th className="px-4 py-2.5 text-left font-medium text-gray-600">Reply</th>
                            <th className="px-4 py-2.5 text-left font-medium text-gray-600">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {group.emails.map((log) => (
                            <EmailRow
                              key={log.id}
                              log={log}
                              retryingId={retryingId}
                              onRetry={handleRetry}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
          {filtered.length > PAGE_SIZE && (
            <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} />
          )}
        </div>
      )}
    </div>
  );
}
