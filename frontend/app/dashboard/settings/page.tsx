"use client";

import { useEffect, useState } from "react";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import api from "@/lib/api";

export default function SettingsPage() {
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [fromName, setFromName] = useState("");
  const [smtpLoading, setSmtpLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);

  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get("/settings/smtp"),
      api.get("/settings/profile"),
    ]).then(([smtp, profile]) => {
      setSmtpHost(smtp.data.host);
      setSmtpPort(String(smtp.data.port));
      setSmtpUser(smtp.data.username);
      setFromName(smtp.data.from_name);
      setProfileName(profile.data.name || "");
      setProfileEmail(profile.data.email || "");
    });
  }, []);

  async function handleSmtpSave(e: React.FormEvent) {
    e.preventDefault();
    setSmtpLoading(true);
    try {
      await api.post("/settings/smtp", {
        host: smtpHost,
        port: Number(smtpPort),
        username: smtpUser,
        password: smtpPass || null,
        from_name: fromName,
      });
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
    try {
      await api.patch("/settings/profile", { name: profileName, email: profileEmail });
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
        <p className="text-gray-500 mt-1">Manage your SMTP, profile, and account settings.</p>
      </div>

      {/* SMTP */}
      <Card>
        <CardHeader><CardTitle className="text-base">SMTP Configuration</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSmtpSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Host</label>
                <Input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.gmail.com" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Port</label>
                <Input type="number" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="587" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Username</label>
                <Input value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} placeholder="you@gmail.com" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Password</label>
                <Input type="password" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} placeholder="Leave blank to keep existing" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">From Name</label>
              <Input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Outreach Tool" />
            </div>
            <div className="flex gap-3">
              <Button type="submit" loading={smtpLoading}>Save SMTP</Button>
              <Button type="button" variant="outline" onClick={handleTest} loading={testLoading}>
                Test Connection
              </Button>
            </div>
            {testResult && (
              <div className={`flex items-center gap-2 text-sm p-3 rounded-md ${testResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                {testResult.ok ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                {testResult.message}
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Profile */}
      <Card>
        <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleProfileSave} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Name</label>
              <Input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="Your name" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Email</label>
              <Input type="email" value={profileEmail} onChange={(e) => setProfileEmail(e.target.value)} />
            </div>
            <Button type="submit" loading={profileLoading}>Update Profile</Button>
          </form>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-red-200">
        <CardHeader><CardTitle className="text-base text-red-700">Danger Zone</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600 mb-4">Permanently delete your account and all associated data. This cannot be undone.</p>
          <Button variant="destructive" onClick={handleDeleteAccount} loading={deleting}>
            Delete Account
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
