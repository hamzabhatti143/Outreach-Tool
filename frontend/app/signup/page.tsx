"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Zap, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import api from "@/lib/api";
import { setTokens } from "@/lib/auth";

export default function SignupPage() {
  const router = useRouter();

  // Account fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // SMTP fields (optional at signup)
  const [showSmtp, setShowSmtp] = useState(false);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFromName, setSmtpFromName] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { data } = await api.post("/auth/signup", {
        name: name || undefined,
        email,
        password,
        smtp_user: smtpUser || undefined,
        smtp_pass: smtpPass || undefined,
        smtp_from_name: smtpFromName || undefined,
      });
      setTokens(data.access_token, data.refresh_token);
      router.push("/dashboard");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Failed to create account.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-10">
      <motion.div
        className="w-full max-w-sm"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 mb-4">
            <Zap className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Create your account</h1>
          <p className="text-gray-500 mt-1 text-sm">Start automating outreach in minutes</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 bg-white p-8 rounded-xl border border-gray-200 shadow-sm">

          {/* ── Account details ── */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Full Name</label>
            <Input
              type="text"
              placeholder="John Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Email</label>
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Password</label>
            <Input
              type="password"
              placeholder="Min. 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>

          {/* ── SMTP / Email sending setup (collapsible) ── */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setShowSmtp((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <span>Email Sending Setup <span className="text-gray-400 font-normal">(optional)</span></span>
              {showSmtp ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
            </button>

            {showSmtp && (
              <div className="px-4 pb-4 pt-3 space-y-3 border-t border-gray-100">
                <p className="text-xs text-gray-500 leading-relaxed">
                  OutreachAI sends emails from your own Gmail account using an{" "}
                  <a
                    href="https://myaccount.google.com/apppasswords"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 hover:underline inline-flex items-center gap-0.5"
                  >
                    App Password <ExternalLink className="h-3 w-3" />
                  </a>
                  . You can also configure this later in Settings.
                </p>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Gmail Address</label>
                  <Input
                    type="email"
                    placeholder="you@gmail.com"
                    value={smtpUser}
                    onChange={(e) => setSmtpUser(e.target.value)}
                    autoComplete="off"
                  />
                  <p className="text-xs text-gray-400">The Gmail account your outreach emails are sent from.</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Gmail App Password</label>
                  <Input
                    type="password"
                    placeholder="xxxx xxxx xxxx xxxx"
                    value={smtpPass}
                    onChange={(e) => setSmtpPass(e.target.value)}
                    autoComplete="off"
                  />
                  <p className="text-xs text-gray-400">
                    16-character app password — not your Gmail login password.{" "}
                    <a
                      href="https://myaccount.google.com/apppasswords"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-600 hover:underline"
                    >
                      Generate one here.
                    </a>
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Sender Display Name</label>
                  <Input
                    type="text"
                    placeholder="Your Name or Company"
                    value={smtpFromName}
                    onChange={(e) => setSmtpFromName(e.target.value)}
                  />
                  <p className="text-xs text-gray-400">How you appear in the recipient's inbox.</p>
                </div>
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" loading={loading}>
            Create Account
          </Button>

          <p className="text-center text-sm text-gray-500">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-indigo-600 hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </motion.div>
    </div>
  );
}
