"use client";

import { useEffect } from "react";
import type { FieldValues, Path, PathValue, UseFormReturn } from "react-hook-form";
import { isIsoTimestamp, toLocalInput } from "./datetime";

/**
 * Server pages pass stored ISO timestamps; this converts them to the browser's
 * local time for datetime-local inputs once the form is in the browser.
 */
export function useLocalDateTimeFields<T extends FieldValues>(form: UseFormReturn<T>, fields: Path<T>[]) {
  useEffect(() => {
    for (const f of fields) {
      const v = form.getValues(f);
      if (isIsoTimestamp(v)) form.setValue(f, toLocalInput(v) as PathValue<T, Path<T>>, { shouldDirty: false });
    }
    // Run once on mount with the initial defaults.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
