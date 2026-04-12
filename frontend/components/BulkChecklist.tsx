"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckSquare, Square, Send, Trash2 } from "lucide-react";

interface BulkItem {
  id: number;
  recipient_email: string;
  blog_name: string | null;
  subject: string;
}

interface BulkChecklistProps {
  items: BulkItem[];
  onSend: (ids: number[]) => Promise<void>;
  onDelete: (ids: number[]) => Promise<void>;
}

export default function BulkChecklist({ items, onSend, onDelete }: BulkChecklistProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function toggleAll() {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((i) => i.id)));
    }
  }

  function toggleItem(id: number) {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
  }

  async function handleSend() {
    setSending(true);
    try {
      await onSend(Array.from(selected));
      setSelected(new Set());
    } finally {
      setSending(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete(Array.from(selected));
      setSelected(new Set());
    } finally {
      setDeleting(false);
    }
  }

  const allSelected = items.length > 0 && selected.size === items.length;

  return (
    <div className="space-y-3">
      {/* Action bar */}
      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="flex items-center gap-3">
          <button onClick={toggleAll} className="text-gray-500 hover:text-indigo-600 transition-colors">
            {allSelected ? <CheckSquare className="h-5 w-5 text-indigo-600" /> : <Square className="h-5 w-5" />}
          </button>
          <span className="text-sm text-gray-600">
            {selected.size > 0 ? `${selected.size} selected` : "Select all"}
          </span>
        </div>
        {selected.size > 0 && (
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSend} loading={sending}>
              <Send className="h-3 w-3" /> Send Selected
            </Button>
            <Button size="sm" variant="destructive" onClick={handleDelete} loading={deleting}>
              <Trash2 className="h-3 w-3" /> Delete Selected
            </Button>
          </div>
        )}
      </div>

      {/* List */}
      <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white overflow-hidden">
        {items.length === 0 && (
          <p className="py-12 text-center text-sm text-gray-500">No approved emails to send.</p>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            className={`flex items-center gap-3 p-4 hover:bg-gray-50 cursor-pointer transition-colors ${
              selected.has(item.id) ? "bg-indigo-50" : ""
            }`}
            onClick={() => toggleItem(item.id)}
          >
            <button className="shrink-0 text-gray-400 hover:text-indigo-600">
              {selected.has(item.id) ? (
                <CheckSquare className="h-5 w-5 text-indigo-600" />
              ) : (
                <Square className="h-5 w-5" />
              )}
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900 truncate">{item.recipient_email}</p>
              <p className="text-xs text-gray-500 truncate">
                {item.blog_name && `${item.blog_name} · `}{item.subject}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
