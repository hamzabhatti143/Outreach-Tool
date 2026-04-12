import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, AlertCircle } from "lucide-react";

interface ValidationBadgeProps {
  status: "valid" | "invalid" | "unverified" | string;
}

export default function ValidationBadge({ status }: ValidationBadgeProps) {
  if (status === "valid") {
    return (
      <Badge variant="success" className="gap-1">
        <CheckCircle className="h-3 w-3" />
        Valid
      </Badge>
    );
  }
  if (status === "invalid") {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" />
        Invalid
      </Badge>
    );
  }
  return (
    <Badge variant="warning" className="gap-1">
      <AlertCircle className="h-3 w-3" />
      Unverified
    </Badge>
  );
}
