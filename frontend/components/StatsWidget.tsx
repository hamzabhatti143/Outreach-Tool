"use client";

import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";

interface StatsWidgetProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  color?: string;
  index?: number;
}

export default function StatsWidget({ label, value, icon: Icon, color = "text-indigo-600", index = 0 }: StatsWidgetProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
    >
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">{label}</p>
              <p className="mt-1 text-3xl font-bold text-gray-900">{value}</p>
            </div>
            <div className={`rounded-full bg-gray-100 p-3 ${color}`}>
              <Icon className="h-6 w-6" />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
