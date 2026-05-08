"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Pagination } from "@/components/ui/pagination";
import { getCached, setCached } from "@/lib/cache";
import {
  Plus, Trash2, Play, Square, Loader2, Globe, Users,
  Mail, CheckCheck, ChevronDown, ChevronUp, AlertCircle, StopCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCampaigns } from "@/lib/campaign-context";
import api from "@/lib/api";

const statusVariant: Record<string, "success" | "default" | "warning" | "destructive" | "secondary"> = {
  completed: "success",
  running: "default",
  idle: "secondary",
  error: "destructive",
};

interface CampaignStats {
  sources: number;
  leads: number;
  pending_outreach: number;
  approved_outreach: number;
}

function PipelineBar({ stats, status }: { stats: CampaignStats | null; status: string }) {
  if (!stats) return null;

  const steps = [
    {
      label: "Blogs found",
      value: stats.sources,
      icon: Globe,
      color: "text-indigo-600 bg-indigo-50",
      warn: stats.sources === 0,
    },
    {
      label: "Emails scraped",
      value: stats.leads,
      icon: Users,
      color: "text-blue-600 bg-blue-50",
      warn: stats.sources > 0 && stats.leads === 0,
    },
    {
      label: "Drafts pending",
      value: stats.pending_outreach,
      icon: Mail,
      color: "text-amber-600 bg-amber-50",
      warn: stats.leads > 0 && stats.pending_outreach === 0 && stats.approved_outreach === 0,
    },
    {
      label: "Approved",
      value: stats.approved_outreach,
      icon: CheckCheck,
      color: "text-green-600 bg-green-50",
      warn: false,
    },
  ];

  const diagnosis = (() => {
    if (status === "running") return null;
    if (status === "error") return "Pipeline hit an error — check backend logs, then re-run.";
    if (stats.sources === 0) return "No blogs were found. Try a different niche.";
    if (stats.leads === 0) return "Blogs were found but no email addresses could be scraped. Many blogs hide emails behind contact forms — you may need to add leads manually.";
    if (stats.pending_outreach === 0 && stats.approved_outreach === 0 && stats.leads > 0)
      return `${stats.leads} lead${stats.leads !== 1 ? "s" : ""} found but no outreach written — go to Outreach and click Generate & Send All.`;
    if (stats.pending_outreach > 0) return `${stats.pending_outreach} draft${stats.pending_outreach !== 1 ? "s" : ""} ready to review in Outreach → approve them, then send via Bulk Send.`;
    return null;
  })();

  return (
    <div className="mt-4 space-y-3">
      <div className="grid grid-cols-4 gap-2">
        {steps.map(({ label, value, icon: Icon, color, warn }) => (
          <div
            key={label}
            className={`rounded-lg px-3 py-2.5 flex flex-col gap-1 border ${
              warn ? "border-red-200 bg-red-50" : "border-gray-100 bg-gray-50"
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span className={`flex h-5 w-5 items-center justify-center rounded ${warn ? "bg-red-100 text-red-500" : color}`}>
                <Icon className="h-3 w-3" />
              </span>
              <span className="text-xs text-gray-500">{label}</span>
            </div>
            <p className={`text-xl font-bold ${warn ? "text-red-500" : "text-gray-900"}`}>{value}</p>
          </div>
        ))}
      </div>

      {diagnosis && (
        <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${
          status === "error" || steps.some((s) => s.warn)
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-green-200 bg-green-50 text-green-800"
        }`}>
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          {diagnosis}
        </div>
      )}
    </div>
  );
}

export default function CampaignsPage() {
  const { campaigns, loading, refresh } = useCampaigns();
  const [name, setName] = useState("");
  const [niche, setNiche] = useState("");
  const [creating, setCreating] = useState(false);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [stoppingId, setStoppingId] = useState<number | null>(null);
  const [stoppingAll, setStoppingAll] = useState(false);
  const [stopRequestedIds, setStopRequestedIds] = useState<Set<number>>(new Set());
  const [statusOverrides, setStatusOverrides] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set());
  const [statsMap, setStatsMap] = useState<Record<number, CampaignStats>>(() => {
    // Pre-populate from cache so stats are visible instantly on page load
    const cached = getCached<Record<number, CampaignStats>>("campaign_stats_all");
    return cached ?? {};
  });
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;
  const [loadingStats, setLoadingStats] = useState<Record<number, boolean>>({});
  const loadedRef = useRef<Set<number>>(new Set());

  async function loadStats(id: number) {
    if (loadedRef.current.has(id)) return; // in-flight guard only
    loadedRef.current.add(id);
    // Show cached value immediately while the network request runs
    const cached = getCached<CampaignStats>(`cstats_${id}`);
    if (cached) setStatsMap((prev) => ({ ...prev, [id]: cached }));
    else setLoadingStats((prev) => ({ ...prev, [id]: true }));
    try {
      const { data } = await api.get<CampaignStats>(`/campaigns/${id}/stats`);
      setStatsMap((prev) => {
        const next = { ...prev, [id]: data };
        setCached("campaign_stats_all", next);
        return next;
      });
      setCached(`cstats_${id}`, data);
    } catch {
      // silent — will retry on next poll
    } finally {
      loadedRef.current.delete(id); // always release so future calls can fetch
      setLoadingStats((prev) => ({ ...prev, [id]: false }));
    }
  }

  function toggleCollapse(id: number) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Sync overrides and stop-set when real status arrives from server
  useEffect(() => {
    campaigns.forEach((c) => {
      // Clear override once the server confirms the status settled
      setStatusOverrides((prev) => {
        if (!(c.id in prev)) return prev;
        if (prev[c.id] === c.status) {
          const n = { ...prev }; delete n[c.id]; return n;
        }
        return prev;
      });
      if (c.status !== "running") {
        setStopRequestedIds((prev) => {
          if (!prev.has(c.id)) return prev;
          const next = new Set(prev); next.delete(c.id); return next;
        });
      }
    });
    // Batch-load stats for every campaign that doesn't have them yet
    campaigns.forEach((c) => { if (!statsMap[c.id]) loadStats(c.id); });
  }, [campaigns]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll stats + campaign list every 5s while any campaign is running
  useEffect(() => {
    const runningIds = campaigns
      .filter((c) => (statusOverrides[c.id] ?? c.status) === "running")
      .map((c) => c.id);
    if (runningIds.length === 0) return;
    const interval = setInterval(() => {
      refresh();
      runningIds.forEach((id) => loadStats(id));
    }, 5000);
    return () => clearInterval(interval);
  }, [campaigns, statusOverrides]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !niche.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await api.post("/campaigns", { name, niche });
      setName(""); setNiche("");
      await refresh();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to create.");
    } finally {
      setCreating(false);
    }
  }

  async function handleRun(id: number) {
    setRunningId(id);
    setStatusOverrides((prev) => ({ ...prev, [id]: "running" }));
    setError(null);
    loadedRef.current.delete(id);
    try {
      await api.post(`/campaigns/${id}/run`);
      await refresh();
      setTimeout(() => loadStats(id), 2000);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || "Failed to start pipeline.");
      setStatusOverrides((prev) => { const n = { ...prev }; delete n[id]; return n; });
    } finally {
      setRunningId(null);
    }
  }

  async function handleStop(id: number) {
    setStoppingId(id);
    setStopRequestedIds((prev) => new Set(prev).add(id));
    setStatusOverrides((prev) => ({ ...prev, [id]: "idle" }));
    setError(null);
    try {
      await api.post(`/campaigns/${id}/stop`);
      await refresh();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || "Failed to stop pipeline.");
      setStopRequestedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      setStatusOverrides((prev) => { const n = { ...prev }; delete n[id]; return n; });
    } finally {
      setStoppingId(null);
    }
  }

  async function handleStopAll() {
    setStoppingAll(true);
    setError(null);
    const overrides: Record<number, string> = {};
    campaigns.forEach((c) => { overrides[c.id] = "idle"; });
    setStatusOverrides((prev) => ({ ...prev, ...overrides }));
    setStopRequestedIds(new Set(campaigns.map((c) => c.id)));
    try {
      await api.post("/campaigns/stop-all");
      await refresh();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || "Failed to stop all campaigns.");
      setStatusOverrides((prev) => {
        const n = { ...prev };
        campaigns.forEach((c) => delete n[c.id]);
        return n;
      });
      setStopRequestedIds(new Set());
    } finally {
      setStoppingAll(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this campaign and all its data?")) return;
    await api.delete(`/campaigns/${id}`);
    await refresh();
  }

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-indigo-600" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Campaigns</h1>
          <p className="text-gray-500 mt-1">Create and manage your outreach campaigns.</p>
        </div>
        {campaigns.some((c) => (statusOverrides[c.id] ?? c.status) === "running") && (
          <Button
            variant="outline"
            onClick={handleStopAll}
            loading={stoppingAll}
            className="border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 shrink-0"
          >
            <StopCircle className="h-4 w-4" /> Stop All
          </Button>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">New Campaign</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="flex gap-3">
            <Input placeholder="Campaign name" value={name} onChange={(e) => setName(e.target.value)} className="max-w-[200px]" />
            <Input placeholder="Niche (e.g. SaaS, fitness)" value={niche} onChange={(e) => setNiche(e.target.value)} />
            <Button type="submit" loading={creating} className="shrink-0">
              <Plus className="h-4 w-4" /> Create
            </Button>
          </form>
          {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
        </CardContent>
      </Card>

      {campaigns.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg font-medium">No campaigns yet</p>
          <p className="text-sm mt-1">Create your first campaign above to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((c, i) => {
            const displayStatus = statusOverrides[c.id] ?? c.status;
            const isRunning = displayStatus === "running";
            return (
            <motion.div key={c.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-gray-900">{c.name}</p>
                      <p className="text-sm text-gray-500">Niche: {c.niche}</p>
                      <p className="text-xs text-gray-400 mt-0.5">Created {new Date(c.created_at).toLocaleDateString()}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={statusVariant[displayStatus] || "secondary"}>{displayStatus}</Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRun(c.id)}
                        loading={runningId === c.id}
                        disabled={isRunning || stoppingId === c.id}
                      >
                        <Play className="h-3 w-3" /> Run Pipeline
                      </Button>
                      {isRunning && !stopRequestedIds.has(c.id) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleStop(c.id)}
                          loading={stoppingId === c.id}
                          className="border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300"
                        >
                          <Square className="h-3 w-3" /> Stop
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleCollapse(c.id)}
                        title={collapsedIds.has(c.id) ? "Show pipeline stats" : "Hide pipeline stats"}
                      >
                        {collapsedIds.has(c.id)
                          ? <ChevronDown className="h-4 w-4 text-gray-500" />
                          : <ChevronUp className="h-4 w-4 text-gray-500" />}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(c.id)}>
                        <Trash2 className="h-3 w-3 text-red-500" />
                      </Button>
                    </div>
                  </div>

                  {/* Pipeline stats — always visible unless manually collapsed */}
                  {!collapsedIds.has(c.id) && (
                    <div className="mt-3 border-t border-gray-100 pt-3">
                      {loadingStats[c.id] && !statsMap[c.id] ? (
                        <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading pipeline stats…
                        </div>
                      ) : statsMap[c.id] ? (
                        <PipelineBar stats={statsMap[c.id]} status={displayStatus} />
                      ) : null}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
            );
          })}
          <Pagination page={page} pageSize={PAGE_SIZE} total={campaigns.length} onChange={setPage} />
        </div>
      )}
    </div>
  );
}
