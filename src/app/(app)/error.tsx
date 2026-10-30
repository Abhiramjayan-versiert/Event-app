"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/shared/error-state";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-lg space-y-4 py-16">
      <ErrorState title="This page failed to load" message={error.digest ? `Reference: ${error.digest}` : "Please try again. If the problem persists, contact your administrator."} />
      <Button onClick={reset} variant="outline">Try again</Button>
    </div>
  );
}
