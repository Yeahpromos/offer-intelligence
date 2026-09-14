# Offer Tracker ASIN ranking / Offer 清单 ASIN 排序

Within each merchant, sum `cnpscy_amazon_order.amount` by ASIN over the
selected inclusive date range, using the same revenue source as merchant reports.
Rank positive totals descending, breaking ties by uppercase ASIN code ascending.
Then append the remaining ASINs by code, regardless of zero, negative or missing
revenue. Offer Tracker displays the first five distinct valid ASINs, or fewer
when the merchant has fewer available products.

按商家和 ASIN 汇总所选日期范围（包含起止日）内的单品营收，与商家报表使用同一营收来源。
正营收商品按营收降序排列，营收相同时按 ASIN 编码升序排列；其余商品无论营收为零、负数
或缺失，均按编码升序补齐。页面最多显示 5 个不重复的有效 ASIN，不足时显示实际数量。

Candidates come from the merchant's product catalog, product keyword ASINs and
ASINs in that merchant's orders for the selected period. An ASIN's revenue is
never shared across merchants. Full ranked lists remain in the payload for ASIN
search. No Amazon BSR or merchant-level revenue is used to rank products.

候选商品来自该商家的商品目录、商品关键词 ASIN，以及所选期间订单中的 ASIN。
同一 ASIN 在不同商家间独立计算营收。接口保留完整排序列表供搜索使用。
排序不使用亚马逊 BSR，也不将商家总营收分配给单品。

Snapshots carry `asinRankingVersion: 1`. Older snapshots are rebuilt instead of
serving the former code-only order. Before production release, regenerate the
default offers snapshot with `offers_payload(force_refresh=True)` using the
existing cache refresh workflow, so the first visitor need not pay rebuild cost.
The generated snapshot must accompany the code deployment. Custom ranges build
their rankings independently and use the existing range cache.

快照新增 `asinRankingVersion: 1` 标记，旧快照会重新生成，避免继续显示旧编码排序。
生产发布前应通过现有缓存刷新流程，以 `offers_payload(force_refresh=True)` 重新生成默认
Offer 快照，并随代码一起部署，避免首次访问承担重建耗时。自定义日期范围独立计算排序，
沿用已有日期范围缓存。
