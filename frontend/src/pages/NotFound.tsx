import { Link } from "react-router-dom";
import { EmptyState } from "@/components/ui";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <EmptyState icon={<Compass className="h-5 w-5" />} title="Page not found" action={<Link to="/app" className="btn-primary">Go to dashboard</Link>}>
        The page you're looking for doesn't exist or has moved.
      </EmptyState>
    </div>
  );
}
