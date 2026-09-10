import { describe, expect, it } from "vitest";
import { categoryStyle, linkKind, asinScope } from "./promotionAppearance";
import { emptyMetrics, type MediaRow } from "./performanceModel";
describe("promotion visual identities", () => {
  it("uses the same stable parent category color across brand views, subcategories and aliases", () => {
    expect(categoryStyle("Home & Kitchen / Vacuums")).toEqual(
      categoryStyle("Home & Kitchen"),
    );
    expect(categoryStyle("家居与厨房")).toEqual(
      categoryStyle("Home & Kitchen"),
    );
    expect(categoryStyle("Home")).not.toEqual(categoryStyle("Sports"));
    expect(categoryStyle("")).toEqual(categoryStyle("未分类"));
  });
  it("does not recolor purchased-only evidence as a promoted product", () => {
    expect(linkKind({ asin: "", linkType: "unknown" })).toBe("unknown");
    expect(linkKind({ asin: "B012345678", linkType: "asin" })).toBe("asin");
    expect(linkKind({ asin: "", linkType: "storefront" })).toBe("storefront");
  });
  it("classifies only promoted ASINs against the exact merchant list", () => {
    const offer = {
      merchantId: "101",
      merchantName: "Brand",
      category: "",
      asins: ["B012345678"],
    };
    const row: MediaRow = {
      merchantId: "101",
      publisherId: "7",
      publisherName: "Publisher",
      asin: " b012345678 ",
      linkType: "asin",
      purchasedAsin: "",
      before: emptyMetrics(),
      after: emptyMetrics(),
    };
    expect(asinScope(row, offer)).toBe("listed");
    expect(asinScope({ ...row, asin: "B000000001" }, offer)).toBe("outside");
    expect(asinScope(row, { ...offer, asins: [] })).toBe("unspecified");
    expect(
      asinScope(
        { ...row, asin: "", purchasedAsin: "B012345678", linkType: "unknown" },
        offer,
      ),
    ).toBeNull();
    expect(asinScope({ ...row, merchantId: "1101" }, offer)).toBeNull();
  });
});
