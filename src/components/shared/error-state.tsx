import { AlertTriangle } from "lucide-react";

export function ErrorState({ title = "Something went wrong", message }: { title?: string; message?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive-surface p-4 text-sm" role="alert">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="space-y-1">
        <p className="font-medium text-destructive">{title}</p>
        {message ? <p className="text-muted-foreground">{message}</p> : null}
      </div>
    </div>
  );
}
