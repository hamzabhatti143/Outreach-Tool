"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Trash2, Play, Loader2 } from "lucide-react";
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

export default function CampaignsPage() {
  const { campaigns, loading, refresh } = useCampaigns();
  const [name, setName] = useState("");
  const [niche, setNiche] = useState("");
  const [creating, setCreating] = useState(false);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    try {
      await api.post(`/campaigns/${id}/run`);
      await refresh();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || "Failed to start pipeline.");
    } finally {
      setRunningId(null);
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
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Campaigns</h1>
        <p className="text-gray-500 mt-1">Create and manage your outreach campaigns.</p>
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
          {campaigns.map((c, i) => (
            <motion.div key={c.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Card>
                <CardContent className="flex items-center justify-between p-5">
                  <div>
                    <p className="font-semibold text-gray-900">{c.name}</p>
                    <p className="text-sm text-gray-500">Niche: {c.niche}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Created {new Date(c.created_at).toLocaleDateString()}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={statusVariant[c.status] || "secondary"}>{c.status}</Badge>
                    <Button size="sm" variant="outline" onClick={() => handleRun(c.id)} loading={runningId === c.id} disabled={c.status === "running"}>
                      <Play className="h-3 w-3" /> Run Pipeline
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(c.id)}>
                      <Trash2 className="h-3 w-3 text-red-500" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
