# Tier 4 revenue promotion / Tier 4 营收晋级

The daily cache workflow, after payment/table synchronization, promotes merchants
whose current database assignment is Tier 4 and whose Amazon revenue totals more
than zero over the last 30 calendar days, including today in Asia/Shanghai.
For 2026-09-14 this is 2026-08-16 through 2026-09-14, inclusive.

每日数据同步后的缓存工作流，检查数据库中仍为 Tier 4 的商家；过去 30 天（含北京时间当天）
累计 Amazon 营收大于 0 的，自动晋级至 Tier 3。例如 2026-09-14 的范围为 08-16 至 09-14，
包含起止日。按 `cnpscy_amazon_order.amount` 汇总，退款等负数参与净额计算。

`scripts/promote_revenue_tier4.py` previews by default; `--apply` performs the
transaction. Assignment updates and `cnpscy_oi_tier_move_history` inserts commit
together. Row locks recheck Tier 4 before every move. There is no automatic
downgrade and no change to Tier 1, Tier 2, Tier 3 or BLACK TIER. An operator who
later puts a qualifying merchant back in Tier 4 can see it promoted on the next run.

脚本默认预览，`--apply` 执行数据库事务。层级更新与迁移历史在同一事务提交，写入失败全部
回滚；更新前加行锁并重新确认仍为 Tier 4。不自动降级，不修改其他层级。若之后人工将仍满足
条件的商家移回 Tier 4，下次运行会再次晋级。

Audit source: `revenue_30d_tier4_to_tier3`; actor: `automation:revenue-30d`.
History records retain source/target tier and UTC time. Workflow artifacts retain
the observation dates, merchant revenues and event IDs. Snapshots rebuild after
the database update. Manual cache runs operate on their explicitly selected branch;
scheduled runs continue updating `main`.

迁移历史可按上述 source 查询，记录原层级、目标层级、UTC 时间与执行者；工作流产物保存日期
范围、商家营收及迁移事件 ID。更新后重新生成快照。手动缓存任务更新所选分支，定时任务仍更新
`main`。本规则是明确启用的自动晋级例外，不恢复飞书数据对所有人工层级的批量覆盖。
