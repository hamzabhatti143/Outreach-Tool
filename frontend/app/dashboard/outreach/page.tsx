"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2, Check, X, Edit2, Save, CheckCheck,
  Mail, ChevronLeft, RefreshCw, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import api from "@/lib/api";

interface OutreachEmail {
  id: number;
  lead_id: number;
  campaign_id: number;
  recipient_email: string;
  blog_name: string | null;
  subject: string;
  body: string;
  status: string;
  created_at: string;
  approved_at: string | null;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function OutreachPage() {
  const [emails, setEmails] = useState<OutreachEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<OutreachEmail | null>(null);
  const [approving, setApproving] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<OutreachEmail[]>("/outreach/pending");
      setEmails(data);
      setOpen((prev) => prev ? (data.find((e) => e.id === prev.id) ?? null) : null);
    } catch {
      setError("Failed to load emails. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openEmail(email: OutreachEmail) {
    setOpen(email);
    setEditing(false);
    setEditSubject(email.subject);
    setEditBody(email.body);
    setError(null);
  }

  function toggleSelect(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }

  function toggleAll() {
    setSelected(selected.size === emails.length ? new Set() : new Set(emails.map((e) => e.id)));
  }

  async function approveSelected() {
    setApproving(true);
    setError(null);
    try {
      await Promise.all(
        Array.from(selected).map((id) =>
          api.patch(`/outreach/${id}/approve`).then(() => undefined)
        )
      );
      setSelected(new Set());
      await load();
    } catch {
      setError("Failed to approve some emails. Please try again.");
    } finally {
      setApproving(false);
    }
  }

  async function handleApprove(id: number) {
    setActionLoading("approve");
    setError(null);
    try {
      await api.patch(`/outreach/${id}/approve`);
      await load();
      setOpen(null);
    } catch {
      setError("Failed to approve email. Please try again.");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject(id: number) {
    setActionLoading("reject");
    setError(null);
    try {
      await api.patch(`/outreach/${id}/reject`);
      await load();
      setOpen(null);
    } catch {
      setError("Failed to reject email. Please try again.");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSave(id: number) {
    setActionLoading("save");
    setError(null);
    try {
      await api.patch(`/outreach/${id}/edit`, { subject: editSubject, body: editBody });
      setEditing(false);
      await load();
    } catch {
      setError("Failed to save changes. Please try again.");
    } finally {
      setActionLoading(null);
    }
  }

  const statusBadge = (status: string) => {
    if (status === "approved") return <Badge variant="success">Approved</Badge>;
    if (status === "rejected") return <Badge variant="destructive">Rejected</Badge>;
    return <Badge variant="secondary">Pending</Badge>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex h-[calc(100vh-170px)] bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">

        {/* ── LEFT PANEL ── */}
        <div className={`flex flex-col border-r border-gray-200 transition-all duration-200 ${open ? "w-80 shrink-0" : "flex-1"}`}>

          {/* Toolbar */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50">
            <input
              type="checkbox"
              checked={emails.length > 0 && selected.size === emails.length}
              onChange={toggleAll}
              className="rounded border-gray-300 text-indigo-600"
            />
            <span className="text-sm text-gray-500 flex-1">
              {selected.size > 0 ? `${selected.size} selected` : `${emails.length} pending`}
            </span>
            <button onClick={load} className="text-gray-400 hover:text-gray-700 transition-colors">
              <RefreshCw className="h-4 w-4" />
            </button>
            {selected.size > 0 && (
              <Button size="sm" onClick={approveSelected} loading={approving} className="h-7 text-xs">
                <CheckCheck className="h-3 w-3" />
                Approve {selected.size}
              </Button>
            )}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {emails.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 py-16">
                <Mail className="h-10 w-10 mb-3 opacity-30" />
                <p className="font-medium text-sm">No pending emails</p>
                <p className="text-xs mt-1">Run a campaign to generate outreach</p>
              </div>
            ) : (
              emails.map((email) => (
                <div
                  key={email.id}
                  onClick={() => openEmail(email)}
                  className={`flex items-start gap-3 px-4 py-3 border-b border-gray-100 cursor-pointer transition-colors hover:bg-indigo-50 ${
                    open?.id === email.id ? "bg-indigo-50 border-l-2 border-l-indigo-500" : ""
                  }`}
                >
                  <div className="pt-0.5" onClick={(e) => toggleSelect(email.id, e)}>
                    <input
                      type="checkbox"
                      checked={selected.has(email.id)}
                      onChange={() => {}}
                      className="rounded border-gray-300 text-indigo-600"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {email.blog_name || email.recipient_email}
                      </p>
                      <span className="text-xs text-gray-400 shrink-0">{timeAgo(email.created_at)}</span>
                    </div>
                    <p className="text-xs text-gray-600 truncate">{email.subject}</p>
                    <p className="text-xs text-gray-400 truncate mt-0.5">{email.body.slice(0, 80)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── RIGHT PANEL ── */}
        <AnimatePresence>
          {open && (
            <motion.div
              className="flex-1 flex flex-col min-w-0 overflow-hidden"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.18 }}
            >
              {/* Header */}
              <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-white shrink-0">
                <button onClick={() => setOpen(null)} className="text-gray-400 hover:text-gray-700 transition-colors lg:hidden">
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <div className="flex-1 min-w-0">
                  {editing ? (
                    <Input value={editSubject} onChange={(e) => setEditSubject(e.target.value)} className="text-base font-semibold h-8" />
                  ) : (
                    <h2 className="text-base font-semibold text-gray-900 truncate">{open.subject}</h2>
                  )}
                </div>
                {statusBadge(open.status)}
              </div>

              {/* Meta row */}
              <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 bg-gray-50 shrink-0">
                <div>
                  <p className="text-sm text-gray-700">
                    <span className="text-gray-400">To: </span>
                    <span className="font-medium">{open.recipient_email}</span>
                    {open.blog_name && <span className="ml-2 text-gray-400 text-xs">· {open.blog_name}</span>}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{new Date(open.created_at).toLocaleString()}</p>
                </div>

                <div className="flex items-center gap-2">
                  {editing ? (
                    <>
                      <Button size="sm" onClick={() => handleSave(open.id)} loading={actionLoading === "save"}>
                        <Save className="h-3 w-3" /> Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                    </>
                  ) : (
                    <>
                      {open.status === "pending" && (
                        <>
                          <Button size="sm" onClick={() => handleApprove(open.id)} loading={actionLoading === "approve"}>
                            <Check className="h-3 w-3" /> Approve
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => handleReject(open.id)} loading={actionLoading === "reject"}>
                            <X className="h-3 w-3" /> Reject
                          </Button>
                        </>
                      )}
                      <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                        <Edit2 className="h-3 w-3" /> Edit
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-6 py-6">
                {editing ? (
                  <Textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={18} className="text-sm leading-relaxed resize-none w-full" />
                ) : (
                  <div className="prose prose-sm max-w-none">
                    <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 leading-relaxed">{open.body}</pre>
                  </div>
                )}
              </div>

              {/* Bottom bar */}
              {open.status === "pending" && !editing && (
                <div className="shrink-0 border-t border-gray-100 bg-gray-50 px-6 py-3 flex gap-3">
                  <Button onClick={() => handleApprove(open.id)} loading={actionLoading === "approve"} className="flex-1">
                    <Check className="h-4 w-4" /> Approve &amp; Move to Send Queue
                  </Button>
                  <Button variant="destructive" onClick={() => handleReject(open.id)} loading={actionLoading === "reject"}>
                    <X className="h-4 w-4" /> Reject
                  </Button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
