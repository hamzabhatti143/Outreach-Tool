"use client";

import { useEffect, useState, useCallback } from "react";
import { Download, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { useCampaigns } from "@/lib/campaign-context";
import api from "@/lib/api";

interface Source {
  id: number;
  blog_name: string | null;
  url: string;
  query_string: string | null;
  email_count: number;
  found_at: string;
}

type SortField = keyof Source;

export default function SourcesPage() {
  const { campaigns, selectedId, setSelectedId } = useCampaigns();
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortField, setSortField] = useState<SortField>("found_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const load = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    try {
      const { data } = await api.get<Source[]>(`/campaigns/${selectedId}/sources`);
      setSources(data);
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { load(); }, [load]);

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
  }

  const sorted = [...sources].sort((a, b) => {
    const cmp = String(a[sortField] ?? "").localeCompare(String(b[sortField] ?? ""), undefined, { numeric: true });
    return sortDir === "asc" ? cmp : -cmp;
  });

  const SortIcon = ({ field }: { field: SortField }) => (
    <span className="ml-1 text-gray-400">
      {sortField === field ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
    </span>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Blog Sources</h1>
          <p className="text-gray-500 mt-1">Blogs discovered during research.</p>
        </div>
        <div className="flex gap-3">
          <Select
            value={selectedId?.toString() || ""}
            onChange={(e) => setSelectedId(Number(e.target.value))}
            className="w-48"
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <Button variant="outline" onClick={() => window.open(`${process.env.NEXT_PUBLIC_API_URL}/campaigns/${selectedId}/sources/export`, "_blank")} disabled={!selectedId}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-indigo-600" /></div>
          ) : sorted.length === 0 ? (
            <p className="py-16 text-center text-sm text-gray-500">No sources found. Run a campaign to discover blogs.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-200 bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer hover:text-gray-900" onClick={() => handleSort("blog_name")}>Blog Name <SortIcon field="blog_name" /></th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">URL</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer hover:text-gray-900" onClick={() => handleSort("query_string")}>Query Used <SortIcon field="query_string" /></th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer hover:text-gray-900" onClick={() => handleSort("email_count")}>Emails <SortIcon field="email_count" /></th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer hover:text-gray-900" onClick={() => handleSort("found_at")}>Date <SortIcon field="found_at" /></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sorted.map((s) => (
                    <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">{s.blog_name || "—"}</td>
                      <td className="px-4 py-3">
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline flex items-center gap-1 max-w-[250px] truncate">
                          {s.url} <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      </td>
                      <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate">{s.query_string || "—"}</td>
                      <td className="px-4 py-3 text-gray-700">{s.email_count}</td>
                      <td className="px-4 py-3 text-gray-500">{new Date(s.found_at).toLocaleDateString()}</td>
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
