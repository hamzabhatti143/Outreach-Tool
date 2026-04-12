"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Check, X, Edit2, Save } from "lucide-react";
import api from "@/lib/api";

interface EmailCardProps {
  email: {
    id: number;
    recipient_email: string;
    blog_name: string | null;
    subject: string;
    body: string;
    status: string;
  };
  onStatusChange?: () => void;
}

export default function EmailCard({ email, onStatusChange }: EmailCardProps) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(email.subject);
  const [body, setBody] = useState(email.body);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await api.patch(`/outreach/${email.id}/edit`, { subject, body });
      setEditing(false);
      onStatusChange?.();
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove() {
    setApproving(true);
    try {
      await api.patch(`/outreach/${email.id}/approve`);
      onStatusChange?.();
    } finally {
      setApproving(false);
    }
  }

  async function handleReject() {
    setRejecting(true);
    try {
      await api.patch(`/outreach/${email.id}/reject`);
      onStatusChange?.();
    } finally {
      setRejecting(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-500 mb-1">
                To: <span className="font-medium text-gray-700">{email.recipient_email}</span>
                {email.blog_name && (
                  <span className="ml-2 text-gray-400">· {email.blog_name}</span>
                )}
              </p>
              {editing ? (
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="text-sm font-semibold"
                />
              ) : (
                <CardTitle className="text-sm font-semibold text-gray-900 truncate">
                  {subject}
                </CardTitle>
              )}
            </div>
            <Badge variant={email.status === "approved" ? "success" : "secondary"}>
              {email.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {editing ? (
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              className="text-sm"
            />
          ) : (
            <p className="text-sm text-gray-600 whitespace-pre-wrap line-clamp-6">{body}</p>
          )}

          <div className="flex items-center gap-2 pt-2">
            {editing ? (
              <>
                <Button size="sm" onClick={handleSave} loading={saving}>
                  <Save className="h-3 w-3" /> Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" onClick={handleApprove} loading={approving}>
                  <Check className="h-3 w-3" /> Approve
                </Button>
                <Button size="sm" variant="destructive" onClick={handleReject} loading={rejecting}>
                  <X className="h-3 w-3" /> Reject
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                  <Edit2 className="h-3 w-3" /> Edit
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
