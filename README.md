# Onerway Payment Showcase

一个面向客户演示的参考商户网站，用真实商户体验展示 Onerway 不同支付接入方式的效果，而不是开发者控制台。

## 源码使用边界

本仓库公开用于产品展示、技术审阅和交流，但未授予任何开源许可证。除适用法律另有规定或另行取得权利人许可外，不得复制、修改、分发或将本仓库内容用于衍生项目。

## 当前里程碑

M0 聚焦虚构电商品牌 **Halden** 的 Web JS SDK：

- `US + USD 5.00`：普通支付成功。
- `US + USD 50.00`：3DS Challenge 后成功。
- Sandbox 端到端交易、回跳、Webhook / query 状态收敛。
- 桌面端与移动端客户演示体验。

Checkout、Direct API，以及游戏、直播、AI 等场景会沿用同一产品模型逐步加入；iOS / Android SDK 不属于当前范围。

当前 Demo Hub 保留确定性 simulation，并为 `US + USD 5.00` 普通成功与 `US + USD 50.00` 3DS Challenge 开放真实 Web JS SDK Sandbox 入口。所有路径共用 `Order → PaymentAttempt → PaymentEvent`；真实路径由服务端创建和查询支付，卡字段只存在于 Onerway 托管 Element 中。

## 项目入口

- [长期产品与架构契约](docs/showcase-contract.md)
- [Web SDK M0 视觉原型](docs/design/sdk-m0.html)
- [GitHub Issues](https://github.com/abel-wang777-showcase/onerway-payment-showcase/issues)

视觉原型用于确认信息架构、状态和视觉表达，不是可以直接复制进生产代码的实现。

## 配置与安全

本地配置从 `.env.example` 复制到 `.env.local`。`pnpm dev` 和 `pnpm preview` 会显式加载该文件；构建与部署则从执行环境读取配置。

`ONERWAY_PROFILE` 必须明确设为 `sandbox` 或 `production`，不能由浏览器请求切换：

- Sandbox 使用 `https://sandbox-acq.onerway.com`；Web SDK 当前使用可替换的 `https://sandbox-checkout-sdk.onerway.com/v4/latest/onerway.js`，不得回退 v3。启动时要求当前 profile 的 SDK URL、canonical Showcase origin、正式 Payment result Webhook URL、`merchantNo`、`appId` 和 `secret` 完整。Webhook 默认直接投递 canonical `/api/webhooks/onerway/payment`；只有 `ONERWAY_SANDBOX_NOTIFY_RELAY=true` 时才接受外部公开 HTTPS Relay，且路径必须精确为 `/onerway/payment`。
- Production 使用 `https://acq.onerway.com`；M0 只允许展示锁定状态。即使误设 `ONERWAY_PRODUCTION_ENABLED=true`，也不会开放生产交易。
- Vercel 的 Preview / Production 是部署范围，不等于 Onerway profile。canonical Vercel Production deployment 承载 `sandbox` profile，是唯一正式测试、演示和验收面；Onerway Production 实际交易仍保持锁定。
- Preview 同样选择 `sandbox` profile，并与 Production 有意共享 Onerway Sandbox 权限和运行数据。Vercel Neon 连接保留 Production / Preview 环境访问，但关闭 `Create database branch for deployment`，两种 deployment 都使用既有共享运行库，避免临时分支制造错误的隔离语义或耗尽分支配额。Preview 使用 `PAYMENT_MIGRATION_MODE=skip`，其回跳与 Webhook 统一落到 canonical Production；Preview 可以辅助排查，但不形成独立验收证据。Preview 的真实 Sandbox 入口必须先导航到 canonical Production，并由 Production 域创建 Order 与签发 host-only recovery cookie；服务端也会拒绝非 canonical origin 的 intent、create、retry 和 submit，Preview 不能直接发起或推进可能跨域回跳的真实支付。

真实 `merchantNo`、`appId` 和 `secret` 只放在未提交的本地环境文件或部署平台的加密环境变量中。浏览器只能通过 `/api/profile` 得到脱敏的环境摘要、公开 canonical origin 和当前 SDK script URL，不得读取凭据、API URL 或 notify URL。PAN / CVV 不经过 Nuxt 服务端、不持久化、不进入日志。

可以在项目根目录创建 `.env.local` 并按 `.env.example` 填写；该文件已被 Git 忽略。不要在 Issue、截图、录屏、终端输出或提交中展示其中的值。

本机浏览器与 Nuxt 同机运行时，在 `.env.local` 中将 `ONERWAY_SANDBOX_TRANSACTION_IP` 设为真实、已登记的持卡人公网 IP，避免把 `127.0.0.1` / `::1` 发送给 Sandbox 风控。该覆盖只在 Sandbox 服务端使用，且不改变限流使用的客户端身份；Nuxt dev adapter 未提供 runtime 地址时，限流仅使用固定 loopback bucket。部署环境应省略交易 IP 覆盖：Vercel runtime 只信任平台覆盖的 `x-vercel-forwarded-for`，其他 runtime 使用 H3 提供的可信客户端地址。服务端不信任请求自带的通用 `X-Forwarded-For`，部署 runtime 缺少可信客户端地址时拒绝请求，并在上游调用前校验最终交易 IP。

公开 create / query BFF 对带浏览器来源信息的请求执行同源 gate，并共享进程内速率与并发安全阀。它用于限制单实例事故半径，不是 Serverless 跨实例全局配额；正式公开部署仍需配置 edge / WAF 限流。query capability 绑定 attempt、Payment ID 和五分钟有效期，过期后服务端拒绝查询；不能据此盲目重试付款，也不能持久化或写入日志。

## 本地开发

要求 Node.js `>=22.18.0 <23` 与 pnpm 10。首次安装后启动 Nuxt 开发服务器：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

默认开发地址为 `http://localhost:3000`。

## 质量门

提交前运行：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

GitHub Actions 将通用质量门与 `Neon integration` 分开运行。两者都显式 checkout 并核对当前同仓库 PR head、手动运行或 `main` push 的 exact SHA；数据库 job 只连接带 guard 的隔离 `TEST_DATABASE_URL`，不能使用运行时数据库，也不定义第二套支付业务真值。公开 fork PR 不接收 repository secrets，因此自动跳过该数据库 job，仍运行不依赖凭据的通用质量门。

## 单人演示前检查

按顺序完成以下检查；任一项不满足时停止真实 Sandbox 演示，不通过重复提交付款来探测故障：

1. `git fetch origin` 后记录 `git rev-parse origin/main` 的完整 40 位 SHA。
2. 用 `gh run list --workflow ci.yml --branch main --commit <sha>` 与 `gh run list --workflow payment-db.yml --branch main --commit <sha>` 回读同一 SHA 的 `Quality (exact head)` 和 `Neon integration` 均成功。
3. 在 Vercel 当前 Production deployment 详情中确认 Git commit 等于该 SHA；再读取 `GET /api/health`，确认 `status=ok`、profile / database 均为 `ready`、`transactionPolicy=sandbox-only`，且响应中的 `commitSha` 与该 SHA 相同。不要把 Preview deployment 当成正式证据。
4. 读取 `GET /api/profile`，确认公开摘要为 Sandbox 与 `sandbox-only`、`canonicalOrigin` 指向 Production 域，且 SDK release URL 符合本节记录；响应不应包含 merchant、secret、API URL 或 notify URL。
5. 确认 Vercel Production 为 `PAYMENT_MIGRATION_MODE=apply`，Preview 为 `skip`；Neon 连接仍覆盖 Production / Preview，但 `Create database branch for deployment` 保持关闭，两者使用同一共享运行库。若 Vercel 报 `Resource provisioning failed`，先检查该 deployment action 是否被重新启用以及 Neon 分支配额，不要删除共享数据库变量或断开资源。部署环境都不配置 `ONERWAY_SANDBOX_TRANSACTION_IP`，也不配置 Onerway Production 实际交易能力。直接投递时 `ONERWAY_SANDBOX_NOTIFY_RELAY=false`；使用受控 Relay 时必须显式为 `true`，且 Production / Preview 使用同一 Relay URL。
6. 在 Vercel 检查每日 Cron 最近一次运行成功，并确认独立的诊断 token 已配置。`/api/health` 不验证 Cron、诊断 token 或 Onerway 上游可用性。
7. 先走 simulation 与异常恢复，再在受控 Sandbox 条件下分别执行 USD 5 普通成功和 USD 50 3DS。最终结论以脱敏的 return / Webhook / fresh query / persistence 收敛证据为准，SDK callback 或结果页不能单独证明成功。
8. 用 1440、834、390、320 宽度检查页面，并完成键盘 Tab / 方向键、可见焦点、状态 live-region 和真实 SDK iframe 基本操作验收。

## 健康检查与故障定位

公开的 `GET /api/health` 只执行服务端 profile 解析与数据库连接检查，不访问 Onerway。正常响应只包含 `status`、两项 readiness、交易策略和合法时的 Vercel 40 位 commit SHA；失败统一返回 `503 SERVICE_UNAVAILABLE`，不会回显环境变量、DSN 或商户信息。

单人排查采用从外到内的顺序：

| 现象 | 首先核对 | 边界 |
| --- | --- | --- |
| `/api/profile` 或 `/api/health` 失败 | 当前 deployment SHA、Vercel env scope、profile 配置与 migration 结果 | 只看错误码和脱敏日志，不打印环境变量值或 DSN |
| 页面正常但 create / query 失败 | canonical origin、可信客户端 IP、edge / WAF、Sandbox allowlist 与上游状态 | 不手工补发 create，不把通用 `X-Forwarded-For` 当可信来源 |
| 3DS 未回到 Showcase | `ONERWAY_SHOWCASE_ORIGIN`、浏览器最终地址与原 Attempt recovery | 不解释、保存或转发 provider 附加的 return query |
| Webhook 未收敛 | configured notify URL、Relay 到 canonical `/api/webhooks/onerway/payment` 的状态透传、Vercel function 状态与脱敏 timeline | 不关闭验签，不保存或复制原始 Webhook payload；Relay 不持有 Onerway secret |
| 长时间 `processing` | 对同一 Payment 执行 fresh query，并比较 return / Webhook / query 事实 | 不凭 SDK callback、页面文案或 transaction `F` 判定最终失败 |
| Cron 异常 | Vercel Cron 运行记录、`CRON_SECRET` 是否存在、清理函数状态 | 不直接删除 Production 数据；Cron 只清理超过 30 天的领域记录 |

受限诊断入口为 `GET /api/internal/payments/timeline`，必须使用独立 bearer token，并且一次只按一个 `merchantTxnId` 或 Onerway `transactionId` 查询。通过密码管理器或 API 客户端的 secret substitution 注入 token，不把它粘贴到 shell history、Issue、截图或日志；只分享接口返回的白名单领域字段。未配置或 token 不正确时 401 是预期的 fail-closed 行为。

Vercel Cron 每天 `03:17 UTC` 调用 `GET /api/internal/payments/cleanup`，平台使用独立 `CRON_SECRET` 授权。确认 Cron 是否工作应读取 Vercel 的运行记录和函数结果；不要公开调用内部路由，也不要把 health 200 当作 Cron 已运行的证据。

## Webhook Relay 部署

Onerway 发送侧无法正确解析 `workers.dev` 时，使用 Cloudflare Pages Advanced Mode 提供无状态 Relay。固定 Production URL 为 `https://onerway-showcase-relay.pages.dev/onerway/payment`；部署入口为 `relay/pages/_worker.js`，只接受精确的 `POST /onerway/payment`、最多 64 KiB 的 JSON body，并把原始字节转发到 canonical Production Webhook。Relay 不解析、记录或保存 payload，不持有 Onerway secret，也不自行返回成功 ACK；上游不可达时 fail closed。

首次部署前使用已认证的 Wrangler 创建独立 Pages 项目；不要复用会保存原始 payload 的 Payment Test Harness 接收路由：

```bash
pnpm exec wrangler pages project create onerway-showcase-relay --production-branch main
pnpm deploy:relay:pages
```

正式发布由 GitHub Actions 自动完成，但新的公开仓库默认没有 `RELAY_DEPLOY_ENABLED` repository variable，因此 Relay fail closed；只有完成部署迁移并显式设为 `true` 后才允许自动或手动发布。Cloudflare Pages 项目保留 Git repository 关联以维持项目元数据，但 Production 与 Preview 的 Git automatic deployments 都必须关闭，避免 Cloudflare Git integration 与 Actions 成为两套发布者；不要用 Disconnect 代替 branch control。启用发布前，仓库需配置 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN` 两个 Actions secrets；token 只授予目标账号的 Cloudflare Pages 编辑权限。`main` 的 `Quality (exact head)` 通过后，只有 Relay 源码、部署脚本、依赖锁或相关 workflow 发生变化才调用 `Deploy Webhook Relay`，并上传同一 exact main revision。需要重新发布当前 main 时，在 Actions 手动运行 `CI`、选择 `main` 并启用 `deploy_relay`；手动重发同样必须先通过 `Quality (exact head)`，不能直接调用部署 workflow 或选择旧 ref。

自动与手动部署都复用 `pnpm deploy:relay:pages`：本机命令先 fetch；Actions 使用当前仓库只读 `GITHUB_TOKEN` 从 GitHub API 回读实时 main SHA，并在启动 Wrangler 前移除该 token。两条路径都拒绝脏工作树或不等于实时 main 的 HEAD，随后把 exact commit SHA 明确写入 Pages Production deployment。部署后 workflow 只用 `GET` 确认非 Webhook 方法返回 404，不发送合成或真实支付 payload。首次 Actions 成功同时证明两个 Cloudflare secrets 可用且 token 权限满足发布要求；Secret 设置页本身不能替代该验收。

Vercel Production / Preview 将 `ONERWAY_SANDBOX_NOTIFY_RELAY=true`，并把 `ONERWAY_SANDBOX_NOTIFY_URL` 设为上述固定 URL；重新部署后该配置只影响新创建的支付。最终验收必须使用新 Sandbox 交易，并以 Pages invocation、Vercel Webhook、fresh query 与数据库状态收敛的脱敏证据为准。2026-08-12 已完成一笔新 Sandbox 交易的 Relay 真实投递，通知由 canonical Production 正常验签、处理并持久化。

## 依赖、SDK 与部署修订

- 应用依赖：在独立分支更新 `package.json` 与 `pnpm-lock.yaml`，保持 Node `>=22.18.0 <23`、pnpm 10 和 CI runtime 一致；重新执行 frozen install 与全部质量门，不在部署时临时追 `latest`。
- 字体：Geist Sans / Mono 由精确锁定的 `@fontsource` 包自托管，应用只导入 Latin 的 400 / 500 / 600 / 700 权重；`@nuxt/fonts` 对这两个 family 使用 `provider=none`，构建和浏览器都不依赖 Google Fonts URL。升级两个字体包时保持版本一致，并重新执行 build 与桌面 / 移动视觉 smoke。
- Web SDK：当前证据是 release 标签 `v4/latest`、2026-08-12 观察到的 bundle SHA-256 `80ee223bc5d3561a729c09901379324186f1c65bcb778be10240fe06f338ed64`，以及同日通过的 canonical Production USD 5 普通成功和 USD 50 3DS Challenge 浏览器复验。当天短暂出现的 bundle `2bd80655e316794cf7f96659e589af0a4e9b1429565f82333b53d017441ceabe` 把 Sandbox action gateway 指向无法解析的 `sandbox-gateway.ronhan.com`，同一时段观察到 USD 50 未发生预期 3DS 跳转；缺少该笔白名单 action-type 证据，因此只记录相关性，不宣称确定因果。当前 bundle 已恢复 `sandbox-gateway.onerway.com`，随后两条黄金路径均复验通过。`revision` query 只隔离缓存，不是固定版本或 SRI。release、hash 或行为变化时，同一变更必须更新 allowlist、契约、观察日期并重做浏览器与 USD 5 / USD 50 验收。
- 设计基础：`geist-foundation` 的 source revision 与受管文件由下一节的 40 位 SHA 和 `geist.lock.json` 共同约束；只通过 canonical registry 更新。
- 部署：长期文档只记录策略与 source revision，不记录临时 deployment ID。每次交付以当前 `origin/main` SHA、两个 exact-SHA checks、Production deployment Git metadata 和 `/api/health.commitSha` 四方一致为准。

## 回滚边界

Vercel 回滚只允许切回已经验收、仍与当前数据库 schema 兼容的 Production deployment，并在操作后重新执行 exact-SHA、health、profile 与关键 simulation 检查。Production build 可能已经执行向前 migration；代码回滚不会回滚 schema，项目也不提供自动 schema downgrade。若旧部署与当前 schema 不兼容，应停止真实 Sandbox 演示并向前修复，不能删除支付事实或手工改库来强行恢复。

回滚不改变 Onerway 或数据库中的支付真值。回滚前后都必须让已创建 Attempt 继续通过 recovery、Webhook 与 fresh query 收敛；不得因页面版本变化重放 create / confirm。若事故涉及 secret、Webhook、域名、edge / WAF 或 Onerway 配置，应先锁住真实 Sandbox 演示并分别恢复对应外部配置；任何情况下都不得顺带开放 Onerway Production 实际交易。

## 设计基础

项目通过 canonical `geist-nuxt` registry 引入设计基础，当前只消费 `geist-foundation`。锁定的 source revision 为：

```text
81464cbcf82813181a49043c5437a25eb8e12d45
```

从同级 `geist-nuxt` 的同一 source revision checkout 更新时，必须依次 dry-run、write、check。`--to` 必须等于该 checkout 的 40 位 `HEAD`；采用新 revision 时需同步替换下列 SHA，并按契约流程确认：

```bash
cd ../geist-nuxt

pnpm geist:update -- \
  --target ../onerway-payment-showcase \
  --to 81464cbcf82813181a49043c5437a25eb8e12d45

pnpm geist:update -- \
  --target ../onerway-payment-showcase \
  --to 81464cbcf82813181a49043c5437a25eb8e12d45 \
  --write

pnpm geist:check -- --target ../onerway-payment-showcase
```

`geist.lock.json` 记录实际来源、依赖闭包和受管文件 hash。不要手改受管的 foundation 文件或 lock；`app/assets/css/main.css` 由 registry 管理，业务样式只写入其后加载的 `app/assets/css/app.css`。
