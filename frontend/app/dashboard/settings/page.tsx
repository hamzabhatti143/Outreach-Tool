"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle, ExternalLink, Upload, Link2, Link2Off, Loader2, AlertTriangle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import api from "@/lib/api";

// ── Gmail connect section (needs useSearchParams → must be in Suspense) ───────

function GmailSection() {
  const searchParams = useSearchParams();

  const [connected, setConnected] = useState(false);
  const [credentialsSaved, setCredentialsSaved] = useState(false);
  const [connectedEmail, setConnectedEmail] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("https://hamzabhatti-outreach-tool-82fb335.hf.space/auth/gmail/callback");
  const [credLoading, setCredLoading] = useState(false);
  const [credSaved, setCredSaved] = useState(false);
  const [connectLoading, setConnectLoading] = useState(false);
  const [disconnectLoading, setDisconnectLoading] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; msg: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<{ connected: boolean; email: string | null; credentials_saved: boolean }>(
      "/auth/gmail/status"
    ).then((r) => {
      setConnected(r.data.connected);
      setConnectedEmail(r.data.email || "");
      setCredentialsSaved(r.data.credentials_saved);
    }).catch(() => {});
  }, []);

  // Handle redirect-back result (?gmail=connected / error / expired)
  useEffect(() => {
    const result = searchParams.get("gmail");
    if (result === "connected") setFlash({ ok: true, msg: "Gmail connected successfully!" });
    if (result === "error") setFlash({ ok: false, msg: "Connection failed. Check your credentials and try again." });
    if (result === "expired") setFlash({ ok: false, msg: "OAuth session expired. Please try again." });
  }, [searchParams]);

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        const section = json.web || json.installed;
        if (section) {
          setClientId(section.client_id || "");
          setClientSecret(section.client_secret || "");
          setRedirectUri(section.redirect_uris?.[0] || redirectUri);
        }
      } catch {
        setFlash({ ok: false, msg: "Invalid credentials.json file." });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  async function handleSaveCredentials(e: React.FormEvent) {
    e.preventDefault();
    setCredLoading(true);
    setFlash(null);
    try {
      await api.post("/auth/gmail/credentials", {
        google_client_id: clientId,
        google_client_secret: clientSecret,
        google_redirect_uri: redirectUri,
      });
      setCredSaved(true);
      setCredentialsSaved(true);
      setTimeout(() => setCredSaved(false), 3000);
    } catch {
      setFlash({ ok: false, msg: "Failed to save credentials." });
    } finally {
      setCredLoading(false);
    }
  }

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
        <CardTitle className="text-base">Email Sending — Gmail API</CardTitle>
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
          /* ── Connected state ── */
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
          /* ── Not connected state ── */
          <div className="space-y-6">
            {/* Setup guide callout */}
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800 space-y-1.5">
              <p className="font-medium">You need a Google Cloud project to send emails.</p>
              <ol className="list-decimal list-inside space-y-1 text-blue-700">
                <li>
                  Go to{" "}
                  <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 font-medium underline">
                    console.cloud.google.com <ExternalLink className="h-3 w-3" />
                  </a>
                  {" "}→ create a project
                </li>
                <li>Enable <strong>Gmail API</strong> in APIs &amp; Services → Library</li>
                <li>Configure OAuth Consent Screen → add <code className="bg-blue-100 px-1 rounded">gmail.send</code> scope → add your email as test user</li>
                <li>Create OAuth Client ID (Web application) → add your redirect URI below → download <strong>credentials.json</strong></li>
              </ol>
              <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1 font-medium underline text-blue-800">
                Open Google Cloud Credentials <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            {/* Credentials form */}
            <form onSubmit={handleSaveCredentials} className="space-y-4">
              <div className="flex items-center gap-3">
                <p className="text-sm font-medium text-gray-700 flex-1">
                  Upload <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">credentials.json</code> to auto-fill
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  Upload JSON
                </Button>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Client ID</label>
                <Input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="123456789-abc.apps.googleusercontent.com"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Client Secret</label>
                <Input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="GOCSPX-..."
                  required
                  autoComplete="new-password"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Authorized Redirect URI</label>
                <Input
                  value={redirectUri}
                  onChange={(e) => setRedirectUri(e.target.value)}
                  placeholder="https://hamzabhatti-outreach-tool-82fb335.hf.space/auth/gmail/callback"
                  required
                />
                <p className="text-xs text-gray-400">
                  Must match exactly what you added in Google Cloud Console.
                  For production: <code className="bg-gray-100 px-1 rounded">https://hamzabhatti-outreach-tool-82fb335.hf.space/auth/gmail/callback</code>
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Button type="submit" loading={credLoading}>Save Credentials</Button>
                {credSaved && (
                  <span className="flex items-center gap-1 text-sm text-green-600">
                    <CheckCircle className="h-4 w-4" /> Saved
                  </span>
                )}
              </div>
            </form>

            {/* Connect button */}
            {credentialsSaved && (
              <div className="border-t pt-4">
                <p className="text-sm text-gray-600 mb-3">
                  Credentials saved. Click below to authorize OutreachAI to send emails from your Gmail account.
                </p>
                <Button onClick={handleConnect} loading={connectLoading} className="gap-2">
                  <Link2 className="h-4 w-4" />
                  Connect Gmail Account
                </Button>
              </div>
            )}
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
