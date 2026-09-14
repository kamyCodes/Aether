/**
 * Shared date/time formatting (audit Section 7). Every user-visible date in
 * the app goes through these helpers so formatting automatically follows the
 * user's locale and timezone via Intl — no hardcoded patterns.
 */
export function formatDateTime(ts: number | Date): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(ts);
}

export function formatDate(ts: number | Date): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(ts);
}

export function formatTime(ts: number | Date): string {
  return new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(ts);
}
