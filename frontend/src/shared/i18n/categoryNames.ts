import type { UiLanguage } from "./index";

// Display labels only. Never use these translations as grouping, color, or API keys.
// Official US en_US / zh_CN node pairs and supplemental provenance:
// docs/amazon-category-translations.md
const officialNames: Readonly<Record<string, string>> = {
  "Appliances": "大家电",
  "Arts, Crafts & Sewing": "艺术品、工艺品和缝纫用品",
  "Automotive": "汽车用品",
  "Baby": "婴儿用品",
  "Beauty & Personal Care": "美容和个人护理",
  "Books": "图书",
  "Cell Phones & Accessories": "手机和配件",
  "Clothing, Shoes & Jewelry": "时尚",
  "Electronics": "电子",
  "Grocery & Gourmet Food": "各色美食",
  "Handmade Products": "手工制品",
  "Health & Household": "健康和家居用品",
  "Home & Kitchen": "家居、厨具、家装",
  "Industrial & Scientific": "工业与科研用品",
  "Musical Instruments": "乐器",
  "Office Products": "办公用品",
  "Patio, Lawn & Garden": "庭院、草坪和园艺",
  "Pet Supplies": "宠物用品",
  "Sports & Outdoors": "运动户外休闲",
  "Tools & Home Improvement": "家居装修",
  "Toys & Games": "玩具和游戏",
  "Video Games": "视频游戏",
  "Health & Personal Care": "个护健康",
  "Kitchen & Dining": "厨房与餐饮"
};

// Regional aliases, custom groups and subcategories are editorial translations,
// not claimed to be official Amazon browse-node translations.
const supplementalNames: Readonly<Record<string, string>> = {
  "Automotive & Outdoor Gear": "汽车用品与户外装备",
  "Baby Products": "婴儿用品",
  "Canned & Jarred Vegetables": "罐装与瓶装蔬菜",
  "Computers & Accessories": "电脑与配件",
  "Electronics & Photo": "电子与摄影",
  "Furniture & Home": "家具与家居",
  "Furniture & Home, Electronics": "家具与家居、电子",
  "Garden": "园艺",
  "Home Security & Locks": "家居安防与锁具",
  "Jewelry": "珠宝首饰",
  "Multi-category Retail": "多品类零售",
  "Pet Supplies & Toys": "宠物用品与玩具",
  "Stationery & Office Supplies": "文具与办公用品",
  "Surveillance DVR Kits": "监控录像机套装",
  "Uncategorized": "未分类",
  "Other selected categories": "其他已选品类"
};

function normalizedName(value: string): string {
  return value.trim().replace(/&amp;/gi, "&").replace(/\s+/g, " ").toLowerCase();
}

const chineseNames = new Map(Object.entries({ ...officialNames, ...supplementalNames })
  .map(([name, label]) => [normalizedName(name), label]));

export function categoryName(value: string, language: UiLanguage): string {
  if (language !== "zh") return value;
  return chineseNames.get(normalizedName(value)) ?? value;
}
