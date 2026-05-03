"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Zap, ArrowLeft, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import api from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
    } catch {
      setError("Something went wrong. Please try again.");
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
          <h1 className="text-2xl font-bold text-gray-900">Forgot password?</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Enter your email and we&apos;ll send a reset link.
          </p>
        </div>

        <div className="bg-white p-8 rounded-xl border border-gray-200 shadow-sm">
          {sent ? (
            <div className="text-center space-y-4">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-100 mb-2">
                <Mail className="h-6 w-6 text-green-600" />
              </div>
              <p className="text-sm font-medium text-gray-900">Check your inbox</p>
              <p className="text-sm text-gray-500">
                If <span className="font-medium text-gray-700">{email}</span> is registered,
                you&apos;ll receive a reset link within a minute.
              </p>
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline mt-2"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Email address</label>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  autoFocus
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" loading={loading}>
                Send reset link
              </Button>

              <p className="text-center text-sm text-gray-500">
                <Link href="/login" className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline">
                  <ArrowLeft className="h-3 w-3" /> Back to sign in
                </Link>
              </p>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
}
