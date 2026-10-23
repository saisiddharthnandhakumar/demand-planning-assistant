"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "./actions";

/** Runs a server action with pending, error and per-field error state. */
export function useRunAction() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function run(action: () => Promise<ActionResult>, onSuccess?: (message?: string) => void) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setError(null);
        setFieldErrors({});
        onSuccess?.(result.message);
      } else {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
      }
    });
  }

  const reset = () => {
    setError(null);
    setFieldErrors({});
  };

  return { pending, error, fieldErrors, run, reset };
}
