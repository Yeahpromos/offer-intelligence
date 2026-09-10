import { apiRequest } from "../../shared/api/client";
import type {
  PerformanceReport,
  PromotionBatch,
  ReportRequest,
} from "./performanceModel";
export const loadCatalog = () =>
  apiRequest<{ batches: PromotionBatch[] }>(
    "/api/ui/db/offer-performance?action=catalog",
  );
export async function loadReport(
  request: ReportRequest,
  signal?: AbortSignal,
): Promise<PerformanceReport> {
  const query = new URLSearchParams(
    Object.entries(request).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const report = await apiRequest<PerformanceReport>(
    `/api/ui/db/offer-performance?${query}`,
    { timeoutMs: 60_000, signal },
  );
  if (!Array.isArray(report.merchants) || !report.dateRange)
    throw new Error("Invalid performance response");
  return report;
}
