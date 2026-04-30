"use client";

import { useEffect, useState, useCallback } from "react";
import { Download, Loader2, RefreshCw, Trash2 } from "lucide-react";
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

export default function LeadsPage() {
  const { campaigns, selectedId, setSelectedId } = useCampaigns();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [validating, setValidating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    setSelected(new Set());
    try {
      const { data } = await api.get<Lead[]>(`/campaigns/${selectedId}/leads`);
      // Client-side safety net: deduplicate by email address, keeping the first occurrence
      const unique = Array.from(new Map(data.map((l) => [l.email.toLowerCase(), l])).values());
      setLeads(unique);
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { load(); }, [load]);

  const filtered = leads.filter((l) =>
    l.email.toLowerCase().includes(search.toLowerCase()) ||
    (l.source_blog || "").toLowerCase().includes(search.toLowerCase())
  );

  function toggleAll() {
    setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map((l) => l.id)));
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
      await load();
    } finally {
      setValidating(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete ${selected.size} leads?`)) return;
    setDeleting(true);
    try {
      await api.post("/leads/bulk-delete", { ids: Array.from(selected) });
      await load();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
          <p className="text-gray-500 mt-1">Scraped email addresses from blog sources.</p>
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
            <p className="py-16 text-center text-sm text-gray-500">No leads found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-200 bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 w-10">
                      <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAll} className="rounded" />
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Source Blog</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Validated At</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Duplicate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((l) => (
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
                      <td className="px-4 py-3">
                        {l.is_duplicate
                          ? <span className="text-yellow-600 text-xs">Duplicate</span>
                          : <span className="text-gray-400 text-xs">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
