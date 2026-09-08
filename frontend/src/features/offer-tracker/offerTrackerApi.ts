import { apiRequest } from "../../shared/api/client";
import type { OfferRecord, OfferTrackerDateRange } from "../../shared/contracts/offer";

export async function loadOfferTrackerRange(range: OfferTrackerDateRange): Promise<readonly OfferRecord[]> {
  const query = new URLSearchParams({
    start_date: range.startDate,
    end_date: range.endDate
  });
  // Range queries aggregate live metrics and can outlast the general 10s timeout.
  const payload = await apiRequest<{ readonly offers?: unknown }>(
    `/api/ui/db/offers?${query.toString()}`,
    { timeoutMs: 60_000 }
  );
  if (!payload || !Array.isArray(payload.offers)) {
    throw new Error("Offer Tracker API 响应缺少 offers");
  }
  return payload.offers.filter((row): row is OfferRecord => (
    typeof row === "object" && row !== null && !Array.isArray(row)
  ));
}
