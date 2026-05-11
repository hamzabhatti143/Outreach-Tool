"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle, Copy, ExternalLink, ChevronDown, ChevronUp,
  AlertTriangle, Info, Mail, RefreshCw, DollarSign, Globe, Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const REDIRECT_URI = "http://localhost:8000/auth/gmail/callback";

/* ── Reusable primitives ─────────────────────────────────────── */

function CopyBox({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="mt-2">
      {label && <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>}
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
        <code className="flex-1 text-sm font-mono text-gray-800 break-all">{value}</code>
        <button
          onClick={copy}
          className="shrink-0 text-gray-400 hover:text-indigo-600 transition-colors"
          title="Copy"
        >
          {copied ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-4 px-6 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white font-bold text-sm">
          {number}
        </div>
        <span className="flex-1 font-semibold text-gray-900">{title}</span>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>
      {open && (
        <div className="px-6 pb-6 pt-1 border-t border-gray-100 space-y-3 text-sm text-gray-700">
          {children}
        </div>
      )}
    </div>
  );
}

function Note({ children, type = "info" }: { children: React.ReactNode; type?: "info" | "warn" }) {
  const styles = type === "warn"
    ? "bg-amber-50 border-amber-200 text-amber-800"
    : "bg-indigo-50 border-indigo-200 text-indigo-800";
  const Icon = type === "warn" ? AlertTriangle : Info;
  return (
    <div className={`flex gap-2 rounded-lg border px-4 py-3 ${styles}`}>
      <Icon className="h-4 w-4 shrink-0 mt-0.5" />
      <span className="text-sm leading-relaxed">{children}</span>
    </div>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-indigo-600 hover:underline font-medium">
      {children} <ExternalLink className="h-3 w-3" />
    </a>
  );
}

/* ── Page ────────────────────────────────────────────────────── */

export default function GmailSetupGuidePage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-12">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Gmail API Setup Guide</h1>
        <p className="text-gray-500 mt-1 text-sm leading-relaxed">
          Connect your own Gmail account so the outreach tool sends emails directly from your address.
          This is a one-time setup — tokens refresh automatically after that.
        </p>
      </div>

      {/* Key info cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { icon: Mail,       label: "From address",    value: "Your own Gmail"   },
          { icon: RefreshCw,  label: "Reply tracking",  value: "Automatic"        },
          { icon: DollarSign, label: "Cost",            value: "Free"             },
          { icon: Globe,      label: "Setup location",  value: "Google Cloud"     },
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

      {/* Redirect URI callout */}
      <div className="rounded-xl border border-green-200 bg-green-50 px-5 py-4">
        <p className="text-sm font-semibold text-green-800 mb-1">Your Redirect URI — save this now</p>
        <p className="text-xs text-green-700 mb-2">
          You will paste this into Google Cloud when creating your OAuth credentials in Step 4.
        </p>
        <CopyBox value={REDIRECT_URI} />
      </div>

      {/* Steps */}
      <Step number={1} title="Create a Google Cloud Project">
        <ol className="list-decimal list-inside space-y-2 leading-relaxed">
          <li>
            Go to{" "}
            <ExtLink href="https://console.cloud.google.com/projectcreate">
              Google Cloud Console → New Project
            </ExtLink>
          </li>
          <li>
            Give it any name — e.g. <code className="bg-gray-100 px-1 rounded">outreach-tool</code> — and click <strong>Create</strong>.
          </li>
          <li>Make sure the new project is selected in the top-left dropdown before continuing.</li>
        </ol>
      </Step>

      <Step number={2} title="Enable the Gmail API">
        <ol className="list-decimal list-inside space-y-2 leading-relaxed">
          <li>
            Open{" "}
            <ExtLink href="https://console.cloud.google.com/apis/library/gmail.googleapis.com">
              APIs &amp; Services → Library → Gmail API
            </ExtLink>
          </li>
          <li>Click the blue <strong>Enable</strong> button.</li>
        </ol>
        <Note>The Gmail API must be enabled before OAuth credentials can be created for it.</Note>
      </Step>

      <Step number={3} title="Configure the OAuth Consent Screen">
        <ol className="list-decimal list-inside space-y-2 leading-relaxed">
          <li>
            Go to{" "}
            <ExtLink href="https://console.cloud.google.com/apis/credentials/consent">
              APIs &amp; Services → OAuth consent screen
            </ExtLink>
          </li>
          <li>Select <strong>External</strong> as the user type, then click <strong>Create</strong>.</li>
          <li>Fill in <strong>App name</strong> (e.g. Outreach Tool) and your <strong>support email</strong>. Leave other fields blank.</li>
          <li>
            On the <strong>Scopes</strong> screen, click <strong>Add or Remove Scopes</strong> and add both:
            <CopyBox value="https://www.googleapis.com/auth/gmail.send" label="Scope 1 — send emails" />
            <CopyBox value="https://www.googleapis.com/auth/gmail.readonly" label="Scope 2 — read threads for reply tracking" />
          </li>
          <li>Click <strong>Update</strong>, then <strong>Save and Continue</strong>.</li>
          <li>
            On the <strong>Test Users</strong> screen, click <strong>+ Add Users</strong> and add the Gmail
            address you want to send from.
          </li>
          <li>Click <strong>Save and Continue</strong>, then <strong>Back to Dashboard</strong>.</li>
        </ol>
        <Note type="warn">
          While the app is in <strong>Testing</strong> mode, only Gmail addresses added as Test Users can connect.
          The OAuth flow will show &ldquo;Access blocked&rdquo; for any other address.
        </Note>
      </Step>

      <Step number={4} title="Create OAuth 2.0 Credentials">
        <ol className="list-decimal list-inside space-y-2 leading-relaxed">
          <li>
            Go to{" "}
            <ExtLink href="https://console.cloud.google.com/apis/credentials">
              APIs &amp; Services → Credentials
            </ExtLink>
          </li>
          <li>Click <strong>+ Create Credentials → OAuth client ID</strong>.</li>
          <li>Set Application type to <strong>Web application</strong>.</li>
          <li>
            Under <strong>Authorized redirect URIs</strong>, click <strong>+ Add URI</strong> and paste:
            <CopyBox value={REDIRECT_URI} label="Paste exactly — no trailing slash" />
          </li>
          <li>Click <strong>Create</strong>.</li>
          <li>
            Copy both the <strong>Client ID</strong> and <strong>Client Secret</strong> from the dialog
            that appears, or click <strong>Download JSON</strong>.
          </li>
        </ol>
        <Note>Treat the Client Secret like a password. Never share it or commit it to version control.</Note>
      </Step>

      <Step number={5} title="Enter Your Credentials in Settings">
        <p className="leading-relaxed">
          Paste the values from Google Cloud into the <strong>Gmail API</strong> section on the{" "}
          <Link href="/dashboard/settings" className="text-indigo-600 hover:underline inline-flex items-center gap-1">
            Settings page <Settings className="h-3 w-3" />
          </Link>:
        </p>

        {/* Credentials table */}
        <div className="rounded-lg border border-gray-200 overflow-hidden mt-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600">Field</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600">Example value</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600">Where to find it</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 font-mono">
              <tr>
                <td className="px-4 py-2.5 text-indigo-700 font-semibold">Client ID</td>
                <td className="px-4 py-2.5 text-gray-500">123...apps.googleusercontent.com</td>
                <td className="px-4 py-2.5 text-gray-600 font-sans">OAuth client dialog</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 text-indigo-700 font-semibold">Client Secret</td>
                <td className="px-4 py-2.5 text-gray-500">GOCSPX-xxxxxxxxxxxx</td>
                <td className="px-4 py-2.5 text-gray-600 font-sans">OAuth client dialog</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 text-indigo-700 font-semibold">Redirect URI</td>
                <td className="px-4 py-2.5 text-gray-500 truncate max-w-[160px]">{REDIRECT_URI}</td>
                <td className="px-4 py-2.5 text-gray-600 font-sans">Copied from above</td>
              </tr>
            </tbody>
          </table>
        </div>

        <ol className="list-decimal list-inside space-y-2 leading-relaxed mt-3">
          <li>Paste all three values into the Settings form.</li>
          <li>Click <strong>Save Credentials</strong>.</li>
        </ol>
      </Step>

      <Step number={6} title="Connect Your Gmail Account">
        <ol className="list-decimal list-inside space-y-2 leading-relaxed">
          <li>
            On the{" "}
            <Link href="/dashboard/settings" className="text-indigo-600 hover:underline inline-flex items-center gap-1">
              Settings page <Settings className="h-3 w-3" />
            </Link>
            , click <strong>Connect Gmail Account</strong>.
          </li>
          <li>A Google sign-in window opens — choose the Gmail account you added as a Test User.</li>
          <li>Grant both requested permissions (send &amp; read).</li>
          <li>You are redirected back to Settings. The status badge shows <strong>Connected ✓</strong> with your email.</li>
        </ol>
        <Note type="warn">
          Sign in with the <strong>same Gmail address</strong> you added as a Test User in Step 3.
          A different address will show &ldquo;Access blocked&rdquo;.
        </Note>
      </Step>

      <Step number={7} title="Reply Tracking — Automatic">
        <p className="leading-relaxed">
          No extra setup needed. Once Gmail is connected, the tool polls your Gmail threads automatically
          to detect replies to sent outreach emails. Replies appear on the <strong>Replies</strong> dashboard
          with sentiment scores.
        </p>
        <Note>
          Reply detection works via Gmail Thread IDs — not IMAP or app passwords. Tokens refresh in the background
          so you stay connected without re-authorising.
        </Note>
      </Step>

      {/* Testing-mode alert */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 flex gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-amber-800">App is in Testing mode</p>
          <p className="text-sm text-amber-700 leading-relaxed">
            While the OAuth consent screen is set to <strong>Testing</strong>, only Gmail addresses you added
            as Test Users can connect. This is fine for personal use. If you want other users to connect their
            Gmail, publish the app via <strong>OAuth consent screen → Publish App</strong> (Google may require
            a verification review for sensitive scopes).
          </p>
        </div>
      </div>

      {/* Done */}
      <div className="rounded-xl border border-green-200 bg-green-50 px-6 py-5">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle className="h-5 w-5 text-green-600" />
          <p className="font-semibold text-green-800">You&rsquo;re all set!</p>
        </div>
        <p className="text-sm text-green-700 leading-relaxed">
          Outreach emails are now sent directly from your Gmail. Replies are tracked automatically via Gmail
          Threads — no IMAP, no app passwords, no extra config.
        </p>
        <div className="flex gap-3 mt-4">
          <Link href="/dashboard/settings">
            <Button size="sm">Go to Settings</Button>
          </Link>
          <Link href="/dashboard/campaigns">
            <Button size="sm" variant="outline">Start a Campaign</Button>
          </Link>
        </div>
      </div>

      {/* FAQ */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Common questions</h2>
        {[
          {
            q: "Why do I need my own Google Cloud project?",
            a: "This tool is self-hosted — there's no shared OAuth app. Using your own project means you fully control which Gmail account is connected and can revoke access at any time from your Google account security settings.",
          },
          {
            q: "Do I need to verify my app with Google?",
            a: "No. With yourself added as a Test User, everything works in Testing mode. Verification is only required if you want other people's accounts to connect — not needed for personal or small-team use.",
          },
          {
            q: "I got “Access blocked: app has not completed Google verification.”",
            a: "Your Gmail address is not added as a Test User. Go to APIs & Services → OAuth consent screen → Test Users and add the exact Gmail address you're trying to connect.",
          },
          {
            q: "The callback returns a 400 or redirect_uri_mismatch error.",
            a: `The redirect URI in Google Cloud doesn't exactly match. Confirm you added "${REDIRECT_URI}" (no trailing slash) under Authorized Redirect URIs in your OAuth 2.0 client.`,
          },
          {
            q: "Do access tokens expire? Will I need to reconnect?",
            a: "Access tokens expire after 1 hour but are refreshed automatically using the stored refresh token. You should never need to reconnect unless you manually revoke access in your Google account.",
          },
          {
            q: "Can I use this with a Google Workspace (G Suite) account?",
            a: "Yes. Create the Cloud project under your personal Google account, but you can sign in with any Gmail or Workspace address during Step 6, as long as it's listed as a Test User.",
          },
        ].map(({ q, a }) => (
          <details key={q} className="rounded-lg border border-gray-200 bg-white group">
            <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium text-gray-800 list-none hover:bg-gray-50 transition-colors">
              {q}
              <ChevronDown className="h-4 w-4 text-gray-400 group-open:rotate-180 transition-transform" />
            </summary>
            <p className="px-4 pb-4 pt-1 text-sm text-gray-600 leading-relaxed border-t border-gray-100">{a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
