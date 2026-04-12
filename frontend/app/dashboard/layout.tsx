"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { isAuthenticated } from "@/lib/auth";
import { CampaignProvider } from "@/lib/campaign-context";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isAuthenticated()) router.push("/login");
  }, [router]);

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
          <header className="shrink-0 border-b border-gray-200 bg-white px-6 py-4">
            <p className="text-sm text-gray-500">
              Dashboard{breadcrumb !== "Overview" ? ` / ${breadcrumb}` : ""}
            </p>
          </header>
          <main className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </CampaignProvider>
  );
}
