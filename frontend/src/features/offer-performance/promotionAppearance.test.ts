import { describe, expect, it } from "vitest";
import { categoryStyle, linkKind } from "./promotionAppearance";
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
});
