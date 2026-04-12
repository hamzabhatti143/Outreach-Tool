import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "destructive" | "warning" | "outline" | "secondary";
}

const variants = {
  default: "bg-indigo-100 text-indigo-800",
  success: "bg-green-100 text-green-800",
  destructive: "bg-red-100 text-red-800",
  warning: "bg-yellow-100 text-yellow-800",
  outline: "border border-gray-300 text-gray-700",
  secondary: "bg-gray-100 text-gray-700",
};

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

export { Badge };
