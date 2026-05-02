"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, Send, Eye, Megaphone, AlertTriangle, ExternalLink, X, Activity } from "lucide-react";
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

interface CampaignActivityEvent {
  id: number;
  campaign_id: number;
  event_type: string;
  message: string;
  created_at: string;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso.endsWith("Z") ? iso : iso + "Z").getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso.endsWith("Z") ? iso : iso + "Z").toLocaleDateString();
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
  const [smtpMissing, setSmtpMissing] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [activityEvents, setActivityEvents] = useState<CampaignActivityEvent[]>([]);

  useEffect(() => {
    api.get<SentLog[]>("/sent")
      .then((r) => setSentLogs(r.data))
      .catch(() => {})
      .finally(() => setSentLoading(false));

    api.get<{ connected: boolean }>("/auth/gmail/status")
      .then((r) => { if (!r.data.connected) setSmtpMissing(true); })
      .catch(() => {});

    api.get<CampaignActivityEvent[]>("/campaigns/events")
      .then((r) => setActivityEvents(r.data))
      .catch(() => {});
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
      {smtpMissing && !bannerDismissed && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3.5">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-semibold text-amber-900">Gmail not connected</p>
            <p className="text-amber-800 mt-0.5">
              Connect your Gmail account in{" "}
              <Link href="/dashboard/settings" className="font-medium underline underline-offset-2">
                Settings
              </Link>{" "}
              before you can send outreach emails.{" "}
              <span className="text-amber-700">
                Need a Google Cloud project?{" "}
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 font-medium underline underline-offset-2"
                >
                  Open Cloud Console <ExternalLink className="h-3 w-3" />
                </a>
              </span>
            </p>
          </div>
          <button
            onClick={() => setBannerDismissed(true)}
            className="text-amber-500 hover:text-amber-700 transition-colors shrink-0"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

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

      {activityEvents.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4 text-indigo-500" /> Recent Activity</CardTitle></CardHeader>
          <CardContent>
            <div className="divide-y divide-gray-100">
              {activityEvents.map((ev) => (
                <div key={ev.id} className="flex items-start justify-between py-2.5 gap-3">
                  <div className="min-w-0">
                    <span className={`inline-block text-xs font-medium px-1.5 py-0.5 rounded mr-2 ${
                      ev.event_type === "scrape" ? "bg-blue-50 text-blue-700" :
                      ev.event_type === "error"  ? "bg-red-50 text-red-700" :
                                                   "bg-gray-100 text-gray-600"
                    }`}>
                      {ev.event_type}
                    </span>
                    <span className="text-sm text-gray-700">{ev.message}</span>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">{timeAgo(ev.created_at)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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
