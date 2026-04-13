"use client";

import {
  useEffect, useState, useCallback, useRef,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2, RefreshCw, ChevronLeft, Sparkles, Send,
  Check, CheckCheck, AlertCircle, ArrowUpDown, InboxIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import api from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AIResponseData {
  id: number;
  suggested_subject: string | null;
  suggested_body: string | null;
  user_edited_subject: string | null;
  user_edited_body: string | null;
  is_approved: boolean;
  is_sent: boolean;
}

interface ReplyItem {
  id: number;
  outreach_email_id: number;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  body: string;
  received_at: string;
  sentiment: string | null;
  sentiment_score: number | null;
  priority: string | null;
  outreach_subject: string | null;
  blog_name: string | null;
  ai_response: AIResponseData | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

const PRIORITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

function SentimentBadge({ sentiment }: { sentiment: string | null }) {
  if (sentiment === "positive") return <Badge variant="success">Positive</Badge>;
  if (sentiment === "negative") return <Badge variant="destructive">Negative</Badge>;
  if (sentiment === "neutral") return <Badge variant="warning">Neutral</Badge>;
  return null;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RepliesPage() {
  const [replies, setReplies] = useState<ReplyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ReplyItem | null>(null);

  // Filters
  const [sentimentFilter, setSentimentFilter] = useState<"all" | "positive" | "neutral" | "negative">("all");
  const [sortOrder, setSortOrder] = useState<"high-to-low" | "low-to-high">("high-to-low");

  // AI response edit state
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [savedIndicator, setSavedIndicator] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Action states
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Regen confirmation
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);

  // Textarea auto-resize
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.style.height = "auto";
      bodyRef.current.style.height = `${bodyRef.current.scrollHeight}px`;
    }
  }, [draftBody]);

  // ── Data loading ────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<ReplyItem[]>("/replies");
      setReplies(data);
      // Refresh the open reply from fresh data
      setOpen((prev) => (prev ? (data.find((r) => r.id === prev.id) ?? null) : null));
    } catch {
      setError("Failed to load replies. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Sync draft fields whenever the open reply changes (e.g. after load/generate)
  useEffect(() => {
    if (!open) return;
    const ai = open.ai_response;
    setDraftSubject(ai?.user_edited_subject ?? ai?.suggested_subject ?? "");
    setDraftBody(ai?.user_edited_body ?? ai?.suggested_body ?? "");
    // Cancel any pending auto-save from the previous open item
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, [open?.id, open?.ai_response?.id]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  function openReply(reply: ReplyItem) {
    setOpen(reply);
    setActionError(null);
    setShowRegenConfirm(false);
    const ai = reply.ai_response;
    setDraftSubject(ai?.user_edited_subject ?? ai?.suggested_subject ?? "");
    setDraftBody(ai?.user_edited_body ?? ai?.suggested_body ?? "");
  }

  // Schedule auto-save 800ms after user stops typing
  function scheduleAutoSave(subject: string, body: string) {
    if (!open?.ai_response) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api.patch(`/replies/${open.id}/response`, {
          user_edited_subject: subject,
          user_edited_body: body,
        });
        setSavedIndicator(true);
        setTimeout(() => setSavedIndicator(false), 2000);
      } catch {
        // Silent — user will see the error if they try to send
      }
    }, 800);
  }

  function handleSubjectChange(val: string) {
    setDraftSubject(val);
    scheduleAutoSave(val, draftBody);
  }

  function handleBodyChange(val: string) {
    setDraftBody(val);
    scheduleAutoSave(draftSubject, val);
  }

  async function handleGenerate(confirmed = false) {
    if (!open) return;
    // If there's existing AI content and user hasn't confirmed regen, show dialog
    if (!confirmed && open.ai_response) {
      setShowRegenConfirm(true);
      return;
    }
    setShowRegenConfirm(false);
    setIsGenerating(true);
    setActionError(null);
    try {
      await api.post(`/replies/${open.id}/generate-response`);
      await load();
    } catch {
      setActionError("Failed to generate response. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleApprove() {
    if (!open) return;
    setIsApproving(true);
    setActionError(null);
    try {
      // Flush any pending auto-save before approving
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (open.ai_response) {
        await api.patch(`/replies/${open.id}/response`, {
          user_edited_subject: draftSubject,
          user_edited_body: draftBody,
        });
      }
      await api.post(`/replies/${open.id}/response/approve`);
      await load();
    } catch {
      setActionError("Failed to approve. Please try again.");
    } finally {
      setIsApproving(false);
    }
  }

  async function handleSend() {
    if (!open) return;
    setIsSending(true);
    setActionError(null);
    try {
      await api.post(`/replies/${open.id}/response/send`);
      await load();
    } catch {
      setActionError("Failed to send reply. Please try again.");
    } finally {
      setIsSending(false);
    }
  }

  async function handlePollInbox() {
    setIsPolling(true);
    try {
      await api.post("/replies/poll");
      setTimeout(() => { load(); setIsPolling(false); }, 3000);
    } catch {
      setIsPolling(false);
    }
  }

  // ── Derived data ──────────────────────────────────────────────────────────

  const filtered = replies
    .filter((r) => sentimentFilter === "all" || r.sentiment === sentimentFilter)
    .sort((a, b) => {
      const ra = PRIORITY_RANK[a.priority ?? ""] ?? 0;
      const rb = PRIORITY_RANK[b.priority ?? ""] ?? 0;
      return sortOrder === "high-to-low" ? rb - ra : ra - rb;
    });

  const isEdited =
    open?.ai_response != null &&
    (draftSubject !== (open.ai_response.suggested_subject ?? "") ||
      draftBody !== (open.ai_response.suggested_body ?? ""));

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading && replies.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Top bar: sentiment filter tabs + sort toggle */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1">
          {(["all", "positive", "neutral", "negative"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setSentimentFilter(tab)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors capitalize ${
                sentimentFilter === tab
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setSortOrder((s) => s === "high-to-low" ? "low-to-high" : "high-to-low")}
            className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <ArrowUpDown className="h-3 w-3" />
            {sortOrder === "high-to-low" ? "Priority: High → Low" : "Priority: Low → High"}
          </button>
          <Button
            size="sm"
            variant="outline"
            onClick={handlePollInbox}
            loading={isPolling}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Poll Inbox
          </Button>
        </div>
      </div>

      {/* Main panel */}
      <div className="flex h-[calc(100vh-210px)] bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">

        {/* ── LEFT: reply list ── */}
        <div className={`flex flex-col border-r border-gray-200 transition-all duration-200 ${open ? "w-80 shrink-0" : "flex-1"}`}>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50">
            <span className="text-sm text-gray-500 flex-1">
              {filtered.length} {sentimentFilter !== "all" ? sentimentFilter : ""} repl{filtered.length !== 1 ? "ies" : "y"}
            </span>
            <button onClick={load} className="text-gray-400 hover:text-gray-700 transition-colors">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 py-16">
                <InboxIcon className="h-10 w-10 mb-3 opacity-30" />
                <p className="font-medium text-sm">No replies yet</p>
                <p className="text-xs mt-1">Poll the inbox to check for new replies</p>
              </div>
            ) : (
              filtered.map((reply) => (
                <div
                  key={reply.id}
                  onClick={() => openReply(reply)}
                  className={`flex items-start gap-3 px-4 py-3 border-b border-gray-100 cursor-pointer transition-colors hover:bg-indigo-50 ${
                    open?.id === reply.id ? "bg-indigo-50 border-l-2 border-l-indigo-500" : ""
                  }`}
                >
                  {/* Priority dot */}
                  <div className="mt-1.5 shrink-0">
                    <span className={`block h-2 w-2 rounded-full ${
                      reply.priority === "high" ? "bg-green-500" :
                      reply.priority === "low" ? "bg-red-400" : "bg-yellow-400"
                    }`} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {reply.from_name || reply.from_email}
                      </p>
                      <span className="text-xs text-gray-400 shrink-0">{timeAgo(reply.received_at)}</span>
                    </div>
                    <p className="text-xs text-gray-600 truncate">{reply.subject || "(no subject)"}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <SentimentBadge sentiment={reply.sentiment} />
                      {reply.ai_response?.is_sent && (
                        <span className="text-[10px] text-indigo-600 font-medium">Replied</span>
                      )}
                      {reply.ai_response?.is_approved && !reply.ai_response.is_sent && (
                        <span className="text-[10px] text-green-600 font-medium">Approved</span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── RIGHT: thread + AI response editor ── */}
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
                <button
                  onClick={() => setOpen(null)}
                  className="text-gray-400 hover:text-gray-700 transition-colors lg:hidden"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-semibold text-gray-900 truncate">
                    {open.subject || "(no subject)"}
                  </h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    From: <span className="font-medium text-gray-600">{open.from_name || open.from_email}</span>
                    {open.from_name && <span className="ml-1 text-gray-400">&lt;{open.from_email}&gt;</span>}
                  </p>
                </div>
                <SentimentBadge sentiment={open.sentiment} />
              </div>

              {/* Scrollable body */}
              <div className="flex-1 overflow-y-auto">

                {/* §1 — Original outreach email */}
                <div className="px-6 pt-5 pb-4 border-b border-gray-100">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                    Original Email Sent
                  </p>
                  <p className="text-xs text-gray-500 mb-1">
                    Subject: <span className="font-medium text-gray-700">{open.outreach_subject || "—"}</span>
                  </p>
                  {open.blog_name && (
                    <p className="text-xs text-gray-400">Blog: {open.blog_name}</p>
                  )}
                </div>

                {/* §2 — Their reply */}
                <div className="px-6 pt-5 pb-4 border-b border-gray-100">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                    Their Reply
                  </p>
                  <p className="text-xs text-gray-500 mb-3">
                    {new Date(open.received_at).toLocaleString()}
                  </p>
                  <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 leading-relaxed">
                    {open.body}
                  </pre>
                </div>

                {/* §3 — AI Suggested Response */}
                <div className="px-6 pt-5 pb-6">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      AI Suggested Response
                    </p>

                    {/* Action error */}
                    {actionError && (
                      <span className="text-xs text-red-600 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" /> {actionError}
                      </span>
                    )}
                  </div>

                  {/* Regenerate confirmation dialog */}
                  {showRegenConfirm && (
                    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
                      <p className="font-medium text-amber-800 mb-2">
                        Regenerate will overwrite your current edits. Continue?
                      </p>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleGenerate(true)} loading={isGenerating}>
                          Yes, regenerate
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowRegenConfirm(false)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  {open.ai_response === null ? (
                    /* No AI response yet — show generate button */
                    <div className="flex flex-col items-center gap-3 py-8 text-center">
                      <Sparkles className="h-8 w-8 text-indigo-400 opacity-60" />
                      <p className="text-sm text-gray-500">No AI response generated yet.</p>
                      <Button onClick={() => handleGenerate(false)} loading={isGenerating}>
                        <Sparkles className="h-4 w-4" /> Generate AI Response
                      </Button>
                    </div>
                  ) : (
                    /* Editable AI response form */
                    <div className="space-y-3">
                      {/* Subject */}
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">Subject</label>
                        <Input
                          value={draftSubject}
                          onChange={(e) => handleSubjectChange(e.target.value)}
                          className="ring-2 ring-blue-500 focus:ring-blue-500"
                        />
                      </div>

                      {/* Body */}
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">Body</label>
                        <Textarea
                          ref={bodyRef}
                          value={draftBody}
                          onChange={(e) => handleBodyChange(e.target.value)}
                          rows={8}
                          className="ring-2 ring-blue-500 focus:ring-blue-500 resize-none overflow-hidden"
                        />
                      </div>

                      {/* Draft label + saved indicator */}
                      <div className="flex items-center gap-3">
                        <span className={`text-xs font-medium ${isEdited ? "text-amber-600" : "text-gray-400"}`}>
                          {isEdited ? "Edited" : "AI draft"}
                        </span>
                        <AnimatePresence>
                          {savedIndicator && (
                            <motion.span
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              className="flex items-center gap-1 text-xs text-green-600 font-medium"
                            >
                              <Check className="h-3 w-3" /> Saved
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 pt-2 flex-wrap">
                        {!showRegenConfirm && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleGenerate(false)}
                            loading={isGenerating}
                          >
                            <Sparkles className="h-3 w-3" /> Regenerate
                          </Button>
                        )}

                        <Button
                          size="sm"
                          variant={open.ai_response.is_approved ? "secondary" : "default"}
                          onClick={handleApprove}
                          loading={isApproving}
                          disabled={open.ai_response.is_sent}
                        >
                          <CheckCheck className="h-3 w-3" />
                          {open.ai_response.is_approved ? "Approved" : "Approve"}
                        </Button>

                        <Button
                          size="sm"
                          onClick={handleSend}
                          loading={isSending}
                          disabled={!open.ai_response.is_approved || open.ai_response.is_sent}
                        >
                          <Send className="h-3 w-3" />
                          {open.ai_response.is_sent ? "Sent" : "Send Reply"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
