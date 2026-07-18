# Athena Status

> 模板，不是已部署状态页。生产前必须把 `config/operations.json.statusPage.publicUrl/provider` 改为真实值并完成独立故障域演练。

## Current status

| Component | Status | Last checked (UTC) | Note |
|---|---|---|---|
| Desktop Direct distribution and updates | Prelaunch |  | Not publicly available |
| Desktop licensing | Prelaunch |  | Production provider not configured |
| Steam distribution and Steam Cloud | Prelaunch |  | No AppID/review evidence |
| Athena Cloud API | Prelaunch |  | Local fixture only |
| Athena Cloud authentication | Prelaunch |  | Local fixture only |
| Athena Cloud sync | Prelaunch |  | Local fixture only |
| Athena Cloud model gateway | Prelaunch |  | No production provider |
| iOS | Not started |  | No app project |
| Android | Not started |  | No app project |
| Support | Prelaunch |  | Public channel not configured |

Allowed status values: `Operational`, `Degraded performance`, `Partial outage`, `Major outage`, `Maintenance`, `Prelaunch`, `Not started`.

## Incident update template

- Incident ID / severity:
- Status: Investigating / Identified / Monitoring / Resolved
- Started at (UTC):
- Affected components, versions, regions and user groups:
- Confirmed user impact:
- Current mitigation or safe workaround:
- Data/security/privacy assessment: pending / confirmed summary
- Next update no later than (UTC):
- Support link:
- Resolved at (UTC):
- Postmortem due / URL:

P0 首次更新不晚于确认后 30 分钟，之后至少每 60 分钟；P1 首次更新不晚于 60 分钟，之后至少每 120 分钟。即使没有新结论，也必须按时写“调查继续”和下一次更新时间。
