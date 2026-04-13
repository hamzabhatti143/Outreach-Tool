"use client";

import { useEffect, useState } from "react";
import { CheckCircle, XCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import api from "@/lib/api";

export default function SettingsPage() {
  // SMTP
  const [smtpHost, setSmtpHost] = useState("smtp.gmail.com");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [fromName, setFromName] = useState("");
  const [passwordSet, setPasswordSet] = useState(false);
  const [smtpLoading, setSmtpLoading] = useState(false);
  const [smtpSaved, setSmtpSaved] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Profile
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get("/settings/smtp"),
      api.get("/settings/profile"),
    ]).then(([smtp, profile]) => {
      setSmtpHost(smtp.data.host || "smtp.gmail.com");
      setSmtpPort(String(smtp.data.port || 587));
      setSmtpUser(smtp.data.username || "");
      setFromName(smtp.data.from_name || "");
      setPasswordSet(smtp.data.password_set ?? false);
      setProfileName(profile.data.name || "");
      setProfileEmail(profile.data.email || "");
    });
  }, []);

  async function handleSmtpSave(e: React.FormEvent) {
    e.preventDefault();
    setSmtpLoading(true);
    setSmtpSaved(false);
    setTestResult(null);
    try {
      await api.post("/settings/smtp", {
        host: smtpHost,
        port: Number(smtpPort),
        username: smtpUser,
        password: smtpPass || null,
        from_name: fromName,
      });
      if (smtpPass) setPasswordSet(true);
      setSmtpPass("");
      setSmtpSaved(true);
      setTimeout(() => setSmtpSaved(false), 3000);
    } finally {
      setSmtpLoading(false);
    }
  }

  async function handleTest() {
    setTestLoading(true);
    setTestResult(null);
    try {
      const { data } = await api.post("/settings/smtp/test");
      setTestResult(data);
    } finally {
      setTestLoading(false);
    }
  }

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
        <p className="text-gray-500 mt-1">Manage your email sending config, profile, and account.</p>
      </div>

      {/* ── SMTP ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Email Sending (SMTP)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 text-sm text-blue-800 space-y-1">
            <p className="font-medium">Using Gmail? You need an App Password — not your regular password.</p>
            <p>
              Go to{" "}
              <a
                href="https://myaccount.google.com/apppasswords"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 font-medium underline"
              >
                myaccount.google.com/apppasswords <ExternalLink className="h-3 w-3" />
              </a>
              , create an app, copy the 16-character code, and paste it below.
            </p>
          </div>

          <form onSubmit={handleSmtpSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">SMTP Host</label>
                <Input
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  placeholder="smtp.gmail.com"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Port</label>
                <Input
                  type="number"
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(e.target.value)}
                  placeholder="587"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Gmail Address (From Email)</label>
              <Input
                type="email"
                value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
                placeholder="you@gmail.com"
                autoComplete="off"
              />
              <p className="text-xs text-gray-400">Outreach emails are sent from this address.</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">
                Gmail App Password
                {passwordSet && (
                  <span className="ml-2 text-xs font-normal text-green-600">✓ saved</span>
                )}
              </label>
              <Input
                type="password"
                value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
                placeholder={passwordSet ? "Leave blank to keep existing" : "xxxx xxxx xxxx xxxx"}
                autoComplete="new-password"
              />
              <p className="text-xs text-gray-400">
                16-character app password.{" "}
                <a
                  href="https://myaccount.google.com/apppasswords"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 hover:underline"
                >
                  Get one here.
                </a>
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Sender Display Name</label>
              <Input
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="Your Name or Company"
              />
              <p className="text-xs text-gray-400">How you appear in recipients' inboxes.</p>
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" loading={smtpLoading}>Save</Button>
              <Button type="button" variant="outline" onClick={handleTest} loading={testLoading}>
                Test Connection
              </Button>
              {smtpSaved && (
                <span className="flex items-center gap-1 text-sm text-green-600">
                  <CheckCircle className="h-4 w-4" /> Saved
                </span>
              )}
            </div>

            {testResult && (
              <div className={`flex items-center gap-2 text-sm p-3 rounded-md ${testResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                {testResult.ok
                  ? <CheckCircle className="h-4 w-4 shrink-0" />
                  : <XCircle className="h-4 w-4 shrink-0" />}
                {testResult.message}
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      {/* ── Profile ── */}
      <Card>
        <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleProfileSave} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Name</label>
              <Input
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="Your name"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Login Email</label>
              <Input
                type="email"
                value={profileEmail}
                onChange={(e) => setProfileEmail(e.target.value)}
              />
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

      {/* ── Danger Zone ── */}
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
