"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2 } from "lucide-react";
import BulkChecklist from "@/components/BulkChecklist";
import api from "@/lib/api";

interface OutreachEmail {
  id: number;
  recipient_email: string;
  blog_name: string | null;
  subject: string;
  status: string;
}

export default function BulkPage() {
  const [emails, setEmails] = useState<OutreachEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<OutreachEmail[]>("/outreach/approved");
      setEmails(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSend(ids: number[]) {
    setProgress({ sent: 0, total: ids.length });
    try {
      await api.post("/bulk/send", { ids });
      setProgress({ sent: ids.length, total: ids.length });
      setTimeout(() => {
        setProgress(null);
        load();
      }, 2000);
    } catch {
      setProgress(null);
    }
  }

  async function handleDelete(ids: number[]) {
    await api.post("/bulk/delete", { ids });
    await load();
  }

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-indigo-600" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Bulk Sender</h1>
        <p className="text-gray-500 mt-1">Select approved emails and send them in bulk.</p>
      </div>

      {/* Progress bar */}
      {progress && (
        <div className="rounded-lg bg-indigo-50 border border-indigo-200 p-4">
          <div className="flex justify-between text-sm text-indigo-700 mb-2">
            <span>Sending emails...</span>
            <span>{progress.sent}/{progress.total}</span>
          </div>
          <div className="h-2 bg-indigo-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-600 rounded-full transition-all duration-500"
              style={{ width: `${(progress.sent / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      <BulkChecklist items={emails} onSend={handleSend} onDelete={handleDelete} />
    </div>
  );
}
