"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  const [isEditing, setIsEditing] = useState(false);
  const [editedSubject, setEditedSubject] = useState(email.subject);
  const [editedBody, setEditedBody] = useState(email.body);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea as content changes
  useEffect(() => {
    if (textareaRef.current && isEditing) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [editedBody, isEditing]);

  function enterEdit() {
    setEditedSubject(email.subject);
    setEditedBody(email.body);
    setIsEditing(true);
  }

  function cancelEdit() {
    setEditedSubject(email.subject);
    setEditedBody(email.body);
    setIsEditing(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.patch(`/outreach/${email.id}/edit`, { subject: editedSubject, body: editedBody });
      setIsEditing(false);
      setToast("Email updated successfully");
      setTimeout(() => setToast(null), 3000);
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
      className="relative"
    >
      {/* Success toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="absolute top-2 right-2 z-10 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white shadow-md"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

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
              {isEditing ? (
                <Input
                  value={editedSubject}
                  onChange={(e) => setEditedSubject(e.target.value)}
                  className="text-sm font-semibold ring-2 ring-blue-500 focus:ring-blue-500"
                />
              ) : (
                <CardTitle className="text-sm font-semibold text-gray-900 truncate">
                  {email.subject}
                </CardTitle>
              )}
            </div>
            <Badge variant={email.status === "approved" ? "success" : "secondary"}>
              {email.status}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {isEditing ? (
            <>
              <Textarea
                ref={textareaRef}
                value={editedBody}
                onChange={(e) => setEditedBody(e.target.value)}
                rows={6}
                className="text-sm ring-2 ring-blue-500 focus:ring-blue-500 resize-none overflow-hidden"
              />
              <p className="text-xs font-medium text-amber-600">(unsaved changes)</p>
            </>
          ) : (
            <p className="text-sm text-gray-600 whitespace-pre-wrap line-clamp-6">{email.body}</p>
          )}

          <div className="flex items-center gap-2 pt-2">
            {isEditing ? (
              <>
                <Button size="sm" onClick={handleSave} loading={saving}>
                  <Save className="h-3 w-3" /> Save
                </Button>
                <Button size="sm" variant="ghost" onClick={cancelEdit}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  onClick={handleApprove}
                  loading={approving}
                  disabled={isEditing}
                >
                  <Check className="h-3 w-3" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleReject}
                  loading={rejecting}
                  disabled={isEditing}
                >
                  <X className="h-3 w-3" /> Reject
                </Button>
                <Button size="sm" variant="ghost" onClick={enterEdit}>
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
