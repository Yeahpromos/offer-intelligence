import type { UiLanguage } from "../../shared/i18n";

// Presentation labels only. Raw keys and values remain stable for sorting and export.
const headers: Readonly<Record<string, string>> = {
  "merchant id": "商家 ID", "merchant name": "商家名称", brand: "品牌", network: "联盟", agency: "代理商",
  "all commission": "总佣金率", "aff commission": "联盟佣金率", "commission rate": "佣金率",
  "order count": "订单数量", orders: "订单数量", revenue: "销售额", clicks: "点击量", "total clicks": "总点击量",
  "backend epc": "后台 EPC", "epc(all)": "总 EPC", "epc(aff)": "联盟 EPC", "all epc": "总 EPC", "aff epc": "联盟 EPC",
  aov: "客单价", "aov type": "客单价类型", "aov method": "客单价计算方式", "aov source": "客单价来源",
  "aov sample products": "客单价样本商品", "aov currency": "客单价币种", "aov source date": "客单价来源日期", "aov source file": "客单价来源文件",
  conversion: "转化率", "conversion rate": "转化率", cvr: "转化率", dpv: "详情页浏览量", atc: "加购量",
  color: "状态颜色", "visual status code": "状态代码", "visual status reason": "状态原因", "visual status source": "状态来源",
  category: "品类", country: "国家", "tier reason": "分层原因", recommendation: "建议", phase: "阶段",
  "publisher count": "媒体数量", "success rate": "成功率", "publisher count june": "6月媒体数量", "success rate june": "6月成功率",
  "payment cycle": "付款周期", "completion rate": "完成率", "recommended link": "推荐链接", "best sub category bsr": "最佳子品类 BSR",
  "has discount": "是否有折扣", "discount info": "折扣信息", "deal info": "优惠信息", cpc: "单次点击成本",
  "backend match status": "后台匹配状态", timeline: "时间线", payout: "佣金支出", "affiliate payout": "联盟佣金支出"
};

const categories: Readonly<Record<string, string>> = {
  "Appliances": "家用电器", "Arts, Crafts & Sewing": "艺术、手工与缝纫", "Automotive": "汽车用品", "Automotive & Outdoor Gear": "汽车与户外装备",
  "Baby": "母婴用品", "Baby Products": "母婴用品", "Beauty & Personal Care": "美容与个人护理", "Books": "图书",
  "Canned & Jarred Vegetables": "罐装蔬菜", "Cell Phones & Accessories": "手机及配件", "Clothing, Shoes & Jewelry": "服装、鞋靴与珠宝",
  "Computers & Accessories": "电脑及配件", "Electronics": "电子产品", "Electronics & Photo": "电子与摄影", "Furniture & Home": "家具与家居",
  "Furniture & Home, Electronics": "家具、家居与电子产品", "Garden": "园艺", "Grocery & Gourmet Food": "食品与美食", "Handmade Products": "手工制品",
  "Health & Household": "健康与家居日用", "Health & Personal Care": "健康与个人护理", "Home & Kitchen": "家居与厨房", "Home Security & Locks": "家居安防与门锁",
  "Industrial & Scientific": "工业与科研用品", "Jewelry": "珠宝首饰", "Kitchen & Dining": "厨房与餐饮", "Multi-category Retail": "综合零售",
  "Musical Instruments": "乐器", "Office Products": "办公用品", "Patio, Lawn & Garden": "庭院、草坪与园艺", "Pet Supplies": "宠物用品",
  "Pet Supplies & Toys": "宠物用品与玩具", "Sports & Outdoors": "运动与户外", "Stationery & Office Supplies": "文具与办公用品",
  "Surveillance DVR Kits": "监控录像套装", "Tools & Home Improvement": "工具与家装", "Toys & Games": "玩具与游戏", "Uncategorized": "未分类", "Video Games": "电子游戏"
};

export function tierHeaderLabel(language: UiLanguage, header: string): string {
  if (language !== "zh") return header;
  const normalized = header.trim().toLowerCase();
  if (headers[normalized]) return headers[normalized];
  const monthly = /^(january|february|march|april|may|june|july|august|september|october|november|december) (revenue|clicks|orders)$/.exec(normalized);
  if (!monthly) return header;
  const month = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].indexOf(monthly[1]!) + 1;
  return `${month}月${headers[monthly[2]!]}`;
}

export function tierCategoryLabel(language: UiLanguage, category: string): string {
  return language === "zh" ? categories[category] ?? category : category;
}

export function tierStatusLabel(language: UiLanguage, status: string): string {
  if (status.startsWith("Could not load shared tier moves;")) return language === "zh"
    ? "共享分层记录暂不可用，当前显示本地记录。" : "Shared tier history is unavailable. Showing local records.";
  if (language !== "zh") return status;
  const messages: Record<string, string> = {
    "Manual tier moves reset": "已重置手动分层记录",
    "Enter at least 2 characters or a full merchant ID.": "请输入至少 2 个字符或完整的商家 ID。",
    "Searching the YeahPromos database...": "正在查找商家…",
    "No active merchants matched that ID or name.": "未找到与该 ID 或名称匹配的有效商家。",
    "Saving the Tier 1 assignment...": "正在保存 Tier 1 分层…",
    "Tier 1 assignment saved.": "已保存 Tier 1 分层。",
    "Request failed.": "请求失败，请稍后重试。"
  };
  const matches = /^([\d,]+) matches found\.$/.exec(status);
  if (matches) return `找到 ${matches[1]} 个匹配商家。`;
  const moved = /^Moved ([\d,]+) to (.+)$/.exec(status);
  if (moved) return `已将 ${moved[1]} 个商家移至 ${moved[2] === "BLACK TIER" ? "黑名单" : moved[2]}`;
  return messages[status] ?? status;
}
