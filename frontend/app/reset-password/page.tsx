"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Zap, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import api from "@/lib/api";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) setError("Missing reset token. Please use the link from your email.");
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.post("/auth/reset-password", { token, new_password: password });
      setSuccess(true);
      setTimeout(() => router.push("/login"), 3000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Failed to reset password. The link may have expired.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
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
          <h1 className="text-2xl font-bold text-gray-900">Set new password</h1>
          <p className="text-gray-500 mt-1 text-sm">Choose a strong password for your account.</p>
        </div>

        <div className="bg-white p-8 rounded-xl border border-gray-200 shadow-sm">
          {success ? (
            <div className="text-center space-y-4">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-100 mb-2">
                <CheckCircle className="h-6 w-6 text-green-600" />
              </div>
              <p className="text-sm font-medium text-gray-900">Password updated!</p>
              <p className="text-sm text-gray-500">
                Redirecting you to sign in…
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {!token && (
                <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-100 px-3 py-2">
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                  <p className="text-sm text-red-600">Invalid reset link.</p>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">New password</label>
                <Input
                  type="password"
                  placeholder="Min. 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  autoFocus
                  disabled={!token}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Confirm password</label>
                <Input
                  type="password"
                  placeholder="Repeat your password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                  disabled={!token}
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" loading={loading} disabled={!token}>
                Reset password
              </Button>

              <p className="text-center text-sm text-gray-500">
                <Link href="/login" className="font-medium text-indigo-600 hover:underline">
                  Back to sign in
                </Link>
              </p>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
