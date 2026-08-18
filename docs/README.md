# Athena 文档索引

Athena 当前工程版本为 **Desktop 0.9 Private Beta candidate (`0.9.6-beta.1`)**。更新协议、候选内容门和 packaged smoke 已有可重复工程证据；签名证书、生产更新源、clean-checkout CI 和真实 20–50 人 Beta 尚未完成，因此发行结论仍为 **No-Go**。文档按以下优先级解释；低优先级文档不得覆盖高优先级结论。

## 商业化唯一基线

1. `COMMERCIAL_ROADMAP.md`：产品阶段、平台边界、风险分级和总路线。
2. `PRODUCT_MATRIX.md`：当前能力与 Desktop、Steam、Mobile、Cloud SKU 分配。
3. `ISSUE_REGISTER.md`：唯一问题台账、窗口责任、状态、证据和验收条件。
4. `RELEASE_CHECKLIST.md`：构建、测试和各平台 Go/No-Go 发布门。
5. `WORK_PROTOCOL.md`：窗口 01–11 的协作、交接和变更协议。
6. `DESKTOP_1_0_COMMERCIAL_POLICY.md`：窗口 07 冻结的一次性 SKU、激活/换机、退款和联系渠道边界。
7. `DESKTOP_1_0_GO_NO_GO.md`：Universal + Desktop 1.0 发布门复核与证据化结论。
8. `steam/STEAM_1_0_POLICY.md`、`steam/STEAMPIPE_RUNBOOK.md`、`steam/STEAM_AI_CONTENT_DISCLOSURE.md`、`steam/STEAM_STORE_LISTING.md`、`steam/STEAM_ASSET_MANIFEST.md`、`steam/STEAM_GO_NO_GO.md`：窗口 08 Steam SKU、构建、Cloud/AI/素材与 Blocked 交接证据。
9. `cloud/ARCHITECTURE.md`、`cloud/API_V1.md`、`cloud/THREAT_MODEL.md`、`cloud/OPERATIONS_SLO.md`、`cloud/PENETRATION_BASELINE.md`、`cloud/PROVIDER_REGISTER.md`、`cloud/CLOUD_GO_NO_GO.md`：窗口 09 独立服务端、协议、安全/运维基线与生产 No-Go 交接证据。
10. `WINDOW_11_RELEASE_REVIEW.md`、`ops/RELEASE_OPERATIONS.md`、`ops/STATUS_PAGE_TEMPLATE.md`、`ops/INCIDENT_RECORD_TEMPLATE.md`：窗口 11 对窗口 03–10 的独立复核、五平台 Go/No-Go、责任链、事故/EOL/迁移政策和运营模板。

## 技术说明

- `architecture.md`：当前 Electron/IPC/路径/打包主链路。
- `api.md`：内部 API 入口说明。
- `prompt.md`：系统提示词组装入口。
- `OFFLINE_PACKAGE.md`：现有离线包的开发者说明；不代表许可已通过。
- `THIRD_PARTY_NOTICES.md`：现有第三方声明草稿；完整许可工作由后续窗口负责。
- `DESKTOP_1_0_STORE_LISTING.md`：官网/商店正式文案源稿及截图禁区。
- `DESKTOP_1_0_SUPPORT.md`：支持、隐私与安全入口分流运行稿。
- `EULA_DRAFT.md`、`PRIVACY_POLICY_DRAFT.md`：未生效草案；主体、公开 URL 和法律复核完成前不可发布为正式条款。

## 非承诺材料

- `roadmap.md`：旧愿景快照，只用于追溯，不是版本计划。
- `ui-motion-*.md`、`concepts/*`：设计依据或概念图，不自动成为发布能力。
- `changelog.md`：开发变更摘要，不替代问题台账和发布记录。

如文档之间冲突，以“商业化唯一基线”的顺序为准，并在 `ISSUE_REGISTER.md` 新建编号问题，而不是在多个文档中各写一套结论。
