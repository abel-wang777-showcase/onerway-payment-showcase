# AGENTS.md — Onerway Payment Showcase

## 开始前

1. 先读 `docs/showcase-contract.md`，它是本项目产品、支付状态和安全边界的唯一长期权威。
2. 构建 UI 时读取当前 canonical `geist-nuxt` 的 `AGENTS.md`、`SKILL.md` 和相关 references。默认本地位置为同级目录 `../geist-nuxt`。
3. `docs/design/sdk-m0.html` 只是冻结的视觉与状态参考；若它与契约、API 文档、安全规则或设计系统冲突，以后者为准。

## 实现规则

- 技术栈为 Nuxt 4、Vue、TypeScript、Nuxt UI；不用 React。
- 设计基础只能通过 canonical `geist-nuxt` registry 安装和更新。不要复制旧 export、旧 starter、playground 或 API Docs kit。
- 初始仅消费 `geist-foundation`。新增设计切片前，先确认 registry 中已有对应条目。
- 业务样式只写入 `app/assets/css/app.css`；不要修改 registry 受管的 `app/assets/css/main.css`，并保持业务入口排在 foundation 之后。
- `ONERWAY_*` 配置只由 `server/utils/profile.ts` 解析；客户端只能消费 `/api/profile` 的显式白名单摘要，不得新增第二套 profile 解析或切换入口。
- 领域模型不依赖 Vue 组件。跨端支付模型按 `shared/payment/` 组织，优先使用精炼文件名，例如 `order.ts`、`attempt.ts`、`event.ts`、`capability.ts`。
- Checkout、Web JS SDK 和 Direct API 都适配到统一的 `Order → PaymentAttempt → PaymentEvent` 模型，不在页面组件中分别发明状态机。
- GitHub Issue 描述“接下来做什么”；完成后仍长期成立的决定必须回写 `docs/showcase-contract.md`。

## 安全红线

- `secret` 及生产凭据只能存在于服务端环境变量，绝不进入 `runtimeConfig.public`、客户端 bundle、日志、Issue、截图或提交历史。
- PAN / CVV 即使来自 Sandbox，也不得持久化、埋点或记录日志。
- 所有原始请求、响应和 Webhook payload 在保存或展示前必须脱敏。
- Production profile 默认不可交易；启用条件未在契约中确认前不得自行放开。
- 客户端 SDK 回调和 `returnUrl` 不能单独作为最终支付成功依据。

## 防漂移

- 修改能力矩阵、支付状态、环境策略、回调真值或 M0 范围时，同一变更必须更新契约。
- 遇到文档、SDK 行为和 API 响应不一致时，先记录证据并暂停相关实现，不凭推测补契约。
- 不创建与契约重复的 `ROADMAP.md`、`architecture.md`、`payment-model.md` 或零散 ADR；只有替换已上线架构决定时才新增 ADR，并在契约中声明替代关系。
