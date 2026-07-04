// Display formatting shared by dashboard pages.

export function formatMoney(
  amount: string | null,
  currency: string | null,
): string {
  if (amount === null) return "—";
  const value = Number(amount);
  if (!Number.isFinite(value)) return amount;
  return new Intl.NumberFormat("en-US", {
    style: currency ? "currency" : "decimal",
    currency: currency ?? undefined,
    minimumFractionDigits: 2,
  }).format(value);
}

export function formatDate(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC", // invoice dates are calendar dates, not moments
  }).format(date);
}

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
