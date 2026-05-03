"use client";

import { useEffect, useState, useCallback } from "react";
import { Download, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Pagination } from "@/components/ui/pagination";
import { getCached, setCached } from "@/lib/cache";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import ValidationBadge from "@/components/ValidationBadge";
import { useCampaigns } from "@/lib/campaign-context";
import api from "@/lib/api";

interface Lead {
  id: number;
  email: string;
  source_blog: string | null;
  validity_status: string;
  validated_at: string | null;
  is_duplicate: boolean;
}

interface LeadCounts {
  all: number;
  new: number;
  contacted: number;
  invalid: number;
}

type Tab = "all" | "new" | "contacted" | "invalid";

const TABS: { id: Tab; label: string; countKey: keyof LeadCounts }[] = [
  { id: "all",       label: "All",       countKey: "all" },
  { id: "new",       label: "New",       countKey: "new" },
  { id: "contacted", label: "Contacted", countKey: "contacted" },
  { id: "invalid",   label: "Invalid",   countKey: "invalid" },
];

export default function LeadsPage() {
  const { campaigns, selectedId, setSelectedId } = useCampaigns();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [counts, setCounts] = useState<LeadCounts | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [validating, setValidating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  const load = useCallback(async (tab: Tab) => {
    if (!selectedId) return;
    const key = `leads_${selectedId}_${tab}`;
    const cached = getCached<Lead[]>(key);
    if (cached) { setLeads(cached); setLoading(false); }
    else setLoading(true);
    setSelected(new Set());
    try {
      const params = tab !== "all" ? `?tab=${tab}` : "";
      const { data } = await api.get<Lead[]>(`/campaigns/${selectedId}/leads${params}`);
      const unique = Array.from(new Map(data.map((l) => [l.email.toLowerCase(), l])).values());
      setLeads(unique);
      setCached(key, unique);
    } catch {
      // silently keep cached data if fetch fails
    } finally {
      setLoading(false);
    }
    api.get<LeadCounts>(`/campaigns/${selectedId}/leads/counts`)
      .then((r) => setCounts(r.data))
      .catch(() => {});
  }, [selectedId]);

  useEffect(() => {
    setActiveTab("all");
    setCounts(null);
    setPage(1);
    load("all");
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  function switchTab(tab: Tab) {
    setActiveTab(tab);
    setPage(1);
    load(tab);
  }

  const filtered = leads.filter((l) =>
    l.email.toLowerCase().includes(search.toLowerCase()) ||
    (l.source_blog || "").toLowerCase().includes(search.toLowerCase())
  );
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleAll() {
    setSelected(selected.size === paginated.length ? new Set() : new Set(paginated.map((l) => l.id)));
  }

  function toggle(id: number) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }

  async function handleValidate() {
    setValidating(true);
    try {
      await api.post("/leads/validate", { ids: Array.from(selected) });
      await load(activeTab);
    } catch { /* ignore */ } finally {
      setValidating(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete ${selected.size} leads?`)) return;
    setDeleting(true);
    try {
      await api.post("/leads/bulk-delete", { ids: Array.from(selected) });
      await load(activeTab);
    } catch { /* ignore */ } finally {
      setDeleting(false);
    }
  }

  const newCount = counts?.new ?? 0;
  const contactedCount = counts?.contacted ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
          <p className="text-gray-500 mt-1">
            Scraped email addresses from blog sources.
            {counts && (
              <span className="ml-2 text-sm text-indigo-600 font-medium">
                {newCount} new · {contactedCount} contacted
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={selectedId?.toString() || ""} onChange={(e) => setSelectedId(Number(e.target.value))} className="w-48">
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Button variant="outline" onClick={() => window.open(`${process.env.NEXT_PUBLIC_API_URL}/leads/export/${selectedId}`, "_blank")} disabled={!selectedId}>
            <Download className="h-4 w-4" /> Export
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => switchTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            {tab.label}
            {counts !== null && (
              <span className={`ml-1.5 text-xs rounded-full px-1.5 py-0.5 ${
                activeTab === tab.id ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-500"
              }`}>
                {counts[tab.countKey]}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Input placeholder="Search emails or blogs..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        {selected.size > 0 && (
          <>
            <Button size="sm" variant="outline" onClick={handleValidate} loading={validating}>
              <RefreshCw className="h-3 w-3" /> Re-validate ({selected.size})
            </Button>
            <Button size="sm" variant="destructive" onClick={handleDelete} loading={deleting}>
              <Trash2 className="h-3 w-3" /> Delete ({selected.size})
            </Button>
          </>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-indigo-600" /></div>
          ) : filtered.length === 0 ? (
            <p className="py-16 text-center text-sm text-gray-500">
              {activeTab === "new" ? "No new leads found." :
               activeTab === "contacted" ? "No contacted leads yet." :
               activeTab === "invalid" ? "No invalid leads." :
               "No leads found."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-200 bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 w-10">
                      <input type="checkbox" checked={paginated.length > 0 && selected.size === paginated.length} onChange={toggleAll} className="rounded" />
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Source Blog</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Validated At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paginated.map((l) => (
                    <tr key={l.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} className="rounded" />
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">{l.email}</td>
                      <td className="px-4 py-3 text-gray-500">{l.source_blog || "—"}</td>
                      <td className="px-4 py-3"><ValidationBadge status={l.validity_status} /></td>
                      <td className="px-4 py-3 text-gray-500">
                        {l.validated_at ? new Date(l.validated_at).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {filtered.length > PAGE_SIZE && (
            <div className="px-4 pb-3">
              <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
