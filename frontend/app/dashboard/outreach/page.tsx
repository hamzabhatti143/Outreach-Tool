"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2, Check, X, Edit2, Save, CheckCheck,
  Mail, ChevronLeft, RefreshCw, AlertCircle,
  Play, Clock, CheckCircle, Zap, Sparkles, Send, PartyPopper,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Pagination } from "@/components/ui/pagination";
import { getCached, setCached } from "@/lib/cache";
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
  sent_outreach: number;
}

interface SendProgress {
  total: number;
  sent: number;
  failed: number;
  failed_ids: number[];
  in_progress: boolean;
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
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<{ msg: string; ok: boolean } | null>(null);
  const [open, setOpen] = useState<OutreachEmail | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [approving, setApproving] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Approve-all / Send-all state
  const [approvingAll, setApprovingAll] = useState(false);
  const [sendingAll, setSendingAll] = useState(false);
  const [sendProgress, setSendProgress] = useState<SendProgress | null>(null);
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoGenRef = useRef<Set<string>>(new Set());

  const [editing, setEditing] = useState(false);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [listPage, setListPage] = useState(1);
  const LIST_PAGE_SIZE = 20;
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

  const load = useCallback(async (cid: number, filter?: string, silent = false) => {
    setError(null);
    if (!silent) setListPage(1);
    const activeFilter = filter ?? statusFilter;
    const key = `outreach_${cid}_${activeFilter}`;
    const cached = getCached<OutreachEmail[]>(key);
    if (!silent) {
      if (cached) { setEmails(cached); setLoading(false); }
      else setLoading(true);
    }

    const params = new URLSearchParams({ campaign_id: String(cid) });
    if (activeFilter !== "all") params.set("status", activeFilter);

    // Fire emails and stats in parallel — halves perceived latency
    const [emailsRes, statsRes] = await Promise.allSettled([
      api.get<OutreachEmail[]>(`/outreach/all?${params}`),
      api.get<CampaignStats>(`/campaigns/${cid}/stats`),
    ]);

    if (emailsRes.status === "fulfilled") {
      const data = emailsRes.value.data;
      setEmails(data);
      setCached(key, data);
      setOpen((prev) => prev ? (data.find((e) => e.id === prev.id) ?? null) : null);
    } else if (!silent) {
      setError("Failed to load emails.");
      if (!cached) setEmails([]);
    }

    if (statsRes.status === "fulfilled") {
      setStats(statsRes.value.data);
    }

    if (!silent) setLoading(false);
  }, [statusFilter]);

  useEffect(() => {
    if (campaignsLoading) return;
    if (!selectedId) { setEmails([]); setStats(null); setLoading(false); return; }
    load(selectedId);
  }, [selectedId, campaignsLoading, load]);

  // Auto-generate drafts whenever new leads arrive without outreach emails.
  // Key = campaignId + leadsCount so it re-fires if the pipeline finds more leads.
  useEffect(() => {
    if (!stats || !selectedId) return;
    if (stats.leads === 0) return;
    const key = `${selectedId}-${stats.leads}`;
    if (autoGenRef.current.has(key)) return;
    autoGenRef.current.add(key);

    (async () => {
      setGenerating(true);
      try {
        const { data } = await api.post<{ generated: number; total_leads: number }>(
          `/outreach/generate?campaign_id=${selectedId}`
        );
        if (data.generated > 0) {
          showSuccess(`Auto-generated ${data.generated} draft${data.generated !== 1 ? "s" : ""} for new leads`);
          setStatusFilter("pending");
          load(selectedId, "pending", true); // silent — no spinner flash
        }
      } catch { /* silent — user can still click Generate manually */ }
      finally { setGenerating(false); }
    })();
  }, [selectedId, stats?.leads]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop progress polling when send job completes
  useEffect(() => {
    if (sendProgress && !sendProgress.in_progress && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
      setSendingAll(false);
      const msg = sendProgress.failed > 0
        ? `Sent ${sendProgress.sent} · ${sendProgress.failed} failed (see Failed tab)`
        : `All ${sendProgress.sent} emails sent successfully`;
      showSuccess(msg);
      setStatusFilter(sendProgress.failed > 0 ? "failed" : "pending");
      if (selectedId) load(selectedId, sendProgress.failed > 0 ? "failed" : "pending");
    }
  }, [sendProgress, selectedId, load]);

  // Cleanup interval on unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  function showSuccess(msg: string) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
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
          msg: `No new drafts — ${data.total_leads} lead${data.total_leads !== 1 ? "s" : ""} found but all already have emails.`,
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

  async function handleApproveAll() {
    if (!selectedId) return;
    setApprovingAll(true);
    setError(null);
    try {
      const { data } = await api.post<{ approved_count: number }>("/outreach/approve-all", {
        campaign_id: selectedId,
      });
      showSuccess(`${data.approved_count} email${data.approved_count !== 1 ? "s" : ""} approved — click Send All Approved to send`);
      setStatusFilter("pending");
      await load(selectedId, "pending");
    } catch {
      setError("Failed to approve all emails.");
    } finally {
      setApprovingAll(false);
    }
  }

  async function handleSendAll() {
    if (!selectedId) return;
    setShowSendConfirm(false);
    setSendingAll(true);
    setSendProgress(null);
    setError(null);

    try {
      await api.post("/outreach/send-all-approved", { campaign_id: selectedId });

      // Start polling progress every 2 seconds
      pollRef.current = setInterval(async () => {
        try {
          const { data } = await api.get<SendProgress>("/outreach/send-progress");
          setSendProgress(data);
        } catch { /* ignore */ }
      }, 2000);

    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Failed to start sending.");
      setSendingAll(false);
    }
  }

  async function handleGenerateAndSend() {
    if (!selectedId) return;
    setGenerating(true);
    setGenerateResult(null);
    setError(null);
    try {
      // Step 1: Write outreach for leads that don't have it yet
      const { data: gen } = await api.post<{ generated: number; total_leads: number }>(
        `/outreach/generate?campaign_id=${selectedId}`
      );
      if (gen.generated === 0) {
        setGenerateResult({
          msg: `No new leads to process — all ${gen.total_leads} already have outreach emails.`,
          ok: false,
        });
        return;
      }
      setGenerateResult({ msg: `Generated ${gen.generated} draft${gen.generated !== 1 ? "s" : ""} — approving & sending…`, ok: true });

      // Step 2: Approve all pending
      await api.post("/outreach/approve-all", { campaign_id: selectedId });

      // Step 3: Kick off background send + start polling
      setGenerating(false);
      setSendingAll(true);
      setSendProgress(null);
      await api.post("/outreach/send-all-approved", { campaign_id: selectedId });
      if (selectedId) await load(selectedId, "approved");
      pollRef.current = setInterval(async () => {
        try {
          const { data } = await api.get<SendProgress>("/outreach/send-progress");
          setSendProgress(data);
        } catch { /* ignore */ }
      }, 2000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Failed to generate and send.");
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
    const pageIds = pagedEmails.map((e) => e.id);
    const allPageSelected = pageIds.every((id) => selected.has(id));
    const next = new Set(selected);
    if (allPageSelected) pageIds.forEach((id) => next.delete(id));
    else pageIds.forEach((id) => next.add(id));
    setSelected(next);
  }

  async function approveSelected() {
    setApproving(true);
    setError(null);
    const ids = Array.from(selected);
    try {
      const results = await Promise.allSettled(ids.map((id) => api.patch(`/outreach/${id}/approve`)));
      const failedCount = results.filter((r) => r.status === "rejected").length;
      const succeededCount = results.length - failedCount;
      setSelected(new Set());
      if (selectedId) await load(selectedId);
      if (failedCount > 0) {
        setError(`${failedCount} email${failedCount !== 1 ? "s" : ""} failed to approve.`);
      }
      if (succeededCount > 0) {
        showSuccess(`${succeededCount} email${succeededCount !== 1 ? "s" : ""} approved`);
      }
    } catch {
      setError("Failed to approve emails.");
    } finally {
      setApproving(false);
    }
  }

  async function handleApprove(id: number) {
    setActionLoading("approve");
    try {
      await api.patch(`/outreach/${id}/approve`);
      setOpen(null);
      setStatusFilter("pending");
      if (selectedId) await load(selectedId, "pending");
      showSuccess("Email approved — click Send All Approved to send it");
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

  const pagedEmails = useMemo(
    () => emails.slice((listPage - 1) * LIST_PAGE_SIZE, listPage * LIST_PAGE_SIZE),
    [emails, listPage]
  );

  const pendingCount = emails.filter((e) => e.status === "pending").length;
  const approvedCount = stats?.approved_outreach ?? 0;

  function ListEmpty() {
    if (!selectedCampaign) {
      return (
        <div className="flex flex-col items-center justify-center h-full py-20 text-gray-400 text-center px-4">
          <Mail className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm font-medium">Select a campaign above</p>
        </div>
      );
    }
    if (selectedCampaign.status === "idle" && (!stats || stats.leads === 0)) {
      return (
        <div className="flex flex-col items-center justify-center h-full py-20 text-center px-6">
          <Play className="h-10 w-10 mb-3 text-gray-300" />
          <p className="text-sm font-semibold text-gray-700">Campaign hasn&apos;t run yet</p>
          <p className="text-xs mt-1 text-gray-400 max-w-xs">
            Go to <span className="text-indigo-600 font-medium">Campaigns</span> and click{" "}
            <span className="font-medium">Run Pipeline</span>.
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
    if (stats && stats.leads === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full py-20 text-center px-6">
          <Zap className="h-10 w-10 mb-3 text-amber-300" />
          <p className="text-sm font-semibold text-gray-700">
            {stats.sources === 0 ? "No blogs were found" : "No emails were scraped from blogs"}
          </p>
          <p className="text-xs mt-1 text-gray-400 max-w-xs">
            {stats.sources === 0
              ? "No results found. Try a different niche."
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
    if (stats && stats.sent_outreach > 0 && stats.pending_outreach === 0 && stats.approved_outreach === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full py-20 text-center px-6">
          <PartyPopper className="h-10 w-10 mb-3 text-green-500" />
          <p className="text-sm font-semibold text-gray-700">All caught up!</p>
          <p className="text-xs mt-1 text-gray-400 max-w-xs">
            {stats.sent_outreach} email{stats.sent_outreach !== 1 ? "s" : ""} sent.
            Run the pipeline again to find more leads.
          </p>
        </div>
      );
    }
    if (stats && stats.leads > 0) {
      // Leads exist but no outreach written — offer one-click generate + send
      return (
        <div className="flex flex-col items-center justify-center h-full py-16 text-center px-6 gap-4">
          <div className="h-14 w-14 rounded-full bg-indigo-50 flex items-center justify-center">
            <Sparkles className="h-7 w-7 text-indigo-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">
              {stats.leads} lead{stats.leads !== 1 ? "s" : ""} ready — no outreach written yet
            </p>
            <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">
              Write emails for all leads and send them automatically, or generate drafts first to review.
            </p>
          </div>
          <div className="flex flex-col gap-2 w-full max-w-[200px]">
            <Button onClick={handleGenerateAndSend} loading={generating} className="w-full">
              <Send className="h-3.5 w-3.5 mr-1.5" /> Generate &amp; Send All
            </Button>
            <Button size="sm" variant="outline" onClick={handleGenerate} loading={generating} className="w-full">
              <Sparkles className="h-3.5 w-3.5 mr-1" /> Generate Drafts Only
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center h-full py-20 text-center px-6">
        <Sparkles className="h-10 w-10 mb-3 text-indigo-300" />
        <p className="text-sm font-semibold text-gray-700">No drafts yet</p>
        <p className="text-xs mt-1 text-gray-400 max-w-xs mb-4">
          Run Generate Drafts to create outreach emails for this campaign.
        </p>
        <Button size="sm" onClick={handleGenerate} loading={generating}>
          <Sparkles className="h-3.5 w-3.5 mr-1" /> Generate Drafts
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Outreach</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Review and approve draft emails before sending.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selectedCampaign && (
            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${
              selectedCampaign.status === "completed"    ? "bg-green-100 text-green-700" :
              selectedCampaign.status === "running"      ? "bg-indigo-100 text-indigo-700" :
              selectedCampaign.status === "quota_paused" ? "bg-amber-100 text-amber-700" :
              selectedCampaign.status === "error"        ? "bg-red-100 text-red-600" :
                                                           "bg-gray-100 text-gray-500"
            }`}>
              {selectedCampaign.status === "running"      && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
              {selectedCampaign.status === "completed"    && <CheckCircle className="h-2.5 w-2.5" />}
              {selectedCampaign.status === "error"        && <AlertCircle className="h-2.5 w-2.5" />}
              {selectedCampaign.status === "idle"         && <Clock className="h-2.5 w-2.5" />}
              {selectedCampaign.status === "quota_paused" && <Clock className="h-2.5 w-2.5" />}
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
            title="Generate draft emails for leads that don't have one yet"
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

      {/* Sticky action bar — shown when there are pending or approved emails */}
      {selectedId && (pendingCount > 0 || approvedCount > 0) && (
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-2.5 shadow-sm flex-wrap">
          <span className="text-sm text-indigo-800">
            {pendingCount > 0 && (
              <span><strong>{pendingCount}</strong> pending</span>
            )}
            {pendingCount > 0 && approvedCount > 0 && <span className="mx-2 text-indigo-300">·</span>}
            {approvedCount > 0 && (
              <span><strong>{approvedCount}</strong> approved &amp; ready to send</span>
            )}
          </span>

          <div className="flex items-center gap-2">
            {pendingCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleApproveAll}
                loading={approvingAll}
                disabled={approvingAll}
                className="border-indigo-300 text-indigo-700 hover:bg-indigo-100"
              >
                <CheckCheck className="h-3.5 w-3.5 mr-1" /> Approve All
              </Button>
            )}
            {approvedCount > 0 && (
              <>
                {sendingAll && sendProgress ? (
                  <span className="text-sm text-indigo-700 font-medium">
                    Sending… {sendProgress.sent}/{sendProgress.total}
                    {sendProgress.failed > 0 && (
                      <span className="text-red-600 ml-1">({sendProgress.failed} failed)</span>
                    )}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => setShowSendConfirm(true)}
                    disabled={sendingAll}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white"
                  >
                    <Send className="h-3.5 w-3.5 mr-1" /> Send All Approved
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Send confirmation dialog */}
      {showSendConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-base font-semibold text-gray-900 mb-2">Send {approvedCount} approved emails?</h3>
            <p className="text-sm text-gray-500 mb-5">
              This will send all approved emails with a 2-second delay between each. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <Button variant="ghost" onClick={() => setShowSendConfirm(false)}>Cancel</Button>
              <Button onClick={handleSendAll}>
                <Send className="h-4 w-4 mr-1" /> Send Now
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Stats strip */}
      {stats && (emails.length > 0 || stats.approved_outreach > 0) && (
        <div className="flex items-center gap-4 text-sm text-gray-500 px-1">
          {emails.length > 0 && <span><span className="font-semibold text-gray-900">{emails.length}</span> shown</span>}
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
      <div className="flex h-[calc(100vh-280px)] bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">

        {/* LEFT: list */}
        <div className={`flex flex-col border-r border-gray-200 transition-all duration-200 ${open ? "w-80 shrink-0" : "flex-1"}`}>

          {/* Toolbar */}
          <div className="flex flex-col border-b border-gray-100">
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
            <div className="flex items-center gap-2 px-4 py-2">
              <input
                type="checkbox"
                checked={pagedEmails.length > 0 && pagedEmails.every((e) => selected.has(e.id))}
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
          <div className="flex-1 overflow-y-auto flex flex-col">
            <div className="flex-1">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-400">
                <Loader2 className="h-7 w-7 animate-spin text-indigo-400" />
                <p className="text-xs">Loading emails…</p>
              </div>
            ) : emails.length === 0 ? (
              <ListEmpty />
            ) : (
              pagedEmails.map((email) => (
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
            {emails.length > LIST_PAGE_SIZE && (
              <div className="px-3 py-2 border-t border-gray-100 shrink-0">
                <Pagination page={listPage} pageSize={LIST_PAGE_SIZE} total={emails.length} onChange={setListPage} />
              </div>
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
