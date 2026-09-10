import type { UiLanguage } from "../../shared/i18n";
import type { MediaRow, TrackedOffer } from "./performanceModel";

// Stable category identity keeps brands consistent across filtering and sorting.
const palette = [
  ["#255bd4", "#9bbcff"],
  ["#7045b3", "#c6abff"],
  ["#a62d6b", "#f3acd1"],
  ["#08756e", "#8fd5cf"],
  ["#626c20", "#cbd88b"],
  ["#036c96", "#8dd3ee"],
  ["#a14c13", "#ffc39b"],
  ["#854ba0", "#dfb3f2"],
  ["#a0353e", "#ffafb7"],
  ["#516c26", "#bcdb8f"],
  ["#496585", "#aecbec"],
  ["#795b22", "#e7cc8a"],
] as const;
const categoryKeys = [
  "home & kitchen",
  "sports & outdoors",
  "beauty & personal care",
  "health & household",
  "patio, lawn & garden",
  "electronics",
  "automotive",
  "pet supplies",
  "clothing, shoes & jewelry",
  "baby",
  "cell phones & accessories",
  "arts, crafts & sewing",
];
const aliases: Record<string, string> = {
  home: "home & kitchen",
  sports: "sports & outdoors",
  家居与厨房: "home & kitchen",
  运动与户外: "sports & outdoors",
  美妆与个护: "beauty & personal care",
  健康与家居: "health & household",
  庭院与园艺: "patio, lawn & garden",
  电子产品: "electronics",
  汽车用品: "automotive",
  宠物用品: "pet supplies",
  服装鞋履与珠宝: "clothing, shoes & jewelry",
  母婴: "baby",
};
export function categoryStyle(category = "") {
  const raw = category
    .split(/\s*[/＞>]\s*/)[0]!
    .trim()
    .toLowerCase();
  const key = aliases[raw] || raw;
  if (!key || ["uncategorized", "未分类"].includes(key))
    return { "--promotion-category-color": "light-dark(#566984, #adbed6)" };
  const known = categoryKeys.indexOf(key);
  const hash = [...key].reduce(
    (value, char) => (value * 31 + char.charCodeAt(0)) >>> 0,
    0,
  );
  const [light, dark] = palette[known < 0 ? hash % palette.length : known]!;
  return { "--promotion-category-color": `light-dark(${light}, ${dark})` };
}
export type LinkKind = "asin" | "storefront" | "unknown";
export const LINK_KINDS: readonly LinkKind[] = [
  "asin",
  "storefront",
  "unknown",
];
export const linkKind = (row: Pick<MediaRow, "asin" | "linkType">): LinkKind =>
  row.asin ? "asin" : row.linkType === "storefront" ? "storefront" : "unknown";
export function linkLabel(kind: LinkKind, language: UiLanguage) {
  return kind === "asin"
    ? language === "zh"
      ? "单品"
      : "Product"
    : kind === "storefront"
      ? "Storefront"
      : language === "zh"
        ? "未识别"
        : "Unknown";
}

export type AsinScope = "listed" | "outside" | "unspecified";
export const ASIN_SCOPES: readonly AsinScope[] = [
  "listed",
  "outside",
  "unspecified",
];
export function asinScope(
  row: MediaRow,
  offer?: TrackedOffer,
): AsinScope | null {
  if (!row.asin || !offer || row.merchantId !== offer.merchantId) return null;
  const listed = offer.asins
    .map((asin) => asin.trim().toUpperCase())
    .filter(Boolean);
  if (!listed.length) return "unspecified";
  return listed.includes(row.asin.trim().toUpperCase()) ? "listed" : "outside";
}
export function asinScopeLabel(scope: AsinScope, language: UiLanguage) {
  const labels = {
    listed: ["清单内 ASIN", "ASIN in list"],
    outside: ["同品牌 · 清单外 ASIN", "Same brand · ASIN outside list"],
    unspecified: ["清单未提供 ASIN", "No ASINs specified in list"],
  };
  return labels[scope][language === "zh" ? 0 : 1];
}
