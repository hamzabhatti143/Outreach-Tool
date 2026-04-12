"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Rocket } from "lucide-react";
import api from "@/lib/api";

interface CampaignLauncherProps {
  onLaunched?: () => void;
}

export default function CampaignLauncher({ onLaunched }: CampaignLauncherProps) {
  const [niche, setNiche] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleLaunch() {
    if (!niche.trim() || !name.trim()) {
      setError("Please fill in both campaign name and niche.");
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const { data: campaign } = await api.post("/campaigns", { niche, name });
      await api.post(`/campaigns/${campaign.id}/run`);
      setMessage(`Campaign "${name}" launched! Pipeline running in background.`);
      setNiche("");
      setName("");
      onLaunched?.();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Failed to launch campaign.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          placeholder="Campaign name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="max-w-[180px]"
        />
        <Input
          placeholder="Niche (e.g. SaaS, fitness, finance)"
          value={niche}
          onChange={(e) => setNiche(e.target.value)}
        />
        <Button onClick={handleLaunch} loading={loading} className="shrink-0">
          <Rocket className="h-4 w-4" />
          Launch
        </Button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-green-600">{message}</p>}
    </div>
  );
}
