# Athena 搜索 provider 政策与可靠性评审

> 评审日期：2026-07-16；范围：Internal Alpha 中的搜狗移动页、Bing 中国页、DuckDuckGo HTML/Lite 与正文读取。

## 商业结论

现有实现使用面向终端用户的 HTML 页面，不是签约搜索 API。它没有 SLA、配额合同、变更通知或商业再分发授权，因此只允许作为 Internal Alpha 实验能力；Desktop/Steam 1.0 在签约 API 接入并完成 DPA/许可复核前排除搜索与深读宣传。

| Provider | 官方依据 | 评审结果 | 1.0 决策 |
|---|---|---|---|
| 智谱 BigModel 搜索 API | https://open.bigmodel.cn/usercenter/service | 签约 API：有账号、密钥、配额与计费和商用条款，非抓取消费者页面 | **候选**，待完成下方归档后可进入 1.0 |
| 搜狗 | https://www.sogou.com/docs/user.htm?v=1 | 用户协议限制未经授权的第三方工具/服务接入；无 Athena 商业合同或 SLA | Excluded |
| Bing | https://www.microsoft.com/en-us/servicesagreement | 消费者 Bing 内容为个人非商业使用；无 Athena API 合同或 SLA | Excluded |
| DuckDuckGo | https://duckduckgo.com/terms 与 https://duckduckgo.com/acceptable-use | as-is/as-available，且禁止销售或转售服务部分；无 Athena 商业合同或 SLA | Excluded |

> 2026-09-08 补充：智谱 API 已完成工程接入，配置 `ZHIPU_API_KEY` 后自动成为首选 provider，失败时降级回上述 HTML 链。**接入不等于获得授权**——`SEARCH_PROVIDER_POLICY.zhipu.commercialApproved` 仍为 `false`，直到下一节要求的授权、配额与 DPA 归档完成为止。在此之前搜索仍按 Internal Alpha 对待。
>
> 补充说明：DuckDuckGo 两个端点在中国大陆网络实测不可达（各 10 秒超时），Brave Search API 同样不可达；两者在当前网络下不构成有效降级路径。

## Internal Alpha 工程边界

- 每 provider 最短请求间隔 1.25 秒、每进程每 provider 每分钟最多 8 次；HTTP 429 遵守 `Retry-After` 并进入冷却。
- 搜索端点超时 9–10 秒；正文读取使用自身超时和大小上限；深读并发最多 2 页。
- captcha、安全验证、unusual traffic、access denied、HTTP 401/403/429、超时、断网、空结果分别分类；不绕过验证码或反爬。
- 失败提示说明“第三方服务阻止/限流/网络过慢”，并明确本地对话仍可继续。
- `WebSearchService.getDiagnostics()` 只保存进程内次数和失败类别，不保存查询文本，不上传遥测。

## 签约 API 进入 1.0 的门

必须归档商业使用授权、SLA/支持、配额与成本、DPA/地域/保留、结果展示与缓存权利、速率限制和停服迁移方案；替换 HTML parser 后重新执行非 live、live、弱网、限流和隐私同意测试。
