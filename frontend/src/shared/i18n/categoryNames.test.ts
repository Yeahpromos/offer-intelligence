import { describe, expect, it } from "vitest";
import { categoryName } from "./categoryNames";

describe("categoryName", () => {
  it.each([
    ["Electronics", "电子"],
    ["Home & Kitchen", "家居、厨具、家装"],
    ["Sports & Outdoors", "运动户外休闲"],
    ["Patio, Lawn & Garden", "庭院、草坪和园艺"],
    ["Beauty & Personal Care", "美容和个人护理"],
    ["Health & Household", "健康和家居用品"],
    ["Kitchen & Dining", "厨房与餐饮"]
  ])("uses the sourced label for %s only in Chinese", (original, chinese) => {
    expect(categoryName(original, "zh")).toBe(chinese);
    expect(categoryName(original, "en")).toBe(original);
  });

  it("handles whole category labels, variations, custom groups and unknown values", () => {
    expect(categoryName("  HOME  &amp; Kitchen ", "zh")).toBe("家居、厨具、家装");
    expect(categoryName("Furniture & Home, Electronics", "zh")).toBe("家具与家居、电子");
    expect(categoryName("Other selected categories", "zh")).toBe("其他已选品类");
    expect(categoryName("Uncategorized", "zh")).toBe("未分类");
    expect(categoryName("New Merchant Category", "zh")).toBe("New Merchant Category");
    expect(categoryName("电子", "zh")).toBe("电子");
    expect(categoryName("Patio, Lawn & Garden, Unknown", "zh")).toBe("Patio, Lawn & Garden, Unknown");
  });
});
