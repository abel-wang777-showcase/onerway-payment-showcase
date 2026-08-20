# Onerway Payment Showcase 契约

> 状态：M0 Web JS SDK Sandbox Card 黄金路径、Google Pay DIRECT 验收入口、异常旅程、安全重试与演示部署边界
>
> 更新日期：2026-08-19
> 作用：这是项目长期有效的产品、架构、状态和安全边界。GitHub Issues 负责交付顺序，不替代本文件。

## 1. 产品目标、受众和非目标

Onerway Payment Showcase 是一个面向客户的参考商户网站。访问者应当像真实消费者一样选场景、下单和支付，同时能够看到当前接入方式的能力与支付结果。

目标：

- 展示 Checkout、Web JS SDK、Direct API 三种接入方式的实际客户体验。
- 允许访问者在 Demo Hub 自助选择已开放的业务场景、接入方式和测试旅程。
- 用统一模型承载电商、游戏、直播、AI 等商户场景，避免为每个页面重写支付逻辑。
- 同时提供可信的支付状态、脱敏技术详情和可重复演示路径。

非目标：

- 不是 Onerway 商户后台、开发者控制台或内部 Presenter Console。
- 不要求业务人员在隐藏 Console 中切换配置后，客户才能看到不同场景。
- M0 不包含 iOS / Android SDK，也不执行 Production 实际交易。
- 不为每个临时演示需求新增一次性页面；新需求必须落入既有场景、接入或能力模型。

## 2. Demo Hub 与商户体验边界

Demo Hub 是公开演示入口，不是第二套后台。它负责：

- 选择 `Scene × Integration × Payment Method`。
- 明确展示能力为 Available、Conditional、Planned 或 Unavailable。
- 为确定性的 Sandbox 演示选择测试旅程，例如普通成功或 3DS Challenge。
- 进入对应的参考商户体验。

商户体验负责商品、订单、支付和结果。M0 使用虚构户外电商品牌 **Halden**；未来场景可有不同外观，但支付领域模型、状态真值和安全边界保持一致。

## 3. 能力矩阵

三个独立维度：

| 维度 | 当前或规划值 |
| --- | --- |
| Scene | E-commerce；后续 Game、Live、AI |
| Integration | Web JS SDK；后续 Checkout、Direct API |
| Payment Method | Card、APM、Google Pay、Apple Pay |

能力状态：

- **Available**：当前 profile 与演示条件下可直接运行。
- **Conditional**：集成支持，但依赖商户配置、地区、币种、浏览器、设备或钱包状态。
- **Planned**：项目计划支持，但当前尚未交付。
- **Unavailable**：该组合明确不支持。

能力配置必须是数据，而不是散落在 Vue 组件中的条件判断。M0 首先交付 `E-commerce × Web JS SDK × Card`；其他组合只有在真实契约和验收路径确认后才能标为 Available。

当前 Demo Hub 的数据化矩阵包含全部 48 个组合，状态边界为：

- `E-commerce × Web JS SDK × Card` 为 Available。`USD 5.00 · Standard success` 同时开放确定性 simulation 与真实 Sandbox SDK；`USD 50.00 · 3DS Challenge` 同时开放 simulation 与仅 Sandbox profile 可见的真实验收入口。两条真实 Sandbox Card 黄金路径均已在 canonical Production 域名完成服务端核验，其中 USD 50.00 覆盖 `R → 3DS Challenge → configured returnUrl → same-payment fresh query`。同一能力下另有独立、仅 Sandbox 的 `Halden Daily Essentials` 初始订阅旅程；它没有伪 simulation，也不把订阅计划建模为新的 Integration。
- Card simulation 额外开放 processing recovery、cancelled retry、deterministic failure 与 form load recovery 四条异常旅程；它们不含 Sandbox mode、不产生 provider 标识，也不扩张真实 create allowlist。deterministic failure 只形成 `source=simulation / status=failed` 的本地事实，不能作为 Payment-level `failed` 原始状态证据。
- `E-commerce × Web JS SDK × Google Pay` 保持 Conditional，但可用 USD 5.00 `standard-success` 的真实 Sandbox 入口验收；Showcase 只记录用户选择的预期方式，是否渲染 Google Pay 及其资格由同一个 Onerway SDK Element 决定。`E-commerce × Web JS SDK × Apple Pay` 仍为不可启动的 Conditional，等待 #21 真实设备验收。两者都不渲染伪钱包按钮。
- Checkout、Direct API、APM 和 Game / Live / AI 场景当前为 Planned。
- Unavailable 保留为明确证实不支持时使用的状态；当前不为凑齐 UI 而制造无证据的 Unavailable 组合。

## 4. 统一支付模型

所有接入方式都适配到：

```text
Order → PaymentAttempt → PaymentEvent
```

- **Order**：商户订单，持有场景、商品、金额、币种和业务履约状态。
- **PaymentAttempt**：一次支付尝试，关联接入方式、Demo Hub 选择的预期支付方式、服务端核验的实际钱包 / 底层支付网络、Onerway 标识、当前标准化状态和重试关系。
- **PaymentEvent**：来自服务端调用、SDK、`returnUrl`、Webhook 或 query 的不可变事实；只保留白名单化原始状态与标准化结果，不保存原始 payload。

同一个 Order 可以有多个 PaymentAttempt；一次重试不得覆盖旧尝试。支付状态与 Vue 组件解耦，组件只消费领域状态和能力配置。

金额在领域模型中使用 ISO currency 加整数 minor units，例如 USD 5.00 为 `500`、USD 50.00 为 `5000`；页面格式化金额但不另存一份浮点总额。

标准化 PaymentAttempt 至少区分：

- `created`
- `requires_action`
- `processing`
- `succeeded`
- `failed`
- `cancelled`

页面可以在此之上表达 `loading`、`ready`、`submitting`、`awaiting_action`、`redirecting`、`verifying`、`not_completed` 等 UI 状态，但不得把页面状态当成支付真值。

Web JS SDK M0 的服务端 Payment query 状态映射为：`S → succeeded`、`I / U / P / A / O → processing`、`R → requires_action`、`N → cancelled`。未知状态拒绝映射并停止结果推进。v4 `confirmPayment()` 与 `payment_result` 使用不同的发起入口和协议：Card 等由商户自定义按钮发起的支付必须先完整处理 `confirmPayment()`；Apple Pay、Google Pay 等由 SDK 自有按钮发起的支付不调用 confirm，以 `payment_result` 作为客户端入口。全局事件订阅可以同时服务这两类方式，但商户 confirm 尚未返回时到达的 callback 只能暂存为白名单化内存事实，不能按到达顺序覆盖或跳过 confirm；多个或不可解析的早到 callback 在 `PresentToShopper` 路径降级为可手动核验的 query-only，`RedirectShopper`、confirm unknown 与其他 query-only 阶段的晚到 callback 一律忽略。confirm 可返回 `R + nextAction.type`，其中 `PresentToShopper` 表示 SDK 已在当前 Checkout 承接并要求商户保留 Element、随后消费 `payment_result`，`RedirectShopper` 表示 SDK 即将外跳并要求商户在 `returnUrl` 后执行服务端 query；两者都只形成非终态 `source: client / requires_action` 事实，不立即 query、不重新 confirm。`payment_result` 不返回 `R`：SDK 自有按钮结果或 `PresentToShopper` 后续结果中的 `P / A / S / N` 只形成非终态 `source: client / processing` 事实并由服务端 query 核验；顶层 `O` 是官方明确允许在同一个未刷新的 `paymentId + Checkout + Element` 上恢复交互和再次 confirm 的唯一支付状态。用户关闭交互返回的 `reason.type=canceled` 不等同于 provider `N`，只在当前仍存活的 Checkout 中恢复交互且不形成 PaymentEvent；没有顶层支付状态的 validation / SDK / API error 不伪装为 `processing`，也不自动 query，刷新后均恢复为 query-only。confirm / callback 的 `rawResult`、完整 `reason` 和 `nextAction` 附加字段均不保存、不记录或原样展示，只在当前内存白名单化匹配的 `paymentId`、`paymentMethod`、顶层 `paymentStatus`、公开的 reason type 与 next-action type。Sandbox 页面可额外展示当前交互中受约束的 SDK 诊断投影：仅接受公开 reason type、格式受限的 reason code，以及经过长度限制和敏感模式清洗的 reason message；URL、邮箱、长数字、控制字符与尖括号内容必须脱敏或移除，一旦检测到 secret / token / signature / authorization / credential / CVV / PAN / capability 等敏感语义则整条 message fail closed 为脱敏占位符。reason 的安全 code / message 投影是主来源；仅当对应投影结果为空时，才允许从同一 SDK 结果的 `rawResult.respCode / rawResult.respMsg` 逐字段兜底并应用完全相同的校验与清洗。主来源与兜底冲突时 reason 胜出；只有 rawResult 诊断时不推断 reason type；`rawResult.data` 和所有其他未知字段始终忽略。该投影不是原始字段透传，不得包含 `rawResult` 或完整 `reason`，不得写入日志、PaymentEvent 或持久化；刷新后不恢复。2026-08-09 真实 Card confirm 观察到的 `reason.type=api_error + reason.code=40000 + reason.message=Invalid transaction URL` 因而可显示具体诊断并提示检查 `returnUrl / notifyUrl`。所有诊断只解释交互失败原因，不形成支付状态，也不改变 query / Webhook 才是最终真值的规则。该协议以 Onerway v4 demo `https://beta-checkout-sdk.ronhan.com/v4/demo/index.html#confirm-payment` 及 2026-08-06 确认的商户按钮 / SDK 自有按钮发起边界为当前受控依据。

当前受控 SDK 证据记录为：release 标签 `v4/latest`，2026-08-12 观察到的 bundle SHA-256 `80ee223bc5d3561a729c09901379324186f1c65bcb778be10240fe06f338ed64`，最近一次 canonical Production 浏览器验收日期 2026-08-12；本次用户复验确认真实 USD 5.00 普通成功，以及 USD 50.00 重新完成 3DS Challenge 与回跳，不能据此替代同笔 Webhook、fresh query 和 persistence 的独立收敛证据。当天短暂发布的 bundle `2bd80655e316794cf7f96659e589af0a4e9b1429565f82333b53d017441ceabe` 把 Sandbox action gateway 指向无法解析的 `https://sandbox-gateway.ronhan.com`，同一时段观察到 USD 50.00 未发生预期 3DS 跳转；缺少该笔白名单 action-type 证据，因此只记录相关性，不宣称确定因果。当前 bundle 已恢复 `https://sandbox-gateway.onerway.com`，随后两条黄金路径均复验通过。该 router 对 `CARD / TOKEN_V2` 在 provider 返回 `redirectUrl` 时执行顶层 browser navigation；没有 `redirectUrl` 时仍返回未承接，不存在商户可补调的公开 `handleAction()`。Showcase 不读取 `rawResult.redirectUrl` 或自行跳转；`R` 没有公开 browser action 时继续保持 query-only。服务端继续严格校验固定基础入口，对客户端脚本 URL 追加观察到的 SHA-256 作为 `revision` cache namespace；该参数只隔离浏览器缓存，不是不可变 SDK 版本、SRI 证明或后续验收替代品。release、hash 或 SDK 行为任一变化时仍必须重新记录 bundle 证据、验收日期、浏览器结果并更新 allowlist；后续变化不能继承本次证据。

Issue #3 的 UI stage 只通过 `source: simulation` 的不可变 PaymentEvent 推进，并按以下规则投影标准状态：

| UI stage | 标准 PaymentAttempt 状态 |
| --- | --- |
| `loading`、`ready` | `created` |
| `submitting` | `processing` |
| `redirecting` | `requires_action` |
| `verifying` | `processing` |
| `succeeded` | `succeeded` |

该映射只定义确定性模拟器的行为，不宣称等同于 Onerway 原始状态映射。

## 5. Web JS SDK M0 黄金路径

固定条件：

- Scene：E-commerce
- Country / currency：US / USD
- Integration：Web JS SDK v4
- Environment：Sandbox

首两个验收用例：

1. **USD 5.00 普通成功**：完成 SDK loading、ready、submitting、成功结果和脱敏 Technical details。
2. **USD 50.00 3DS Challenge 成功**：完成离站 Challenge、回跳恢复、服务端核验、成功结果和脱敏 Technical details。

指定 Sandbox 测试卡由 Onerway 的受控测试资料提供，不在仓库、Issue 或日志中保存完整 PAN / CVV。

当前 Sandbox SDK 基础入口确认为 `https://sandbox-checkout-sdk.onerway.com/v4/latest/onerway.js`，服务端只接受该精确配置值；公开给浏览器的脚本 URL 追加上一段定义的受控 `revision` cache namespace，并必须与顶层 `environment: "sandbox"` 组合；不得回退到 v3。`v4/latest` 是当前可替换入口，不是长期固定版本契约，替换时必须重新完成 bundle 证据、浏览器验收和配置 allowlist 更新。

v4 初始化以 `paymentId` 调用 `createCheckout(paymentId, options)`，不传 `redirectUrl`。创建支付 API 的 `txnOrderMsg.returnUrl` 是独立的服务端 create 字段，仍按 API 契约发送；两者不得混为同一个 SDK option。

当前 Web SDK 的可选保存卡能力属于普通支付体验，不新增面向用户的“绑卡旅程”。服务端为匿名浏览器维护稳定的 customer identity，在创建支付时把 `productType` 从旧 SDK 的 `CARD` 调整为当前默认值 `ALL`，`subProductType` 继续使用 `DIRECT` 并传入 `merchantCustId`；不得使用旧 SDK 保存卡逻辑中的 `subProductType=TOKEN`。传入 `merchantCustId` 只允许 SDK 在托管表单中提供保存卡选项，是否保存由用户主动选择；它不证明卡已保存，也不形成新的 PaymentAttempt 状态。后续同一 `merchantNo + appId + environment + merchantCustId` 的支付由 SDK 内部回显可选 saved card，Showcase 不自建卡列表、不读取 SDK 原始 token 结果，也不把 `tokenId` 暴露给客户端。

Google Pay DIRECT 不新增 create adapter、钱包专属 fixture 或 Google JS。Demo Hub 的 Google Pay 选择复用 USD 5.00 `standard-success`，服务端仍发送 `paymentMode=WEB + productType=ALL + subProductType=DIRECT + txnType=SALE`；`PaymentAttempt.method=google-pay` 只记录本次验收预期，不保证 SDK 最终渲染该按钮，也不把 Onerway 的 `DIRECT` 与 Google tokenization 的同名概念混用。同一聚合 checkout 保留 Card merchant action 和 SDK 自有钱包按钮；Card action才调用 `confirmPayment()`，SDK 自有按钮继续只通过 `payment_result` 进入核验。

2026-08-13 真实 Sandbox 验收确认：当前 create 会发送非空 `merchantCustId`，用户可在 SDK 托管表单中主动勾选保存卡，后续同 scope 的新支付会正确回显 saved card。Provider 内部先完成 `DIRECT` 支付交易，再为用户选择的保存卡执行第二笔绑卡交易；Payment result Webhook 不包含 `tokenId`，第二笔绑卡交易也不发送 Webhook，因此商户不能从支付通知链路取得 `tokenId`。需要服务端 token 生命周期时，商户可使用同一 `merchantCustId` 调用 [List saved tokens](https://developers.onerway.com/payments/api-reference/endpoints/list-saved-tokens)，从 `data.tokenInfos[]` 读取 `tokenId`；其中 `id` 是 binding record id，不是支付使用的 `tokenId`。该查询是独立的 server-only 能力，不改变支付真值、不把保存卡并入 PaymentAttempt，也不属于当前 Showcase M0 的卡列表、解绑或 token 支付范围。

真实 Sandbox create 只接受服务端 allowlist 中的固定旅程，并从已持久化 Order 生成金额与商品：普通成功为 USD 5.00 / `HL-SAMPLE-005`，3DS Challenge 为 USD 50.00 / `HL-SAMPLE-050`。两者都固定使用 `paymentMode=WEB`、`productType=ALL`、`subProductType=DIRECT`、`txnType=SALE`、`risk3dsStrategy=DEFAULT` 与 `orderCurrency=USD`，并附带当前 Order 私有绑定的 `merchantCustId`；USD 50.00 是当前 Sandbox 受控资料确认的高金额 3DS 触发条件，不把 `INNER` 或客户端可选金额作为触发补丁。同步 create 的 `respCode=20000` 仅表示创建请求成功，返回 `status=U`、`transactionId` 和 `paymentId` 后才初始化 SDK。客户端只提交 allowlist journey id；普通入口遇到已有非终态恢复能力时始终返回原 Order / Attempt，不因页面后来选择另一旅程而创建平行支付。只有下一段定义的用户显式 Sandbox 新订单入口可以更换恢复绑定。

Demo Hub 继续提供两条同结果、可重复的本地模拟旅程。模拟会话使用版本化 `sessionStorage` 在单个浏览器标签页内保存 Order、PaymentAttempt 和 PaymentEvent，刷新时恢复同一 attempt；Retry 追加新 attempt 并保留旧历史。该存储不包含凭据、PAN / CVV 或原始 provider payload，也不替代第 6 节要求的服务端持久化。真实 Sandbox 会话不写入该 simulation 存储。为避免 Provider-created 非终态阻塞后续受控测试，Demo Hub 的真实 Sandbox 按钮与支付页的 clean-run 按钮都显式启动一个新的独立 Sandbox Order；这不是旧 Order 的 PaymentAttempt Retry，不取消、不覆盖旧 Attempt，也不改变其支付真值，旧 Attempt 仍由 query / Webhook 收敛。该测试入口只在 Sandbox profile 开放，普通恢复入口仍复用同一非终态 Attempt，不能据此推导 Production 的放弃或重试语义。

## 6. 回跳、通知和最终状态

支付结果采用多来源收敛，不采用“最后到达者覆盖”：

1. SDK 客户端 `payment_result` 或 `confirmPayment()` resolve 只更新交互状态，不能单独确认最终成功；`rawResult` 不保存、不记录日志、不进入 Technical details。
2. `returnUrl` 用于恢复 Order / PaymentAttempt，并触发服务端 query；它不是支付成功证据。
3. Webhook 先可靠持久化、幂等处理，再按 Onerway 契约返回 ACK。
4. query 与 Webhook 都产生 PaymentEvent，并通过明确的优先级和状态迁移规则收敛 PaymentAttempt。
5. `processing` 必须可刷新恢复和后续收敛；重复回调不得重复创建业务结果或触发重复扣款。
6. 浏览器一旦调用 `confirmPayment()`，除当前仍存活的 v4 Checkout 明确返回顶层 `paymentStatus=O` 或 `reason.type=canceled` 外，不得把同一 PaymentAttempt 恢复为可再次提交；`R`、`P`、`A`、离页或客户端结果未知时只允许查询该 attempt，直到服务端真值收敛。刷新会丢失该临时 SDK 交互许可，因此 provider-created Attempt 仍恢复为 query-only。

### 6.1 Web JS SDK Card 初始订阅

初始订阅继续使用同一个 `Order → PaymentAttempt → PaymentEvent` 支付模型承载首次扣款，并新增相邻的服务端 `SubscriptionContract` 承载合约生命周期。二者通过不可变的 initial Order / Attempt 审计快照关联，但 SubscriptionContract 不受 Payment 30 天级联清理控制；Payment succeeded、SDK callback、configured `returnUrl`、Provider result page 或同步 `respCode=20000` 都不能单独证明合约 active。

首个计划由服务端固定为：内部 `planId=halden-daily-essentials-v1`、version `1`、Provider `productName=Halden Daily Essentials`、首次及每周期 USD 5.00、`frequencyType=D`、`frequencyPoint=1`、`expireDate=2099-12-31`。未来计划使用独立、稳定且版本化的 `planId`；`productName`、金额和周期只是该版本的不可变 Provider projection，不能作为本地主键。客户端只能提交 allowlist 中的 `planId`，不能覆盖金额、币种、customer、subscription terms 或 Provider routing 字段。

Sandbox create 固定使用 `paymentMode=WEB`、`productType=ALL`、`subProductType=SUBSCRIBE`、`txnType=SALE`、`subscription.requestType=0`、`subscription.selfExecute=2`、`subscription.mode=2`，并让 top-level 与 subscription 内的 `merchantCustId` 精确相同。当前官方 SDK 字段表仍把 SDK scope 写成 `productType=CARD`，但 controlled Sandbox 已确认 `ALL + SUBSCRIBE`；Showcase 不实现 `CARD` fallback、双请求或自动兼容。`selfExecute=2` 不发送 Onerway-managed 专用的 cycle、trial、notification 或 `bindCard` 字段。

Provider 同步 create 的受控响应为 `status=U + paymentStatus=U + contractId=null + tokenId=null`，且不返回 `dataStatus` / `subscriptionStatus`。服务端在 Provider create 前原子建立 contract placeholder，并以本地、已确认的 `dataStatus=0 + subscriptionStatus=paymentdue` 投影为 `pending`；SDK 只用 response 的同笔 `paymentId` 初始化。Card 初始订阅固定进入 3DS，不提供绕过 3DS 的成功路径。

已收到但不符合上述精确契约的 create response 是不可恢复的 runtime drift：服务端必须为该 Attempt 持久化 stop-gate，通用 merchant transaction recovery 不得绕过 parser 后继续打开 SDK。只有网络结果未知、尚未确认收到何种 Provider response 时，才允许用既有 `merchantTxnId` 查找同一 creation。

同一 `merchantNo + appId + environment + merchantCustId` customer scope 与相同 `planId` 下，任何未进入终态的 SubscriptionContract 都禁止再次创建同一 product。该规则由数据库唯一约束与事务串行化执行；Provider Create 已实证会接受重复 customer + product，因此 Provider duplicate error 不能替代本地 gate，普通订阅入口也不能通过随机 productName、随机 plan、新 customer 或自动取消绕过。为保持公开 Showcase 可重复演示，Sandbox profile 可在当前签名 recovery 已恢复相同 plan 的非终态合约、且该合约已有 `paymentId` 或 `contractId` Provider evidence 后，由用户显式选择“新的 Sandbox 测试客户”；服务端据此生成全新的 `merchantCustId` 与独立 Order，替换当前浏览器 recovery 绑定，但不取消、覆盖或修改旧客户的 Order、Attempt 或 SubscriptionContract。该入口不接受客户端 customer id、不自动触发、不属于同一 customer 的 Retry，并且不在 Production profile 开放；每个新测试客户仍独立受相同 duplicate guard 约束。尚未取得任何 Provider identifier 的本地 placeholder 不开放该入口，避免 intent 响应未知时重复生成测试身份。

SUBSCRIBE 只接收一条 `scenarios=SUBSCRIPTION_INITIAL` 的 Subscription payment Webhook，不等待 ordinary Payment Webhook。该通知在同一事务内写入 PaymentEvent、收敛 PaymentAttempt、发现并保存非空 `contractId` / opaque `tokenId`、更新 SubscriptionContract；全部关联和写入成功后才返回 HTTP 200、`text/plain`、原 `transactionId`。`SUBSCRIPTION_RENEWAL` 不得误写 initial Attempt。Webhook 复用 ordinary Payment 的唯一显式签名 exclusion contract；不得增加“只排除 sign”的第二套验签或 fallback。

SubscriptionContract 自持久化初始 `merchantTxnId`、create 后的 `paymentId` 与首次 Subscription Webhook `transactionId` 幂等键；这些字段只用于服务端关联，不进入公开 DTO。Payment 记录 30 天后删除，迟到或重复 initial Webhook 仍能直接关联长期合约。已成功处理的相同 Webhook 重试必须先用本地幂等事实 ACK，不得因 Provider 当前 Query 状态变化或暂时不可用而拒绝重复通知。

已知 `contractId` 后，服务端才可调用 Query subscription details，并必须关联 merchant、customer、plan、amount、currency 和 token；wire `merchantCustomerId` 对应当前 server-owned customer，`products` 先从 JSON string 安全解析再匹配。未知 `contractId` 时不扫描 customer、不猜测合同，也不伪造 active。非空 `tokenId` 不一致、未知状态或关联歧义均 fail closed。

结果页始终显示 Payment 与 Subscription 两条状态轴。至少区分 `Payment pending`、`Payment succeeded + Subscription pending`、`Subscription active`、`Subscription needs attention` 和终态；Payment success 不会提前激活 Subscription。`tokenId` 永远不进入客户端 DTO、URL、日志、Issue、截图或 Technical details；`contractId` 也不进入公开页面或 URL。

configured `returnUrl` 始终发送，Provider 自动导航到 canonical merchant return/result 是首选 UX，但只用于恢复。自动回跳成功时，页面通过 HttpOnly recovery cookie 恢复同一 Order / Attempt 并无条件 fresh Query 同一 `paymentId`；自动回跳缺席、浏览器停在 Provider result page 时，Webhook 仍可在服务端收敛，用户手动返回、刷新或重新打开 Showcase 后以同一 cookie 恢复并执行相同 Query。降级路径不得创建新 Order / Attempt、不得再次 Provider Create 或 `confirmPayment()`，不得把 provider identifier 或 recovery capability 放进 URL；cookie 已失效时 fail closed。

SubscriptionContract 自有 customer scope、plan projection、初始审计标识、标准状态、白名单 Provider 状态、可空唯一 `contractId`、server-only `tokenId` 与生命周期时间戳。`initialAttemptId` 唯一；Payment Order 30 天删除后，非终态合约仍可独立执行 duplicate guard、Webhook 关联和 known-contract query。合约明确进入 `dataStatus=3`、`canceled` 或 `ended` 时立即擦除 token，只保留最小 contract/customer/plan tombstone 与首次 `terminalAt`，30 天后删除；重复终态事实不得刷新 `terminalAt`。Payment 最终失败/取消且 `contractId` 仍为空时，placeholder 同样进入 30 天清理；已有 contract 且仍为 `0 + paymentdue` 时保持并等待 query，`dataStatus=2` 在 Provider 明确不可恢复前保持 needs-attention，不自动删除。

Card merchant confirm 使用独立的持久化 submission latch：浏览器在调用 `confirmPayment()` 前，必须以当前 HttpOnly recovery cookie 加精确匹配的 `orderId + attemptId + paymentId` 请求服务端原子写入 `PaymentAttempt.submissionStartedAt`。该时间只证明服务端已经签发一次 confirm 前置许可，不证明浏览器实际调用、confirm 返回或支付成功。首次 claim 返回 `claimed=true` 后客户端才允许调用 confirm；重复 claim 或响应未知不得再次 confirm，只能恢复并查询原 Attempt。顶层 `O` 或 `reason.type=canceled` 仍可在同一未刷新的 Checkout 中沿用已签发的临时许可再次 confirm，但不会清除持久化 latch；刷新后仍一律 query-only。历史 provider-created Attempt 无法证明从未提交，迁移时保守回填该 latch，不能因部署升级重新开放提交。

新 PaymentAttempt Retry 与“重载原 Payment”或“启动独立 Sandbox Order”是三种不同动作：SDK 脚本 / Element 在 pre-confirm 阶段加载失败时先重载同一个 `paymentId`，不创建新 Attempt；create、confirm 或网络结果未知以及 `created / requires_action / processing` 只恢复和 query 原 Attempt；独立 clean-run 继续创建新 Order。只有 query / Webhook 权威建立的 `cancelled`，以及未来具有同等权威来源的 `failed`，才允许服务端在同一 Order 下创建带 `retryOf` 的新 Attempt。当前 transaction `F` 不能映射 Payment-level `failed`，在正式来源确认前真实 Sandbox `failed` 路径保持 stop gate。

Retry 由服务端在单一数据库事务中锁定 parent、重新计算资格并 get-or-create 唯一直接 child；数据库以非空 `retry_of` 唯一索引防止多击、请求重放或跨实例并发产生兄弟 Attempt。child 继承 parent 的 integration / method，使用新的 `merchantTxnId`，不覆盖旧 Attempt/Event。切换 recovery cookie 前 child 记录必须已完成数据库提交；响应丢失后，无论浏览器仍持有旧 parent cookie，还是已经收到响应头并切换为该 child cookie，重放同一个 parent retry 请求都只回读同一 child，其他 cookie lineage 一律拒绝。child 调用 Provider create 前必须再次锁定并核验 parent 资格，防止 parent 在建 child 后被 fresh query 调和为 `succeeded` 仍产生新扣款；一旦 child 已有 create claim 或 Provider 标识，后续只恢复该 child，不能重放 create。若 pre-create child 因 parent 真值变化而不再具有 Retry 资格，claim 事务必须先持久化本地、非投影且不可逆的拒绝事件，再永久关闭该 child；recovery 只在该拒绝事实存在时恢复并重绑 direct parent，不查询被拒 child 的 Provider creation、不删除 child 历史，也不把 child 伪装为 Provider `cancelled / failed`。

客户端异常动作使用结构化 operation + action 契约，不从任意错误 message 或 HTTP 状态单独猜测：pre-confirm SDK / Element load 失败只重载同一个 `paymentId`；create 结果未知只恢复已有 Attempt；query / confirm 结果未知只核验已有 Attempt；暂时性 recovery 失败只重试 restoration；只有服务端权威允许的终态才显示同 Order Retry；clean-run 始终创建独立 Order。query capability 被拒绝时最多先通过 HttpOnly recovery 刷新一次 capability，再查询同一 Attempt，不循环复用旧 token。Retry 或 child create 响应未知时优先恢复 cookie 当前绑定的 parent/child；不得因此再次 confirm 或无条件重放 Provider create。

授权 recovery 同时返回该 Order 的白名单 Attempt 历史，并显式保留 cookie 当前绑定的 active Attempt；客户端不得用数组末项猜 active。历史只展示 Attempt id、标准状态、active 标记与 `retryOf` 关系，不新增原始 Event/provider payload 暴露面。

#4 在 #5 持久化交付前只保证同一次 SPA 导航内的真实普通支付：服务端签发绑定 `attemptId + paymentId + expiresAt`、五分钟内有效的 query capability，浏览器不能用任意 Payment ID 查询同商户交易，过期或异常远期 capability 必须拒绝。该 capability 不展示、不记录、不持久化；刷新后的可靠恢复仍由 #5 交付。

#5 通过 HttpOnly、SameSite=Lax、绑定单个 `orderId + attemptId` 且最长覆盖 30 天保留期的服务端签名 cookie 恢复当前真实 Sandbox Attempt。恢复接口允许省略 URL / query `orderId`，此时只使用签名 cookie 内绑定的 `orderId + attemptId` 授权；调用方提供 `orderId` 时必须与 cookie 精确匹配。不能仅凭可枚举的 `orderId`、`attemptId`、`merchantTxnId` 或 `paymentId` 公开读取。恢复后服务端重新签发五分钟 query capability，不把长期恢复能力暴露给 JavaScript。恢复响应只根据持久化 `submissionStartedAt` 判断 merchant confirm 是否已开始，不再用 Payment status 猜测提交边界；已开始的 Attempt 恢复为 query-only，未开始的 Card Attempt 才能重新挂载同一个 Payment Element。

同一 recovery 链还用于延续匿名 customer，但 customer identity 不写入 cookie：每个 Order 在服务端私有保存 `environment + merchantNo + appId + merchantCustId`，新 Order 只在 scope 完全一致时继承上一 Order 的 customer；旧数据缺少 customer 时在首次 Provider create 前以数据库行锁原子补齐。浏览器必须用同源 Web Lock 只串行化 `/api/payment/intent` 请求，使并发首开标签页在前一个响应写入 recovery cookie 后再创建或恢复 Order；锁不覆盖 Provider create、SDK 生命周期或后续查询，不支持 Web Locks 时必须在发出 intent 前 fail closed，不能退回到 IP / User-Agent 指纹或客户端 customer id。`merchantCustId` 少于 64 个字符，只使用大小写字母、数字、下划线与 dash，并且不进入共享 `Order` / `PaymentAttempt`、公开 API 响应、URL、浏览器存储、Technical details 或日志。清除 recovery cookie 或连续 30 天没有新 Order 后，Showcase 会把后续访问视为新的匿名 customer；这只表示本地不再关联，不能表述为 Onerway 侧 saved card 已删除。

#6 的 create 使用 `ONERWAY_SHOWCASE_ORIGIN` 生成 canonical `GET /halden/return/:orderId` 回跳地址。Onerway 通过顶层 browser navigation 自动回跳，并可能在 `returnUrl` 后附加 query parameters；Showcase 不解释、不转发、不保存或展示这些参数，客户端恢复开始时立即把地址替换为无 query 的 canonical path。v4 SDK 在 3DS 顶层跳转分支可能不产生客户端 callback，因此 callback 缺席不能触发新 Attempt。回跳页只用 URL order 与 SameSite=Lax 签名 cookie 完成绑定，幂等写入一次 `source=return`、`status=processing`、以 Attempt id 为 source key 的 PaymentEvent；该事件不投影更新 PaymentAttempt。服务端随后无条件对同一 `paymentId` 执行 fresh query 并持久化 query event，即使 Webhook 已先形成终态也由 query 调和冲突；非终态时浏览器继续轮询同一 Payment。Webhook 先到、query 先到、return 先到或重复 return 都不得倒退终态或产生第二次提交。

Provider create 采用两步 BFF：第一步先持久化 Order 与 Attempt，并在独立 HTTP 响应中把恢复 cookie 交付浏览器；第二步以该 cookie 认领同一 Attempt，再调用 Onerway。认领本身写入唯一 `source: server` PaymentEvent，因此取消请求、并发调用或结果未知都不能再次发起 create。Onerway 文档把 `merchantTxnId` 定义为每次交易请求唯一且用于防重复，但没有承诺重复 create 会返回原结果，因此网络或第二次本地事务失败后不得自动重放 create。恢复只使用同一 Attempt 已保存的 `merchantTxnId` 调用 `/v1/txn/list` 找回并关联既有 `paymentId + transactionId`；该 transaction 查询的 `S / F / N` 也只形成非终态事实，最终状态仍必须再经 Payment query。2026-08-04 已用当前新鲜 Sandbox 交易不落盘验证 merchantTxnId 查询返回唯一精确匹配。未查到既有 Provider 记录时保持恢复 pending，不能创建平行 Attempt。

公开 create / query BFF 对带浏览器来源信息的请求执行同源 gate，并共享按 runtime 可信客户端地址计数的应用层速率与并发安全阀；不信任请求自带的通用 `X-Forwarded-For`。Vercel runtime 只读取平台覆盖的 `x-vercel-forwarded-for`，其他 runtime 使用 H3 提供的可信地址；Nuxt dev adapter 未提供 runtime 地址时只使用固定 loopback bucket，非开发 runtime 缺失可信地址则拒绝请求。该安全阀是单进程、单实例边界，不提供 Serverless 跨实例精确配额，也不替代部署平台的 edge / WAF 限流。

最终核验调用 `POST /v1/txn/queryPayments`，以 v4 SDK 使用的 `paymentId` 查询 Payment 级 `paymentStatus`，并只白名单化 `paymentId`、`lastTransactionId` 与原始状态。2026-08-03 的真实 Sandbox 验证显示：同一 v4 Payment 在该接口可立即查询，而使用创建阶段 `transactionId` 调用 `/v1/txn/list` 返回空记录；因此 M0 不以旧 transaction query 作为最终真值入口。

支付方式归因是独立的服务端 enrichment：先由 `/v1/txn/queryPayments` 取得同一 Payment 的 `lastTransactionId` 并持久化状态真值，再以该 transaction id 调用 `POST /v1/txn/list`。只有 fresh Query 已给出终态，且 transaction id、payment id、`subProductType=DIRECT` 与 `txnType=SALE` 全部严格匹配唯一记录时，才可把 `walletTypeName=GooglePay` 归一化为 `actualWallet=google-pay`，并把受限的 `paymentMethod`（例如 `VISA`）保存为底层 `fundingNetwork`。归因必须满足 `attributionTransactionId = PaymentAttempt.transactionId`；同一 Payment 的 `lastTransactionId` 变化时先清除旧归因，再以新 transaction 原子替换，绝不把新 transaction 与旧钱包 / 网络拼接。该短超时 enrichment 缺失、暂不可用或响应不匹配时不得阻断或回退已经建立的 Payment 状态；结果页恢复终态且仍缺少 `attributionTransactionId` 时自动执行一次 fresh Query 重试，recovery 本身只恢复已经持久化的归因，不能使用 create 阶段 transaction id 自行归因。SDK callback 的 `paymentMethod` 只属于当前内存交互事实；Webhook 的 `walletTypeName` / `paymentMethod` 按当前实测验签规则被排除，二者都不得替代 transaction query 成为持久化实际方式真值。

Payment result Webhook 的 M0 契约已通过 2026-08-04 当前 Sandbox secret 与新鲜通知做不落盘差分验签确认：

- 验签从解析后的顶层字段中剔除 `originTransactionId`、`originMerchantTxnId`、`customsDeclarationAmount`、`customsDeclarationCurrency`、`paymentMethod`、`walletTypeName`、`periodValue`、`tokenExpireTime` 和 `sign`；其余非 `null`、非空字符串字段按字段名 ASCII 升序，只拼接 value，末尾追加当前 profile 的服务端 `secret`，计算小写 SHA-256，并使用 timing-safe comparison。
- `reason`、`products`、`paymentMethodDetails` 等 JSON string 使用收到并由 JSON parser 解码后的字符串值参与验签；它们只在验签进程内短暂存在，不保存、不记录日志、不进入错误或诊断响应。
- 当前新 API Reference source 把 `paymentMethod` / `walletTypeName` 标为参与签名，但真实 Sandbox 样本只命中上述排除矩阵；这是已知文档 drift。更换 secret、环境或 Provider 规则后必须重新做受控样本验证，不实现双规则兼容或验签降级。
- 验签、商户号、`merchantTxnId`、`paymentId`、金额和币种关联全部通过，且 PaymentEvent 与 PaymentAttempt 在同一数据库事务中可靠提交后，才返回 HTTP 200、`text/plain`，响应体严格为收到的 `transactionId`。
- Onerway 在首次通知失败后以 30 分钟间隔重试两次，最多在 T+0、T+30、T+60 投递三次；`transactionId` 是 Webhook PaymentEvent 的 provider 幂等键。

Webhook 同时保留 transaction 级 `status` 和 Payment 级 `paymentStatus` 白名单值。`paymentStatus=S / O / N` 分别投影 `succeeded / processing / cancelled`；缺少 Payment 级状态时，transaction `N` 可投影 `cancelled`，`S / F` 只保留为 `processing` 并等待 query。`status=F + paymentStatus=O` 表示单笔交易失败但 Payment 仍开放，不得投影为 Attempt 失败。query 是终态冲突的调和权威：新 query 可替换冲突的 Webhook 终态；Webhook 不得覆盖已有 query 终态；任何中间态都不得回退终态，冲突事实仍作为 PaymentEvent 保留。

正式持久层采用 Vercel Marketplace 管理的 Neon Postgres：

- 只保存 `Order → PaymentAttempt → PaymentEvent` 的最小白名单字段，以及 Order 私有的匿名 customer scope；`PaymentAttempt.id` 是 Showcase 内部关联标识，不发送给 Onerway。Attempt 的 `method` 是预期方式，nullable `actualWallet` / `fundingNetwork` / `attributionTransactionId` 只来自严格关联的 transaction query，且三者满足“全部为空或归因 transaction 非空并至少有一项方式元数据”的约束；`submissionStartedAt` 只记录服务端签发 merchant confirm 前置许可的时间，不保存 SDK 请求或结果。
- Order 保存商品摘要、整数 minor amount、currency 和履约状态；Attempt 分开保存 `merchantTxnId`、Payment `paymentId` 与 transaction `transactionId`；Event 保存 source/source key、双轴原始状态、标准状态、冲突标记和时间。
- 不存在原始 request/response/Webhook payload、`sign`、`secret`、PAN、CVV、`reason`、`paymentMethodDetails`、`tokenId` 或卡详情列；私有 `merchantCustId` 只用于当前 SDK create 和同 scope 后续支付。
- Order、Attempt 和 Event 保留 30 天；Vercel Cron 每日调用独立 `CRON_SECRET` 保护的内部清理路由，删除到期 Order 并通过外键级联清理 Attempt/Event。
- 受限时间线只可通过独立 `PAYMENT_DIAGNOSTIC_TOKEN` 查询 `merchantTxnId` 或 Onerway `transactionId`；未配置 token 时路由 fail closed，响应只返回白名单领域字段。
- Vercel build 同时校验 `VERCEL_ENV` 与独立的 `PAYMENT_MIGRATION_MODE` 并 fail closed：只允许 Production=`production + apply`，在构建前完成串行 migration；只允许 Preview=`preview + skip`，不迁移共享运行时数据库；缺失、未知或交叉配置一律中止构建。数据库集成测试只接受显式确认的隔离 `TEST_DATABASE_URL`，在任何 migration/test 写入前必须同时拒绝两个运行时 DSN 的同库别名，并验证只存在于 CI branch、不会由正式 migration 创建的 `payment_test_guard(singleton=true, purpose='onerway-payment-showcase:ci')`。`Neon integration` 对当前 exact head 必须成功；当前私有 Hobby 仓库不能由 GitHub branch protection 强制 required check，因此合并操作者必须回读并人工执行该门禁，直到仓库能力允许平台强制。
- 通用 CI 与数据库集成是两个独立门禁：`Quality (exact head)` 对同一提交执行 frozen install、lint、typecheck、unit / Vue、build 与浏览器验收；`Neon integration` 只验证隔离测试数据库上的持久化与收敛实现，不复制产品状态或支付真值为第二套业务权威。PR 更新、rebase 或 push 后旧 SHA 的结果全部失效，合并与部署前必须回读两项 check 均绑定当前 exact head。

Sandbox profile 由 `ONERWAY_SHOWCASE_ORIGIN` 固定公开 canonical origin；它必须为 HTTPS 公网域名且不能带 path/query/hash。默认直接投递时，`ONERWAY_SANDBOX_NOTIFY_URL` 必须严格等于该 origin 下的 `/api/webhooks/onerway/payment`。只有显式设置 `ONERWAY_SANDBOX_NOTIFY_RELAY=true` 时，notify URL 才允许指向不同 origin 的公开 HTTPS Relay；Relay URL 不得包含 credential、IP / localhost / `.local` host、query 或 fragment，路径必须精确为 `/onerway/payment`。Relay 只做有界字节转发和上游状态透传，不持有 Onerway secret、不解析或保存 payload、不制造成功 ACK；验签、merchant / Order 关联、幂等、PaymentEvent 持久化和最终 ACK 仍全部由 canonical Production 的 `/api/webhooks/onerway/payment` 完成。Onerway 发送侧在 2026-08-11 对 `workers.dev` 返回非 Cloudflare 地址，而已验 harness 证明 `pages.dev` 可达，因此当前正式 Relay 部署面固定为独立 Cloudflare Pages Advanced Mode 项目；已有 Payment Test Harness 的 payload 记录路由不得复用。新的公开仓库以缺失 `RELAY_DEPLOY_ENABLED` repository variable 作为部署迁移 stop gate；只有显式设置为 `true` 后，Relay Production deployment 才能由 main 的 exact-head CI 通过后自动发布。Cloudflare Pages 保留 Git repository 关联，但 Production 与 Preview 的 Git automatic deployments 都关闭，只允许 Actions 通过 Wrangler 成为唯一发布者；仅 Relay 源码、部署脚本、依赖锁或相关 workflow 变化进入发布，调用方只显式传入 Cloudflare Account ID 与最小权限 API token，且凭据只在 Wrangler 发布 step 可见；当前仓库只读 `GITHUB_TOKEN` 仅用于回读实时 main SHA，启动 Wrangler 前必须移除。手动发布也必须先让当前 exact main 通过同一 Quality gate。脏工作树、旧 ref 或失败质量门均不得覆盖 Production Relay。2026-08-12 已完成一笔新 Sandbox 交易的 Relay 真实投递，通知由 canonical Production 正常验签、处理并持久化。该例外只属于 Sandbox profile，Onerway Production 交易与通知继续锁定。任何 Relay 都必须完成真实投递 smoke，失败时停止真实 Sandbox 演示。

现有测试 harness 只用于 Sandbox 行为核对，其“关闭验签”配置不能成为 Showcase 正式实现。

## 7. Profile、凭据和支付数据

配置采用命名 profile：

- `sandbox`
- `production`

规则：

- `ONERWAY_PROFILE` 必须在服务端明确选择 `sandbox` 或 `production`；不提供默认值、别名或由请求切换 profile 的入口。
- 本地允许通过未提交的 `.env.local` 配置多个 profile；开发和预览脚本显式加载该文件。
- Vercel 部署范围不等于 Onerway profile。canonical Vercel Production deployment 使用 `sandbox` profile，是 M0 唯一正式测试、演示和验收面；这不表示开放 Onerway Production 实际交易。
- Vercel Preview 同样选择 `sandbox` profile，并与 Production 有意共享 Onerway Sandbox 权限和运行数据。Vercel Neon 连接保留 Production / Preview 环境访问，但关闭 `Create database branch for deployment`；两种 deployment 使用既有共享运行库，不为 Preview 创建临时数据库分支。Preview 只用于临时预览或排查，不形成独立验收证据；它使用 `PAYMENT_MIGRATION_MODE=skip`，支付回跳通过 `ONERWAY_SHOWCASE_ORIGIN` 收敛到 canonical Production，Webhook 则通过 Production / Preview 共享的直接或 Relay notify 配置最终进入 canonical Production Webhook。共享是已接受的单人维护边界，不得表述为 Preview / Production 交易隔离。由于 recovery cookie 是 host-only，Preview 的真实 Sandbox 入口必须先导航到公开白名单摘要中的 canonical Production origin，并由 Production 域创建 Order、签发 cookie 和承接后续回跳；服务端对 intent、create、retry 与 submit 同时执行 canonical-origin fail-closed gate。Preview 不直接创建或推进真实支付，不通过 URL 传递 capability，也不扩大 cookie domain；recover 与 query 只可用于收敛已有 Attempt。
- `merchantNo`、`appId`、`secret`、API / notify URL 和签名逻辑只在 Nitro 服务端读取。
- 本机浏览器与 Nuxt 同机运行时，可通过未提交的 `ONERWAY_SANDBOX_TRANSACTION_IP` 提供真实持卡人公网 IP，避免把 loopback 发送给 Sandbox 风控；该覆盖只属于 Sandbox 服务端 profile，且不改变用于请求限流的 runtime 客户端身份。部署环境应省略它：Vercel 使用平台覆盖的 `x-vercel-forwarded-for`，其他 runtime 使用 H3 提供的可信地址；最终地址必须通过 IP 格式校验。
- 浏览器只通过 `/api/profile` 得到显式白名单投影后的 profile、环境、交易策略、canonical Showcase origin 与当前 SDK script URL；canonical origin 和 SDK URL 不是 credential。
- PAN / CVV 即使来自 Sandbox，也不得持久化、进入日志、分析埋点或错误上报。
- 保存和展示请求、响应、Webhook、Technical details 前统一脱敏。
- Onerway `production` profile 默认锁定。基础域名已确认不代表允许交易；启用实际交易仍需单独确认凭据、回调验签、审计、错误处理和显式开关。
- 所有 Vercel scope 都不得配置或开放 Onerway Production 实际交易；Vercel Production target 也必须继续服从该锁定。
- Onerway `production` profile 锁定时仍可运行明确标记为 Simulation 的纯本地旅程，因为它不产生上游请求或交易；页面必须同时保留 Simulation 与 Transactions locked 提示。

Sandbox 基础域名为 `https://sandbox-acq.onerway.com`，create 与 query 请求来源必须已加入 Sandbox IP allowlist。Production 基础域名为 `https://acq.onerway.com`；启用条件尚未确认。

## 8. UI、响应式和可访问性

冻结参考为 [`docs/design/sdk-m0.html`](design/sdk-m0.html)，它定义 M0 的信息架构、主要状态和视觉方向，不定义支付真值或生产代码结构。

实现要求：

- 使用 Nuxt UI 原语和 registry 提供的语义 token，不复制原型中的硬编码样式。
- 初始只安装 `geist-foundation`；不复制旧 `assets/starter`、旧 export、playground 或 API Docs kit。
- 验收 1440、834、390、320 宽度；独立静态画板不等于真实响应式已通过。
- Demo Hub 的选择器使用正确的 radio / `aria-pressed` 语义。
- 页面提供 `main`、`nav`、`aria-current`、`aria-controls`、可见键盘焦点和状态播报。
- `Change`、`Back to cart` 等控件在演示中必须有真实行为，否则删除。
- 不承诺未实现的邮件发送；卡数据文案只陈述经 SDK / 合规确认的边界。
- SDK 托管输入区的键盘、验证、错误和 iframe 可访问性必须基于真实 SDK 验证。
- Issue #3 的 Payment Element 只是明确标记的非交互 simulation 区域，不渲染 PAN / CVV、伪钱包按钮或伪 SDK 输入。
- 模拟结果的 Technical details 只展示白名单化的 mode、journey、order / attempt 标识、minor amount / currency、标准状态、3DS 模拟标记和 attempt 数量；不得伪造 Onerway transaction id、响应码或 provider payload。
- 真实 Sandbox checkout 在终态形成前必须直接展示可跨系统排查的白名单引用：`merchantTxnId`、Onerway `transactionId`、`paymentId`、Showcase `orderId` 与 `attemptId`；缺失的 provider 标识不伪造。Technical details 可展示 mode、integration、当前 SDK release 标签、受控 journey / 3DS journey 标记、是否观察到 return、上述 order / attempt / merchant transaction / transaction / payment 标识、minor amount / currency、标准状态、query 原始状态、核验 source、预期方式、transaction query 核验的实际钱包和底层网络；SDK callback method 必须另标为非持久的交互事实。当前交互提示还可展示上一段定义的受约束 reason type、reason code 与清洗后的 reason message。不得展示 provider 附加的 return query、query capability、完整 `reason`、未清洗的 `reason.message`、`rawResult` 或其他 provider payload。
- 模拟旅程不得请求 Onerway API、SDK CDN 或银行页面，也不得把结果写成真实 Sandbox 付款完成。
- 异常动作必须明确区分 Reload secure form、Verify existing payment、Retry payment 与 Start a separate Sandbox order；页面只显示当前状态允许且真实可执行的动作，服务端仍在执行时重新核验权限。
- Attempt history 使用语义化列表展示 active Attempt 与 `retryOf` 链；长 identifier 在 320px 仍须换行且不得造成水平滚动。

## 9. 已确认决定

- 新项目独立于 `geist-nuxt`，公开 canonical 仓库为 `abel-wang777-showcase/onerway-payment-showcase`；原 `Abel-Wang777/onerway-payment-showcase` 保持 private archive，不作为后续交付入口。
- 公开仓库用于产品展示、技术审阅和交流，但不授予开源许可证；公开可见不改变凭据、支付数据、Provider payload 和 Production 交易能力的既有安全边界。
- 技术栈为 Nuxt 4、Vue、TypeScript 与 Nuxt UI；设计基础通过 canonical registry 管理。
- 设计基础采用 Source-first registry copy-in；旧 starter / package / layer 架构不再使用。
- 当前只消费 `geist-foundation`，设计基础来源 revision 记录为 `81464cbcf82813181a49043c5437a25eb8e12d45`；本次 registry metadata 更新未改变三个受管 foundation 文件的内容。
- Geist Sans / Mono 字体资产由同版本、精确锁定的 `@fontsource` 包在应用构建中自托管；`@nuxt/fonts` 不再通过 Google provider 解析这两个 family，构建和浏览器运行时都不得依赖 Google Fonts URL。字体导入只属于 consumer-owned `app.css`，不修改 registry 受管的 foundation CSS。
- M0 先交付 Web JS SDK，不包含 iOS / Android SDK。
- Direct API 的 Sandbox 演示允许浏览器输入测试 PAN / CVV，但应用仍不得持久化或记录。
- Delete card token 接口的 `id` 是 binding record id，不是 `tokenId`。
- Checkout、Web JS SDK、Direct API 共用统一支付模型。
- 客户可以从 Demo Hub 自助选择已开放场景，不依赖内部 Console。
- 项目由单人维护，以固定场景和能力模型控制范围，不接受一次性演示分支。
- Demo Hub 的确定性模拟与真实支付 adapter 共用领域模型，但 simulation 事件显式使用独立 source；浏览器会话恢复不是支付真值或正式持久层。
- Web JS SDK v4 当前使用 `paymentId` 初始化且不需要 `redirectUrl`；客户端结果始终经 `/v1/txn/queryPayments` 按 `paymentId` 服务端核验后才形成最终事件。
- 当前 Web SDK 使用 `productType=ALL + subProductType=DIRECT + merchantCustId` 提供用户主动选择的保存卡能力；不使用旧 SDK 保存卡逻辑的 `subProductType=TOKEN`，且不回退到 `productType=CARD`；不新增绑卡 journey、卡列表或 CardBinding 状态。
- Google Pay DIRECT 复用 `standard-success` 与聚合 SDK Element；Showcase 不新增钱包 create 分支、钱包专属 fixture、自绘按钮或 token 处理。`PaymentAttempt.method` 是预期方式，实际钱包 / 底层网络只由 `queryPayments.lastTransactionId → /v1/txn/list` 的严格服务端关联记录补齐。
- 真实 Sandbox 已确认保存卡会在 `DIRECT` 支付后形成独立的 Provider 绑卡交易；Payment result Webhook 不含 `tokenId`，绑卡交易不发送 Webhook。需要 `tokenId` 时由服务端按同一 `merchantCustId` 调用 List saved tokens，且必须区分 binding record `id` 与支付 `tokenId`；Showcase M0 不接入该 token 生命周期。
- 匿名 customer 只在服务端按 `merchantNo + appId + environment + merchantCustId` 隔离并随 recovery 链延续；本地最多保留 30 天且不承诺删除 Provider 侧 saved card。
- #4 的临时通知地址只用于 Sandbox harness；它不替代 #5 的 Webhook 持久化和状态收敛。
- #5 的持久层采用 Vercel Marketplace Neon Postgres，PaymentEvent 保留 30 天并每日清理；原始 payload 和支付敏感数据永不落库。
- Payment result Webhook 使用当前 Sandbox 受控样本命中的动态排除矩阵、`transactionId` 幂等和纯文本 ACK；query 负责调和终态冲突。
- Card merchant confirm 前必须先持久化 `submissionStartedAt`；claim 响应未知、刷新或离页后只允许 query 原 Attempt，不能再次 confirm。
- 新 PaymentAttempt Retry 只接受 query / Webhook 权威形成的 `cancelled` 或未来权威 `failed`，同一 parent 最多一个直接 child；SDK load retry 复用原 Payment，clean Sandbox run 使用独立 Order。
- canonical Vercel Production deployment 是唯一正式验收面并承载 Onerway Sandbox profile；Preview 有意共享同一 Sandbox 权限和运行数据，但跳过 migration，真实入口先导航 Production，再由 Production 创建支付，所有支付回跳与 Webhook 也收敛到 Production，且 Preview 不作为独立验收证据。Onerway Production 实际交易在所有 Vercel scope 继续锁定。
- Sandbox Webhook 默认直达 canonical Production；受发送侧网络限制时可显式启用无 secret、无 payload 存储、只透传上游状态的 HTTPS Relay，最终验签、幂等和持久化边界不变。

## 10. 未决问题

| 事项 | 最迟确认时间 |
| --- | --- |
| Web SDK 从可替换 `v4/latest` 迁移到版本化入口 | SDK 团队提供版本化入口后 |
| Card / APM / Google Pay / Apple Pay 的逐组合能力 | 对应组合标为 Available 前 |
| Production 启用门槛和演示边界 | 任何 Production 交易能力开放前 |
| Checkout 与 Direct API 的完整字段契约 | 对应里程碑排期前 |
| Payment-level `failed` 的正式原始状态与受控 Sandbox fixture | 真实 failed Retry 标为已通过前 |

## 11. 实现顺序

原 private 仓库的历史 Issue / PR 不迁移到公开仓库；已完成事项保留下列 legacy 编号作为交付记录，未完成事项在公开仓库重新建立独立 Issue：

1. Legacy #1：建立可运行的 Showcase 基线与项目契约。
2. Legacy #2：建立安全的 Sandbox / Production Profile。
3. Legacy #3：交付 Demo Hub 与确定性的模拟支付旅程。
4. Legacy #4：完成 USD 5.00 Web JS SDK Sandbox 普通成功。
5. Legacy #5：接入 PaymentEvent 持久化、Webhook 幂等与状态收敛。
6. Legacy #6：完成 USD 50.00 Web JS SDK Sandbox 3DS Challenge 与回跳核验。
7. Legacy #7：完成异常、刷新恢复与安全重试闭环。
8. Legacy #8：部署并验收客户演示版。
9. Legacy #20：验收 Web JS SDK v4 Google Pay 并补齐支付方式归因。
10. Legacy #21：验收 Web JS SDK v4 Apple Pay 真实设备与支付方式归因；该未完成范围需要在公开仓库重新建 Issue。

可靠的回跳恢复依赖持久化，因此 #5 是 #6 的前置条件；两者均已完成，#7 在该基线上补齐持久化提交边界、安全 Retry 和异常旅程。每一步由 GitHub Issue 跟踪；Issue 关闭时，新增的长期决定必须同步回写本契约。
