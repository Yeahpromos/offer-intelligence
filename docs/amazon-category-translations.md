# Amazon category display names / 亚马逊品类显示名称

Verified on 2026-09-11. This dictionary is used by the Category Report in Chinese mode, including records, full view, charts, previews and search. Source category strings remain the identity used for aggregation, sorting, colors, drill-down and export.

核对日期：2026-09-11。词典用于中文模式的品类报表，包括记录、全图、图表、预览和搜索。原始品类字符串继续用于聚合、排序、配色、下钻与导出。

## Official sources / 官方来源

- [Amazon Business Product Search API categories](https://docs.business.amazon.com/docs/product-search-api-categories): match US `en_US` and `zh_CN` entries by node ID. Regional English aliases do not change a node's identity. The API deliberately uses labels such as `电子`, `时尚`, and `家居、厨具、家装`; do not silently substitute an assumed translation.
- [Amazon Business 官方类目文档](https://docs.business.amazon.com/docs/product-search-api-categories)：按节点 ID 对照 US 的 `en_US` 与 `zh_CN`；英文地区别名不改变节点含义。沿用文档中的“电子”“时尚”“家居、厨具、家装”等中文名称，避免凭印象替换。

| Source category / 原始品类 | Chinese / 中文 | Node / 节点 |
| --- | --- | --- |
| Appliances | 大家电 | 2619525011 |
| Arts, Crafts & Sewing | 艺术品、工艺品和缝纫用品 | 2617941011 |
| Automotive | 汽车用品 | 15684181 |
| Baby | 婴儿用品 | 165796011 |
| Beauty & Personal Care | 美容和个人护理 | 3760911 |
| Books | 图书 | 283155 |
| Cell Phones & Accessories | 手机和配件 | 2335752011 |
| Clothing, Shoes & Jewelry | 时尚 | 7141123011 |
| Electronics | 电子 | 172282 |
| Grocery & Gourmet Food | 各色美食 | 16310101 |
| Handmade Products (Handmade alias) | 手工制品 | 11260432011 |
| Health & Household | 健康和家居用品 | 3760901 |
| Home & Kitchen | 家居、厨具、家装 | 1055398 |
| Industrial & Scientific | 工业与科研用品 | 16310091 |
| Musical Instruments | 乐器 | 11091801 |
| Office Products | 办公用品 | 1064954 |
| Patio, Lawn & Garden | 庭院、草坪和园艺 | 2972638011 |
| Pet Supplies | 宠物用品 | 2619533011 |
| Sports & Outdoors | 运动户外休闲 | 3375251 |
| Tools & Home Improvement | 家居装修 | 228013 |
| Toys & Games | 玩具和游戏 | 165793011 |
| Video Games | 视频游戏 | 468642 |

- `Health & Personal Care` → `个护健康`: the same official API document's JP `en_US` / `zh_CN` node `160384011`.
- `Health & Personal Care` → `个护健康`：同一官方文档 JP 的 `en_US` / `zh_CN` 节点 `160384011`。
- `Kitchen & Dining` → `厨房与餐饮`: [Amazon Global Selling article](https://gs.amazon.cn/zhishi/article-260407-3), bilingual category table available in the search index on the verification date. Direct access redirected to the homepage; this source is less durable than the API node table above.
- `Kitchen & Dining` → `厨房与餐饮`：[亚马逊全球开店文章](https://gs.amazon.cn/zhishi/article-260407-3)的中英类目表，核对时搜索索引仍有内容，直接访问则跳转首页；此来源稳定性弱于上方 API 节点表。

## Supplemental labels / 补充译名

The following regional aliases, custom groups and subcategories were not verified as exact official Chinese node labels. They use editorial translations, kept separate in code. The [official UK locale reference](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/locale-reference/united-kingdom) confirms regional English names, not their Chinese translations.

下列地区别名、自定义组合和细分类目未核实到完全对应的官方中文节点名，使用补充译名，并在代码中单独存放。[官方英国站文档](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/locale-reference/united-kingdom)仅用于确认地区英文名称，不作为其中文译名的证明。

| Original / 原文 | Display / 显示 |
| --- | --- |
| Automotive & Outdoor Gear | 汽车用品与户外装备 |
| Baby Products | 婴儿用品 |
| Canned & Jarred Vegetables | 罐装与瓶装蔬菜 |
| Computers & Accessories | 电脑与配件 |
| Electronics & Photo | 电子与摄影 |
| Furniture & Home | 家具与家居 |
| Furniture & Home, Electronics | 家具与家居、电子 |
| Garden | 园艺 |
| Home Security & Locks | 家居安防与锁具 |
| Jewelry | 珠宝首饰 |
| Multi-category Retail | 多品类零售 |
| Pet Supplies & Toys | 宠物用品与玩具 |
| Stationery & Office Supplies | 文具与办公用品 |
| Surveillance DVR Kits | 监控录像机套装 |
| Uncategorized | 未分类 |
| Other selected categories | 其他已选品类 |

Unknown categories retain their source text. Matching tolerates case, whitespace and `&amp;`, but never splits comma-containing category names or merges groups with the same translation. Duplicate Chinese search labels include their original names to keep selection unambiguous. Both English and Chinese searches resolve back to original entries.

未知品类保留原文。匹配兼容大小写、空格与 `&amp;`，不会按逗号拆分品类，也不会合并中文同名分组。同名中文搜索项附带原文以避免歧义，中英文搜索均定位到原始记录。
