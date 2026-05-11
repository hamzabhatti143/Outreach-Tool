"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import { isAuthenticated } from "@/lib/auth";
import { CampaignProvider } from "@/lib/campaign-context";
import ErrorBoundary from "@/components/ErrorBoundary";
import api from "@/lib/api";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) router.push("/login");
  }, [router]);

  useEffect(() => {
    api.get<{ connected: boolean }>("/auth/gmail/status")
      .then((r) => setGmailConnected(r.data.connected))
      .catch(() => setGmailConnected(null));
  }, [pathname]);

  const breadcrumb = pathname
    .replace("/dashboard", "")
    .split("/")
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" / ") || "Overview";

  return (
    <CampaignProvider>
      <div className="flex h-screen bg-gray-50">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {gmailConnected === false && (
            <div className="shrink-0 bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between">
              <span className="text-amber-800 text-sm">
                ⚠️ Connect your Gmail to start sending emails.
              </span>
              <Link
                href="/dashboard/settings"
                className="text-amber-700 text-sm font-medium underline"
              >
                Connect Now →
              </Link>
            </div>
          )}
          <header className="shrink-0 border-b border-gray-200 bg-white px-6 py-4">
            <p className="text-sm text-gray-500">
              Dashboard{breadcrumb !== "Overview" ? ` / ${breadcrumb}` : ""}
            </p>
          </header>
          <main className="flex-1 overflow-y-auto p-6">
            <ErrorBoundary>
              {children}
            </ErrorBoundary>
          </main>
        </div>
      </div>
    </CampaignProvider>
  );
}
