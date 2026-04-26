"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Loader2, Send, Trash2, CheckSquare, Square,
  RefreshCw, AlertCircle, CheckCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useCampaigns } from "@/lib/campaign-context";
import api from "@/lib/api";

interface OutreachEmail {
  id: number;
  recipient_email: string;
  blog_name: string | null;
  subject: string;
  status: string;
}

export default function BulkPage() {
  const { campaigns, selectedId, setSelectedId } = useCampaigns();

  const [emails, setEmails] = useState<OutreachEmail[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelected(new Set());
    try {
      const url = selectedId
        ? `/outreach/approved?campaign_id=${selectedId}`
        : "/outreach/approved";
      const { data } = await api.get<OutreachEmail[]>(url);
      setEmails(data);
    } catch {
      setError("Failed to load emails.");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { load(); }, [load]);

  function toggleAll() {
    setSelected(selected.size === emails.length ? new Set() : new Set(emails.map((e) => e.id)));
  }

  function toggle(id: number) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }

  async function handleSend() {
    const ids = Array.from(selected);
    setSending(true);
    setError(null);
    setProgress({ sent: 0, total: ids.length });
    try {
      await api.post("/bulk/send", { ids });
      setProgress({ sent: ids.length, total: ids.length });
      setSuccessMsg(`${ids.length} email${ids.length !== 1 ? "s" : ""} sent successfully!`);
      setTimeout(() => { setSuccessMsg(null); setProgress(null); load(); }, 3000);
      setSelected(new Set());
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Failed to send emails.");
      setProgress(null);
    } finally {
      setSending(false);
    }
  }

  async function handleDelete() {
    const ids = Array.from(selected);
    if (!confirm(`Delete ${ids.length} email${ids.length !== 1 ? "s" : ""}?`)) return;
    setDeleting(true);
    try {
      await api.post("/bulk/delete", { ids });
      setSelected(new Set());
      await load();
    } catch {
      setError("Failed to delete emails.");
    } finally {
      setDeleting(false);
    }
  }

  const selectedCampaign = campaigns.find((c) => c.id === selectedId);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bulk Sender</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Select approved emails and send them via your connected Gmail account.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedCampaign && (
            <Badge variant={
              selectedCampaign.status === "completed" ? "success" :
              selectedCampaign.status === "running"   ? "default" :
              selectedCampaign.status === "error"     ? "destructive" : "secondary"
            }>
              {selectedCampaign.status}
            </Badge>
          )}
          <Select
            value={selectedId?.toString() || ""}
            onChange={(e) => { setSelectedId(Number(e.target.value)); }}
            className="w-52"
          >
            <option value="">All campaigns</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <button onClick={load} className="p-1 text-gray-400 hover:text-gray-700 transition-colors">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Banners */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">✕</button>
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          <CheckCircle className="h-4 w-4 shrink-0" /> {successMsg}
        </div>
      )}

      {/* Progress bar */}
      {progress && (
        <div className="rounded-lg bg-indigo-50 border border-indigo-200 p-4">
          <div className="flex justify-between text-sm text-indigo-700 mb-2">
            <span>Sending emails…</span>
            <span>{progress.sent}/{progress.total}</span>
          </div>
          <div className="h-2 bg-indigo-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-600 rounded-full transition-all duration-500"
              style={{ width: `${(progress.sent / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={toggleAll}
            disabled={emails.length === 0}
            className="text-gray-500 hover:text-indigo-600 transition-colors disabled:opacity-30"
          >
            {selected.size > 0 && selected.size === emails.length
              ? <CheckSquare className="h-5 w-5 text-indigo-600" />
              : <Square className="h-5 w-5" />}
          </button>
          <span className="text-sm text-gray-600">
            {selected.size > 0
              ? `${selected.size} of ${emails.length} selected`
              : `${emails.length} approved email${emails.length !== 1 ? "s" : ""}`}
          </span>
        </div>
        {selected.size > 0 && (
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSend} loading={sending} disabled={deleting}>
              <Send className="h-3 w-3" /> Send {selected.size}
            </Button>
            <Button size="sm" variant="destructive" onClick={handleDelete} loading={deleting} disabled={sending}>
              <Trash2 className="h-3 w-3" /> Delete {selected.size}
            </Button>
          </div>
        )}
      </div>

      {/* Email list */}
      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-7 w-7 animate-spin text-indigo-500" />
        </div>
      ) : emails.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 rounded-xl border border-gray-200 bg-white">
          <Send className="h-10 w-10 mb-3 opacity-30" />
          <p className="font-medium text-sm text-gray-600">No approved emails</p>
          <p className="text-xs mt-1 text-center max-w-xs">
            Go to <span className="text-indigo-600 font-medium">Outreach</span> to approve draft emails first, then come back here to send them.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
          {emails.map((email) => (
            <div
              key={email.id}
              onClick={() => toggle(email.id)}
              className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-indigo-50 ${
                selected.has(email.id) ? "bg-indigo-50 border-l-2 border-l-indigo-500" : ""
              }`}
            >
              <button
                className="shrink-0 text-gray-400"
                onClick={(e) => { e.stopPropagation(); toggle(email.id); }}
              >
                {selected.has(email.id)
                  ? <CheckSquare className="h-5 w-5 text-indigo-600" />
                  : <Square className="h-5 w-5" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900 truncate">{email.recipient_email}</p>
                <p className="text-xs text-gray-500 truncate mt-0.5">
                  {email.blog_name ? `${email.blog_name} · ` : ""}{email.subject}
                </p>
              </div>
              <Badge variant="success" className="shrink-0 text-xs">Approved</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
