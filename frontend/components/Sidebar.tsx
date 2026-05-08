"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Megaphone,
  Globe,
  Users,
  Mail,
  Send,
  Inbox,
  MessageSquare,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Zap,
  BookOpen,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { clearTokens, isAuthenticated } from "@/lib/auth";
import api from "@/lib/api";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/dashboard/sources", label: "Sources", icon: Globe },
  { href: "/dashboard/leads", label: "Leads", icon: Users },
  { href: "/dashboard/outreach", label: "Outreach", icon: Mail },
  { href: "/dashboard/bulk", label: "Bulk Send", icon: Send },
  { href: "/dashboard/sent", label: "Sent", icon: Inbox },
  { href: "/dashboard/replies", label: "Replies", icon: MessageSquare },
  { href: "/dashboard/templates", label: "Templates", icon: FileText },
  { href: "/dashboard/gmail-setup", label: "Gmail Setup", icon: BookOpen },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [highPriorityCount, setHighPriorityCount] = useState(0);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated()) return;
    api
      .get<{ total: number; high_priority_pending: number }>("/replies/stats")
      .then(({ data }) => {
        setHighPriorityCount(data.high_priority_pending ?? 0);
      })
      .catch(() => {});
  }, [pathname]); // refresh badge whenever route changes

  function handleLogout() {
    clearTokens();
    router.push("/login");
  }

  return (
    <aside
      className={cn(
        "flex flex-col h-screen bg-gray-900 text-white transition-all duration-300 shrink-0",
        collapsed ? "w-16" : "w-56"
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-5 border-b border-gray-800">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 shrink-0">
          <Zap className="h-4 w-4 text-white" />
        </div>
        {!collapsed && (
          <span className="font-bold text-sm tracking-tight">OutreachAI</span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 space-y-1 px-2 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === "/dashboard" ? pathname === href : pathname.startsWith(href);
          const isReplies = href === "/dashboard/replies";

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-indigo-600 text-white"
                  : "text-gray-400 hover:bg-gray-800 hover:text-white"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1">{label}</span>
                  {isReplies && highPriorityCount > 0 && (
                    <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white leading-none">
                      {highPriorityCount}
                    </span>
                  )}
                </>
              )}
              {collapsed && isReplies && highPriorityCount > 0 && (
                <span className="absolute left-9 top-1 h-2 w-2 rounded-full bg-amber-500" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="border-t border-gray-800 p-2 space-y-1">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Logout</span>}
        </button>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex w-full items-center justify-center rounded-lg py-2 text-gray-500 hover:text-gray-300 transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  );
}
