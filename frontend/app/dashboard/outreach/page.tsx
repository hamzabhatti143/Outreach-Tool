"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2, Check, X, Edit2, Save, CheckCheck,
  Mail, ChevronLeft, RefreshCw, AlertCircle,
  Play, Clock, CheckCircle, Zap, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { useCampaigns } from "@/lib/campaign-context";
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

interface CampaignStats {
  sources: number;
  leads: number;
  pending_outreach: number;
  approved_outreach: number;
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
  const { campaigns, selectedId, setSelectedId, loading: campaignsLoading } = useCampaigns();

  const [emails, setEmails] = useState<OutreachEmail[]>([]);
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<{ msg: string; ok: boolean } | null>(null);
  const [open, setOpen] = useState<OutreachEmail | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [approving, setApproving] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const selectedCampaign = campaigns.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    if (bodyRef.current && editing) {
      bodyRef.current.style.height = "auto";
      bodyRef.current.style.height = `${bodyRef.current.scrollHeight}px`;
    }
  }, [editBody, editing]);

  useEffect(() => {
    if (!editing && open) {
      setEditSubject(open.subject);
      setEditBody(open.body);
    }
  }, [open, editing]);

  const load = useCallback(async (cid: number, filter?: string) => {
    setLoading(true);
    setError(null);
    const activeFilter = filter ?? statusFilter;
    try {
      const params = new URLSearchParams({ campaign_id: String(cid) });
      if (activeFilter !== "all") params.set("status", activeFilter);
      const { data } = await api.get<OutreachEmail[]>(`/outreach/all?${params}`);
      setEmails(data);
      setOpen((prev) => prev ? (data.find((e) => e.id === prev.id) ?? null) : null);
    } catch {
      setError("Failed to load emails.");
      setEmails([]);
    } finally {
      setLoading(false);
    }
    // stats load in background — don't block
    try {
      const { data: s } = await api.get<CampaignStats>(`/campaigns/${cid}/stats`);
      setStats(s);
    } catch { /* non-critical */ }
  }, [statusFilter]);

  // Load whenever campaign selection is ready
  useEffect(() => {
    if (campaignsLoading) return;         // wait for context
    if (!selectedId) {
      setEmails([]);
      setStats(null);
      setLoading(false);
      return;
    }
    load(selectedId);
  }, [selectedId, campaignsLoading, load]);

  function showSuccess(msg: string) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  }

  async function handleGenerate() {
    if (!selectedId) return;
    setGenerating(true);
    setGenerateResult(null);
    setError(null);
    try {
      const { data } = await api.post<{ generated: number; total_leads: number }>(
        `/outreach/generate?campaign_id=${selectedId}`
      );
      if (data.generated === 0) {
        setGenerateResult({
          msg: `No new drafts created — ${data.total_leads} lead${data.total_leads !== 1 ? "s" : ""} found but all already have emails (or Gemini failed — check backend logs).`,
          ok: false,
        });
      } else {
        setGenerateResult({ msg: `Generated ${data.generated} new draft${data.generated !== 1 ? "s" : ""}!`, ok: true });
        await load(selectedId);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Failed to generate drafts.");
    } finally {
      setGenerating(false);
    }
  }

  function openEmail(email: OutreachEmail) {
    setOpen(email);
    setEditing(false);
    setEditSubject(email.subject);
    setEditBody(email.body);
    setError(null);
  }

  function cancelEdit() {
    setEditing(false);
    if (open) { setEditSubject(open.subject); setEditBody(open.body); }
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
      await Promise.all(Array.from(selected).map((id) => api.patch(`/outreach/${id}/approve`)));
      setSelected(new Set());
      if (selectedId) await load(selectedId);
      showSuccess(`${selected.size} email${selected.size !== 1 ? "s" : ""} approved`);
    } catch {
      setError("Failed to approve some emails.");
    } finally {
      setApproving(false);
    }
  }

  async function handleApprove(id: number) {
    setActionLoading("approve");
    try {
      await api.patch(`/outreach/${id}/approve`);
      if (selectedId) await load(selectedId);
      setOpen(null);
      showSuccess("Email approved — go to Bulk Send to send it");
    } catch {
      setError("Failed to approve email.");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject(id: number) {
    setActionLoading("reject");
    try {
      await api.patch(`/outreach/${id}/reject`);
      if (selectedId) await load(selectedId);
      setOpen(null);
    } catch {
      setError("Failed to reject email.");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSave(id: number) {
    setActionLoading("save");
    try {
      await api.patch(`/outreach/${id}/edit`, { subject: editSubject, body: editBody });
      setEditing(false);
      showSuccess("Email saved");
      if (selectedId) await load(selectedId);
    } catch {
      setError("Failed to save changes.");
    } finally {
      setActionLoading(null);
    }
  }

  const statusBadge = (status: string) => {
    if (status === "approved") return <Badge variant="success">Approved</Badge>;
    if (status === "rejected") return <Badge variant="destructive">Rejected</Badge>;
    return <Badge variant="secondary">Pending</Badge>;
  };

  // ── Empty state inside list ─────────────────────────────────────────────────
  function ListEmpty() {
    if (!selectedCampaign) {
      return (
        <div className="flex flex-col items-center justify-center h-full py-20 text-gray-400 text-center px-4">
          <Mail className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm font-medium">Select a campaign above</p>
        </div>
      );
    }
    if (selectedCampaign.status === "idle") {
      return (
        <div className="flex flex-col items-center justify-center h-full py-20 text-center px-6">
          <Play className="h-10 w-10 mb-3 text-gray-300" />
          <p className="text-sm font-semibold text-gray-700">Campaign hasn&apos;t run yet</p>
          <p className="text-xs mt-1 text-gray-400 max-w-xs">
            Go to <span className="text-indigo-600 font-medium">Campaigns</span> and click <span className="font-medium">Run Pipeline</span>.
          </p>
        </div>
      );
    }
    if (selectedCampaign.status === "running") {
      return (
        <div className="flex flex-col items-center justify-center h-full py-20 text-center px-6">
          <Loader2 className="h-10 w-10 mb-3 animate-spin text-indigo-400" />
          <p className="text-sm font-semibold text-gray-700">Pipeline is running…</p>
          <p className="text-xs mt-1 text-gray-400">Emails will appear here when the writer step completes.</p>
        </div>
      );
    }
    if (selectedCampaign.status === "error") {
      return (
        <div className="flex flex-col items-center justify-center h-full py-20 text-center px-6">
          <AlertCircle className="h-10 w-10 mb-3 text-red-300" />
          <p className="text-sm font-semibold text-gray-700">Pipeline error</p>
          <p className="text-xs mt-1 text-gray-400">Re-run the pipeline from the Campaigns page.</p>
        </div>
      );
    }
    // completed — no drafts
    if (stats && stats.leads === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full py-20 text-center px-6">
          <Zap className="h-10 w-10 mb-3 text-amber-300" />
          <p className="text-sm font-semibold text-gray-700">
            {stats.sources === 0 ? "No blogs were found" : "No emails were scraped from blogs"}
          </p>
          <p className="text-xs mt-1 text-gray-400 max-w-xs">
            {stats.sources === 0
              ? "SerpAPI returned no results. Try a different niche."
              : `${stats.sources} blog${stats.sources !== 1 ? "s" : ""} found but none had a public email address.`}
          </p>
        </div>
      );
    }
    if (stats && stats.approved_outreach > 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full py-20 text-center px-6">
          <CheckCircle className="h-10 w-10 mb-3 text-green-400" />
          <p className="text-sm font-semibold text-gray-700">All drafts approved</p>
          <p className="text-xs mt-1 text-gray-400">
            {stats.approved_outreach} email{stats.approved_outreach !== 1 ? "s" : ""} ready in{" "}
            <span className="text-indigo-600 font-medium">Bulk Send</span>.
          </p>
        </div>
      );
    }
    // leads exist but no outreach → writer step probably failed
    return (
      <div className="flex flex-col items-center justify-center h-full py-20 text-center px-6">
        <Sparkles className="h-10 w-10 mb-3 text-indigo-300" />
        <p className="text-sm font-semibold text-gray-700">No drafts yet</p>
        <p className="text-xs mt-1 text-gray-400 max-w-xs mb-4">
          {stats && stats.leads > 0
            ? `${stats.leads} lead${stats.leads !== 1 ? "s" : ""} found — click Generate Drafts to write outreach emails.`
            : "Run Generate Drafts to create AI outreach emails for this campaign."}
        </p>
        <Button size="sm" onClick={handleGenerate} loading={generating}>
          <Sparkles className="h-3.5 w-3.5 mr-1" /> Generate Drafts
        </Button>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Outreach</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Review and approve AI-generated draft emails before sending.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Campaign status pill */}
          {selectedCampaign && (
            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${
              selectedCampaign.status === "completed" ? "bg-green-100 text-green-700" :
              selectedCampaign.status === "running"   ? "bg-indigo-100 text-indigo-700" :
              selectedCampaign.status === "error"     ? "bg-red-100 text-red-600" :
                                                        "bg-gray-100 text-gray-500"
            }`}>
              {selectedCampaign.status === "running"   && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
              {selectedCampaign.status === "completed" && <CheckCircle className="h-2.5 w-2.5" />}
              {selectedCampaign.status === "error"     && <AlertCircle className="h-2.5 w-2.5" />}
              {selectedCampaign.status === "idle"      && <Clock className="h-2.5 w-2.5" />}
              {selectedCampaign.status}
            </span>
          )}

          <Select
            value={selectedId?.toString() || ""}
            onChange={(e) => {
              setSelectedId(Number(e.target.value));
              setOpen(null);
              setSelected(new Set());
              setStats(null);
              setGenerateResult(null);
              setStatusFilter("all");
            }}
            className="w-52"
          >
            {campaigns.length === 0
              ? <option value="">No campaigns</option>
              : campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)
            }
          </Select>

          <Button
            size="sm"
            variant="outline"
            onClick={handleGenerate}
            loading={generating}
            disabled={!selectedId || generating}
            title="Generate AI draft emails for leads that don't have one yet"
          >
            <Sparkles className="h-3.5 w-3.5 mr-1" /> Generate Drafts
          </Button>

          <button
            onClick={() => { if (selectedId) load(selectedId); }}
            className="p-1 text-gray-400 hover:text-gray-700 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Stats strip */}
      {stats && (emails.length > 0 || stats.approved_outreach > 0) && (
        <div className="flex items-center gap-4 text-sm text-gray-500 px-1">
          {emails.length > 0 && <span><span className="font-semibold text-gray-900">{emails.length}</span> pending</span>}
          {stats.approved_outreach > 0 && <span><span className="font-semibold text-gray-900">{stats.approved_outreach}</span> approved</span>}
          {stats.leads > 0 && <span><span className="font-semibold text-gray-900">{stats.leads}</span> leads total</span>}
        </div>
      )}

      {/* Banners */}
      <AnimatePresence>
        {error && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
          >
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            <button onClick={() => setError(null)} className="ml-auto"><X className="h-4 w-4" /></button>
          </motion.div>
        )}
        {generateResult && (
          <motion.div
            key="generateResult"
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${
              generateResult.ok
                ? "bg-indigo-50 border-indigo-200 text-indigo-800"
                : "bg-amber-50 border-amber-200 text-amber-800"
            }`}
          >
            <Sparkles className="h-4 w-4 shrink-0" /> {generateResult.msg}
            <button onClick={() => setGenerateResult(null)} className="ml-auto"><X className="h-4 w-4" /></button>
          </motion.div>
        )}
        {successMsg && (
          <motion.div
            key="successMsg"
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700"
          >
            <Check className="h-4 w-4 shrink-0" /> {successMsg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main split panel */}
      <div className="flex h-[calc(100vh-230px)] bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">

        {/* LEFT: list */}
        <div className={`flex flex-col border-r border-gray-200 transition-all duration-200 ${open ? "w-80 shrink-0" : "flex-1"}`}>

          {/* Toolbar */}
          <div className="flex flex-col border-b border-gray-100">
            {/* Status tabs */}
            <div className="flex items-center gap-1 px-3 pt-2 pb-0">
              {(["all", "pending", "approved", "rejected", "sent"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setStatusFilter(s);
                    setSelected(new Set());
                    if (selectedId) load(selectedId, s);
                  }}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                    statusFilter === s
                      ? "bg-indigo-600 text-white"
                      : "text-gray-500 hover:bg-gray-100"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            {/* Checkbox + count row */}
            <div className="flex items-center gap-2 px-4 py-2">
              <input
                type="checkbox"
                checked={emails.length > 0 && selected.size === emails.length}
                onChange={toggleAll}
                className="rounded border-gray-300 text-indigo-600"
                disabled={emails.length === 0}
              />
              <span className="text-sm text-gray-500 flex-1">
                {selected.size > 0 ? `${selected.size} selected` : `${emails.length} email${emails.length !== 1 ? "s" : ""}`}
              </span>
              {selected.size > 0 && statusFilter !== "approved" && (
                <Button size="sm" onClick={approveSelected} loading={approving} className="h-7 text-xs">
                  <CheckCheck className="h-3 w-3" /> Approve {selected.size}
                </Button>
              )}
            </div>
          </div>

          {/* List body */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-400">
                <Loader2 className="h-7 w-7 animate-spin text-indigo-400" />
                <p className="text-xs">Loading emails…</p>
              </div>
            ) : emails.length === 0 ? (
              <ListEmpty />
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

        {/* RIGHT: detail panel */}
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
              <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 shrink-0">
                <button onClick={() => setOpen(null)} className="text-gray-400 hover:text-gray-700 lg:hidden">
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <div className="flex-1 min-w-0">
                  {editing ? (
                    <Input
                      value={editSubject}
                      onChange={(e) => setEditSubject(e.target.value)}
                      className="text-base font-semibold h-8 ring-2 ring-blue-500"
                    />
                  ) : (
                    <h2 className="text-base font-semibold text-gray-900 truncate">{open.subject}</h2>
                  )}
                </div>
                {statusBadge(open.status)}
              </div>

              {/* Meta + actions */}
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
                      <span className="text-xs text-amber-600 font-medium mr-1">(unsaved)</span>
                      <Button size="sm" onClick={() => handleSave(open.id)} loading={actionLoading === "save"}>
                        <Save className="h-3 w-3" /> Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={cancelEdit}>Cancel</Button>
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
                  <Textarea
                    ref={bodyRef}
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    rows={18}
                    className="text-sm leading-relaxed resize-none w-full ring-2 ring-blue-500 overflow-hidden"
                  />
                ) : (
                  <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 leading-relaxed">
                    {open.body}
                  </pre>
                )}
              </div>

              {/* Bottom approve bar */}
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
