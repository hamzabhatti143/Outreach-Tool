"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X, AlertCircle, FileText, PenLine, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import api from "@/lib/api";

interface TemplateData {
  type: "default" | "custom";
  subject: string;
  body: string;
  default_subject: string;
  default_body: string;
}

export default function TemplatesPage() {
  const [data, setData] = useState<TemplateData | null>(null);
  const [mode, setMode] = useState<"default" | "custom">("default");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: d } = await api.get<TemplateData>("/template");
        setData(d);
        setMode(d.type);
        setSubject(d.type === "custom" ? d.subject : d.default_subject);
        setBody(d.type === "custom" ? d.body : d.default_body);
      } catch {
        setError("Failed to load template.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function handleModeChange(next: "default" | "custom") {
    setMode(next);
    setError(null);
    setSuccess(null);
    if (next === "custom" && data) {
      // Pre-fill with the current active template so user has a starting point
      setSubject(data.type === "custom" ? data.subject : data.default_subject);
      setBody(data.type === "custom" ? data.body : data.default_body);
    }
  }

  async function handleSave() {
    if (!subject.trim() || !body.trim()) {
      setError("Subject and body cannot be empty.");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await api.post("/template", { subject: subject.trim(), body: body.trim() });
      setData((prev) => prev ? { ...prev, type: "custom", subject: subject.trim(), body: body.trim() } : prev);
      showSuccess("Template saved. New outreach drafts will use this template.");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Failed to save template.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setResetting(true);
    setError(null);
    setSuccess(null);
    try {
      await api.delete("/template");
      if (data) {
        setData({ ...data, type: "default", subject: data.default_subject, body: data.default_body });
        setSubject(data.default_subject);
        setBody(data.default_body);
      }
      setMode("default");
      showSuccess("Template reset to default.");
    } catch {
      setError("Failed to reset template.");
    } finally {
      setResetting(false);
    }
  }

  function showSuccess(msg: string) {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 4000);
  }

  const isCustomSaved = data?.type === "custom";

  return (
    <div className="max-w-2xl space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Email Template</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          Choose the outreach email template used when generating drafts.
        </p>
      </div>

      {/* Banners */}
      <AnimatePresence>
        {error && (
          <motion.div
            key="err"
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto"><X className="h-4 w-4" /></button>
          </motion.div>
        )}
        {success && (
          <motion.div
            key="ok"
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700"
          >
            <Check className="h-4 w-4 shrink-0" />
            {success}
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
          Loading…
        </div>
      ) : (
        <>
          {/* Mode selector */}
          <div className="flex gap-3">
            <button
              onClick={() => handleModeChange("default")}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl border-2 text-sm font-medium transition-all ${
                mode === "default"
                  ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
              }`}
            >
              <FileText className="h-4 w-4" />
              Default
              {!isCustomSaved && (
                <span className="ml-1 rounded-full bg-green-500 px-1.5 py-0.5 text-[10px] font-bold text-white leading-none">
                  Active
                </span>
              )}
            </button>

            <button
              onClick={() => handleModeChange("custom")}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl border-2 text-sm font-medium transition-all ${
                mode === "custom"
                  ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
              }`}
            >
              <PenLine className="h-4 w-4" />
              Write Your Own
              {isCustomSaved && (
                <span className="ml-1 rounded-full bg-green-500 px-1.5 py-0.5 text-[10px] font-bold text-white leading-none">
                  Active
                </span>
              )}
            </button>
          </div>

          {/* Content area */}
          <AnimatePresence mode="wait">
            {mode === "default" ? (
              <motion.div
                key="default"
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
                className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm"
              >
                <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Default Template</p>
                  {isCustomSaved && (
                    <span className="text-xs text-amber-600 font-medium">Custom template is currently active</span>
                  )}
                </div>
                <div className="px-5 py-4 space-y-4">
                  <div>
                    <p className="text-xs font-medium text-gray-400 mb-1">Subject</p>
                    <p className="text-sm font-semibold text-gray-800">{data?.default_subject}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-400 mb-1">Body</p>
                    <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 leading-relaxed">
                      {data?.default_body}
                    </pre>
                  </div>
                </div>
                {isCustomSaved && (
                  <div className="px-5 py-3 border-t border-gray-100 bg-gray-50">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleReset}
                      loading={resetting}
                      className="text-amber-700 border-amber-300 hover:bg-amber-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                      Switch back to Default
                    </Button>
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="custom"
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
                className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm"
              >
                <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Custom Template</p>
                </div>
                <div className="px-5 py-5 space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-600">Subject</label>
                    <Input
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="Enter email subject…"
                      className="text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-600">Body</label>
                    <Textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      placeholder="Enter email body…"
                      rows={14}
                      className="text-sm leading-relaxed resize-none"
                    />
                  </div>
                </div>
                <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center gap-2">
                  <Button onClick={handleSave} loading={saving}>
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                    Save Template
                  </Button>
                  {isCustomSaved && (
                    <Button
                      variant="outline"
                      onClick={handleReset}
                      loading={resetting}
                      className="text-gray-600"
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                      Reset to Default
                    </Button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Info note */}
          <p className="text-xs text-gray-400">
            Changes apply to new outreach drafts only — emails already generated are not affected.
          </p>
        </>
      )}
    </div>
  );
}
