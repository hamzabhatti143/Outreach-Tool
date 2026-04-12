"use client";

import { useEffect, useState, useCallback } from "react";
import { Eye, RefreshCw, Loader2 } from "lucide-react";
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
}

export default function SentPage() {
  const [logs, setLogs] = useState<SentLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [retryingId, setRetryingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = statusFilter ? `?status_filter=${statusFilter}` : "";
      const { data } = await api.get<SentLog[]>(`/sent${params}`);
      setLogs(data);
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
    } finally {
      setRetryingId(null);
    }
  }

  const filtered = logs.filter((l) =>
    l.recipient_email.toLowerCase().includes(search.toLowerCase()) ||
    l.subject.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Sent Log</h1>
        <p className="text-gray-500 mt-1">Track sent emails, opens, and retry failures.</p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40">
          <option value="">All Statuses</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-indigo-600" /></div>
          ) : filtered.length === 0 ? (
            <p className="py-16 text-center text-sm text-gray-500">No sent emails found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-200 bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Recipient</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Blog</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Subject</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Sent At</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Opens</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{log.recipient_email}</td>
                      <td className="px-4 py-3 text-gray-500">{log.blog_name || "—"}</td>
                      <td className="px-4 py-3 text-gray-700 max-w-[200px] truncate">{log.subject}</td>
                      <td className="px-4 py-3 text-gray-500">{new Date(log.sent_at).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <Badge variant={log.status === "sent" ? "success" : "destructive"}>
                          {log.status}
                        </Badge>
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
                        {log.status === "failed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRetry(log.id)}
                            loading={retryingId === log.id}
                          >
                            <RefreshCw className="h-3 w-3" /> Retry
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
