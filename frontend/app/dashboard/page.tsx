"use client";

import { useEffect, useState } from "react";
import { Users, Send, Eye, Megaphone } from "lucide-react";
import StatsWidget from "@/components/StatsWidget";
import CampaignLauncher from "@/components/CampaignLauncher";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCampaigns } from "@/lib/campaign-context";
import api from "@/lib/api";

interface SentLog {
  id: number;
  recipient_email: string;
  subject: string;
  sent_at: string;
  status: string;
  open_count: number;
}

const statusColor: Record<string, string> = {
  completed: "text-green-600 bg-green-50",
  running: "text-blue-600 bg-blue-50",
  idle: "text-gray-600 bg-gray-100",
  error: "text-red-600 bg-red-50",
};

export default function DashboardPage() {
  const { campaigns, refresh: refreshCampaigns, loading: campaignsLoading } = useCampaigns();
  const [sentLogs, setSentLogs] = useState<SentLog[]>([]);
  const [sentLoading, setSentLoading] = useState(true);

  useEffect(() => {
    api.get<SentLog[]>("/sent")
      .then((r) => setSentLogs(r.data))
      .catch(() => {})
      .finally(() => setSentLoading(false));
  }, []);

  const totalOpens = sentLogs.reduce((acc, l) => acc + (l.open_count || 0), 0);
  const openRate = sentLogs.length > 0
    ? Math.round((sentLogs.filter((l) => l.open_count > 0).length / sentLogs.length) * 100)
    : 0;
  const activeCampaigns = campaigns.filter((c) => c.status === "running").length;

  if (campaignsLoading && sentLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Overview</h1>
        <p className="text-gray-500 mt-1">Your outreach at a glance.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsWidget label="Total Campaigns" value={campaigns.length} icon={Megaphone} color="text-indigo-600" index={0} />
        <StatsWidget label="Emails Sent" value={sentLogs.length} icon={Send} color="text-blue-600" index={1} />
        <StatsWidget label="Open Rate" value={`${openRate}%`} icon={Eye} color="text-green-600" index={2} />
        <StatsWidget label="Active Campaigns" value={activeCampaigns} icon={Users} color="text-orange-500" index={3} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Quick Launch Campaign</CardTitle></CardHeader>
        <CardContent>
          <CampaignLauncher onLaunched={refreshCampaigns} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent Sent Emails</CardTitle></CardHeader>
        <CardContent>
          {sentLogs.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">No emails sent yet.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {sentLogs.slice(0, 10).map((log) => (
                <div key={log.id} className="flex items-center justify-between py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{log.recipient_email}</p>
                    <p className="text-xs text-gray-500 truncate">{log.subject}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    {log.open_count > 0 && (
                      <span className="text-xs text-green-600">
                        <Eye className="inline h-3 w-3 mr-0.5" />{log.open_count}
                      </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[log.status] || "text-gray-600 bg-gray-100"}`}>
                      {log.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent Campaigns</CardTitle></CardHeader>
        <CardContent>
          {campaigns.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">No campaigns yet. Launch one above.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {campaigns.slice(0, 5).map((c) => (
                <div key={c.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{c.name}</p>
                    <p className="text-xs text-gray-500">{c.niche}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[c.status] || ""}`}>
                    {c.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
