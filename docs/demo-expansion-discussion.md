# 三端 Demo 扩展方案与协作交接

> 更新日期：2026-10-25（Asia/Shanghai）
> 状态：B0 契约准备；A1 多轮只读审阅和产品选择已完成。仅授权事实核实、基线检查与契约/示例文档，不授权业务实施、提交、合并、部署或真实交易。
> 本次已确认：商户自管理订阅先做手动续费，不做自动调度。
> 补充确认：普通演示公开、会话数据隔离、内部调试独立凭证；客户仅在本会话内选择；不做跨端同步和清除数据/卸载后的身份找回。
> 第 10、13–14 节保留阶段 A 核实和审阅记录；第 11–12 节已改为长期契约索引。B0 当前范围、证据和交接见第 7、9 节；所有 v1 接口均未部署。
> 本文保留阶段安排、事实缺口与交接记录；长期语义已回写 `showcase-contract.md`，首批结构见 `api/demo-v1.openapi.json`，共享示例见 `api/demo-v1.examples.json`。后续执行与验收证据进入关联 Issue / PR。

## 1. 目标与原则

Web、Android、iOS 共用一个 Demo 后端，让客户与内部人员能够自定义参数、反复演示支付、继续中断流程、管理订阅，并查看自己的脱敏交互记录。

- 保留一个共享后端部署，暂不拆独立服务；明确业务模块和接口边界。
- 固定旅程作为快捷预设，不再作为底层支付能力的唯一入口。
- 三端共享业务语义、参数规则和服务端状态，不强求 UI 或 SDK 生命周期实现一致。
- 关闭页面、关闭 SDK、刷新、App 重启或网络异常，不能永久封锁继续体验的入口。
- 继续原支付、恢复未知创建结果、开始独立测试是不同动作，必须明确区分。
- 当前目标为 Sandbox；不因客户端文档写了 Production 就启用生产交易。用户已确认原生 SDK 支持 Sandbox。

## 2. 事实基线与避免误用旧结论

本轮只读检查涉及三个工作目录：

| 目录 | 用途与观察 |
| --- | --- |
| `/Users/abel.wang/projects/onerway_payment_showcase` | 当前聊天工作区；检查时 HEAD 为 `6d1adf9`，基线较旧 |
| `/Users/abel.wang/projects/onerway-payment-showcase-mobile` | 同一 Showcase 仓库的另一个 worktree，不是另一个后端产品；检查时 HEAD 为 `fa7c4a8`，存在移动接口等未提交修改 |
| `/Users/abel.wang/projects/onerway-native-sdk` | Android Demo 与原生 SDK 指南；iOS Demo 尚待实现 |

以上 SHA、文件状态是本轮观察，不代表后续实时状态。实施前重新核对 worktree、分支、已有修改和交付基线，不覆盖其他任务成果。

重要更正：较新的 Web 实现已经接受一次性支付 `amountMinor`，契约记载允许 USD 0.01–10,000.00；这是 Demo 策略，不是 Provider 统一限额。移动接口仍只接受 `requestId + platform`，固定 USD 5.00。因此，不能沿用“整个项目金额仍全部写死”的旧结论。

现有可复用基础：`Order → PaymentAttempt → PaymentEvent`、数据库事务与幂等、凭据服务端管理、Webhook 验签、查询与状态收敛、订阅合约记录。

主要演进点：统一 Web 与移动端参数能力；收敛重复查单编排；解除固定预设与 Provider 请求构造的过度耦合；将测试客户身份与当前订单恢复链分开；增加完整历史与脱敏交互查看能力。

## 3. 已确认决定

### 3.1 部署、协作与范围

- 保留一个共享后端部署；Codex 负责 Showcase 后端与 Web，Claude 负责移动端。
- 已确认：暂不建设跨端历史同步、配对登录、组织、角色管理或名为“受控测试空间”的产品模块。
- 已确认：三端各自恢复、查询本会话创建的客户、订单、订阅和脱敏报文；共享后端不等于共享全部数据访问权限。
- 已确认：支持刷新、关闭页面、App 重启后的恢复；暂不支持清除浏览器数据或卸载 App 后找回身份，不建设账号系统。既有记录保留/过期策略仍需明确，不承诺永久恢复。
- 金额、客户复用、订阅生命周期、脱敏报文和自定义回跳属于讨论中的完整扩展范围；分阶段不应默默删减最终范围。
- 移动端已确认：首页“待继续”显示本会话最近一笔可继续或创建结果未知的支付；底部导航为首页 / 记录 / 订阅 / 设置。
- 现有未提交 `/api/mobile/payment/create|query` 为 v0，不再继续投入，也不作为新接口兼容约束。Android 可在其单独授权范围内使用假数据搭界面；本阶段不执行移动端实现。
- App Link 已确认先登记 Android 本机调试签名，阶段 C 交接；以后分发改用专用 Demo 签名，再补登记。本稿只记录用户提供值，未核验实际构建证书、未发布关联文件。iOS 关联身份仍待提供。
  - Android 本机调试 SHA-256：`A9:86:DC:F9:C0:52:53:92:BC:64:F9:11:D2:17:2A:B1:AF:03:AC:E2:2E:B1:81:94:2A:5A:BD:44:FA:DE:05:F7`。
  - 专用 Demo 分发签名后续补登记；不要将当前指纹当作分发签名，也不自动删除仍在使用的调试关联。

### 3.2 支付恢复：用户明确确认的业务语义

| 接入 | 已确认语义 | 实现要求 |
| --- | --- | --- |
| SDK（Web、Android、iOS） | `paymentId` 未到支付终态可以重复使用 | 恢复同一支付关联并重新进入 SDK；不能以本地“曾打开过”永久禁止继续。具体状态下可展示/提交的动作仍按 SDK 协议核实 |
| 托管收银台 | 未发生支付时，原 `redirectUrl` 可以继续打开 | 不能因为曾导航过就销毁唯一继续入口；先核实状态与 URL 可用性，不以页面关闭推定支付未发生 |
| Direct API | 已调用支付接口，原支付只能查状态；用户要再付款则重新下单发起支付 | 恢复不能重发旧扣款请求；新支付使用新的请求/交易标识，保留旧支付历史 |

共同约束：

- 创建请求结果未知时，先按原幂等键/商户交易标识恢复，不能因超时自动新建。
- “重新打开 SDK”不等于“自动重复 confirm”；处理中或已有外部动作时，仍按协议展示和继续。
- Direct API 首次响应要求的跳转、二维码或客户端动作属于正常支付流程；不要把“原调用只查状态”误写成忽略首次响应动作。中断后这些动作是否可恢复需补证。
- SDK/URL 回调不是最终支付真值；最终状态仍来自服务端核验。
- 用户显式开始独立 Sandbox 测试可以保留旧支付后创建新支付，不自动取消旧支付；不以旧支付必须终态作为所有新测试的门槛。
- “新支付”与“必须新建商业订单”不是同一个概念，具体 Order/Attempt 关系应按业务场景明确，避免重复履约。

### 3.3 订阅完整范围

用户要求覆盖：

1. 首次订阅：购买的商品/计划、金额、频率、周期及托管/商户自管理模式。
2. 查询订阅信息和当前演示客户的订阅列表。
3. 升级、降级及相应生效规则。
4. 立即取消与到期取消。
5. 托管模式使用 Provider 提供的 `subscriptionManageUrl` 承接相应管理体验；Demo 展示摘要并核验最新状态。
6. 非托管模式由商户 Demo 实现对应详情与管理功能。
7. **商户自管理续费采用用户主动点击的手动续费，不做周期自动扣款调度。**

手动续费仍须有权限、幂等、结果未知恢复和重复点击保护；关闭页面后不自动发起下一次续费。首次支付成功、合约生效、某次续费成功、合约取消是不同事实，分别展示。

计划修改必须保留原始条款与变更记录，不能改一份配置就使历史合约看起来已同步变化。具体字段、可选值、变更生效时点和模式差异见待核实项。

### 3.4 回跳与服务端收敛

- `returnUrl` 支持商户自己的地址，不固定为 Demo 页面；提供各端默认值作为便捷选项。
- 回跳可以触发查询，但不是查询的必要前提。
- 推荐以收到 Webhook 后主动查询作为主要收敛链路；保留页面打开、App 前台恢复、手动刷新和有界补偿查询。
- Webhook 验签、关联与幂等处理后，可靠记录通知及待查询任务，再按协议 ACK；后续查询失败可恢复，不以阻塞通知应答方式等待所有上游查询完成。
- 不使用请求结束后可能丢失的内存任务代替可靠查询任务。此类状态补偿不等于订阅自动扣款调度。
- `notifyUrl` 继续由共享后端控制；修改 `returnUrl` 不改变通知归属。
- 跳到外部商户地址后，后端仍处理支付；用户再次进入 Demo 可查看结果。App Link / Universal Link 是否能唤回 App 取决于域名关联，不能承诺任意地址都能自动返回。

## 4. 产品方案：已确认边界与待审阅实现建议

第 4.1 节的访问范围、客户选择和恢复边界已获用户确认；具体技术承载及后续页面建议供 Claude 审阅。产品确认不等于 Provider 协议证据或实施授权。

### 4.1 默认演示与访问边界

默认演示建议提供已支持场景、自定义金额/参数、继续原支付、新建独立测试、当前客户保存卡体验、订阅管理、自有订单的脱敏交互记录和自定义回跳。

已确认：普通演示公开；当前会话只能查看、管理自己的客户、订单、订阅和脱敏报文。内部调试入口保留独立访问凭证。普通演示无需手工填写内部 Demo Token；不建设账号系统。公开访问不意味着可以任意代签上游请求。

采用最小会话归属：Web 使用服务端签发的受保护 Cookie，App 安全保存会话凭证；后端关联测试客户、订单和合约。订单号、`paymentId`、`merchantCustId`、`contractId` 本身都不是授权凭据。

已确认：提供“使用当前测试客户 / 新建测试客户 / 选择本会话已有客户”；暂不允许输入任意 `merchantCustId`，不做跨端同步。当前内部 Demo Token 只承担内部入口门禁，不能代替会话数据归属校验。会话凭证的 Cookie/设备安全存储细节属于待审阅技术方案。

### 4.2 页面与操作

- 连接配置：后端地址、访问凭证放设置/首次配置；可预置默认服务地址，自定义地址放高级设置。
- 支付参数：金额、客户、订阅条款、回跳选择放场景配置；不增加每次下单必经的中间页。
- SDK 外观：语言、主题、品牌色放设置。
- 明确提供“继续这笔支付”和“开始新测试”，不自动把关闭 SDK 当作重下单。
- 订单列表、订阅列表、详情和脱敏报文是业务入口；不要长期埋在临时“设置与调试”页。
- 可在后端响应中提供当前允许动作和原因，三端按统一契约展示，执行时重新核验；不预先锁定字段命名。

### 4.3 历史与诊断

- 后端保存订单和合约历史，设备缓存恢复信息。Android 当前 50 条本地会话上限不应成为后端支付能力的业务限制。
- 本地清理缓存不取消支付、不删除 Provider 合约；重要未完成支付不能静默失去关联。
- 交互时间线关联一次支付的创建请求/响应、SDK 事件、查询、Webhook 接收与处理、实际应答信息，标明来源和时间。
- 报文经过脱敏再保存/展示；不保存 secret、认证信息、PAN/CVV、敏感 token 等原文，不先入库再仅在 UI 遮挡。
- Provider 跳转/管理 URL 可能具有访问能力，应作为受保护的导航信息处理，不能随原始报文公开。为恢复而保存必要 URL 与禁止公开原始 payload 是不同边界，须在契约明确保存、访问和清理策略。
- 诊断记录与支付领域事件分离，不参与支付真值判定，不自动提供任意重放能力。脱敏副本不能用来复验原始签名，应保留验签结果及安全元信息。
- 客户端 SDK 事件缺失不妨碍后台支付收敛；禁止伪造客户端事件补齐时间线。

## 5. 实施前与实施中需要核实的事项

| 事项 | 核实内容 | 依赖方 |
| --- | --- | --- |
| SDK 复用 | 各状态下重新初始化、处理中展示、外部动作恢复、终态/过期识别；不同 SDK 版本与 Web/原生差异 | 文档任务、Codex、Claude |
| Checkout 重开 | 如何判断未发生支付、原 URL 有效性/过期、链接保存与访问、已发生支付后的允许动作 | 文档任务、Codex |
| Direct API 恢复 | 结果未知查询、首次 action 与再次付款边界、新交易标识要求；不得自动重复扣款 | 文档任务、Codex |
| 订阅创建 | 频率/周期字段含义、支持值、金额、模式参数、客户关联及验证来源 | Codex |
| 订阅管理 | 托管页面实际支持操作、URL 有效性；自管理升降级和两种取消的接口与生效语义 | Codex |
| 手动续费 | 接口、必要引用、扣款次数/周期标识、幂等、重复点击和未知结果恢复 | Codex |
| 状态模型 | Payment、Transaction、AUTH、合约各自终态，不能共用一个粗粒度终态判断误封锁操作 | Codex |
| 身份与公开范围 | 按已确认的公开普通演示、内部凭证、会话客户选择和不提供丢失找回实施；核实凭证生命周期、会话过期、数据清理及现有 Token 入口迁移方式 | Codex 定契约，Claude 审阅移动承载 |
| 报文与历史 | 可见字段、脱敏规则、大小限制、保留期限、URL 安全保存、历史过期提示 | Codex 与用户确认 |
| 通知驱动查询 | 持久任务方案、幂等去重、有界重试、乱序/重复通知、通知缺失补偿 | Codex |
| 三端兼容 | API 版本/能力摘要、旧 App 支持范围、平台参数、配置测试与错误展示 | Codex 定契约，Claude 接入 |

不因某项待核实就阻断所有独立工作；对确实影响业务行为的未知点明确列出事实与选项，不编造兼容逻辑。

## 6. Codex / Claude 分工与交接

| 工作 | Codex（Showcase） | Claude（移动端） |
| --- | --- | --- |
| 共同契约 | 维护后端接口、业务规则、允许动作、错误语义和示例 | 审阅可接入性，反馈原生生命周期需求 |
| 支付核心 | 参数校验、创建/恢复/查单、状态、幂等与权限 | 调用接口，不复制服务端状态机或保存商户 secret |
| 客户与订阅 | 客户归属、列表、创建、更新、取消、手动续费 | 客户选择、表单、订阅详情和管理交互 |
| UI | Web Demo | Android，再实现 iOS；原生风格独立，业务语义一致 |
| 回跳 | 可配置地址、默认落地页、必要域名关联文件 | App Link / Universal Link、冷启动/热启动处理 |
| 诊断 | 服务端脱敏记录、访问控制、查询 API | 展示记录、补充安全 SDK 回调事件 |
| 验证 | 领域/路由/数据库测试、Web 浏览器验证 | 构建、UI 验证、设备生命周期及原生支付验收 |
| 部署 | 仅获得明确部署授权后执行后端发布 | 不自行创建第二套支付后端 |

交接以同一份已确认接口契约和响应示例为依据；不要把当前未提交的移动接口当作不可变协议。Claude 负责 Android 与未来 iOS 的平台实现，Codex 不在同一批次修改移动端文件。

Claude 提出的 D1–D5 处理方向：

- D1：旧 Views 仅可作为过渡配置入口；最终按连接、支付参数、SDK 外观分工，具体页面方案待确认。
- D2：取消“打开过就不可再开”的永久限制；按本稿三类支付恢复语义设计，不靠自动归档掩盖恢复问题。
- D3：`AppIconTile` 属移动 UI 实现，按当地组件规则确认；不阻塞后端设计。
- D4：文档主页 `https://developers.onerway.com/` 可作为入口，原生指南另明确定位，不将 Web SDK 文档冒充原生指南。
- D5：稳定 HTTPS 后端是实付验收依赖，未提交迁移/接口需按发布流程交付；隧道仅短期联调，不据此认定独立服务有必要。部署需单独授权。

移动 `CLAUDE.md` 中“商户凭证”、Production 切换、原始报文等与当前 Sandbox/服务端 secret/脱敏边界冲突的内容，需要在实施时由 Claude 同步修正；这不要求重新设计 UI 风格。

## 7. 推进顺序与完成标准

### 推进原则与分工（2026-10-25 同步）

采用“三端统一契约下的 Web 与后端重构”：在现有仓库、Nuxt 技术栈和共享后端部署上推进，不从零重写整个项目，也不长期维护两套兼容业务逻辑。共享后端统一会话、客户、参数规则、幂等、状态与动作许可；三端适配自己的交互、SDK 和回跳。保留经核对仍正确的领域模型、Provider 校验/适配、验签关联及测试，重新组织应用层和数据访问职责。Web 必须迁入同一 v1 契约，不能让新后端成为 Android 专用后端。

三端均以覆盖收银台、各自 SDK、Direct API 为最终目标；支付产品/平台组合仍按独立能力与证据开放，不将目标写成当前全部支持。Direct API 由共享后端持有凭证并执行，客户信息采集与外部动作按具体场景适配，不把商户 API 凭据下放 App。

| 负责人 | 职责 | 边界 |
| --- | --- | --- |
| Codex | 共享后端、统一契约、Web 迁移、数据/旧接口收敛、对应验证 | 不修改 native-sdk；实施前确认实际开发基线，保留其他 worktree 的修改 |
| Claude | Android 首个联调客户端、后续 iOS、平台 SDK/回跳与 UI 适配 | 不另建后端或自行修改业务规则；先审契约，获授权后再实现 |
| 用户 | 开始实施授权、部署及真实交易授权 | 产品选择已确认；文档同步或只读确认不等于开始实施 |

### 阶段 A：讨论收尾与实施前确认

契约多轮审阅已完成，用户产品选择已全部确认：任何已认证请求滑动续期 30 天、不轮换 token、保留 renew 兼容入口；每会话客户上限当前为 20，由服务端配置；U2 自管理到期取消采用本地预约 + 每日补调。U1 新客户自动切换、U3 方案 D、M5 永久最小幂等摘要也已决定，具体语义以第 11–13 节为准，不再重复提问。剩余 Provider 组合/有效期缺口按影响记录，不据此把已确认的业务规则退回未确认。

阶段 A 已收尾。用户现已授权 B0 文档准备，允许提前回写长期契约和首批 OpenAPI/示例；B0 完成后仍停在业务实施前。后端及移动端实施、部署、真实交易分别按明确授权推进，不因会话标题含“实施”放宽范围。

Android 首页假数据成果已在 `redesign/compose-ui-kit` 提交：`e421f5b`（首页及 21 张基准截图）、`7b385b2`（首页成为黄金页面、删除旧范例），不再列为未提交成果。2026-10-26 已只读核对本地提交与工作区，详见下方基线快照；Claude 报告两笔提交尚未推送，本轮未核验实时远端。成果来自此前单独授权，应保留，不能将其当成本轮 v1 移动端业务实施已开始。v1 一次性支付数据层、待继续/恢复假数据流程及 SDK 启动/回跳骨架，待实施授权后由 Claude 首先推进，其他页面同样不提前启动。

### B0：事实、开发基线与首批契约准备

本轮只准备可供 Claude 复核的首条一次性 SDK SALE 契约和脱敏合成示例，核实 Provider 依赖及实际开发基线。Codex 后端会话 `01a173a7-5ad0-73b3-a478-fbb3fc5f9eeb` 同时承接 B0 和未来获授权的后端实现；不另开契约会话。

允许：只读资料/源码/工作区对比，编辑本方案、长期契约、唯一 OpenAPI 与共享示例，使用已有工具校验。禁止：业务代码、native-sdk 修改、客户端生成、依赖安装、数据库迁移、部署、交易、远程业务配置变更及向其他会话发送消息。管理 URL TTL、自管理 expireDate 上限和续费客户动作恢复留到 C，除非影响首批结构。

完成标准：

1. paymentId 有效期/过期行为、防重复扣款、APP×SALE/AUTH/SUBSCRIBE 和 Web Direct 旅程都有证据或准确的未核实范围；逐项明确阻断和可并行工作，不把 Demo 幂等当 Provider 保证。
2. 两个 worktree 的提交、未提交成果和旧消费者已登记，保留所有成果，给出实施基线建议。
3. A1 长期语义迁入契约；首条 SDK SALE 的会话、能力、客户、创建/恢复/查询、启动租约和操作恢复有唯一 OpenAPI 与共享示例。结构实质未知写入 OpenAPI 的 `x-b0-open-questions`，不假装可接入生产。
4. 完成已有工具能覆盖的 JSON、引用及示例结构检查，区分完整 OpenAPI 校验与局部检查；实际响应/响应头、客户端解析、幂等/归属/恢复行为检查随接口实施落地。
5. 第 9 节提供给 Claude 既有审阅会话的简短提示词，由用户转发。报告首批是否可用于契约复核、mock 或真实接入，并停在实施前。

#### B0 开发基线快照（Showcase：2026-10-25；Native：2026-10-26）

| 工作区 | 提交与分支 | 本轮观察与处理 |
| --- | --- | --- |
| `/Users/abel.wang/projects/onerway_payment_showcase` | `6d1adf91f4498e40673331dfc7c17800031d7108`，`abel/issue-8-checkout-3ds` | 原有 Apple Pay 关联文件修改、`.apifox/` 和未跟踪讨论稿保留；B0 文档在此目录准备，源码不迁移 |
| `/Users/abel.wang/projects/onerway-payment-showcase-mobile` | `fa7c4a859c63d33bb5c34e98c539efa37313b2e6`，`codex/native-demo-api` | 与本地缓存 origin/main 相同，未 fetch，不代表实时远端；有 staged/unstaged/untracked 的 mobile v0 与迁移成果，全程只读 |
| `/Users/abel.wang/projects/onerway-native-sdk` | `7b385b27f5ca463b0c4508a1a4dd8b027ea05ef3`，`redesign/compose-ui-kit` | Android 首页成果已提交；tracked 文件无暂存或未暂存改动，仍有未跟踪交付包目录 `Onerway-Native-SDK-20261023/`。未推送为 Claude 报告状态，未实时核验远端；本轮只读 |

Native 本地核对：`e421f5bced287f08e095a0c12d90de4f94ac8989` 提交首页假数据与截图，`7b385b27f5ca463b0c4508a1a4dd8b027ea05ef3` 为其直接后继，确立首页黄金页面并删除旧范例。`android/app/src/screenshots/` 内以 `com.onerway.demo.ui.screens.home.` 开头的 21 张截图均已进入 e421f5b，当前文件逐一与该提交一致。本轮未重新构建、运行测试或验收截图视觉效果；提交说明中的历史验证不当作本轮执行结果。未跟踪交付包不是未提交首页代码，保持原处；未 fetch、切换、重置、提交或推送 Native 分支，也未修改 native-sdk 文件。此同步仅修正基线，B0 授权和实施前停止条件不变。

mobile 未提交文件及 index/worktree 双层摘要快照共 17 个文件，SHA-256 为 `58b517245f555eb4c5265b5a9a97089ddf29b6b734ad849e7467efac2b26ae46`（本轮临时清单 `/tmp/showcase-b0-snapshot/mobile-manifest.json`，不是提交）。

两分支共同祖先为 `1af5c6e49846f077527ae23a8cf961cd2453bff7`，非直接快进关系。mobile 已提交基线包含主目录缺失的 Direct 钱包、Checkout AUTH/订阅、金额编辑和迁移 0008/0009。长期契约第 1–11 节已从该提交同步，未复制 mobile 工作区末尾的旧 v0 契约，也没有同步源码。后续实施应先 fetch 核对最新 main，再在安全隔离基线上定向接入必要的未提交成果和 B0 文档；不在旧分支直接重做这些功能，不自动合并两个 dirty worktree。

mobile 已暂存：`.env.example`、README、契约、gateway/profile/store、attempt、profile/store integration tests；README、契约、store 还有未暂存修正，另有 amount e2e/store 单测修改。未跟踪：`server/api/mobile/`、`server/routes/`、`server/utils/mobile.ts`、`server/db/migrations/0010_native_sdk.sql`、`tests/mobile.test.ts`。其中 0010 仅扩展 integration 约束，不是 v1 会话/客户/操作/outbox 迁移；暂存文档曾写 0008，工作区已修正 0010，不以重置抹掉修正。

旧接口存在真实消费者：native-sdk 的 `android/app/src/main/java/com/onerway/demo/MobilePaymentApi.kt` 调用 `/api/mobile/payment/$action`，`CheckoutViewModel.kt` 使用它。Web 旧接口由 `useSdk.ts`、`useApplePay.ts`、`useGooglePay.ts`、支付/订阅返回页及授权组件消费。旧恢复 Cookie 的 Path 为 `/api/payment`，不会自动发送给 `/api/demo/v1`；切换前须处理历史订单、回跳、迟到通知与恢复凭证，不能只替换客户端路径就删除旧入口。

#### B0 Provider 事实与 Web 范围

**2026-10-26 用户确认范围**：Demo（Web、Android、iOS）只使用 Sandbox，不涉及 beta/uat；生产字典值仅作历史调研背景，不作为 Demo 依据。后续 AUTH、订阅、Checkout、Direct 批次的 Onerway 侧参数与协议以 Onerway 开发者文档为准，按 A1 已确认语义与文档参数补齐 v1 OpenAPI 和共享示例，不再单独列为调研缺口。本文档更新不构成实施授权。

2026-10-25 经 `onerway-developers` 的 list-pages → get-page 回读发布文档；工具未提供发布 revision/更新时间，不把读取日期当发布日期。本轮不查生产交易日志/数据库，不调用业务 API，不制造真实交易样本。

| 事实问题 | 已确认及剩余缺口 | 受影响接口、阻断与可并行部分 |
| --- | --- | --- |
| paymentId 有效期、过期查询/再启动 | 30分钟用户确认；新增用户转交 Claude/糖糖 rhcn-acquiring@f3cd2a75 源码调研，详见长期契约 §13.1 | Demo采用服务端保守继续窗口并禁止到期后启动；Provider 实际关单 cron 频率未核实（不影响 Demo），N 后支付/竞态自动退款留阶段 D Sandbox 实测，不填充未知providerExpiresAt |
| 同 paymentId 重开/提交/并发防重复 | 2026-10-26 用户确认：同一个 paymentId 最多成功扣款一次，user_confirmed；发布文档中的创建去重规则作为补充，不冒充此保证的直接出处 | 移除支持性阻断；保留 U/O 可继续、P/R/A 禁再提交及 Demo 归属/幂等/租约。具体重复响应按既定恢复/查询处理，真实 Sandbox 仍未验收，不要求内部机制审计 |
| APP × SALE/AUTH/SUBSCRIBE | 2026-10-26 用户确认 Android/iOS APP 均支持 AUTH 和 SUBSCRIBE；MCP SDK 创建文档核对 APP、osType 及 AUTH/DIRECT、SALE/SUBSCRIBE 字段。Web SDK 三类场景另有明确发布说明 | APP 支持性为 user_confirmed，Web SDK 场景为 documented；不再标支持性 unverified。首批仍为 Native SALE，AUTH/Web/订阅按既定批次补接口与验证，未交付组合不标 Available |
| 阶段 B Web Direct 旅程 | mobile 已有 Apple Pay / Google Pay 的 US/USD/SALE 钱包链，客户选钱包/金额并在钱包中选卡授权；固定账单/收货测试信息由服务端提供，金额允许范围见长期契约。不是通用 PAN/CVV 表单 | B 的 Web Direct 批次迁移这两条既有旅程及首次外部动作/恢复；不自动扩张卡号直填、APM、Direct AUTH/SUBSCRIBE。首批 SDK OpenAPI 不提前定义钱包 token/action 结构；这些结构在 Web 批次前补齐 |

Provider 防重复的只读定位：知识库 repo `rhcn-acquiring` 的 `acquiring-gateway-impl/src/main/java/com/rh/acquiring/gateway/api/web/TransactionController.java:140–172`，confirmPayment 调用图关联 `RedisKeyConstant.PAYMENT_ID_LOCK`、`prepareSdkConfirmPaymentRetry`、`doAfterSdkConfirmRetry`、`TransactionConcreteService.confirmPayment`；重试服务定位 `api/service/impl/TransRetryServcieImpl.java:451–483`。APP 校验定位 `acquiring-gateway-web/src/main/java/com/rh/acquiring/gateway/service/impl/BaseCheckParamServiceImpl.java:748–777`，图中有 checkSubscription/checkAppDockingMode/checkTxnType。索引时间 `2026-10-20T04:16:22.046Z`，knowledge_commit 为空；未返回方法正文、部署版本或测试正文，故不将锁名/调用图当作并发机制核验通过。本轮用户确认已补齐同 ID 防重复和 APP 组合的支持性依据，不再要求内部锁实现审计。未确认的过期行为仍保留；B0 不自行发送核实消息。


本轮确认已收敛（2026-10-26）：同 paymentId 最多成功扣款一次、Android/iOS APP 支持 AUTH/SUBSCRIBE 均为 user_confirmed；Web SDK 一次性支付、首次订阅、预授权由 MCP 发布文档明确支持，记 documented。长期依据和参数边界见[SDK 场景支持与防重复边界](showcase-contract.md#sdk-场景支持与防重复边界2026-10-26-确认)。AUTH 与 SUBSCRIBE 为两个场景，不表示 AUTH+SUBSCRIBE；本次不实施、不部署、不交易。

Web Direct 迁移的客户旅程与外部动作：

- Apple Pay：选择金额 → Apple 官方钱包按钮 → 服务端商户验证 → 钱包选卡/授权 → 加密 token 瞬时提交共享后端 → `/v1/txn/doTransaction` → 服务端 query。设备、账户和域名仍须满足条件；[Apple Pay 发布指南](https://developers.onerway.com/payments/online-payments/payment-methods/apple-pay)要求校验 validationURL，token 不持久化/不记录。
- Google Pay：选择金额 → Google TEST 钱包选卡/授权 → token 瞬时提交 → Provider 首次 R 的受校验托管 CVC 外跳 → 回跳并查询原支付。CVC 在 Provider 页面输入；不新增商户 CVC 输入。[Google Pay 发布指南](https://developers.onerway.com/payments/online-payments/payment-methods/google-pay)及 [Direct create](https://developers.onerway.com/payments/api-reference/endpoints/direct-create-transaction) 的 google-pay-pan-only-redirect 示例允许 transactionId/paymentId 均为 null，必须保留 merchantTxnId 关联。
- 提交结果未知时只查原商户交易；无有效续接 URL 时保持查询，不能自动重发 token。用户明确再次付款才创建新支付/新标识。首次外部动作属于原流程，不因“中断后只查询”而被删除；[Direct API 接入](https://developers.onerway.com/payments/online-payments/api)的通用动作枚举不等于本轮要实现所有 QR/APM 动作。
- 本地来源为 mobile 已提交基线的 `shared/payment/journey.ts:41–79`、`server/utils/direct-gateway.ts:43–63`、`server/utils/direct.ts:26–29,63–81`、`app/composables/useApplePay.ts`、`useGooglePay.ts:193–216`。钱包 token 不进入永久幂等摘要、日志、outbox 或共享样例；安全 action 投影、导航 URL 保存/恢复期限由 Web Direct 批次补契约。已有手动 token 调试入口不作为三端主链路。

**剩余缺口清单（2026-10-26）**：

- 关单 cron 频率：未核实，不影响 Demo 的保守窗口和方案 D。
- Onerway 回跳是否追加 paymentId：待 SDK 团队确认；merchantTxnId → refresh → App 自有结果页不依赖它，不新增 B0 阻断。
- N 后仍可支付与竞态自动退款：阶段 D Sandbox 实测，当前保留源码调研与推断的证据边界。
- Web Cookie/CSRF：Web 批次前冻结。
- 订阅管理 URL 有效期：开发者文档未覆盖，阶段 C 按“期限未知”兜底（MANAGE_URL_EXPIRY_UNKNOWN），不写成已确认。
- 自管理 expireDate 上限：开发者文档未覆盖，阶段 C 按“期限未知”兜底，不猜测上限或写成已确认。

阶段 C 的续费客户动作恢复仍属既定契约与实施工作，不另列为 Provider 调研缺口。

### 阶段 B：共享后端先形成完整链路，Android 首先联调

交付参数化一次性支付、稳定客户、状态核验、幂等恢复、服务端记录、默认/自定义回跳，以及方案 D 的持久待查任务。按以下顺序推进，而非先做完整 Android 再补后端：

1. **契约先行，再完成共同基础与第一条后端链路**：B0 先落实下述命名、唯一 OpenAPI 和共享示例，由 Claude 在已有审阅会话简短确认；获得后端实施授权后，再实现会话、能力规则、客户、创建/恢复/查询、记录与回跳关联；持久幂等和查询任务一起进入基础，不延后到最后补安全边界。契约检查随首个接口进入，不留到全部功能完成后补做。
2. **Android 并行准备与首先联调**：获实施授权后，Claude 可按契约用明确标记的假数据开发对应界面和数据层。后端就绪后先接一次性原生 SDK 链路：选择客户/金额 → 创建 → 打开 SDK → 关闭或中断 → 找回原支付 → 查询结果。重点验证不重复创建、不永久卡住。上线联调、部署和真实 Sandbox 交易分别遵守用户授权，不能以假数据宣称支付通过。
3. **Web 紧接着迁移，补收银台与 Direct API**：Web 消费同一套 v1 接口，逐条完成三种接入及各自恢复方式，避免后端围绕单一 App 特化。页面按共同功能重新组织，必要部分可替换；不要求三端 UI 完全一致。
4. **iOS 接入稳定契约**：在共享契约经 Android 与 Web 接入检查后实现 iOS，适配其实际公开接口。两端均使用 merchantTxnId → refresh → App 自有结果页；SDK 原界面恢复为独立能力，不依赖 Provider 自动附加 paymentId。
5. **收敛旧实现**：检查外部消费者、存量订单/订阅、回跳、迟到 Webhook 与迁移回滚，完成切换后删除被替代的 Web 恢复链/路由与 mobile v0，不永久保留双状态机。旧业务记录仍需正确关联，不能因页面退役丢失通知或合约。

阶段 B 完成标准：上述三端一次性支付范围及约定接入方式完成对应验证，形成同一套业务规则和接口；各平台未具备的组合明确列出，不能静默删减交付范围或伪标支持。最先交付 Android SDK 只是先打通一条链路，不代表阶段 B 仅交付 Android。恢复、归属、幂等、回跳与 Webhook/客户端/每日扫描三入口按 §11–13 验收；方案 D 正常日扫描兜底约 25 小时的条件见 §12.2。

### 实施时的命名、契约与检查

以下安排适用于 B0 契约准备及后续获授权实施；B0 不生成客户端类型或业务代码：

- **沿用 A1 命名**：以第 11–13 节已确认的名称为起点，不做批量改名或引入同义别名。明确区分 Demo 资源 `id`、Onerway `paymentId`、商户 `merchantTxnId`。JSON 字段使用 lowerCamelCase，标识后缀使用 `Id`；时间字段沿用 `At`、带时区的 ISO 8601 表达，时长注明单位。三端内部遵循各自语言惯例，交换字段与枚举保持一致；发现既有契约冲突先列明影响再处理，不借命名整理改变业务语义。
- **单一结构来源**：B0 中，Codex 将长期业务语义与领域词汇回写 `docs/showcase-contract.md`，在仓库建立唯一 OpenAPI，负责请求、响应、请求/响应头、枚举、必填与可空等结构。核对两个 worktree 后未发现已有业务 OpenAPI，采用第 9 节登记的路径。Markdown 解释业务语义，OpenAPI 定义结构；不维护彼此独立的重复字段表。本稿已迁入正式契约的定义改为引用，保留有效决定与交接记录。
- **分批覆盖**：首批只覆盖首条一次性 SDK 支付链及其会话、客户、能力、恢复等依赖；Claude 确认可接入后再实现。Web、iOS 与阶段 C 所需接口按批次先补契约再实现，不等待全部订阅 OpenAPI 完成才启动首条支付链，也不缩减最终范围。
- **共用示例**：契约旁维护经脱敏的共享请求/响应示例，供服务端验证及 Web、Android、iOS 的 mock 和解析检查复用。样例必须符合 schema，不由各端独立编造同一接口结构。沿用方案 b：成功直接返回资源，订阅/续费使用约定复合结构，分页为 `{items,nextCursor}`，错误为 `{error}`；会话期限只在 `X-Demo-Session-Expires-At` 响应头，不恢复 `{data,session}` 外层。
- **检查跟随接口交付**：首批加入 OpenAPI 有效性、示例符合 schema、服务端实际响应/响应头及客户端示例解析检查；幂等、归属、恢复等业务行为另用相应测试验证，不能仅凭 schema 通过认定行为正确。后续字段变更同批更新契约、示例、消费者影响及必要检查。类型生成在核对三端工具与维护成本后决定，非开工前提；若手写 DTO，同样验证共享示例可解析。mock 和契约检查不替代真实 Sandbox 验收。
- **职责**：Codex 为共享契约的维护方，Claude 审阅移动端可接入性并维护原生实现，不另立移动端契约。通用 skill 或自动同步工具等首条链路稳定后再评估，不作为当前交付依赖。

### 会话与客户端交接

按阶段或职责边界组织会话，不按每个接口拆会话；新开会话须由用户明确授权。本会话完成 B0 后停在业务实施前，文档整理不构成实施授权。

本次补充不改变 A → B → C → D 的阶段顺序，也不新增独立契约阶段或契约会话。阶段 B 的启动顺序明确为：本 Codex 会话完成 B0 基线与首批契约 → Claude 既有审阅会话简短确认 → 用户授权后，本 Codex 会话实现首条后端链路并加入检查，同时已获实施授权的 Claude 开发 Android mock/数据层 → 后端就绪后 Android 联调 → Web 迁移 → iOS 接入 → 核验并收敛旧实现。后续批次复用这一契约先行方式，不因每次补接口重新开会话。

| 时点 | 会话与客户端安排 | 交接要求 |
| --- | --- | --- |
| B0 与后端获实施授权后 | 复用当前 Codex 会话 | B0 先完成文档；获授权后再接续后端实现，不另开契约会话 |
| 首批契约交接 | Claude 在已有审阅会话简短确认 | 只检查 A1 转为 OpenAPI/示例后的结构与接入一致性；无新矛盾不重开产品讨论。仅审阅不要求先获得移动端实施授权 |
| 移动端获 v1 实施授权 | 再开 Claude Android 接入会话 | 保留既有首页成果，首批契约确认后先 mock，与后端实现并行；后端就绪再联调 |
| Android 联调 | 继续双方实施会话 | 后端问题由 Codex 处理，原生问题由 Claude 处理，不来回转移实现职责 |
| Web 迁移 / iOS 接入 | 范围独立或上下文过大时再新开 | Web 在 Codex，iOS 在 Claude；避免多个会话同时修改共享契约或同一后端文件 |
| 阶段 C 订阅与时间线 | 按阶段交接，必要时新开双方会话 | 先补齐本批契约与示例，再各自实现 |
| 部署及真实验收 | B 联调需要时可先准备具体范围，D 集中审查交付 | 分别取得部署、环境及交易授权；不必等 D，也不自行执行 |

每次交接给出目标、非目标、准确路径、分支/commit、未提交差异、已完成与剩余工作、文件归属、验证证据、未核实事实及授权边界。会话链接只提供背景，不能代替文件版本。具体同步方式见第 9 节。

### 阶段 C：订阅与交互记录

在共享支付基础上完成首次订阅配置、模式选择、列表详情、托管页面入口、自管理管理页面、升降级、两种取消、手动续费及脱敏时间线。U2 按第 11.4 节已确认的本地预约 + 每日补调方案实现，不重新等待产品选择；自管理不做自动周期扣款调度。沿用阶段 B 的通知查询任务基础，扩展订阅关联与收敛，不另建状态机或第二套后端。

### 阶段 D：审查、发布与真实验收

按仓库适用检查验证、审查；部署和真实交易依据后续明确授权执行。不能用“Vercel Production”推定已开启 Onerway Production，也不能用 Preview 名称推定数据隔离。

验收应覆盖：

- 创建成功响应丢失 → 恢复同一支付，不重复创建。
- SDK 关闭、刷新、App 重启 → 能找到原支付，按状态继续；不能永久锁死。
- 收银台未付款关闭 → 可重新打开原链接；已完成支付不会被当作待付重复发起。
- Direct API 提交后断网 → 查询原支付；用户明确再付才发起新支付。
- 重复点击、重复/乱序 Webhook、查询失败 → 不重复业务操作、不错误覆盖状态。
- 自定义回跳到商户地址、不回跳、App 已关闭 → 后端仍可收敛，回来可查询结果。
- 同一测试客户新支付 → 保存卡体验有稳定身份；新客户与其他访问者隔离。
- 两种订阅模式 → 首次订阅、查询、升降级、取消按实际协议完成；手动续费不重复扣款，也不自动调度。
- 报文查看 → 归属检查生效、敏感内容脱敏，SDK 回调与服务端确认清楚区分。

自动化、浏览器/设备验证、真实 Sandbox、人工确认分别记录，不把 mock 或历史样本算作本次真实验收。覆盖本次承诺流程即可，不扩张为所有 Provider/渠道异常的完整认证项目。

## 8. 文档任务与事实源

已按用户要求在 onerway-api-next 新建“补充支付中断恢复与复用规则”，模型 GPT 6 Astra、思考强度 medium：

- Chat ID：`01a170d4-e52d-7fb0-8f82-1a6c37f1c57e`。
- 初始任务要求：核实并补齐 SDK/Checkout/Direct API 的中英文恢复与复用说明，区分同实例重试、刷新重建、未知结果查询和重新发起支付，不改两个 Demo 项目、不部署。
- 本稿整理时未核实该文档任务的最终文档差异和验收结果；该聊天后续已有其他工作，不能以聊天空闲或最近一轮完成推定原文档任务已完成。实施前读取对应文档成果。

另有独立只读任务“评估 API Key 鉴权与新旧规范并存”（GPT 6 Astra、medium）：

- Chat ID：`01a17187-c7ba-78e3-b9cb-02b051d69fd9`。
- 依据：[收单新版 API 说明引导文档](https://confluence.ronhan.com/confluence/pages/viewpage.action?pageId=138390904)，本轮读取 Confluence 第 7 版。
- 新版 Header `ApiKey` 与旧版 body `sign` 链路并存，旧商户不强制迁移；Webhook 新增 `x-signature`，加签密钥与 API Key 分离。
- 新域名 `payment-api.ronhan.com` / `payment-api.onerway.com` 的页面冲突、新 Sandbox 入口、新旧 Webhook 兼容、缺失签名处理及算法由该任务核实；不得自行猜测或全局替换。`x-timestamp` 不参与签名，不能独立保证防重放。
- 该任务仅评估，不修改。鉴权争议在该对话讨论，结论返回后再更新共享后端方案；Claude 不重复启动鉴权迁移，也不因此修改移动端凭据模型。商户 API Key、Webhook 验签密钥与 Demo 访问凭证用途不同，前两者始终在服务端。

公开资料：

- [Web SDK 接入](https://developers.onerway.com/zh/payments/online-payments/sdk)
- [托管收银台接入](https://developers.onerway.com/zh/payments/online-payments/checkout)
- [Direct API 创建交易](https://developers.onerway.com/payments/api-reference/endpoints/direct-create-transaction)

本地事实源：各项目 `AGENTS.md`；Showcase `docs/showcase-contract.md`；移动项目 `CLAUDE.md`、`android/README.md`；两份 `Onerway_Android_SDK_商户接入指南_完整版.md` / `Onerway_iOS_SDK_商户接入指南_完整版.md`。旧限制不能反向证明 Provider 不支持用户已确认的能力。

## 9. 给 Claude 的 B0 复核交接

采用“共享文件 + 用户转发简短通知”。Codex 维护共享后端、Web、契约与示例；Claude 负责 Android/iOS。首批契约在 Claude 既有审阅会话复核；正式移动端接入获授权后再开接入会话。B0 与未来后端实现复用本 Codex 会话，不自行发送消息、创建会话或建立消息桥。

### 唯一来源与版本

本批根目录是 `/Users/abel.wang/projects/onerway_payment_showcase`，分支 `abel/issue-8-checkout-3ds`、HEAD `6d1adf91f4498e40673331dfc7c17800031d7108`。以下成果均未提交，不能用 HEAD 代表内容：

| 文件 | 责任与版本 |
| --- | --- |
| `docs/showcase-contract.md` | 长期业务语义；第 1–11 节文档基线为 fa7c4a8，第 12–13 节为未实现 v1 目标 |
| `docs/api/demo-v1.openapi.json` | 唯一首批结构，版本 `0.1.0-b0`；SDK SALE 及依赖；x-b0-structural-decisions 明列形状候选，x-b0-open-questions 明列未知 |
| `docs/api/demo-v1.examples.json` | 同版本共享合成样例；用于 schema/DTO 解析，不是实测报文、可执行请求或可用服务 |
| `docs/demo-expansion-discussion.md` | 第 7 节阶段/事实/基线，第 9 节交接；第 11–12 节为迁移索引，第 13 节为历史审阅增量 |

首批覆盖连接、会话、客户、能力、Native SDK SALE 创建/恢复/查询、启动租约/释放和 Operation 恢复。Android/iOS 共用交换字段，保留 A1 命名；Web Cookie/CSRF 细节和 Web SDK 启动、Checkout/Direct 的请求/action、AUTH 资金操作、订阅/时间线按后续批次补齐。首条链路优先不缩减阶段 B 最终范围。

### 可接入性与验证边界

最新合并复核结论：Claude 确认可作为首批实现依据；本轮修订 B2/B4/B5 并保留已完成 B1、preset、B3。源码调研来自用户转交的 Claude/糖糖 `rhcn-acquiring@f3cd2a75` 报告，本端未独立复核源码；事实、推断与运行时未知分别见长期契约 §13.1。新修订需交回 Claude 简短确认，未开始实施。

Claude 已按此前 §9 三文件 SHA-256 快照完成只读复核：jsonschema 4.25 独立校验 42 个示例通过，状态码/响应头与首条链路字段关联完整；结论为结构可接入。SessionView/CustomerCreated、202 Operation、204 及 combinations 容器均已接受。本轮已按反馈修订四项：conditional 客户端/服务端放行并提示证据；客户端响应前向兼容与未知枚举兜底；固定 app_android/app_ios 回跳预设；currentCustomerId 不参与支付 revision 比较。修订后的新快照尚未经 Claude 再次回读。

同时明确 payment_create 优先按 requestId 查询恢复，/connection 以 X-Demo-Client 为准且查询参数不得冲突。本轮已采用 PAYMENT_EXPIRED 与服务端创建请求发送时间 + TTL 配置快照的保守窗口，不填充 providerExpiresAt。输入边界、错误码目录和 Provider 过期行为不阻断首批结构接入；label 40、cursor 512、custom URL 2048 及本轮提出的错误码已冻结，Web 接入前冻结 Cookie/CSRF。结构可接入不等于实施授权：仍未开始 DTO、mock、业务实现、部署或交易。
paymentId 的 30 分钟有效期、同 ID 最多成功扣款一次、Android/iOS APP 支持 AUTH/SUBSCRIBE 均已获用户确认；Web SDK 一次性支付/首次订阅/预授权已据 MCP 文档核对。过期行为仍按第 7 节记录。U/O/P/R/A 的用户确认不撤回，也不标成真实 Sandbox 通过。管理链接与自管理续费缺口属于 C，不扩张 B0。

静态检查已完成：14 个路径、16 个操作、43 个 schema、226 个内部引用及 45 个合成请求/响应/响应头示例通过现有 Python jsonschema 2020-12 检查；同时检查路径参数、operationId 唯一性、204 无 body、401 不续期和 429 等待时间一致。未安装完整 OpenAPI 验证器，不能将这些检查称为完整 OAS 合规验证。未运行服务端实际响应、原生 DTO 解析、业务测试、数据库或 Sandbox 交易。临时复验命令为 `python3 /private/tmp/showcase-b0-validate.py`（不作为长期维护入口，不安装依赖）。

独立定向复核已修复并回读确认：恢复 GET 的跨会话 409、支付中新客户创建后的实际 currentCustomerId、可信查询成功的共享示例。契约迁移补回 Operation 未受理/占位/unknown 语义和全额请款限制，修正回跳关联引用。实际请求/响应/响应头验证、原生解析，以及归属、同键并发/参数冲突、创建未知恢复、租约接替/释放、状态动作和查询任务三入口检查随首个接口实现落地；静态结构通过不证明这些运行时行为。

未提交产物 SHA-256（Claude 反馈修订后的增量复核快照）：

| 文件 | SHA-256 |
| --- | --- |
| `docs/showcase-contract.md` | `8fa4be8db41a0280e5f7aa7851aee5a43791ba0db71ded244f06ccceacc7c82d` |
| `docs/api/demo-v1.openapi.json` | `3cc4804f8addf74837d3c322324a9daddcafbe4f65832b90d0884c3118f6e1ac` |
| `docs/api/demo-v1.examples.json` | `f95f42b3fb4c79e096fa97108422e0dcde40c8f75cf2659a211e1ee797983a09` |

本方案以本节所列候选为交接快照；后续文件变化须更新摘要后再转交。原 Apple Pay 关联文件和 .apifox 文件内容未变；mobile 的 17 个未提交文件及 index 层与第 7 节快照一致。未提交、推送或修改分支。

### 用户转发提示词

```text
请在本既有审阅会话只读增量复核 B0 首批契约，仅确认最新 B1–B5 与 preset 反馈是否闭环，不重开 A1 全面需求讨论。
实际根目录：/Users/abel.wang/projects/onerway_payment_showcase
分支/HEAD：abel/issue-8-checkout-3ds / 6d1adf91f4498e40673331dfc7c17800031d7108；本批文档均未提交，以本节 SHA-256 快照核对。
读取 docs/showcase-contract.md 第12–13节、docs/api/demo-v1.openapi.json、docs/api/demo-v1.examples.json；协作和基线看 docs/demo-expansion-discussion.md 第7、9节。业务契约第1–11节已同步较新 fa7c4a8 文档，但业务源码未同步。
变化：conditional 在客户端和服务端均允许执行并展示证据等级；严格响应 schema 只校验服务端输出/示例，客户端忽略未知字段，未知枚举安全降级；app_android/app_ios 固定回跳路径由服务端解析；currentCustomerId 不参与支付 revision 比较。另明确 payment_create 优先 GET /payment-requests/{requestId}，/connection 头优先且查询参数冲突返回400。新增保守过期窗口、PAYMENT_EXPIRED、可信资金结果 N→S 合并与异常记录；退款表达登记为已知后续缺口。补齐所有未知枚举兜底及不提高 minimumClientBuild 的规则，冻结输入边界/401错误码。
请仅检查以上修订是否解决最新 B1–B5、preset 及输入边界及是否引入具体矛盾。共享示例现为45个，新增窗口过期、refresh=running、N后可信成功视图；不要把结构通过写成运行时验证、真实交易通过或实施授权。无问题则简短确认首批契约可作为实施依据；有问题请给文件定位、影响和最小修订建议。
源码基线另见 /Users/abel.wang/projects/onerway-payment-showcase-mobile：fa7c4a8 + 未提交mobile v0/0010迁移，存在实际Android消费者，不能删除/覆盖。Codex负责共享后端/Web，Claude负责Android/iOS；当前仅复核，正式移动端实施再开接入会话。
禁止编辑代码、native-sdk或共享文档，禁止生成客户端/安装依赖、部署、交易、改远程配置或发消息给其他会话。B0结束停在业务实施前，反馈直接回复用户。
```

## 10. 阶段 A 核实结论（2026-10-25）

证据分级：**发布文档**表示公开描述，**源码**表示所读版本实现，**用户确认**表示本次业务要求，三者都不等同于真实 Sandbox 验收。本轮未运行 SDK、未发起交易、未查生产数据、未修改移动文件。Showcase mobile worktree HEAD `fa7c4a8`，native 仓库 HEAD `8336120`；未提交内容可能改变行为，应以列出的文件核对，不以 HEAD 代表整份工作区。

### 10.1 原生 SDK 恢复与 APP 场景

Android 当前依赖 `onerway-android:0.1.5`（`android/app/build.gradle.kts:56`）。随包 `core-0.1.5-sources.jar`、`ui-0.1.5-sources.jar` 位于 `android/local-maven/onerway-android-0.1.5/com/onerway/sdk/`；本轮直接读取 JAR 内源码，不改包。

| 问题 | 代码/文档事实 | 不能据此宣称的内容 |
| --- | --- | --- |
| 同 paymentId 再次 present | `ui…!com/onerway/sdk/ui/OnerwayCheckout.kt:50–97,265–277` 只阻止未回调的并发展示；回调清锁后可再次传同 ID。Demo `CheckoutViewModel.kt:86–94,198–210` 的永久 `checkoutStarted` 拦截是宿主限制 | 入口接受不证明各状态下可安全重复确认扣款 |
| 首屏状态恢复 | `core…!com/onerway/sdk/core/session/CheckoutStore.kt:354–480` 加载字段、订单详情后构建表单，没有按 U/P/R/A/N 实现专用恢复分支 | 不能把重开表单等同于恢复原支付阶段 |
| U | `core…!com/onerway/sdk/core/model/Models.kt:13–25` 的客户端结果枚举没有 U，未知码映射 UNKNOWN | 不能把客户端结果枚举当作服务端 Payment 状态全集 |
| P / A | `CheckoutStore.kt:1126–1133,1359–1389` 提交后会有界查询，仍未完成则回传对应状态 | 这是提交后流程，不证明再次 present 的具体行为；A 的授权资金动作与普通支付终态须分开 |
| R / 3DS / 已外跳 | `CheckoutStore.kt:1080–1114,1219–1258` 有外跳及返回查单；`OnerwayCheckout.kt:92–93` 新 present 会清除旧外跳上下文 | 不能承诺重新 present 会恢复原 3DS；优先恢复现有 return 上下文，缺失时查询并明确可用动作 |
| N | `PaymentResultPolicy.kt:28`、`CheckoutStore.kt:1136–1146` 展示未完成结果 | 未证明 N 原支付能再次扣款；它不在用户“未终态可复用”承诺内 |
| 明确的实例内重试 | `PaymentResultPolicy.kt:29–33`、`CheckoutStore.kt:1177` 对 transaction F + payment O 保留表单重试 | 不能推广为所有非终态均可自动再次 submit |
| 有效期 | `RedirectReturnSupport.kt:94–105,132–149` 的恢复上下文为 30 分钟；Demo 的 29 天为本地 create 恢复窗口 | 两者都不是 paymentId 有效期；阶段 A 当时未查到 paymentId 有效期；2026-10-26 用户已确认为 30 分钟 |
| 重复扣款防护 | SDK 有会话锁、提交锁、回调/回跳查询去重；Demo 应保证自己创建及资金操作幂等 | 没有 Provider 跨会话重复扣款保证的代码/实测证据，不写“SDK 自动保证不会重复扣款” |

iOS 当前本地只有指南，没有可检查的 iOS 工程/固定 SDK 源码版本；不能套用 Android 0.1.5 的具体行为。用户确认的“非终态 paymentId 可复用”仍是目标，状态级规则已由后续用户确认补齐，同 paymentId 最多成功扣款一次于2026-10-26确认；不将证据缺口改写成永久 query-only 产品规则。

发布的 [创建 SDK 交易](https://developers.onerway.com/zh/payments/api-reference/endpoints/sdk-create-transaction) 同时列出 `paymentMode=APP`、`osType=ANDROID|IOS`、`txnType=SALE|AUTH`、`subProductType=SUBSCRIBE` 及订阅参数。**字段层面允许表达这些组合，但不是 APP×AUTH/SUBSCRIBE 已验收证据。** 知识库定位到 `rhcn-acquiring/acquiring-gateway-web/src/main/java/com/rh/acquiring/gateway/web/SdkController.java:73–126` 及 `checkSdkParam/checkApiProductParam` 调用；返回的是调用图，没有提供完整校验源码与部署 revision，不能据图证明组合已放行。索引时间 `2026-10-20T04:16:22.046Z`。当时未进行 APP 交易。2026-10-26 用户已确认 Android/iOS APP 支持 AUTH/SUBSCRIBE，支持性现记 user_confirmed；真实验收仍未完成，未交付能力不标 Available。

### 10.2 订阅协议已核实部分

来源：[订阅支付](https://developers.onerway.com/zh/payments/online-payments/scenarios/subscriptions)、[创建 SDK 交易](https://developers.onerway.com/zh/payments/api-reference/endpoints/sdk-create-transaction)、[创建直连交易](https://developers.onerway.com/zh/payments/api-reference/endpoints/direct-create-transaction)、[取消订阅合约](https://developers.onerway.com/zh/payments/api-reference/endpoints/cancel-subscription-contract)、[查询订阅详情](https://developers.onerway.com/zh/payments/api-reference/endpoints/query-subscription-details)，本轮经 onerway-developers MCP 读取；工具未返回发布 SHA。

| 字段/操作 | 发布文档说明 |
| --- | --- |
| selfExecute | `1` Onerway 托管自动扣款；`2` 商户自管理、主动发起后续扣款 |
| mode | `1` 仅授权、由商户发起首期，仅自管理；`2` 默认，客户授权后完成首期扣款。不是托管/自管理开关 |
| frequencyType / frequencyPoint | 托管 D={1,7,14}、M={1,3,6}、Y={1}；自管理仅 D，周期为天数，不是自动扣款指令。不把 30 天显示成自然月 |
| cycleCount / expireDate | 托管周期数 1–99；自管理不支持 cycleCount。expireDate 字段也描述最大 99 期，但同页自管理示例给远期日期，适用范围存在疑问，需核对后再公布自管理上限 |
| 首次订阅 | requestType=0，创建 SDK/Checkout 或 Direct API；客户标识内外层同传必须一致 |
| 手动续费 | `/v1/txn/doTransaction`，SUBSCRIBE + requestType=1，服务端使用合约与订阅 token，金额由商户指定，可不同于首期；新业务动作使用新交易标识 |
| 托管升降级 | 同 Direct API，requestType=2；changeMode=1 立即，=2 下期。prorationMode=1 平台计算，=0 商户传差价；降级不代表自动退款 |
| 自管理升降级 | 文档没有给自管理 requestType=2 的支持承诺；不能照搬托管接口。可考虑本地条款版本决定后续手动扣款，但这是待确认商户业务规则，不是 Provider 合约已变更 |
| 取消 | `/v1/txn/sub/cancel`；托管 expireMode=1 立即、=2 周期末、=3 指定日期。自管理取消立即生效 |
| 预约取消结果 | 返回 data="3" 只表示请求处理成功；预约后 dataStatus=3、subscriptionStatus 可仍 active，实际 canceled 才代表生效；不能把前者当最终取消 |
| 详情/列表 | `/v1/txn/sub/detail` 按 contractId 查询单份详情；不提供列表。Demo 列表来自本地已关联合约，不扫商户全部订阅 |
| subscriptionManageUrl | 创建响应具有该字段，指南用于托管客户自助管理/换卡。未找到 Provider URL 的明确 TTL 或刷新/重签 API。查询详情文档未提供该字段，不能假设随时可从详情接口重新取得 |

**待用户/协议确认的实质差异**：自管理的到期取消不能直接发送 expireMode=2 并宣称预约成功。若提供商户侧周期末停用，需要持久调度只执行取消（不扣款），并明确生效时区、周期锚点、已发起续费；它不在本轮已确认“手动续费”里自动获得授权。当前草案保留该能力但标 `decision_required`。自管理升降级是本地未来扣款条款变更还是额外 Provider 操作，也需确认。不要为避免问题而默默删除用户要求。

### 10.3 其他核实与源码出处

以下相对路径均基于 `/Users/abel.wang/projects/onerway-payment-showcase-mobile` 的当前工作区：

| 项目 | 已核实事实 | 草案处理 |
| --- | --- | --- |
| 客户 | `server/utils/mobile.ts:58–66` 每新请求创建 customer；Web 已沿恢复链复用。原生指南未承诺 saved card 回显，本轮没有设备证据 | 独立 session-owned Customer 记录，同一引用稳定映射 merchantCustId；保存卡回显作为原生待验项，不能以传 ID 当作已绑卡 |
| 会话 | `server/utils/recovery.ts:10,34–56` 是含订单引用的签名 Cookie；mobile 全局 Bearer 不区分会话所有者 | 新会话用不透明凭证，requestId 不是权限；v0 不保兼容 |
| 保留 | `server/utils/store.ts:2416–2441` Payment 按创建时间 30 天清理，合约独立保留；契约记录终态清 token、再保留 30 天 | 分开会话期限、记录期限、Provider paymentId 期限，禁止合并成一个 expiresAt |
| 过期创建重放 | `mobile.ts:27–30,58–79` + `store.ts:747–756`：清理后同 ID 可再次进入创建分支 | 保留服务端幂等 tombstone，或拒绝原作用域全部请求，不能只信客户端 29 天检查 |
| Webhook 查询 | `server/api/webhooks/onerway/payment.post.ts:39–51` 订阅查询同步在 ACK 前；无持久 outbox | 事务记录通知与待查任务，可靠 worker 查询后投影；先受限接收后核验的边界需在实施契约修订 |
| 限流 | `server/utils/limit.ts:47–68` 的 Map 为进程内 IP 桶，mobile 独立实例；不是跨实例、会话级额度 | 会话操作桶为主，可信 IP/全局桶保护注册与总负载，多个用户共享出口不共享一份极低支付额度 |
| 调度 | `vercel.json` 仅每日 cleanup Cron | 现状不能保证 Webhook 后及时异步查询；必须核实可用调度频率/任务唤醒能力 |

App Link：Android Manifest 目前无 HTTPS VIEW/BROWSABLE，宿主无回跳处理；本地未见两份关联文件。`public/.well-known/apple-developer-merchantid-domain-association.txt` 是 Apple Pay 文件，不能替代 AASA。iOS 工程未建立。线上域名文件未查，因此这里只证明本地缺口。

## 11. A1 契约迁移索引

已确认业务语义已迁入长期契约，首批请求/响应结构以 OpenAPI 为准；本节不再维护重复字段定义。历史审阅中的 §11.x 可通过下列索引定位。

### 11.1 会话、连接与规则

见 [长期契约 §12.1](showcase-contract.md#121-会话连接与规则)。首批结构见 [OpenAPI](api/demo-v1.openapi.json)，示例见 [共享示例](api/demo-v1.examples.json)。

### 11.2 支付接口与幂等

见 [长期契约 §12.2](showcase-contract.md#122-支付接口与幂等)。首批结构见 [OpenAPI](api/demo-v1.openapi.json)，示例见 [共享示例](api/demo-v1.examples.json)。

### 11.3 支付视图与动作

见 [长期契约 §12.3](showcase-contract.md#123-支付视图与动作)。首批结构见 [OpenAPI](api/demo-v1.openapi.json)，示例见 [共享示例](api/demo-v1.examples.json)。

### 11.4 订阅接口

见 [长期契约 §12.4](showcase-contract.md#124-订阅接口)。首批结构见 [OpenAPI](api/demo-v1.openapi.json)，示例见 [共享示例](api/demo-v1.examples.json)。

### 11.5 时间线与客户端摘要

见 [长期契约 §12.5](showcase-contract.md#125-时间线与客户端摘要)。首批结构见 [OpenAPI](api/demo-v1.openapi.json)，示例见 [共享示例](api/demo-v1.examples.json)。

### 11.6 统一错误与过期

见 [长期契约 §12.6](showcase-contract.md#126-统一错误与过期)。首批结构见 [OpenAPI](api/demo-v1.openapi.json)，示例见 [共享示例](api/demo-v1.examples.json)。

### 11.7 returnUrl 与关联文件

见 [长期契约 §12.7](showcase-contract.md#127-returnurl-与关联文件)。首批结构见 [OpenAPI](api/demo-v1.openapi.json)，示例见 [共享示例](api/demo-v1.examples.json)。

## 12. 生命周期迁移索引

### 12.1 三个期限独立

见 [长期契约 §13.1](showcase-contract.md#131-三个期限独立)。

### 12.2 可靠查询任务

见 [长期契约 §13.2](showcase-contract.md#132-可靠查询任务)。

### 12.3 限流

见 [长期契约 §13.3](showcase-contract.md#133-限流)。

## 13. 反馈回复、待决策与第三轮修订确认

本节以 Claude 完整编号稿（F1–F6、B1–B14、Q1–Q10、U1–U3）为依据；仅修订第 11–13 节。第 10 节保留此前核实快照，不回写历史，新增核实与更正以本节为准。本稿仍是 A1 讨论稿，不是已实现契约。Claude 第三轮已确认无新增阻断、B1/B2 在契约层面闭环，并接受跨进程恢复依据及场景占位 ID 的更正；本轮处理其 M1–M5、O1，等待简短确认，不等于实施授权或真实 Sandbox 验收。

### 13.1 F1–F6 核实结果

源码证据：Showcase 路径以 `/Users/abel.wang/projects/onerway-payment-showcase-mobile` 为根；Native 以 `/Users/abel.wang/projects/onerway-native-sdk` 为根。下述 SDK 路径属于 `android/local-maven/onerway-android-0.1.5/com/onerway/sdk/ui/0.1.5/ui-0.1.5-sources.jar` 内的 `com/onerway/sdk/ui/`，不是工作区解压源码。未运行 SDK 或发起交易。

| 编号 | 本轮核实 | 草案修订/尚缺证据 |
| --- | --- | --- |
| F1 iOS Sandbox | 交付包 iOS 1.0.0 的公开 Swift interface :116、:118、:123–128 明确有 .sandbox，present/resumeFromReturn 默认 .production，无 configure(merchantId) | 支持性证据改为 source_checked；真实 Sandbox 验收仍 unverified。指南仅写 Production 是资料缺口，不构成实现门禁 |
| F2 服务端恢复策略 | `OnerwayCheckout.kt:79–94` 新 present 清理 redirect context；`:116–158` 由 App Link 与本地上下文恢复，后端不知道上下文是否存在 | 删除 present/resume_return 策略字段，服务端只给 present 信息和动作许可；回跳交 SDK handler，false/异常只 refresh，不重建支付 |
| F3 回跳 paymentId | 用户确认商户创建时传 returnUrl，Demo 后端拼 merchantTxnId；Provider 是否自动附 paymentId 尚待 SDK 团队确认 | 按不会附加设计：App 匹配本会话引用并 refresh 展示自有结果页；SDK resumeFromReturn false 走同一路径，不依赖它。不得声称已有自动附加承诺 |
| F4 decision_required | A1 确有将决策状态与 availability 混写的问题 | 不新增 availability 值；待产品决定用 planned + PRODUCT_DECISION_PENDING，动作 disabled。本节决策登记仍写 decision_required；Provider 未核实另用 conditional/unverified |
| F5 会话作用域与 404 | 旧草案 session+key 会让新会话查不到旧键，结合“404 可创建”确有重放风险 | 改环境内全局认领 + 客户端原会话分区；跨所有者 409 不带视图，404 不是原请求必未执行的证明。尚未到服务器的请求须由客户端分区保护 |
| F6 客户创建 | `server/utils/customer.ts:25–33` 同步返回本地对象和随机 merchantCustId，没有网络调用；`mobile.ts:66` 把它交本地持久化；`gateway.ts:1190–1203` 将该 ID 放支付请求 | 删除“Provider 客户创建结果未知”与臆造的上游创建流程；稳定客户是本地记录和稳定 ID，默认客户懒创建，显式新建仍幂等。这里只否定当前 Demo 有独立客户创建调用，不推断 Provider 没有客户 API |

B1 的事实修正：`CheckoutActivity.kt:72–79` 会关闭无内存会话的系统重建 Activity，但 `OnerwayCheckout.kt:137–140,212–216` 允许有条件的显式跨进程恢复；“后端会话凭证只对应一个进程”没有证据。SDK 进程内锁不能代替后端幂等，故采用接替+释放而非删除原生并发保护。配置指纹精确包含 merchantId/environment/resolveBaseUrl（`RedirectReturnSupport.kt:146–150`）；不是所有配置字段，也不是 Demo configRevision。

B14 的事实修正：`HomeViewModel.kt:27–36` 的四场景 ID 明确是待契约对齐的占位值；本稿建议固定这些名称，不能写成当前 App 已真实接入。`android/app/build.gradle.kts:12–16,56` 声明 versionCode=1、SDK 0.1.5，不代表已安装 APK 版本。

### 13.2 Q1–Q10 逐条回复

以下“采纳”表示采纳进讨论草案，不表示获得实现、发布或交易授权。

| 问题 | 结论 | 理由与具体处理 |
| --- | --- | --- |
| Q1 租约方案（B1） | **采纳方案 a** | 增加 supersedes 与 DELETE 释放，原子接替、同操作回读、旧租约不能释放新租约；建议短 TTL 不续用，崩溃无需等 3DS 窗口结束。R 回跳不要求租约有效。未选 b：原生进程锁不能证明后端所有并发都被排除；两端统一契约减少维护分叉。见 §11.3 |
| Q2 全局认领（B2） | **采纳** | 环境内全局 requestId/operationId 认领，跨会话 409 IDEMPOTENCY_KEY_UNAVAILABLE 无视图，客户端分区保留旧记录。用户已确认只含哈希与标记的最小认领摘要永久保留、不做删除机制；支付明细仍按期清理。见 §11.2、§12.1 |
| Q3 非契约响应/并发/429（B3） | **采纳** | 无结构化应用结果视为 unknown；原会话原键恢复，同键并发 202。应用层 429=not_started，已认领先回读；CDN/网关非契约错误不能承诺同样语义，不能按 HTTP 重扣。见 §11.6 |
| Q4 删除 resume_return（B4/F2） | **采纳** | 后端不指挥设备恢复上下文；R 按用户确认禁止再提交，保留 QUERY/SDK 回跳；U/O 可继续、P 禁止提交、A 禁止再付款。handler 返回 true/false 都不是交易结果。见 §11.3 |
| Q5 闭集（B6/B13） | **采纳** | 支付/来源/创建/资金、时间线/验签、订阅/动作/原因码均在 §11.3–11.6 给出；新增 unknown 安全视图、not_applicable、cancel_scheduled 与 operation.outcome。预约受理不提前变 canceled，未知枚举不开放资金动作 |
| Q6 场景/预设/频率（B14） | **采纳** | scenes 为 one_time/pre_auth/subscription_hosted/subscription_merchant；presets 为 usd_standard_5/usd_3ds_50，按组合门禁。托管 D1/D7/D14/M1/M3/M6/Y1，自管理 days；requiredWhen 限单层。名称是新草案建议，金额预设不是 3DS 保证。见 §11.1、§11.4 |
| Q7 版本与续期（B10/B11） | **已确认** | 每请求版本 header 保留；任何已认证请求滑动 30 天、不轮换 token、不设绝对寿命；renew 保留兼容入口。响应头统一携带实际会话期限，JSON 不加入 session。iOS 整数构建号已确认。见 §11.1、§12.1 |
| Q8 客户创建（B12/F6） | **采纳懒创建；纠正上游假设** | 当前无独立上游客户创建调用；默认 Customer 与支付认领在本地事务创建/关联，保持同 ID。新增客户额度字段和错误码，当前配置值 20，含创建占位、客户端不写死；U1 已确认新建成功自动切换，最后成功提交为准，重放不再切换。见 §11.1 |
| Q9 Web 迁移/旧路由 | **采纳** | 阶段 B 迁一次性支付和恢复，阶段 C 补订阅/时间线；完成标准包含无外部消费者检查、存量数据/恢复迁移、回滚与同等恢复验收，满足后删除被替代路径。不能仅新客户端上线就删旧 Cookie 记录入口。见 §11 开头 |
| Q10 转交 Provider 核实 | **采纳，已收到核实回复** | 用户明确允许后，向“补充支付中断恢复与复用规则”发送精简核实请求，仅 F1、F3、U/P/R/A 再 present/TTL/防重复边界，不授权改文档、实施或交易。早前回复未补齐文档证据；F1 后由交付包升级为 source_checked；状态级 present 规则记 user_confirmed，F3 按不追加设计。仍不把用户确认等同真实验收 |

转交目标：[补充支付中断恢复与复用规则](codex://threads/01a170d4-e52d-7fb0-8f82-1a6c37f1c57e)。其此前只读回复是历史证据缺口记录；本轮新增的用户/Onerway 侧确认替代 iOS Sandbox 与 U/O/P/R/A 规则的旧待核实判断。尚待 SDK 团队确认的自动附加 paymentId 与过期行为独立保留；TTL 30 分钟、同 paymentId 最多成功扣款一次、APP 支持 AUTH/SUBSCRIBE 已于 2026-10-26 获用户确认，移出支持性待核实项。重复提交的具体响应仍遵循现有恢复规则，不设新的全面核实门禁；本轮未向外另发消息或操作 SDK。

其他反馈闭环：B5 采纳公开 SDK 配置并补原分区本地快照；B7 采纳 attention 和列表摘要；B8 采纳有界前台 GET 轮询；B9 采纳阶段 C 白名单 client-events，允许无租约的安全回跳摘要且仍验归属。B13 采纳动作/预约/链接不可用态，但“续费需客户动作只展示状态”只能是未核实兜底，不算完整交付。第 4 节建议 1–3 采纳应用层演进、Web 迁移和领域拆分；建议 4 合并为 /requests **不采纳**，两类恢复端点消费简单、底层共用认领即可，不为省路径引入多态响应；建议 5 不删除原生租约；renew 已确认保留兼容入口；建议 6 已由用户选定 D：outbox + 同调用尽力查询 + 客户端读取/刷新 + 每日扫描，阶段 B 以 §12.2 已确认边界验收。第 7 节稳定边界继续保留，不新增通用规则引擎、UI 颜色/文案、推送、跨端同步或 Direct API 自动重扣。

### 13.3 U1–U3 决定登记

| 编号 | 状态 | 决定/尚待决定内容 |
| --- | --- | --- |
| U1 new 是否成为当前客户 | confirmed | 新建测试客户成功自动切换；并发以服务端最后成功事务提交为准，响应返回实际 currentCustomerId，幂等重放不再切换 |
| U2 自管理到期取消 | confirmed | 本地持久预约→立即禁手动续费→最近成功扣款时间加 UTC days 形成 localCancelEffectiveAt→每日 Cron 立即取消并查询确认；来源 demo，失败次日继续，多轮失败 needs_attention，仍可手动立即取消；托管仍用 Provider expireMode=2 |
| U3 后台唤醒与费用 | confirmed | 选 D，不新增高频 Cron/队列/外部触发；outbox 加三种查询入口，正常日扫描兜底约 25 小时，不再追求约 1 分钟；阶段 B 验收边界见 §12.2 |

用户产品选择已全部确认：U1/U2/U3、M5、滑动续期/renew 兼容、客户上限 20 均无 decision_required 阻断；仍未获得实施授权。第 7 节推进安排与第 9 节协作入口现已同步；第 10 节保留历史核实快照，其中旧待决定表述以本节当前决定为准，不重开产品选择。

仍待事实核实，不能扩张承诺：Onerway 回跳是否附加 paymentId（SDK 团队）、paymentId 过期行为（有效期已确认 30 分钟）、管理 URL TTL、自管理 expireDate 上限、续费需客户动作时的恢复链及全部真实 Sandbox 验收。自管理升降级适配仍按实际协议补证，不列为新的用户待选择项，也不据此伪造 Provider 支持。

### 13.4 相对上一版 A1 的接口与字段改动清单

| 类别 | 新增/修改/删除 |
| --- | --- |
| 新增接口 | DELETE /payments/{id}/checkout-sessions/{checkoutSessionId}，仅幂等释放自己的指定租约 |
| 修改连接/版本 | /connection 输入 clientVersion → clientBuild，minimumClientVersion → minimumClientBuild；新增 sdk.merchantNo/environment/configRevision；/sessions 输入同步，新增 X-Demo-Client 请求头和 426 错误；/session/renew **保留** |
| 修改能力 | scenes[]、presets[]、组合适用范围；limits.customersPerSession；有限 requiredWhen；待决策 planned+PRODUCT_DECISION_PENDING，不添加 decision_required 枚举 |
| 修改客户 | 默认客户懒生成本地 ID，currentCustomerId 可 null，响应返回实际当前引用；删除“独立 Provider 客户创建/结果未知”假设，已有 POST operationId 保留 |
| 修改启动 | 请求增加 supersedes；响应明确 checkoutSessionId/leaseExpiresAt/revision/sdk.configRevision；409 同所有者冲突可带租约引用；删除 present/resume_return 恢复策略字段；新增 ended 错误，不把已结束租约回读为有效启动票据 |
| 修改幂等/错误 | session+key → 环境内全局键认领，客户端原分区；完善 202/404/409/410/429 与非 JSON unknown；新增 IDEMPOTENCY_KEY_UNAVAILABLE、CUSTOMER_LIMIT_REACHED、CHECKOUT_SESSION_ENDED、CLIENT_VERSION_UNSUPPORTED 等稳定码 |
| 修改支付视图 | attentionKind → attention 对象/null；明确列表摘要与 provider=null；补齐状态闭集、unknown/not_applicable、安全来源；refresh 新增 lastAttemptAt/pollAfterSeconds，保留 lastErrorCode；不新增恢复创建动作 |
| 修改订阅 | frequency unit/interval → 托管组合码或自管理 days；refresh 统一结构；新增/明确 cancel_scheduled、allowedActions/原因码、initialPayment 过期摘要、operation.outcome、管理链接 warningCode；不新增 Provider URL 重签接口 |
| 修改客户端事件 | 保留 POST /client-events 并排阶段 C，细化 eventType/platform/sdkVersion/appBuild/状态/原因码约束，checkoutSessionId 允许 null；拒收报文、URL 和 body paymentId；同 eventId 冲突/过期规则 |
| 删除接口 | 无。未合并为 /requests，未删除 renew 或现有 Web/mobile 代码路由；未来删除仅列迁移完成条件 |

### 13.5 第三轮 M1–M5、O1 处理与改动清单

| 编号 | 结论 | 本轮接口/字段/语义改动 |
| --- | --- | --- |
| M1 | 采纳 | 修改 checkout-session 的 supersedes 处理：旧租约已结束且无有效租约时按普通领取；有其他有效租约才报租约冲突。保留归属、幂等及 Provider 状态校验，领取原子化；结束旧操作仍不可重放为新租约 |
| M2 | 采纳并补齐已有消费者 | 明确 Operation 的 operationId/type/execution/outcome/resource/leaseState/error、创建键别名、GET 200 与 POST 202 的区别。type 除所列八项补 customer_create，resource.kind 补 customer，覆盖既有 POST /customers；续费 resource.id 是新 Demo 支付引用，详情增加 subscriptionId，不再将本地引用叫 paymentId。无新增接口 |
| M3 | 采纳删除 | creationState 删除 expired；记录过期详情/对应创建恢复/时间线 410、列表排除。仍有效操作可查历史引用，资源过期不等于操作到期；订阅 initialPayment.state=expired 不删除 |
| M4 | 采纳补表，AUTH A 保留 processing | 新增 PaymentView/列表 txnType；补 Payment 状态 × SALE/AUTH 与资金证据表，额外含 I。F 不是发布的 Payment 枚举，交易 F 不直接让整个支付 failed。AUTH A+关联 AUTH S 显示 processing/authorized/isTerminal=false，App 显示已授权待请款。补订阅 needs_attention 条件与优先级，不以查询失败或预约取消直接变业务失败 |
| M5 | 用户已确认 | 全局认领摘要仅哈希/标记永久保留，不做删除机制；客户端 24 小时同键重 POST 窗口保留；不扩大其他业务记录保留期限 |
| O1 | 已撤回 | 删除支付详情 provider.environment/configRevision 及详情与 connection 比对恢复分支；原本地配置快照缺失时一律只 refresh，保留 /connection 与启动响应中既有配置字段 |
| iOS 构建号 | 已确认 | CFBundleVersion=CURRENT_PROJECT_VERSION 为单调递增整数，clientBuild 直接取值，appVersion 用于展示，构建强制整数校验；移除 decision_required |

新增接口：无。删除接口：无。删除字段值：creationState.expired。§13.4 保留第二轮相对上一版的清单，本表是第三轮增量，当前定义以第 11–12 节为准。

上述剩余用户决定现均已确认，最新规则见 §11–12 与 §13.7；可停在实施前，不因文档收尾开始开发。独立 Provider 事实缺口仍按证据限制。

### 13.6 本轮用户确认后的增量清单

| 类别 | 新增/修改/删除 |
| --- | --- |
| 客户行为 | U1 confirmed：新建成功自动切换，最后服务端成功提交为准，响应实际 currentCustomerId，重放不再切换 |
| 任务与验收 | U3 confirmed：选 D，持久 outbox；Webhook ACK 后同调用尽力查询、客户端读取/刷新顺带处理、现有每日 Cron 分批扫描。取消约 1 分钟目标，采用 §12.2 约 25 小时正常兜底边界；客户端任务接口不变 |
| 幂等保留 | M5 confirmed：哈希与标记永久保留，无删除机制；24 小时客户端重 POST 窗口不变；删除有限保留/不实施无限持久化的旧表述 |
| 回跳引用 | PaymentView 与列表摘要新增顶层 merchantTxnId；既有 GET /payments 增加可选 merchantTxnId 精确过滤（仍须本会话凭证）。后端拼接回跳参数并冻结；App 匹配→refresh→自有结果页；不依赖 Provider 自动追加 paymentId |
| 原生动作 | U/O 允许继续，P/R/A 禁止再次提交；新增 PAYMENT_AUTHORIZED，避免混淆 Payment 终态与已授权。F1 证据已升级 source_checked，状态规则记 user_confirmed，verification 闭集新增该值 |
| Operation | R2 明确 outcome 的创建/资金/订阅变更三类含义；App 支付结果仅看 PaymentView |
| 删除 O1 | 删除 provider.environment/provider.configRevision 及基于详情重新 configure 的分支；/connection.sdk 和 checkout-session.sdk 原有配置字段不删 |
| 接口路径 | 无新增或删除路径；仅支付列表增加公开引用过滤，所有归属校验保持 |

### 13.7 本轮收尾决定与改动清单

| 项目 | 修改/新增 |
| --- | --- |
| SDK 措辞 | Android 前台自动查询改为源码条件：已外跳、已离开、尚未处理；宿主读取/刷新不省略。iOS Sandbox 支持性为 source_checked，验收仍 unverified |
| U2 | 从待决定改 confirmed，self_managed period_end 使用 Demo 预约与每日补调；托管保持 expireMode=2；目标动作 available/user_confirmed，不再 PRODUCT_DECISION_PENDING |
| 订阅视图 | 新增 localCancelEffectiveAt、cancellationSource、providerCancelConfirmedAt、cancelExecution（state/attempts/consecutiveFailures/lastAttemptAt/lastErrorCode）；cancelEffectiveAt 明确仅 Provider 实际取消时间，未知为 null。保留 cancelRequestedAt |
| 操作与动作 | 本地预约 completed/scheduled，原预约历史不冒充 Provider 结果；预约即禁 RENEW_MANUAL，accepted/unknown 续费阻止预约；保留 CANCEL_IMMEDIATE，不支持撤销预约；无成功扣款锚点用 CYCLE_ANCHOR_UNAVAILABLE |
| 每日任务 | 增加既有 Cron 内的 subscription-cancel 任务类型（不是新增调度器/路由）；取消未知先查询恢复，失败次日继续，连续失败提示 needs_attention；不引入自动扣款 |
| 会话与响应 | 滑动 30 天、不轮换 token、无绝对寿命，renew 保留；成功直接返回资源，订阅创建 {subscription,payment}、错误 {error}；期限只放 X-Demo-Session-Expires-At，移除统一 data/session 外层并同步示例 |
| 客户上限 | capabilities.limits.customersPerSession=20，含创建占位；仍 409 CUSTOMER_LIMIT_REACHED/not_started，后续服务端可调 |
| 接口路径/删除 | 无新增或删除业务路径；删除本范围内已失效的用户待决定结论，未删除仍待核实的事实边界 |

### 13.8 交回 Claude 的简短确认要求

只读第 11–13 节，重点核对 §13.7：U2 本地预约证据/UTC 锚点/续费互斥/每日取消与时间展示一致；无成功扣款锚点不伪造周期，取消未知不盲重发，连续失败提示不停止次日补调；会话自动续期与所有认证响应头的准确期限一致，成功资源无 data/session 外层且 Demo 视图不冒充 Onerway 报文；客户上限 20 服务端配置；Android 条件查单及 iOS source_checked 来源正确。只报告残留矛盾或简短确认可停在实施前；没有新的用户待决定项，不重新打开已确认选择。不得修改代码、部署或发起交易，也不能把用户决定或接口源码证据写成真实 Sandbox 通过。

## 14. 阶段 A 交付边界

本阶段产出仅为本文件内 A1 草案及上述核实结论；没有新建 API 实现、数据库迁移、任务、部署、真实支付或对 native-sdk 的修改。知识库调用图不是已部署源码的完整证明，文档枚举不是场景验收。本轮尚未穷尽 Provider 内部源码或日志；无明确交易标识/时间窗且未授权真实交易，不为填满表格制造样本。

阶段 A 多轮审阅已完成。当前按第 7 节授权进入 B0：回写长期契约并准备 OpenAPI/示例，由 Claude 在已有审阅会话复核结构迁移。鉴权迁移继续独立；完成 B0 后等待业务实施授权，部署与交易另行授权。
