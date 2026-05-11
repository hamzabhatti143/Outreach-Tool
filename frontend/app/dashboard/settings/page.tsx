"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle, Link2, Link2Off, Loader2, AlertTriangle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import api from "@/lib/api";

// ── Gmail connect section (needs useSearchParams → must be in Suspense) ───────

function GmailSection() {
  const searchParams = useSearchParams();

  const [connected, setConnected] = useState(false);
  const [connectedEmail, setConnectedEmail] = useState("");
  const [connectLoading, setConnectLoading] = useState(false);
  const [disconnectLoading, setDisconnectLoading] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    api.get<{ connected: boolean; email: string | null }>(
      "/auth/gmail/status"
    ).then((r) => {
      setConnected(r.data.connected);
      setConnectedEmail(r.data.email || "");
    }).catch(() => {});
  }, []);

  // Handle redirect-back result (?gmail=connected / error / expired)
  useEffect(() => {
    const result = searchParams.get("gmail");
    if (result === "connected") setFlash({ ok: true, msg: "Gmail connected successfully!" });
    if (result === "error") setFlash({ ok: false, msg: "Connection failed. Please try again." });
    if (result === "expired") setFlash({ ok: false, msg: "OAuth session expired. Please try again." });
  }, [searchParams]);

  async function handleConnect() {
    setConnectLoading(true);
    setFlash(null);
    try {
      const { data } = await api.get<{ url: string }>("/auth/gmail/connect");
      window.location.href = data.url;
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setFlash({ ok: false, msg: msg || "Failed to start OAuth flow." });
      setConnectLoading(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect Gmail? You won't be able to send emails until you reconnect.")) return;
    setDisconnectLoading(true);
    try {
      await api.delete("/auth/gmail/disconnect");
      setConnected(false);
      setConnectedEmail("");
      setFlash({ ok: true, msg: "Gmail disconnected." });
    } finally {
      setDisconnectLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Email Sending — Gmail</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">

        {/* Flash message */}
        {flash && (
          <div className={`flex items-center gap-2 text-sm px-3 py-2.5 rounded-md ${flash.ok ? "bg-green-50 text-green-700 border border-green-100" : "bg-red-50 text-red-700 border border-red-100"}`}>
            {flash.ok ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
            {flash.msg}
          </div>
        )}

        {connected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
              <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-green-900">Gmail connected</p>
                <p className="text-xs text-green-700">{connectedEmail}</p>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={handleDisconnect}
              loading={disconnectLoading}
              className="text-red-600 border-red-200 hover:bg-red-50"
            >
              <Link2Off className="h-4 w-4 mr-1.5" />
              Disconnect Gmail
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Connect your Gmail account to send outreach emails.
            </p>
            <Button onClick={handleConnect} loading={connectLoading} className="gap-2">
              <Link2 className="h-4 w-4" />
              Connect Gmail Account
            </Button>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="text-xs text-amber-800">
                ⚠️ Google may show "This app isn't verified". Click <strong>Advanced → Go to App</strong> to continue.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}


// ── Profile section ───────────────────────────────────────────────────────────

function ProfileSection() {
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  useEffect(() => {
    api.get("/settings/profile").then((r) => {
      setProfileName(r.data.name || "");
      setProfileEmail(r.data.email || "");
    }).catch(() => {});
  }, []);

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault();
    setProfileLoading(true);
    setProfileSaved(false);
    try {
      await api.patch("/settings/profile", { name: profileName, email: profileEmail });
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 3000);
    } finally {
      setProfileLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={handleProfileSave} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Name</label>
            <Input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="Your name" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Login Email</label>
            <Input type="email" value={profileEmail} onChange={(e) => setProfileEmail(e.target.value)} />
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" loading={profileLoading}>Update Profile</Button>
            {profileSaved && (
              <span className="flex items-center gap-1 text-sm text-green-600">
                <CheckCircle className="h-4 w-4" /> Saved
              </span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}


// ── Main page ─────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [deleting, setDeleting] = useState(false);

  async function handleDeleteAccount() {
    if (!confirm("This will permanently delete your account and all data. Are you sure?")) return;
    setDeleting(true);
    try {
      await api.delete("/settings/account");
      window.location.href = "/login";
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-1">Manage Gmail, your profile, and account.</p>
      </div>

      <Suspense fallback={
        <Card>
          <CardContent className="py-10 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </CardContent>
        </Card>
      }>
        <GmailSection />
      </Suspense>

      <ProfileSection />

      {/* Danger Zone */}
      <Card className="border-red-200">
        <CardHeader><CardTitle className="text-base text-red-700">Danger Zone</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600 mb-4">
            Permanently delete your account and all associated data. This cannot be undone.
          </p>
          <Button variant="destructive" onClick={handleDeleteAccount} loading={deleting}>
            Delete Account
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
