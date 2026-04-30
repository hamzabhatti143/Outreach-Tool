"use client";

import {
  useEffect, useState, useCallback, useRef,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2, RefreshCw, ChevronLeft, Send,
  Check, CheckCheck, AlertCircle, ArrowUpDown, InboxIcon,
  ChevronDown, ChevronUp, ExternalLink, Mail, MailOpen,
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
  outreach_body: string | null;
  lead_email: string | null;
  blog_name: string | null;
  blog_url: string | null;
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

// Collapsible email bubble used for original email + their reply
function EmailBubble({
  label,
  from,
  date,
  subject,
  body,
  defaultOpen = false,
  accent = "gray",
}: {
  label: string;
  from: string;
  date?: string;
  subject?: string | null;
  body: string;
  defaultOpen?: boolean;
  accent?: "gray" | "indigo";
}) {
  const [open, setOpen] = useState(defaultOpen);
  const borderColor = accent === "indigo" ? "border-indigo-200" : "border-gray-200";
  const labelColor = accent === "indigo" ? "text-indigo-600" : "text-gray-500";

  return (
    <div className={`rounded-lg border ${borderColor} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          {open ? (
            <MailOpen className={`h-4 w-4 shrink-0 ${labelColor}`} />
          ) : (
            <Mail className={`h-4 w-4 shrink-0 ${labelColor}`} />
          )}
          <div className="min-w-0">
            <span className={`text-xs font-semibold uppercase tracking-wide ${labelColor}`}>{label}</span>
            {!open && (
              <p className="text-xs text-gray-500 truncate mt-0.5">
                {from}{subject ? ` · ${subject}` : ""}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {date && <span className="text-xs text-gray-400">{date}</span>}
          {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </div>
      </button>

      {open && (
        <div className="px-4 py-4 space-y-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
            <span>From: <span className="font-medium text-gray-700">{from}</span></span>
            {subject && <span>Subject: <span className="font-medium text-gray-700">{subject}</span></span>}
          </div>
          <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 leading-relaxed mt-2">
            {body}
          </pre>
        </div>
      )}
    </div>
  );
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

  // AI reply draft state
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [savedIndicator, setSavedIndicator] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Action states
  const [isApproving, setIsApproving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pollToast, setPollToast] = useState<{ msg: string; ok: boolean } | null>(null);

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
      setOpen((prev) => (prev ? (data.find((r) => r.id === prev.id) ?? null) : null));
    } catch {
      setError("Failed to load replies. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  function showPollToast(msg: string, ok: boolean) {
    setPollToast({ msg, ok });
    setTimeout(() => setPollToast(null), 4000);
  }

  // Auto-poll inbox + load replies on mount
  useEffect(() => {
    const init = async () => {
      try {
        await api.post("/replies/poll");
      } catch {
        // Silently skip if Gmail not connected yet
      }
      await load();
    };
    init();
  }, [load]);

  // Sync draft when open reply changes
  useEffect(() => {
    if (!open) return;
    const ai = open.ai_response;
    setDraftSubject(ai?.user_edited_subject ?? ai?.suggested_subject ?? "");
    setDraftBody(ai?.user_edited_body ?? ai?.suggested_body ?? "");
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, [open?.id, open?.ai_response?.id]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  function openReply(reply: ReplyItem) {
    setOpen(reply);
    setActionError(null);
    const ai = reply.ai_response;
    setDraftSubject(ai?.user_edited_subject ?? ai?.suggested_subject ?? "");
    setDraftBody(ai?.user_edited_body ?? ai?.suggested_body ?? "");
  }

  function scheduleAutoSave(subject: string, body: string) {
    if (!open) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api.patch(`/replies/${open.id}/response`, {
          user_edited_subject: subject,
          user_edited_body: body,
        });
        setSavedIndicator(true);
        setTimeout(() => setSavedIndicator(false), 2000);
      } catch { /* silent */ }
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

  async function handleApprove() {
    if (!open) return;
    setIsApproving(true);
    setActionError(null);
    try {
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
      // Always save draft first — upserts the reply record if it doesn't exist yet
      await api.patch(`/replies/${open.id}/response`, {
        user_edited_subject: draftSubject,
        user_edited_body: draftBody,
      });
      await api.post(`/replies/${open.id}/response/approve`);
      await load();
    } catch {
      setActionError("Failed to approve.");
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
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setActionError(msg || "Failed to send reply.");
    } finally {
      setIsSending(false);
    }
  }

  async function handlePollInbox() {
    setIsPolling(true);
    try {
      const { data } = await api.post<{ new: number; errors: string[] }>("/replies/poll");
      await load();
      if (data.errors?.length) {
        showPollToast(`Poll error: ${data.errors[0]}`, false);
      } else if (data.new === 0) {
        showPollToast("Inbox checked — no new replies found.", true);
      } else {
        showPollToast(`Found ${data.new} new repl${data.new === 1 ? "y" : "ies"}!`, true);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      showPollToast(msg || "Failed to check inbox.", false);
    } finally {
      setIsPolling(false);
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = replies
    .filter((r) => sentimentFilter === "all" || r.sentiment === sentimentFilter)
    .sort((a, b) => {
      const ra = PRIORITY_RANK[a.priority ?? ""] ?? 0;
      const rb = PRIORITY_RANK[b.priority ?? ""] ?? 0;
      return sortOrder === "high-to-low" ? rb - ra : ra - rb;
    });

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading && replies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p className="text-sm text-gray-500">Checking inbox for replies…</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Poll result toast */}
      <AnimatePresence>
        {pollToast && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${
              pollToast.ok
                ? "bg-green-50 border-green-200 text-green-800"
                : "bg-red-50 border-red-200 text-red-700"
            }`}
          >
            {pollToast.ok
              ? <CheckCheck className="h-4 w-4 shrink-0" />
              : <AlertCircle className="h-4 w-4 shrink-0" />}
            {pollToast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1">
          {(["all", "positive", "neutral", "negative"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setSentimentFilter(tab)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors capitalize ${
                sentimentFilter === tab ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
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
            {sortOrder === "high-to-low" ? "High → Low" : "Low → High"}
          </button>
          <Button size="sm" variant="outline" onClick={handlePollInbox} loading={isPolling}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            {isPolling ? "Checking…" : "Check Inbox"}
          </Button>
        </div>
      </div>

      {/* Main split panel */}
      <div className="flex h-[calc(100vh-210px)] bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">

        {/* ── LEFT: reply list ── */}
        <div className={`flex flex-col border-r border-gray-200 transition-all duration-200 ${open ? "w-80 shrink-0" : "flex-1"}`}>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
            <span className="flex-1">{filtered.length} repl{filtered.length !== 1 ? "ies" : "y"}</span>
            <button onClick={load} className="text-gray-400 hover:text-gray-700 transition-colors">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 py-16">
                <InboxIcon className="h-10 w-10 mb-3 opacity-30" />
                <p className="font-medium text-sm">No replies yet</p>
                <p className="text-xs mt-1 text-center px-4">Click "Check Inbox" above to poll your Gmail for new replies</p>
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
                    <p className="text-xs text-gray-500 truncate">{reply.blog_name || reply.from_email}</p>
                    <p className="text-xs text-gray-600 truncate mt-0.5">{reply.subject || "(no subject)"}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <SentimentBadge sentiment={reply.sentiment} />
                      {reply.ai_response?.is_sent && (
                        <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-medium">Replied</span>
                      )}
                      {reply.ai_response?.is_approved && !reply.ai_response.is_sent && (
                        <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">Approved</span>
                      )}
                      {!reply.ai_response && (
                        <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">Needs reply</span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── RIGHT: thread + AI editor ── */}
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
              <div className="flex items-start gap-3 px-6 py-4 border-b border-gray-100 bg-white shrink-0">
                <button
                  onClick={() => setOpen(null)}
                  className="text-gray-400 hover:text-gray-700 transition-colors lg:hidden mt-0.5"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base font-semibold text-gray-900 truncate">
                      {open.from_name || open.from_email}
                    </h2>
                    <SentimentBadge sentiment={open.sentiment} />
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap text-xs text-gray-400">
                    <span>{open.from_email}</span>
                    {open.blog_name && (
                      <span className="flex items-center gap-1">
                        ·
                        {open.blog_url ? (
                          <a href={open.blog_url} target="_blank" rel="noopener noreferrer"
                            className="text-indigo-500 hover:underline flex items-center gap-0.5">
                            {open.blog_name} <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        ) : open.blog_name}
                      </span>
                    )}
                    <span>· {new Date(open.received_at).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Scrollable thread */}
              <div className="flex-1 overflow-y-auto">
                <div className="px-6 py-5 space-y-4">

                  {/* 1. Original outreach email (collapsible) */}
                  <EmailBubble
                    label="Your Outreach Email"
                    from={`you → ${open.lead_email || open.from_email}`}
                    subject={open.outreach_subject}
                    body={open.outreach_body || "(email body not available)"}
                    defaultOpen={false}
                    accent="indigo"
                  />

                  {/* 2. Their reply (open by default) */}
                  <EmailBubble
                    label="Their Reply"
                    from={open.from_name ? `${open.from_name} <${open.from_email}>` : open.from_email}
                    date={timeAgo(open.received_at)}
                    subject={open.subject}
                    body={open.body}
                    defaultOpen={true}
                    accent="gray"
                  />

                  {/* 3. Reply Editor */}
                  <div className="rounded-lg border border-blue-200 bg-blue-50/30 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-blue-100 bg-blue-50">
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-blue-600" />
                        <span className="text-xs font-semibold text-blue-800 uppercase tracking-wide">
                          Your Reply
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

                      {actionError && (
                        <span className="text-xs text-red-600 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" /> {actionError}
                        </span>
                      )}
                    </div>

                    <div className="px-4 py-4">

                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-gray-600">Subject</label>
                          <Input
                            value={draftSubject}
                            onChange={(e) => handleSubjectChange(e.target.value)}
                            disabled={open.ai_response?.is_sent ?? false}
                            placeholder="Re: ..."
                            className="ring-2 ring-blue-400 focus:ring-blue-500 disabled:opacity-60"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-gray-600">Body — write your reply</label>
                          <Textarea
                            ref={bodyRef}
                            value={draftBody}
                            onChange={(e) => handleBodyChange(e.target.value)}
                            rows={8}
                            disabled={open.ai_response?.is_sent ?? false}
                            placeholder="Type your reply here…"
                            className="ring-2 ring-blue-400 focus:ring-blue-500 resize-none overflow-hidden disabled:opacity-60"
                          />
                        </div>

                        <div className="flex items-center gap-2 pt-1 flex-wrap">
                          {!(open.ai_response?.is_sent) && (
                            <Button
                              size="sm"
                              variant={open.ai_response?.is_approved ? "secondary" : "default"}
                              onClick={handleApprove}
                              loading={isApproving}
                              disabled={!draftBody.trim()}
                            >
                              <CheckCheck className="h-3 w-3 mr-1" />
                              {open.ai_response?.is_approved ? "Approved" : "Approve"}
                            </Button>
                          )}

                          <Button
                            size="sm"
                            onClick={handleSend}
                            loading={isSending}
                            disabled={!(open.ai_response?.is_approved) || (open.ai_response?.is_sent ?? false)}
                            className={open.ai_response?.is_sent ? "opacity-60" : ""}
                          >
                            <Send className="h-3 w-3 mr-1" />
                            {open.ai_response?.is_sent ? "Sent" : "Send Reply"}
                          </Button>
                        </div>

                        {open.ai_response?.is_sent && (
                          <p className="text-xs text-indigo-600 font-medium flex items-center gap-1">
                            <CheckCheck className="h-3.5 w-3.5" /> Reply sent via Gmail
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
