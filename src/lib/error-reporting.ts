/**
 * Minimal client-side error reporting hook for Vanilla Chess.
 * Logs React error-boundary failures to the console; swap in your own
 * telemetry service here if you need remote reporting.
 */
export function reportError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;

  const message =
    error instanceof Response
      ? `Response ${error.status}${error.url ? ` at ${error.url}` : ""}`
      : error instanceof Error
        ? error.message
        : String(error);

  console.error("[vanilla-chess] error", {
    message,
    stack: error instanceof Error ? error.stack : undefined,
    route: window.location.pathname,
    ...context,
  });
}
