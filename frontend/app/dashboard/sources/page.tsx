"use client";

import { useEffect, useState, useCallback } from "react";
import { Download, Loader2, ExternalLink, Eye, EyeOff } from "lucide-react";
import { Pagination } from "@/components/ui/pagination";
import { getCached, setCached } from "@/lib/cache";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
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
  already_emailed: boolean;
}

interface CampaignStats {
  total_blogs_fetched: number;
  last_search_page: number;
}

type SortField = keyof Source;

function formatDate(iso: string) {
  // Append Z so the browser parses as UTC, then converts to local timezone for display
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function SourcesPage() {
  const { campaigns, selectedId, setSelectedId } = useCampaigns();
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [sortField, setSortField] = useState<SortField>("found_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  const load = useCallback(async () => {
    if (!selectedId) return;
    const key = `sources_${selectedId}_${showAll}`;
    const cached = getCached<Source[]>(key);
    if (cached) { setSources(cached); setLoading(false); }
    else setLoading(true);
    setPage(1);
    try {
      const params = showAll ? "?show_all=true" : "";
      const { data } = await api.get<Source[]>(`/campaigns/${selectedId}/sources${params}`);
      setSources(data);
      setCached(key, data);
    } catch {
      // keep cached data on network failure
    } finally {
      setLoading(false);
    }
  }, [selectedId, showAll]);

  const loadStats = useCallback(async () => {
    if (!selectedId) return;
    try {
      const { data } = await api.get<CampaignStats>(`/campaigns/${selectedId}/stats`);
      setStats(data);
    } catch { /* non-critical */ }
  }, [selectedId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadStats(); }, [loadStats]);

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
  }

  const sorted = [...sources].sort((a, b) => {
    const cmp = String(a[sortField] ?? "").localeCompare(String(b[sortField] ?? ""), undefined, { numeric: true });
    return sortDir === "asc" ? cmp : -cmp;
  });
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const SortIcon = ({ field }: { field: SortField }) => (
    <span className="ml-1 text-gray-400">
      {sortField === field ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
    </span>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Blog Sources</h1>
          <p className="text-gray-500 mt-1">Blogs discovered during research.</p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <Select
            value={selectedId?.toString() || ""}
            onChange={(e) => { setSelectedId(Number(e.target.value)); setSources([]); setStats(null); }}
            className="w-48"
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>

          {/* Filter toggle */}
          <Button
            variant={showAll ? "default" : "outline"}
            size="sm"
            onClick={() => setShowAll((v) => !v)}
            title={showAll ? "Showing all blogs (including already emailed)" : "Showing only uncontacted blogs"}
          >
            {showAll ? <Eye className="h-4 w-4 mr-1" /> : <EyeOff className="h-4 w-4 mr-1" />}
            {showAll ? "All blogs" : "Uncontacted only"}
          </Button>

          <Button
            variant="outline"
            onClick={() =>
              window.open(
                `${process.env.NEXT_PUBLIC_API_URL}/campaigns/${selectedId}/sources/export${showAll ? "?show_all=true" : ""}`,
                "_blank"
              )
            }
            disabled={!selectedId}
          >
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Pagination / fetch stats */}
      {stats && (stats.total_blogs_fetched > 0 || stats.last_search_page > 0) && (
        <div className="text-sm text-gray-500 px-1">
          Fetched so far:{" "}
          <span className="font-semibold text-gray-900">{stats.total_blogs_fetched}</span> blogs
          across{" "}
          <span className="font-semibold text-gray-900">{stats.last_search_page}</span> pages
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
            </div>
          ) : sorted.length === 0 ? (
            <p className="py-16 text-center text-sm text-gray-500">
              {showAll
                ? "No sources found. Run a campaign to discover blogs."
                : "No uncontacted blogs found. Toggle to show all blogs or run pipeline to find more."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-200 bg-gray-50">
                  <tr>
                    <th
                      className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer hover:text-gray-900"
                      onClick={() => handleSort("blog_name")}
                    >
                      Blog Name <SortIcon field="blog_name" />
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">URL</th>
                    <th
                      className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer hover:text-gray-900"
                      onClick={() => handleSort("query_string")}
                    >
                      Query Used <SortIcon field="query_string" />
                    </th>
                    <th
                      className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer hover:text-gray-900"
                      onClick={() => handleSort("email_count")}
                    >
                      Emails <SortIcon field="email_count" />
                    </th>
                    <th
                      className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer hover:text-gray-900"
                      onClick={() => handleSort("found_at")}
                    >
                      Date <SortIcon field="found_at" />
                    </th>
                    {showAll && (
                      <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paginated.map((s) => (
                    <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">{s.blog_name || "—"}</td>
                      <td className="px-4 py-3">
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-600 hover:underline flex items-center gap-1 max-w-[250px] truncate"
                        >
                          {s.url} <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      </td>
                      <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate">
                        {s.query_string || "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{s.email_count}</td>
                      <td className="px-4 py-3 text-gray-500">
                        {formatDate(s.found_at)}
                      </td>
                      {showAll && (
                        <td className="px-4 py-3">
                          {s.already_emailed ? (
                            <Badge variant="secondary">Already emailed</Badge>
                          ) : (
                            <Badge variant="success">Uncontacted</Badge>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {sorted.length > PAGE_SIZE && (
            <div className="px-4 pb-3">
              <Pagination page={page} pageSize={PAGE_SIZE} total={sorted.length} onChange={setPage} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
