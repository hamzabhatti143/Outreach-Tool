"use client";

import Link from "next/link";
import {
  CheckCircle, AlertTriangle, Mail, RefreshCw, Shield, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GmailSetupGuidePage() {
  return (
    <div className="max-w-2xl mx-auto space-y-8 pb-12">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Connect Your Gmail</h1>
        <p className="text-gray-500 mt-1 text-sm leading-relaxed">
          Link your Gmail account so outreach emails are sent directly from your address.
          Setup takes under a minute.
        </p>
      </div>

      {/* Feature cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { icon: Mail,     label: "From address",   value: "Your Gmail"    },
          { icon: RefreshCw, label: "Reply tracking", value: "Automatic"     },
          { icon: Shield,   label: "Auth method",    value: "OAuth 2.0"     },
          { icon: Zap,      label: "Setup time",     value: "< 1 minute"    },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <Icon className="h-4 w-4 text-indigo-500" />
              <span className="text-xs font-medium text-gray-500">{label}</span>
            </div>
            <p className="text-sm font-semibold text-gray-800">{value}</p>
          </div>
        ))}
      </div>

      {/* Steps */}
      <div className="space-y-4">
        {[
          {
            number: 1,
            title: "Go to Settings",
            description: (
              <>
                Head to the{" "}
                <Link href="/dashboard/settings" className="text-indigo-600 hover:underline font-medium">
                  Settings page
                </Link>{" "}
                and click <strong>Connect Gmail Account</strong>.
              </>
            ),
          },
          {
            number: 2,
            title: "Sign in with Google",
            description: "A Google sign-in window opens. Choose the Gmail account you want to send outreach emails from.",
          },
          {
            number: 3,
            title: "Grant permissions",
            description: (
              <>
                Approve the two permissions: <strong>Send emails</strong> and <strong>Read email threads</strong>.
                The read permission is used only to detect replies to your outreach emails.
              </>
            ),
          },
          {
            number: 4,
            title: "You're connected",
            description: "You'll be redirected back to Settings with a green Connected badge showing your Gmail address. That's it.",
          },
        ].map(({ number, title, description }) => (
          <div key={number} className="flex gap-4 rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white font-bold text-sm mt-0.5">
              {number}
            </div>
            <div>
              <p className="font-semibold text-gray-900">{title}</p>
              <p className="text-sm text-gray-600 mt-0.5 leading-relaxed">{description}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Unverified app warning */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 flex gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-amber-800">Google may show "This app isn't verified"</p>
          <p className="text-sm text-amber-700 leading-relaxed">
            This is expected. Click <strong>Advanced</strong> at the bottom of the warning screen,
            then <strong>Go to App (unsafe)</strong> to continue. This warning appears because the
            OAuth app hasn't gone through Google's verification process — it is safe to proceed.
          </p>
        </div>
      </div>

      {/* Reply tracking note */}
      <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-5 py-4 space-y-1">
        <p className="text-sm font-semibold text-indigo-800">Reply tracking is automatic</p>
        <p className="text-sm text-indigo-700 leading-relaxed">
          Once connected, the tool polls your Gmail threads in the background to detect replies to
          your outreach emails. Replies appear on the <strong>Replies</strong> page with sentiment
          scores. No extra setup needed.
        </p>
      </div>

      {/* Done CTA */}
      <div className="rounded-xl border border-green-200 bg-green-50 px-6 py-5">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle className="h-5 w-5 text-green-600" />
          <p className="font-semibold text-green-800">Ready to connect?</p>
        </div>
        <p className="text-sm text-green-700 leading-relaxed mb-4">
          Click the button below to go to Settings and connect your Gmail account.
        </p>
        <Link href="/dashboard/settings">
          <Button size="sm">Go to Settings</Button>
        </Link>
      </div>

    </div>
  );
}
