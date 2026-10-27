# Onerway Payment Showcase 契约

> 状态：M0 Web JS SDK Card、订阅与钱包；Sandbox Hosted Checkout 已有真实演示证据，逐方式能力保持条件限制
>
> 更新日期：2026-10-27（Native SDK SALE 首批后端）
> 作用：这是项目长期有效的产品、架构、状态和安全边界。GitHub Issues 负责交付顺序，不替代本文件。

> 适用范围与来源：第 1–11 节同步自已提交 `fa7c4a859c63d33bb5c34e98c539efa37313b2e6` 的契约；这些旧入口规则不表示三端 v1 已实现，源码版本与工作区基线另见交付 PR。第 12–13 节定义三端 v1 契约；首批 Native SDK SALE 后端已实现，其他批次仍为目标。部署与验收证据以关联 PR 为准，不从契约推定运行时可用。旧入口的 latch、单订单 Cookie、固定客户等现行规则仅约束旧实现，v1 按新规则实施；旧入口须完成消费者、数据和恢复迁移验证后才可删除。
> 首批结构唯一来源：[Demo v1 OpenAPI](api/demo-v1.openapi.json)；[共享合成示例](api/demo-v1.examples.json)。首批结构覆盖一次性 SDK SALE 及其依赖；订阅、时间线、其他支付方式的目标语义保留，结构按后续批次补齐。不能从目标文档推定运行时能力 Available。

## 1. 产品目标、受众和非目标

Onerway Payment Showcase 是一个面向客户的参考商户网站。访问者应当像真实消费者一样选场景、下单和支付，同时能够看到当前接入方式的能力与支付结果。

目标：

- 展示 Checkout、Web JS SDK、Direct API 三种接入方式的实际客户体验。
- 允许访问者在 Demo Hub 自助选择已开放的业务场景、接入方式和测试旅程。
- 用统一模型承载电商、游戏、直播、AI 等商户场景，避免为每个页面重写支付逻辑。
- 同时提供可信的支付状态、脱敏技术详情和可重复演示路径。

非目标：

- 不是 Onerway 商户后台、开发者控制台或内部 Presenter Console。
- 不承担 Provider 的完整认证、风控或渠道测试；交付围绕约定的客户演示体验，仍保证 Showcase 自身的支付真值、恢复、幂等与安全边界。
- 不要求业务人员在隐藏 Console 中切换配置后，客户才能看到不同场景。
- M0 不包含 iOS / Android SDK，也不执行 Production 实际交易。
- 不为每个临时演示需求新增一次性页面；新需求必须落入既有场景、接入或能力模型。

## 2. Demo Hub 与商户体验边界

Demo Hub 是公开演示入口，不是第二套后台。它负责：

- 选择 `Scene × Integration × Payment Method`。
- 明确展示能力为 Available、Conditional、Planned 或 Unavailable。
- 为真实 Sandbox 演示选择测试旅程，例如普通支付或 3DS Challenge。公开 Demo Hub 不提供本地模拟付款入口；模拟状态机与对应的模拟 checkout 路由仅保留供自动化测试 fixture 使用。
- 进入对应的参考商户体验。

首页接入页签按 Checkout、Web JS SDK、Direct API 排列；计费方式、支付方式和测试旅程使用有明确标签的紧凑下拉选择，启动摘要随选择同步。桌面配置与摘要可通过拖拽或键盘调整宽度，两侧保留可读下限；大屏限制阅读宽度并在剩余视口内平衡布局，页脚置于底部。常见桌面尺寸下，配置、金额与启动操作应在一屏内；窄屏按配置到摘要的顺序自然排列，保留至少 44px 的操作区域和直达配置/摘要区的导航；底部使用 Edit selection / View summary 的轻量导航样式，不暗示点击会创建订单或付款，不以缩小文字、裁切必要条件或固定高度隐藏内容换取一屏。未开放选项集中在可展开的说明中，不伪装成可启动的入口。

Preview 的支付入口保留跳转到已配置 canonical Sandbox origin 的边界；query 只携带公开选择及一次性金额配置并定位到启动摘要，不携带支付权限，不从 URL 自动创建订单或付款。canonical 首页的一次 Hosted 启动操作创建订单后直接继续 Onerway 收银台，详情页承担过渡与恢复，不再要求重复确认。

首页统一使用 **Onerway Payment Showcase**，以通用支付体验入口呈现场景、接入方式和旅程。电商演示命名为 **Onerway Store**；**Onerway Gaming / Onerway Live / Onerway AI** 是规划中的演示场景名称，不代表已开放能力或独立正式产品。只有已开放场景可启动，其余继续标为 Planned。商户体验负责商品、订单、支付和结果；不同场景可有不同外观，但支付领域模型、状态真值和安全边界保持一致。页面明确标识 Demo / Sandbox，避免被误认为真实商城或服务。

品牌改名仅改变展示与新钱包会话的商户显示名称。原 Halden 的 `/halden/**` 回跳路由、订单 ID、SKU、匹配用商品名和 `halden-daily-essentials-v1` 的 version / Provider `productName` 保持不变，以保证历史订单恢复和契约一致性；Showcase 商品摘要使用独立展示名称，不回写订单或篡改技术证据。托管收银台及历史记录可能仍显示原 Provider 商品名称，若要迁移需单独版本化计划。品牌图形使用用户提供的官方彩色 SVG（`public/brand/onerway.svg`），原样保留颜色与比例；同时用于浏览器图标，并与 Onerway 文字共用页头组件，显式限制尺寸并适配深浅背景，不使用自创图案或 Geist 标记。

## 3. 能力矩阵

三个独立维度：

| 维度 | 当前或规划值 |
| --- | --- |
| Scene | E-commerce；后续 Game、Live、AI |
| Integration | Web JS SDK、Checkout、Direct API（Apple Pay、Google Pay） |
| Payment Method | Card、APM、Google Pay、Apple Pay；Checkout 的 All 表示由客户在托管页选择 |

能力状态：

- **Available**：当前 profile 与演示条件下可直接运行。
- **Conditional**：集成支持，但依赖商户配置、地区、币种、浏览器、设备或钱包状态。
- **Planned**：项目计划支持，但当前尚未交付。
- **Unavailable**：该组合明确不支持。

能力配置必须是数据，而不是散落在 Vue 组件中的条件判断。M0 首先交付 `E-commerce × Web JS SDK × Card`；其他组合只有在真实契约和验收路径确认后才能标为 Available。

当前 Demo Hub 的数据化矩阵包含全部 60 个组合，状态边界为：

- `E-commerce × Web JS SDK × Card` 为 Available。`USD 5.00 · Standard success` 与 `USD 50.00 · 3DS Challenge` 作为默认预设，在公开 Demo Hub 提供可编辑一次性金额的真实 Sandbox SDK 入口；按钮只在具备所需 SDK 的 Sandbox profile 启用，锁定预览明确说明尚未启用 Sandbox 支付。两条真实 Sandbox Card 黄金路径均已在 canonical Production 域名完成服务端核验，其中 USD 50.00 覆盖 `R → 3DS Challenge → configured returnUrl → same-payment fresh query`。同一能力下另有独立、仅 Sandbox 的 `Halden Daily Essentials` 初始订阅旅程；它没有伪 simulation，也不把订阅计划建模为新的 Integration。
- processing recovery、cancelled retry、deterministic failure 与 form load recovery 四条 Card 异常模拟旅程仅保留为自动化测试 fixture，不在公开 Demo Hub 展示；旧 Hub URL 指向这些旅程时归一化为 `standard-success`。它们不含 Sandbox mode、不产生 provider 标识，也不扩张真实 create allowlist。deterministic failure 只形成 `source=simulation / status=failed` 的本地事实，不能作为 Payment-level `failed` 原始状态证据。
- `E-commerce × Web JS SDK × Google Pay` 与 `E-commerce × Web JS SDK × Apple Pay` 均保持 Conditional，并复用默认 USD 5.00、允许编辑一次性金额的 `standard-success` 真实 Sandbox 入口；Showcase 只记录用户选择的预期方式，是否渲染对应钱包按钮及其资格由同一个 Onerway SDK Element 决定。两者都不渲染伪钱包按钮，也没有钱包专属 simulation。Apple Pay 的最终真实设备 / Safari / Wallet canary 仍需单独授权与用户设备配合，不能由桌面浏览器或历史支付替代。
- `E-commerce × Checkout × All` 为 Conditional，并提供默认 USD 5.00 普通支付与 USD 50.00 3DS 的 Sandbox 一次性支付预设，金额可按第 4 节范围编辑。`All` 是支付方式选择策略，不代表最终使用某张卡或钱包；具体可选项由商户启用、国家、币种和设备条件决定。USD 50.00 真实 3DS 已获用户人工验收确认，返回恢复、超时取消与通知链路已有独立 Sandbox 证据，执行范围见 Issue #8；这些证据不代表所有设备或具体支付方式均已验证，不宣称任一具体收银台支付方式为 Available。同一入口另有 Card 初始订阅选项，沿用固定 USD 5.00 计划且保持 Conditional，范围及证据边界见 Issue #10 章节。
- `E-commerce × Checkout × Card` 提供默认 USD 5.00、允许编辑一次性金额的预授权旅程及全额请款或撤销操作，保持 Conditional；当前实现、查询补偿与真实 Sandbox 验收边界见 Issue #11 章节。
- `E-commerce × Direct API × Apple Pay` 提供默认 USD 5.00、允许编辑一次性金额的 SALE 条件性 Sandbox 入口；自有 Merchant ID 验证、Onerway 代解密。实际 Direct 设备支付验收仍待 Issue #17，不能沿用 SDK Apple Pay 证据。
- `E-commerce × Direct API × Google Pay` 提供 US / USD / SALE 的 Conditional Sandbox 入口，默认金额 USD 5.00 且允许编辑，Google 环境固定 TEST；网关测试 token 的可处理性与托管补充认证仍按本节下述条件记录，不因可取得 token 而标为 Available。
- Checkout 的其余具体支付方式直达、其余 Direct API 方式、其余 APM 和 Game / Live / AI 场景当前为 Planned。
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

2026-10-12 用户确认：全部一次性 Sandbox 入口，包括 Checkout SALE、Checkout AUTH、Web JS SDK（Card 及 SDK 自有钱包）和 Direct Apple Pay / Google Pay，允许用户在创建订单前设置 **USD 0.01–10,000.00**（含端点）。这是 Showcase 演示允许范围，不是 Onerway、商户或渠道统一限额，也不保证范围内每个金额或支付方式均可受理。USD 5.00 / USD 50.00 只作为现有旅程的默认预设；自定义金额不承诺普通成功、是否发生 3DS 或认证结果，既有真实验收仍只证明当时记录的金额和交互。初始订阅继续使用固定 Provider 计划及金额，不接受该自定义金额。

一次性 intent 接受可选 `amountMinor`；省略时取所选旅程默认金额，提供时服务端必须验证为 `1..1_000_000` 的整数，商品单价、数量为 1 的订单总额和 AUTH 授权金额一致后持久化。展示金额字符串最多两位小数，按十进制精确转为 cents，不静默舍入。商品、币种、集成与支付方式仍受服务端 allowlist 约束；真实 Sandbox 旅程按固定商品身份及金额自洽识别，simulation-only fixture 保留固定金额。后续 create、钱包 consult / 授权 / submit、Query 与 Webhook 关联均使用持久化订单金额；客户端不能在这些步骤或 Retry 中再次覆盖金额。

首页金额与跨域 query 仅配置下一笔新订单；恢复已有 Order / Attempt 时保留并展示原金额，不因首页选择变化而改写订单或绕过未完成订单保护。同 Order Retry 继承原金额；支付页显式启动独立 Sandbox 订单时保留当前订单金额，首页显式新单使用当前配置，仍遵守各集成既有新单与恢复边界。金额编辑不改变 production lock、creation claim、token 安全、支付真值或订阅 duplicate guard。

标准化 PaymentAttempt 至少区分：

- `created`
- `requires_action`
- `processing`
- `succeeded`
- `failed`
- `cancelled`

页面可以在此之上表达 `loading`、`ready`、`submitting`、`awaiting_action`、`redirecting`、`verifying`、`not_completed` 等 UI 状态，但不得把页面状态当成支付真值。

Web JS SDK M0 的服务端 Payment query 状态映射为：`S → succeeded`、`I / U / P / A / O → processing`、`R → requires_action`、`N → cancelled`。未知状态拒绝映射并停止结果推进。v4 `confirmPayment()` 与 `payment_result` 使用不同的发起入口和协议：Card 等由商户自定义按钮发起的支付必须先完整处理 `confirmPayment()`；Apple Pay、Google Pay 等由 SDK 自有按钮发起的支付不调用 confirm，以 `payment_result` 作为客户端入口。全局事件订阅可以同时服务这两类方式，但商户 confirm 尚未返回时到达的 callback 只能暂存为白名单化内存事实，不能按到达顺序覆盖或跳过 confirm；多个或不可解析的早到 callback 在 `PresentToShopper` 路径降级为可手动核验的 query-only，`RedirectShopper`、confirm unknown 与其他 query-only 阶段的晚到 callback 一律忽略。confirm 可返回 `R + nextAction.type`，其中 `PresentToShopper` 表示 SDK 已在当前 Checkout 承接并要求商户保留 Element、随后消费 `payment_result`，`RedirectShopper` 表示 SDK 即将外跳并要求商户在 `returnUrl` 后执行服务端 query；两者都只形成非终态 `source: client / requires_action` 事实，不立即 query、不重新 confirm。`payment_result` 不返回 `R`：SDK 自有按钮结果或 `PresentToShopper` 后续结果中的 `P / A / S / N` 只形成非终态 `source: client / processing` 事实并由服务端 query 核验；顶层 `O` 是官方明确允许在同一个未刷新的 `paymentId + Checkout + Element` 上恢复交互和再次 confirm 的唯一支付状态。用户关闭交互返回的 `reason.type=canceled` 不等同于 provider `N`，只在当前仍存活的 Checkout 中恢复交互且不形成 PaymentEvent；没有顶层支付状态且明确返回 `reason.type=validation_error` 表示本地表单校验失败、未产生支付状态：保留当前 Checkout / Element，提示用户补全支付信息，允许在同一存活交互中再次 confirm，不形成 PaymentEvent、不自动 query；SDK / API error 与无法识别的结果仍进入 query-only，不伪装为 `processing`。这些路径刷新后均恢复为 query-only。confirm / callback 的 `rawResult`、完整 `reason` 和 `nextAction` 附加字段均不保存、不记录或原样展示，只在当前内存白名单化匹配的 `paymentId`、`paymentMethod`、顶层 `paymentStatus`、公开的 reason type 与 next-action type。Sandbox 页面可额外展示当前交互中受约束的 SDK 诊断投影：仅接受公开 reason type、格式受限的 reason code，以及经过长度限制和敏感模式清洗的 reason message；URL、邮箱、长数字、控制字符与尖括号内容必须脱敏或移除，一旦检测到 secret / token / signature / authorization / credential / CVV / PAN / capability 等敏感语义则整条 message fail closed 为脱敏占位符。reason 的安全 code / message 投影是主来源；仅当对应投影结果为空时，才允许从同一 SDK 结果的 `rawResult.respCode / rawResult.respMsg` 逐字段兜底并应用完全相同的校验与清洗。主来源与兜底冲突时 reason 胜出；只有 rawResult 诊断时不推断 reason type；`rawResult.data` 和所有其他未知字段始终忽略。该投影不是原始字段透传，不得包含 `rawResult` 或完整 `reason`，不得写入日志、PaymentEvent 或持久化；刷新后不恢复。2026-08-09 真实 Card confirm 观察到的 `reason.type=api_error + reason.code=40000 + reason.message=Invalid transaction URL` 因而可显示具体诊断并提示检查 `returnUrl / notifyUrl`。所有诊断只解释交互失败原因，不形成支付状态，也不改变 query / Webhook 才是最终真值的规则。该协议以 Onerway v4 demo `https://beta-checkout-sdk.ronhan.com/v4/demo/index.html#confirm-payment` 及 2026-08-06 确认的商户按钮 / SDK 自有按钮发起边界为当前受控依据。

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

## 5. Sandbox 接入路径

### Web JS SDK M0 黄金路径

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

Web JS SDK 集成内的 Google Pay / Apple Pay 不新增 create adapter、钱包专属 fixture、Google Pay JS 或 Apple Pay JS。Demo Hub 的两个钱包选择都复用默认 USD 5.00、允许编辑一次性金额的 `standard-success`，服务端仍发送 `paymentMode=WEB + productType=ALL + subProductType=DIRECT + txnType=SALE`；`PaymentAttempt.method=google-pay / apple-pay` 只记录本次验收预期，不保证 SDK 最终渲染对应按钮，也不把支付方式与 Onerway 的 `DIRECT` 交易模型混用。同一聚合 checkout 保留 Card merchant action 和 SDK 自有钱包按钮；Card action 才调用 `confirmPayment()`，SDK 自有按钮继续只通过 `payment_result` 进入核验。该 SDK 路径不实现 merchant session、validation URL、certificate / private key 或 Apple payment token / wallet payload 处理；这些属于 Onerway SDK / 服务端边界。独立 Direct API 路径见下节。Showcase 仅在 `/.well-known/apple-developer-merchantid-domain-association.txt` 原样提供 Apple 要求的域名关联文件，该静态资产不扩张支付数据或凭据处理面。

2026-08-13 真实 Sandbox 验收确认：当前 create 会发送非空 `merchantCustId`，用户可在 SDK 托管表单中主动勾选保存卡，后续同 scope 的新支付会正确回显 saved card。Provider 内部先完成 `DIRECT` 支付交易，再为用户选择的保存卡执行第二笔绑卡交易；Payment result Webhook 不包含 `tokenId`，第二笔绑卡交易也不发送 Webhook，因此商户不能从支付通知链路取得 `tokenId`。需要服务端 token 生命周期时，商户可使用同一 `merchantCustId` 调用 [List saved tokens](https://developers.onerway.com/payments/api-reference/endpoints/list-saved-tokens)，从 `data.tokenInfos[]` 读取 `tokenId`；其中 `id` 是 binding record id，不是支付使用的 `tokenId`。该查询是独立的 server-only 能力，不改变支付真值、不把保存卡并入 PaymentAttempt，也不属于当前 Showcase M0 的卡列表、解绑或 token 支付范围。

真实 Sandbox create 只接受服务端 allowlist 中的旅程，并从已持久化 Order 生成金额与商品：普通预设为 USD 5.00 / `HL-SAMPLE-005`，3DS 预设为 USD 50.00 / `HL-SAMPLE-050`；一次性金额可按第 4 节范围编辑，商品身份保持受控。两者都固定使用 `paymentMode=WEB`、`productType=ALL`、`subProductType=DIRECT`、`txnType=SALE`、`risk3dsStrategy=DEFAULT` 与 `orderCurrency=USD`，并附带当前 Order 私有绑定的 `merchantCustId`；USD 50.00 是既有 Sandbox 受控资料及验收记录中的 3DS 条件；自定义金额不沿用该结果承诺，不把 `INNER` 或修改金额作为强制认证补丁。同步 create 的 `respCode=20000` 仅表示创建请求成功，返回 `status=U`、`transactionId` 和 `paymentId` 后才初始化 SDK。客户端向 intent 提交 allowlist journey id、允许的预期支付方式和可选 amountMinor，由服务端验证后保存；普通入口遇到已有非终态恢复能力时始终返回原 Order / Attempt 及其金额，不因页面后来选择另一旅程或金额而创建平行支付。只有下一段定义的用户显式 Sandbox 新订单入口可以更换恢复绑定。

公开 Demo Hub 仅展示真实 Sandbox 旅程，不再提供模拟启动按钮或仅模拟异常旅程。底层确定性模拟状态机、模拟 checkout 路由及普通成功、3DS、异常旅程继续作为自动化测试 fixture 保留，由测试显式初始化，不作为客户入口或真实支付证据。测试模拟会话使用版本化 `sessionStorage` 在单个浏览器标签页内保存 Order、PaymentAttempt 和 PaymentEvent，刷新时恢复同一 attempt；Retry 追加新 attempt 并保留旧历史。该存储不包含凭据、PAN / CVV 或原始 provider payload，也不替代第 6 节要求的服务端持久化。真实 Sandbox 会话不写入该 simulation 存储。为避免 Provider-created 非终态阻塞后续受控测试，Demo Hub 的真实 Sandbox 按钮与支付页的 clean-run 按钮都显式启动一个新的独立 Sandbox Order；这不是旧 Order 的 PaymentAttempt Retry，不取消、不覆盖旧 Attempt，也不改变其支付真值，旧 Attempt 仍由 query / Webhook 收敛。该测试入口只在 Sandbox profile 开放，普通恢复入口仍复用同一非终态 Attempt，不能据此推导 Production 的放弃或重试语义。

### Direct 钱包付款反馈

Apple Pay 与 Google Pay 的主付款区域均先展示商品、订单号和金额，移动端不把这些信息放在流程讲解之后。自动授权后的在途提交、回跳恢复和实际查询提供可见且可被辅助技术读出的等待反馈；等待动画仅对应实际请求，不把已提交、待验证或暂未查到交易当作持续加载。确认的成功、失败或取消在主区域展示，查询失败保留已确认结果。钱包关闭及 returnUrl 本身不产生成功效果；手动捕获明确显示未提交。授权触发的提交将付款回执带回可见区域，不抢夺键盘焦点；不因此新增支付调用、修改状态真值或重提 token。

### Apple Pay Direct API（Issue #17）

旅程为 `apple-pay-direct`：E-commerce、USD、SALE，商品 `HL-APPLE-005`；默认金额 USD 5.00，一次性金额可按第 4 节范围编辑。沿用现有 Sandbox merchantNo/appId；Merchant ID 为 `merchant.com.onerway.showcase`，域名为 `https://onerway-payment-showcase.vercel.app`。本期使用自有 Merchant Identity 验证商户，Payment Processing 私钥及 token 代解密由 Onerway 承担；不调用代理验证接口，不采集卡号，不含订阅、AUTH、其他 Direct 方式或 Production 交易。渠道及域名准备的确认不替代真实支付证据。

- `POST /v1/txn/consultPaymentMethod` 以本交易金额、币种、US、WEB、DIRECT 查询，读取唯一 `ApplePay` 的 `countryCode` 与 `subCardTypes`。浏览器资格另用官方 Apple Pay JS `1.latest` 与能力检测确认；不硬编码 Safari-only。优先验收 iPhone Safari，跨浏览器扫码不在首期必验范围。
- 订单先持久化并签发既有 HttpOnly recovery cookie。自动支付的 Direct 提交与所有 intent 共用同一独占 Web Lock；锁等待计入授权预算，超时、取消或离页后尚未发出的提交不再执行，防止多标签切换订单覆盖在途提交的恢复绑定。官方 `apple-pay-button` 的用户点击同步启动 ApplePaySession；订单金额和币种由服务端控制。准备、商户验证不创建上游交易；自动支付收到完整 `event.payment.token` 后，服务端才原子认领既有 creation claim 并提交 `/v1/txn/doTransaction`。请求固定 `CARD + DIRECT + SALE`，`tokenInfo = JSON.stringify({ provider: 'ApplePay', tokenId: JSON.stringify(token) })`。每层只序列化一次，使用完整 token 而非仅 paymentData。
- 2026-10-08 用户授权两种 Sandbox 模式：默认「自动支付」在 Wallet 授权后立即按原流程提交；「手动调试」只捕获 token，不调用 `/api/payment/apple-pay/pay`、不认领提交、不自动轮询 Provider、不把订单投影成 processing / succeeded / failed。模式必须在打开 Wallet 前选择；面板打开、准备中或已提交后禁止切换。手动捕获后取消本地授权 timer 并调用 `ApplePaySession.abort()` 结束本次 sheet，不使用 `STATUS_SUCCESS` 伪报支付成功，也不让 sheet 停留等待复制；本次主动关闭的晚到 `oncancel` 不清除捕获的副本。用户之后主动展开或复制 token 到 Apifox 等工具，以与本次授权一致的订单金额及币种自行提交请求并在该工具核对结果；外部请求不自动关联本页 Order。清空 token 不改变「未提交」事实；切换模式或重新打开 Wallet 会清除旧副本，自动模式必须取得新授权，不自动消费手动 token。Apple 的 30 秒回调响应要求不是 token 有效期；授权后 abort 的设备表现及捕获 token 能否被 Onerway 受理仍需真实 Sandbox 验证。
- `ONERWAY_*` 仍由 `server/utils/profile.ts` 唯一解析。新增 Sandbox Apple Merchant ID、证书 PEM 和私钥 PEM 仅在服务端；全部未配时 SDK / Checkout 仍可运行，部分配置则拒绝。身份材料不得放入 public profile、客户端、日志或持久层。Merchant Identity 与 Payment Processing 证书用途不能混用。
- 验证 URL 来自 Apple 事件，服务端仅允许 HTTPS 的 `apple-pay-gateway-cert.apple.com` 或 `cn-apple-pay-gateway-cert.apple.com`，路径仅 `/paymentservices/startSession` 或 `/paymentservices/paymentSession`；拒绝 userinfo、显式端口、query、fragment、其他主机与重定向。域名取受控 canonical origin；mTLS 总等待与响应大小有界。Apple Sandbox tester 与 Sandbox merchant session 配对，遵守 TN3174 的 2026-10-01 环境变更，不从 Vercel deployment 名称推导 Apple 环境。
- 商户验证失败的服务端诊断仅记录固定类别（URL / 账号环境、未配置、HTTP 拒绝、超时、TLS、传输、响应格式或大小）及上游 HTTP 状态；不记录实际验证 URL、身份材料、session、响应体或原始异常。诊断不放宽 Sandbox 地址白名单。
- token 与 merchant session 不写入日志、数据库、PaymentEvent、浏览器存储或既有 Technical details。2026-10-08 用户授权新增仅 Sandbox、当前访问的 token 调试区：收到本次 Wallet 授权后，完整标准 Apple token 的单一序列化快照只保留在组件内存；默认收起，由用户主动展示或复制。提供 JSON 对象、Stringify JSON 字符串值、Apifox `tokenInfo` 对象请求片段及 Direct API `tokenInfo` 字符串请求片段，自动支付提交仍使用同一快照恢复的对象。Stringify 将已有 `JSON.stringify(token)` 快照再编码为可粘贴的 JSON 字符串字面量，带外层引号和转义符，仅改变展示/复制格式；在 JSON 请求编辑器中整体替换 `tokenInfo.tokenId` 的值，不额外加引号或 stringify。Apifox 对象片段使用 `tokenInfo: { provider: 'ApplePay', tokenId: <完整 token 的字符串值> }`，内层转义已由 JSON 格式化生成，外层由现有公共签名脚本序列化一次；Direct API 片段的 `tokenInfo` 已是 wire 字符串，使用公共签名脚本的 Apifox 编辑器优先复制 Apifox 对象片段。调试展示只接受标准 token 字段结构且不超过服务端 64 KiB 上限；未知字段在自动模式不展示、不删改支付提交，在手动模式不展示且不提交。清空、用户 Wallet 取消、新面板、模式切换、`pagehide`（含 BFCache）和组件销毁均清除调试副本；离页关闭旧面板并阻止尚未发出的锁等待提交，已发出的支付仍按原单核验。刷新或服务端恢复不恢复 token，复制后的剪贴板由用户管理。自动模式捕获的 token 已用于本次提交，页面提示不用于再次扣款。该例外不开放 merchant-session 凭据、PAN / CVV、Production 交易或重复提交。测试与截图仅使用合成占位数据。可展示订单、Attempt、商户交易号、transactionId、存在时的 paymentId、可信状态及来源。
- 本路径按**同笔交易 `status`**：`S → succeeded`、`F → failed`、`N → cancelled`、`P/I/U → processing`、`R → requires_action`。可信来源为关联正确的同步 Direct 响应、严格匹配的 query 与验签 Webhook；忽略 `paymentStatus`，不全局更改 SDK / Checkout 映射。R 暂无本范围已确认的商户 action 协议，保持待核验，不根据未经确认的 URL 自动跳转。未知状态、响应丢失、查无记录与 HTTP 200 均不证明失败或成功。
- 恢复按已保存 `merchantTxnId` 查询 `/v1/txn/list`，核对唯一交易、金额币种和已有 provider IDs，不要求先有 paymentId；事务内再次检查固定 transactionId。刷新与恢复保留 Direct 页面及订单，结果未知只能查询原单，不重发扣款。早到通知与同步响应共享同一 Attempt；既有 query / Webhook 非终态不得阻断随后关联正确的同步 Direct 终态，同步非终态不得覆盖 query / Webhook 投影，已有 query 终态仍优先；终态不被中间态回退，终态冲突由 fresh query 调和。
- Direct 禁止同 Order 的 Attempt retry。F/N 后“重新下单支付”创建新的 Order、Attempt、merchantTxnId 和 Apple session/token，保留旧结果。已认领提交且结果未知的 Apple Pay Direct Attempt 即使收到 restart 请求也保留恢复绑定；不得借切换接入方式绕过。Google Pay 的显式新建 Sandbox 订单例外见下节。未提交 token 前关闭钱包仅结束本次面板，不产生 Onerway N；仍可启动新的 Apple 会话或显式选择其他旅程。订单仍为 created、无提交 claim 且无 Provider ID 时，显式切换 Apple Pay / Google Pay 应按所选钱包创建独立订单并更新当前恢复绑定；Apple Pay 同钱包重复打开继续复用原订单。除下节 Google Pay 显式新建独立订单外，已认领、已进入处理/认证状态或有 Provider ID 的非终态订单仍只恢复原单，不因切换钱包放开重复提交。
- 自动模式从 `onpaymentauthorized` 开始计约 25 秒总预算。明确 S 完成面板成功，F/N 完成面板失败；预算耗尽但交易未明时，对尚有效且未完成的面板返回失败，订单继续“结果确认中”并查询原单。面板最多完成一次；晚到结果继续收敛订单。25 秒是 UI 等待预算，不是交易失败规则，不能据此开放新订单。手动模式授权捕获后立即 abort，不等待 Provider 结果。
- 页面保留 Halden 商品、金额与付款操作，以 Customer、Merchant client、Merchant server、Apple / Wallet、Onerway 五方交互图展示六个主阶段：准备付款、打开钱包、商户验证、用户授权、提交 Onerway、确认结果，并将 Wallet `oncancel` 作为无 Provider 报文的教学分支。图中优先突出 `onvalidatemerchant → validationURL → Apple mTLS → merchantSession → completeMerchantValidation`、`onpaymentauthorized → event.payment.token` 等回调边与每阶段各一句客户端/服务端动作；完整 merchantSession 仅瞬时回传 Apple，图示投影和短 illustrative 伪代码中的合成 merchant session、`EC_v1` token 只保留字段结构和敏感值占位。手动选中的阶段不被实时跟随覆盖、不移动焦点，讲解不暂停 Apple 时限；本次交互、服务端恢复与合成示例明确区分，恢复后只展示可确认事实，不伪造此前钱包步骤已成功。
- 2026-09-23 用户确认面向商户/开发者演示，实际值优先展示并按字段脱敏：金额、币种、状态、国家、支持网络、公开 Merchant ID/验证域完整展示；验证 URL 仅展示通过同一 Sandbox 白名单的 HTTPS 主机与路径，不显示其他原始 URL。Merchant session 仅投影 epochTimestamp/expiresAt（保持原数值，另提供可读有效期）、匹配当前域的 domainName 与已知 displayName，session 标识、nonce、签名及未知字段均省略；不持久化会话或其投影。授权阶段的安全时间线仍仅显示白名单 network/type/version 与“加密 token 已收到”，不展示卡片显示名、钱包交易标识或 token 片段，不推断 Face ID 等具体认证方式；完整 token 只适用上文单独授权的 Sandbox 调试区。
- 订单/商户/应用/客户/Provider 交易标识在协议摘要内统一保留首尾各 4 字符，长度不超过 8 时全部省略；既有授权 Payment references 的精确标识边界不变。服务端从实际发送的同一 payload 显式投影请求摘要，只返回方法、路径、上述脱敏标识、金额币种、CARD/DIRECT/SALE/WEB 及 tokenInfo/txnOrderMsg 的结构占位；不返回完整 payload、sign、secret、IP、UA、地址或邮箱。摘要只在本次响应和页面内存中使用，不写入 PaymentEvent、日志、浏览器存储或数据库；时间线复制只复制安全摘要，完整 token 的复制仅限上述调试区。没有成功响应时，不把客户端发起请求当成 Onerway 已接收。
- 支付结果仅展示已关联的同步响应、Query、已验签 Webhook 状态与来源；三者是无固定到达顺序的独立观察路径。`completePayment` 仅完成 Apple 面板展示，不替代订单状态。钱包回调的网络只标为钱包提供，actualWallet/fundingNetwork 的已核验归因仍来自严格匹配的服务端 Query。合成示例使用明确占位符和独立标签，不伪装为本次实测报文。

真实 iPhone 授权、商户验证 mTLS、Onerway 代解密、同笔 query / Webhook / persistence 的黄金路径须分别在 Issue #17 登记。自动化与本地浏览器通过只证明对应测试范围；本实现合并与正式发布须另获本次授权。

### Google Pay Direct API（Issue #20）

旅程为 `google-pay-direct`：E-commerce、US / USD、SALE，商品 `HL-GOOGLE-005`；默认金额 USD 5.00，一次性金额可按第 4 节范围编辑。Google `PaymentsClient` 固定 `TEST`，现有 Onerway profile 仍为 Sandbox，两者是独立环境维度。使用官方 `pay.js`、`createButton()`、`isReadyToPay()` 和用户点击时的 `loadPaymentData()`；采用 `PAYMENT_GATEWAY`，由 Onerway 处理 gateway token，不做商户自解密。

- 服务端用持久化订单金额及 US / USD / WEB / DIRECT 调用 `consultPaymentMethod`，只接受唯一 GooglePay 记录并白名单投影 `gatewayName`、`gatewayMerchantId`、`countryCode`、`subCardTypes`。认证方式按当前 Onerway [Google Pay 指南](https://developers.onerway.com/zh/payments/online-payments/payment-methods/google-pay)同时声明 `PAN_ONLY` 与 `CRYPTOGRAM_3DS`，不从网络列表推导实际 token 的认证方式。生产锁定和唯一 profile 解析保持不变，不把 credential 或整个响应放入 public profile。
- `paymentMethodData.tokenizationData.token` 已是字符串，原样作为 `tokenId`，wire `tokenInfo = JSON.stringify({ provider: 'GooglePay', tokenId: token })`。不解析后重建支付 token，不对 `tokenId` 多做一次 stringify。金额、币种、客户、回跳地址和通知地址由服务器控制；请求保持 CARD / DIRECT / SALE，复用权限、creation claim、独占 Web Lock、签名、Query 与验签 Webhook。
- 默认自动支付；手动调试在打开 Google 面板前选择，只捕获本次 token，不提交、不认领、不轮询、不改变 Order/Attempt 状态。外部 Apifox 请求及其结果不自动关联本页订单。切换模式、重新授权均清除旧副本，自动模式必须取得新 token。取消与 `loadPaymentData()` 的返回只描述钱包交互，不构成付款成功或 Provider 取消。
- **2026-10-09 用户明确授权**将完整 token 调试例外扩展到 Google Pay，仅限 Sandbox、用户主动展开、当前页面内存。只提取 token 字符串，不保存完整 PaymentData。JSON 视图仅在可解析为 JSON 对象时展示；否则明确为非对象字符串，不伪造对象。Stringify 提供带外层引号及转义的 JSON 字符串值；Apifox 提供对象形式 `tokenInfo`，交由既有签名脚本序列化外层一次；Direct API 提供已经序列化的 wire 字符串。四种用途必须还原同一个原始 token。清空、新授权、模式切换、离页（含 BFCache）及销毁时清除；刷新不恢复。不进入日志、数据库、PaymentEvent、浏览器存储、URL、公开 profile 或既有 Technical details。剪贴板由用户管理；自动提交后的 token 不得再次用于扣款。该例外不开放 PAN/CVV、Production 或重复提交，测试与截图仅用合成数据。
- Direct 状态遵循同笔交易 `status`，不采用 SDK 的 `paymentStatus`。 Direct 同步提交的非 `20000` 业务响应若包含明确 `status=F`、合法交易标识及匹配的金额/币种，继续经过既有商户、订单与交易关联校验后记录失败；不将这类已确认失败显示为结果未知。此例外不适用于查询响应，也不从错误码或错误文案推断其他支付状态；超时、不完整或不匹配的响应仍只允许查询原单，不重发 token。2026-10-10 用户确认 PAN_ONLY 可返回 `R + redirectUrl`，要求在 Onerway 托管页补充 CVV；此时 Onerway 尚未落单，只有托管页收集并提交 CVV 后才可能落单。同步响应的 `merchantTxnId/transactionId/paymentId` 均可缺失，以本次服务端请求的既有 `merchantTxnId` 关联原单；无回显标识时要求匹配的金额与币种，若回显标识则仍校验一致，不重新下单，也不以 `actionType` 作为跳转的必要字段。自动模式仅接受 HTTPS `sandbox-checkout.onerway.com` 的精确 `/additional-information` 路径，且 URL 内 `returnUrl` 必须与本次服务端生成的原单回跳地址一致；拒绝 credentials、fragment 及不合法或重复的关键参数。经校验的链接仅随本次支付响应临时返回并用于顶层导航，不进入订单快照、PaymentEvent、日志、浏览器存储或教学证据；离页前清除 token 调试副本。托管页负责采集 CVV 与姓名，Showcase 不接收这些表单字段。托管页回到 `/halden/direct/:orderId` 后，使用恢复 cookie 查询原单；回跳不表示成功，不再次提交 token。缺失或无效的链接仍保留 `requires_action`，明确提示托管认证不可继续并允许用户查询原单；等待托管认证时不自动轮询。恢复或回跳可查询一次，`content` 空数组或已观察到的 `records: [] + total: 0 + current: 1` 空页表示暂未查到交易，不推断失败或取消，不以通用查询故障展示，也不继续自动轮询。用户仍可手动查询；原托管页已关闭且临时链接丢失时，可显式新建独立 Sandbox 订单，不重提原 token。非空 `records` 不作为已确认的查询记录契约接受。手动调试不自动提交或跳转；真实 CVV 提交与回跳验收独立记录，自动化通过不等同于真实支付验证。
- 讲解体验与 Apple Pay Direct 保持同等深度：可切换阶段的参与方流程图、客户端/服务端职责与示例代码，以及每步输入、输出、失败边界、文档链接和本次安全证据。Google 阶段按配置准备、浏览器就绪、钱包授权、提交、服务端核验组织，并独立说明钱包关闭分支；不套用 Apple merchant validation 或 completePayment。流程图中的示例与本次观察分区展示；手动模式止于捕获，后续提交/核验不标完成；刷新仅恢复有服务端依据的步骤，不伪造此前浏览器事件。
- 已提交或结果未知的 Google Pay 原单只查询，不重发 token。用户显式选择“新建 Sandbox 订单”（`restart: true + google-pay-direct`），且当前恢复绑定属于 Google Pay Direct 时，无论旧单处于未提交、已认领、requires_action 或 processing，均允许创建独立的 Order/Attempt/merchantTxnId 并取得新授权；不取消、修改或重提旧单，也不将其标为失败。终态后的新支付同样创建独立订单。普通进入与刷新不带 restart，继续恢复原单；Apple Pay、跨钱包的已提交订单和 Production 策略不变。当前恢复 cookie 仅绑定一笔订单，新建后切换到新单，不能用新 cookie 查询旧单；旧单仍保留在服务端，可由关联正确的 Webhook 继续收敛，新建订单不证明旧单不会成功。Direct 恢复根据持久化的钱包方式选择页面，不依赖 URL query 推断钱包。刷新不能恢复旧 token 或伪造先前 Google 面板步骤。
- Google 普通 TEST、Mock test cards 或面板返回 token 不证明 Onerway 已解密或可扣款。Onerway [测试说明](https://developers.onerway.com/zh/payments/get-started/testing)指向测试卡群组；Google [测试卡套件](https://developers.google.com/pay/api/web/guides/resources/test-card-suite)未将 `ronghan` 列入 gateway test cards 支持表，未列网关使用 mock 卡时可能被处理方拒绝。因此浏览器 mock、Google 取 token、Onerway 提交/拒绝、Query、Webhook 与用户人工确认分别记录；预期拒绝可验证约定调试链路，不等同于付款成功或未观察到的解密证据。

### Checkout 接入决定与验收边界（2026-09-14）

用户已确认首版沿用 Halden 电商场景，接入 Sandbox 托管收银台的一次性支付、回跳与服务端核验，由收银台展示商户在当前交易条件下已启用的全部支付方式。首版不含保存卡；后续保存卡与复购按下方 Issue #9 边界接入。Checkout 初始订阅按下方 Issue #10 边界接入；预授权和 Production 交易仍不属于此范围。以下记录当天发布文档与用户确认的实施边界；模拟、自动化测试不替代真实 Sandbox 验收。

已确认的官方输入与跳转契约：

- [收银台接入](https://developers.onerway.com/zh/payments/online-payments/checkout)与[创建收银台支付](https://developers.onerway.com/zh/payments/api-reference/endpoints/create-checkout-payment)：调用 `POST /txn/payment`，普通聚合支付使用 `productType=ALL`、`subProductType=DIRECT`、`txnType=SALE`，不传 `lpmsInfo`，避免锁定单一支付方式。商品来自服务端旅程 allowlist，金额来自经 intent 验证后持久化的订单；按创建接口必填要求提供固定 Sandbox 账单/收货样例（US、CA 与测试邮箱），不向客户采集这些字段。
- `txnOrderMsg` 提供 `returnUrl` 与 `notifyUrl`；浏览器、设备及持卡人 IP 由托管收银台采集，商户不沿用 SDK create 的 browser/device/IP 输入。创建返回 `U` 与 `redirectUrl` 后跳转，回跳不构成成功证据。
- 当前公开示例证实的 Sandbox 跳转 origin 为 `https://sandbox-checkout.onerway.com`，路径包含 `/checkout` 与 `/aggregate`；示例不能作为任意子域或 Production origin 的授权。跳转 URL 只用于当前请求后的浏览器导航，不记录日志、不写入 Order / Attempt / Event、不进入 Technical details。

本次已确认的差异及处理：

| 边界 | 当前项目已验 SDK 契约 | 2026-09-14 发布文档 |
| --- | --- | --- |
| 通知验签入口（已迁移） | 历史实现使用 body `sign` | [请求签名](https://developers.onerway.com/zh/payments/get-started/request-signing#webhook-%E9%AA%8C%E7%AD%BE)要求使用 `X-Rh-Signature` 的 `v1` 签名项；body `sign` 仅兼容保留，不能可靠覆盖密钥轮换 |
| 终态冲突处理（按用户决定保留） | fresh query 可调和冲突的 Webhook 终态，保留冲突事件 | [Webhook 通知](https://developers.onerway.com/zh/payments/get-started/webhooks)要求终态 Webhook 优先，query 只用于补偿 |
| 收银台查询维度（按 integration 分派） | SDK 继续使用 `POST /v1/txn/queryPayments` | 收银台使用[查询交易记录](https://developers.onerway.com/zh/payments/api-reference/endpoints/query-transactions) `POST /v1/txn/list`；SDK 继续使用 Payment 查询。文档未明确禁止收银台调用 Payment 查询，但不能据此替代它指定的交易查询流程 |
| 收银台取消通知（新增受限例外） | 仅 Checkout 的 `status=N` 且缺 Payment 级字段可走无 ID 关联 | [支付结果通知](https://developers.onerway.com/zh/payments/api-reference/webhooks/payment-result)明确收银台订单取消可能缺少 `paymentId` 与 `paymentStatus`，需以已验签的商户、交易关联和金额币种处理 |

同日支付结果 API Reference 已将 `paymentMethod` 与 `walletTypeName` 标为不参与验签，与现有字段排除集合一致。普通通知的 `scenarios: null` 分流修复后，header 通知链路已取得真实 Sandbox 重发与自动超时取消样本；两类证据分别登记在 Issue #8。

实施规则：

- 真实旅程为 `hosted-checkout`（默认 USD 5.00、`HL-CHECKOUT-005`）与 `hosted-checkout-three-ds`（默认 USD 50.00、`HL-CHECKOUT-050`），一次性金额可按第 4 节范围编辑，均为 `integration=checkout`、`method=all`，不提供伪造收银台或结果保证的本地 simulation。USD 50.00 触发条件由用户在 Issue #8 确认；验收时在托管页选择 Card，由 Provider 承接 Challenge，不新增商户 3DS 或 risk strategy 补丁；金额编辑不保证触发或通过 Challenge。选择其他支付方式不构成 Card 3DS 验收。`all` 通过 `0007_checkout` 迁移加入已有 method 约束；新增旅程复用现有 Order / Attempt / Event，无新增数据库字段。
- Hosted 页与结果页从持久化 Order 的商品身份、币种与金额自洽识别旅程。默认 USD 50.00 的 3DS 预设可标为 `threeDSJourney=challenge`，只表示所选测试条件，不证明实际发生或通过 Challenge；其他一次性金额使用 `provider-determined`，不承诺 Provider 会要求或跳过认证。Hosted 页显式启动独立 Sandbox Order 时保留当前旅程和金额，不静默降回 USD 5.00；恢复和 Retry 继续保留原订单关联与金额。
- 创建继续分为先持久化 intent 并签发 cookie、再认领 Provider create 两步。adapter 由持久化 Attempt 的 integration 决定；Hosted create 只接受空对象，不调用客户端 browser data 采集。客户在 Demo Hub 确认当前选择并启动后，`/halden/hosted/:order` 自动消费本次 create 返回且与当前 Attempt 匹配的一次性内存链接，直接进入托管收银台，不再要求第二次确认。该页面仍承载导航失败、刷新和返回后的订单恢复与白名单引用；不存在新鲜链接时只查询原订单，不自动重建或重放。普通支付、预授权与首次订阅共用该导航规则；不挂载 SDK、不调用 confirm 或 SDK submission latch。
- 跳转 URL 仅保留在当前浏览器内存的独立导航引用中，外跳时消费；不进入 Payment session/Event、持久层或 Technical details。刷新、恢复与结果未知时不重放 create、不拼造收银台 URL，只恢复和查询已有交易。
- `Return to Merchant Page` 的显示由商户开关控制。2026-09-16 用户确认该入口只返回商户页，不立即关闭交易或发送取消通知；交易置为 `N` 及取消通知须等待 Provider 超时关单。点击入口后仍为 `U` 时继续保持 `processing`，不得把返回、关闭页面或点击行为映射为 `cancelled`。验收分别记录同订单返回恢复与超时关单后的 query / Webhook 收敛，不以返回成功替代 `N` 终态证据，也不假设未确认的关单时长。
- Checkout 查询调用 `POST /v1/txn/list`，按保存的 `merchantTxnId` 唯一匹配，并核对金额、币种及已有 provider IDs；`S → succeeded`、`N → cancelled`、`R → requires_action`、`I/U/P → processing`。交易 `F` 可能对应仍开放的 Payment，因此保守保持 `processing`，不开放新扣款 Retry；存在 Payment 轴时结合 `S/O/N`，未知值拒绝。
- 无 Payment ID 的取消只允许已验签、商户匹配且 `status=N`、缺 `paymentStatus` 的 Checkout 通知；按唯一 `merchantTxnId`、金额、币种与已存 `transactionId` 核对。它可以早于 create 响应，后续 create 完成不能回退已持久化终态。SDK 和非取消通知不获得此例外。
- 创建响应丢失后若只有无 Payment ID 的 Checkout 取消事实，恢复响应显式返回 `paymentId=null`、`query=null`；页面按 cookie 恢复既有取消，不能伪造 Payment ID、query capability 或调用 SDK。该情形首版不提供同 Order Retry，用户可回 Demo Hub 启动独立 Sandbox Order；具有 Payment ID 的权威取消继续使用既有唯一 child Retry。
- `returnUrl` 在服务端 SSR 前丢弃附加 query（303、no-store、no-referrer），使用同源恢复 cookie 并对同一订单 fresh query；Checkout 按交易维度查询，SDK 按 Payment 维度查询。双方终态冲突遵循第 6 节用户确认的调和规则。Production 交易、canonical origin、限流及凭据边界不变。

验收按 Showcase 责任与证据类型分层。自动化覆盖受控旅程、金额边界及关联、创建认领与 URL 单次消费、回跳查询、无 Payment ID 取消、header 验签与幂等、终态冲突、跨 integration 恢复及 SDK 回归；页面检查覆盖约定的响应式、明暗和键盘交互。真实 Sandbox 验证本次承诺的客户旅程和通知链路，不要求每个防御性测试都有真实交易副本。用户于 2026-09-16 确认按 Demo 目标收尾，不将 Provider 拒付及其内部重试机制作为本次交付必验项；状态映射与安全限制不因此放宽。

一次性支付的执行结果登记在 [Issue #8](https://github.com/abel-wang777-showcase/onerway-payment-showcase/issues/8)，长期验收边界为：

| 范围 | 验收要求 |
| --- | --- |
| Issue #8 原始演示验收 | USD 5.00 普通入口与 USD 50.00 3DS；确认客户可进入托管页、完成约定旅程并由服务端核验。USD 50 的用户人工确认单列，不与其他订单的通知证据拼成同笔全链路 |
| 商户返回与恢复 | Return to Merchant Page、关闭 / 刷新 / 后退只恢复原订单，不以交互判定终态、不重复创建；超时关单后的 N 由 query / Webhook 收敛 |
| 通知接收 | 核对真实通知的 Provider 发送与 ACK、同笔持久化和结果；重复回放仅证明接收端幂等，不证明 Provider 自动重试。成功通知重发与自动超时取消分别记录 |
| 后续按需演示 | Apple Pay、Google Pay 和选定 APM 在商户、US / USD、设备与钱包条件具备且明确安排演示时验证，记录实际方式和网络；本次不提升对应能力状态，不作为当时约定 Card 旅程的交付阻断 |
| 后续按需诊断 | 3DS 取消 / 失败、Provider 拒付后重试、成功支付首次自动通知，以及通知乱序、缺 Payment ID、创建响应未知等真实异常样本保留未验证范围；仅在明确需求或具体缺陷涉及它们时补验，不为凑齐矩阵制造交易 |

Showcase 对 transaction F 的保守映射、缺 Payment ID 取消的受限关联、未知创建结果禁止重复 create、通知验签 / 幂等 / 终态调和仍是实现要求，继续由相关自动化验证。后续真实样本未验证不等于本次演示未完成，也不得写成已通过。`ALL` 仅表示托管页选择策略，不作为任何具体支付方式已验证的依据；能力改为 Available 仍须满足对应组合条件。

代理执行的真实记录应包含日期、canonical Production 部署 SHA、Sandbox profile、所选旅程、订单金额、实际方式、设备 / 浏览器、国家 / 币种、观察到的交互及核验来源；未取得的字段明确标为未知。用户人工验收按其明确确认的范围登记，不推定缺失订单或设备信息。受限诊断使用同笔白名单标识关联通知、query 与持久化，公开 Issue / PR 只保留脱敏尾号及证据摘要；不记录完整交易标识、卡数据、导航 URL、query capability 或原始 payload。模拟、自动化、人工确认、真实 Provider 发送与手动回放不得互相替代。

### Checkout 保存卡与复购（Issue #9）

Checkout 与 Web JS SDK 的普通一次性支付共用第 6 节定义的服务端匿名 customer 与签名 recovery 链。Checkout create 必须读取当前 Order 的私有 customer；旧记录缺失时使用现有 `ensurePaymentCustomer` 原子补齐，并在认领 Provider create 前验证 environment、merchantNo、appId 与客户标识。请求保持 `ALL + DIRECT + SALE`，在顶层传入稳定的 `merchantCustId`；不接受客户端 customer 或 token 输入，不新增 cookie、数据库字段或支付状态。

按 [Checkout 保存卡](https://developers.onerway.com/payments/online-payments/checkout#saved-card-option)与[保存支付方式](https://developers.onerway.com/payments/online-payments/scenarios/saved-payment-methods)指南，保存选项默认不勾选，由客户在 Provider 托管页主动选择并完成支付；后续同 scope 的新 Order 继续传入同一客户标识，保存与选卡均由 Provider 承接。Showcase 不自建卡列表、解绑、token 支付或“绑卡成功”状态。现有显式新 Sandbox Order 入口用于复购，恢复仍只收敛原 Attempt；支付成功不能单独证明卡已保存。

SDK → Checkout 与 Checkout → SDK 切换沿用同 scope 身份，但实际跨入口卡可见性必须由新鲜 Provider 证据确认；若 Provider 隔离可见性，只记录限制，不复制或绕过 token。清除 recovery 后的新访问成为新匿名客户，不再关联旧客户卡，不表示 Provider 卡已删除；既有 30 天保留边界不变。

2026-09-17 核对的官方保存支付方式指南描述独立保存结果通知；2026-08-13 SDK 历史验收则记录未收到第二笔绑卡通知。两者不能直接推定为当前 Checkout 行为，本次真实验收须单列是否观察到该通知及其关联证据。当前托管复购不依赖商户 token 消费，不新增 List saved tokens 或绑卡 Webhook 消费；若出现需要改变处理方式的契约冲突，先保留脱敏证据并停止依赖该事实的实现。

执行与证据登记在 [Issue #9](https://github.com/abel-wang777-showcase/onerway-payment-showcase/issues/9)：自动化验证客户传递、scope 隔离、并发补齐、公开响应不泄露与 SDK 回归；真实 Sandbox 按“不保存对照 → 主动保存支付 → 同客户新订单回显并选卡复购 → 双向跨入口对照”验证，并分别记录托管交互、每笔支付服务端核验和通知观察。2026-09-17 Issue #9 已关闭：真实 Sandbox 已取得主动保存、同客户复购、SDK → Checkout 与 Checkout → SDK 双向卡回显/复购及客户隔离证据；PR #13 合并为 `74d6617`，合并后 CI、Payment DB 与 canonical 部署通过。独立保存通知及 Provider 发送/ACK 逐单观察仍未验证，不作为初始订阅前置。上述历史保存卡证据不替代 Checkout 订阅验收；Checkout 能力继续为 Conditional。无关渠道或设备异常不扩展为交付阻断。

### Checkout Card 初始订阅（Issue #10）

Checkout 复用第 6.1 节固定 `halden-daily-essentials-v1` 计划、服务端匿名客户、`SubscriptionContract` 与 `Order → PaymentAttempt → PaymentEvent`。Demo Hub 在 Checkout 下提供初始订阅入口，保持 **Conditional**；`ALL` 仅表示托管页选择方式，本期演示要求选择 **Card** 并完成首次 3DS。其他 LPM 可能采用独立授权通知或省略 `scenarios` 的首次扣款通知，不在本次接入承诺内；保存卡成功及独立保存通知均不是订阅前置。续费、后续扣款、调度、取消、升降级和计划管理不在本期。

- 按当前[创建收银台支付](https://developers.onerway.com/payments/api-reference/endpoints/create-checkout-payment)与[订阅指南](https://developers.onerway.com/payments/online-payments/scenarios/subscriptions)，Checkout 调用 `POST /txn/payment`，固定 `ALL + SUBSCRIBE + SALE + WEB`，JSON string `subscription` 使用 `requestType=0`、`selfExecute=2`、`mode=2` 和既有固定计划。内外 `merchantCustId` 同传且一致，覆盖指南与字段表对必填位置的差异；不接收客户端客户、金额、周期或 Provider routing，不传 SDK browser/device/IP、`lpmsInfo`、`risk3dsStrategy` 或 Provider-managed cycle/trial/bindCard 字段。
- Checkout create 采用独立解析器：要求同笔非空 `paymentId` / `transactionId`、`status=U`、`paymentStatus=U` 与受限 `redirectUrl`。尚未建立的 `contractId` / `tokenId` 可为缺省、null 或空串；不能套用 SDK 受控响应的精确 null 假设。同步响应不建立 active，不消费生命周期状态；已收到的无效响应持久化 stop-gate，结果未知只查原 creation，不重发 create。
- 同 scope + plan 的 duplicate guard 跨 SDK/Checkout 生效，不把 integration 加入防重键。intent 回传持久化 integration；仅已原子建立但尚未认领、无 Provider evidence 的 placeholder 可继续首次 create，已认领或结果未知只能恢复。切换入口不得改变已存在 Attempt 的 adapter；显式新测试客户继续受第 6.1 节限制。
- 回跳使用既有 `/halden/subscription/return` 与 HttpOnly recovery cookie；进入 SSR 前清除附加 query。刷新、关闭或返回仅恢复原 Order/Attempt/Contract，导航 URL 只使用一次且不持久化。Hosted 页和结果页均分开展示 Payment 与 Subscription；订阅不提供普通支付的独立订单/Retry 捷径。
- Checkout 按[交易查询](https://developers.onerway.com/payments/api-reference/endpoints/query-transactions)核对原 `merchantTxnId`、商户、金额币种与已有 Provider IDs。该查询没有合约生命周期字段；发现非空 `contractId` 后必须另行执行严格关联的[订阅详情查询](https://developers.onerway.com/payments/api-reference/endpoints/query-subscription-details)，才可收敛合约状态。支付成功、回跳及合同标识本身均不能推断 active；token 冲突与未知状态保持拒绝。
- 合约持久化 `initialIntegration`，旧记录回填 `web-js-sdk`，确保 Payment 30 天清理后仍可使用正确的查询协议。原有 token 终态擦除、首次 `terminalAt` 和合约独立保留规则不变。
- Card 初始通知复用 `SUBSCRIPTION_INITIAL`、header 验签、事务写入、幂等 ACK 与续费隔离。当前公开[订阅通知](https://developers.onerway.com/payments/api-reference/webhooks/subscription-payment)允许 `paymentId` / `paymentStatus` 为空，本项目仅为已验签、精确关联到 Checkout initial Attempt 的 `status=N` 且无 Payment 级状态通知提供受限无 ID 取消处理；其他缺失关联保持 fail closed。2026-09-18 已观察到一笔初始取消通知持久化为 `status=N`、Payment cancelled 与 Subscription ended；Payment 级状态缺失，未保存原始 payload，因此不据此推断其他原始字段形态。该样本不代表每次取消均有通知，也不替代首次成功订阅验收。

2026-09-18 用户确认：Checkout Card 自主管理初始订阅允许使用 `selfExecute=2`、`mode=2`、`frequencyType=D`、`frequencyPoint=1`、`expireDate=2099-12-31`，本项目据此沿用既有固定计划；此前公开文档中“最多 99 周期”与远期示例的冲突不再阻断本组合的实施。该确认不推广为其他支付方式或 Onerway 托管订阅的到期日、周期规则，也不构成本次真实 Checkout 订阅验收证据，能力继续保持 Conditional。真实初始支付仍会建立可用于后续扣款的授权，执行前须单独明确授权范围。`selfExecute=2` 的后续扣款由商户管理，本项目不发起续费 API 或新增调度。

[Issue #10](https://github.com/abel-wang777-showcase/onerway-payment-showcase/issues/10) 分开记录本次自动化、历史 SDK/保存卡证据和本次真实 Checkout 订阅证据。本次实现不能替代首次托管 Card/3DS、回跳、通知与查询真实验收；未授权时不部署、不执行真实订阅交易、不合并，也不将能力提升为 Available。

### Checkout 预授权、请款与撤销（Issue #11）

本期范围是 Card 的标准全额 `AUTH → CAPTURE` 与 `AUTH → VOID`，继续使用 `Order → PaymentAttempt → PaymentEvent`、服务端 customer scope 和现有恢复权限。部分或多次请款、增量授权、退款、APM 预授权、分期与 Production 交易不在范围内。实现接入默认 USD 5.00、允许按第 4 节编辑一次性金额的旅程，以及交易路由、资金操作、通知持久化及原交易查询补偿，能力仍保持 Conditional。真实 Sandbox 与自动化验收分别记录在 Issue #11，不因本地或 mock 闭环通过而宣称真实旅程已验收。

[Checkout 指南](https://developers.onerway.com/payments/online-payments/checkout#pre-authorization)与[创建接口](https://developers.onerway.com/payments/api-reference/endpoints/create-checkout-payment)规定通过 `POST /txn/payment`、`subProductType=DIRECT`、`txnType=AUTH` 创建授权。用户已于 2026-09-18 确认当前 Sandbox 商户支持 `CARD + DIRECT + AUTH`，本期固定使用该组合；商户支持已确认不代表实现或真实验收已经完成。3DS、卡信息与设备信息由托管页承接。

资金状态与交易结果分开表达。已验签的[预授权通知](https://developers.onerway.com/payments/api-reference/webhooks/authorization-capture)当前可确认的组合为：

| txnType | status / paymentStatus | 资金语义 | PaymentAttempt 投影 |
| --- | --- | --- | --- |
| AUTH | S / A | 已授权冻结，尚未扣款 | processing |
| AUTH | F / O | 本次授权尝试失败，Payment 仍开放 | processing |
| CAPTURE | S / S | 已全额扣款 | succeeded |
| VOID | S / N | 授权已撤销并释放 | cancelled；不开放普通付款 Retry |

[预授权场景指南](https://developers.onerway.com/payments/online-payments/scenarios/pre-authorization#confirm-the-authorization)明确以 AUTH `S/A` 通知确认授权，并保存其 `transactionId / paymentId`。成功通知通过验签及关联核对，或下述查询组合确认原 AUTH 成功且当前 Payment 仍为 A 后，事务性确定成功授权 `transactionId`，后续将其作为 `originTransactionId`；不能把创建响应中尚未成功的交易 ID 提前固定为成功授权锚点。已经确认的成功授权 ID 不随迟到创建响应或失败通知改变，出现第二个冲突的成功授权 ID 时保留冲突并关闭资金操作。Provider 内部重试机制的完整说明不是这条成功通知路径的前置条件。

AUTH 成功不形成已扣款或可履约事实。独立资金投影只区分 `pending / authorized / captured / voided`；操作的 `pending / unknown / confirmed` 与资金状态分开。迟到或重复的 AUTH 事实不得回退已授权或已完成资金状态；相互矛盾的资金终态保留冲突，不能按到达顺序覆盖。CAPTURE/VOID 失败组合、AUTH 取消缺 ID 的例外和授权自然过期均不得自行推导；不使用本地时钟宣告冻结已释放。普通 Checkout 无 Payment ID 取消规则不自动适用于 AUTH。这些未定义组合保持待确认且不解除操作锁，不要求先取得所有异常样本才实施两条标准成功旅程。

[请款或撤销接口](https://developers.onerway.com/payments/api-reference/endpoints/capture-or-void-authorization)为 `POST /v1/txn/authPayment`。请求只使用服务端保存的原 AUTH `originTransactionId`，以及稳定且独立的操作 `merchantTxnId`、`txnType=CAPTURE|VOID` 和商户签名；接口无请款金额字段，仅支持全额。原授权 transactionId 永久保留，返回的新 transactionId 属于本次操作，paymentId 必须关联同一授权。`respCode=20000` 不代表资金成功；同步 `data.status` 可记录操作处理结果，但不能代替已验签通知或经确认的查询资金事实。解析器缺少必要关联时拒绝推进，即使 Provider schema 没有声明这些字段必返。

资金操作在数据库事务中锁定同一 Attempt，验证资金已授权且尚无操作，再原子保存互斥的 CAPTURE/VOID claim 后请求 Provider；纯领域 claim 判定不构成跨请求并发保护。已认领、响应未知或已确认的操作都不得重新提交，相反动作也不得并发执行。网络错误、HTTP 错误、业务拒绝或响应无法解析均不自动解除 claim；恢复只读取原操作。前端在操作 URL 中选择当前页面的本地订单，body 只提交动作；不能提供金额、客户、paymentId 或其他 Provider 标识。服务端要求签名恢复 cookie 与该本地订单一致，再校验 customer scope、Sandbox、canonical origin 和已保存的交易上下文，防止旧标签页误操作 Cookie 已切换的新订单。

通知继续验证公共 `X-Rh-Signature`，只投影白名单字段。CAPTURE 通知可能使用原 AUTH merchantTxnId，VOID 可能使用本次操作 merchantTxnId；因此关联必须结合 paymentId、已保存的授权和操作 ID、操作类型、金额币种与已认领操作。`originTransactionId / originMerchantTxnId` 不参与现有签名，不作为单独授权依据。通知早于同步响应时，仅在签名 merchantTxnId 命中已保存允许集合、同一 Payment 且同类型操作已认领后绑定新操作 transactionId；后续同步响应不能覆盖通知真值。落库与事件须在同一事务提交后再 ACK。

2026-09-21 用户确认及真实 Sandbox 样本表明，CAPTURE/VOID 通知可以不含 `txnTime`，这不是 Provider 待补字段或资金成功前置。AUTH 保持交易时间校验；CAPTURE/VOID 有非空 `txnTime` 时仍严格校验日期及时区，缺省、null 或空串时使用服务端接收时间记录通知事件的 `occurredAt`。该回退表示接收时间，不宣称为 Provider 交易发生时间，也不把 `responseTime / responseDate` 或历史 AUTH 时间当作本次交易时间。重复通知沿用首次持久化事件时间；资金状态、关联、冲突和操作资格仍由已验签业务事实决定，不按事件时间先后推导。其他通知格式的字段名不因单份样例自动加入本项目解析或签名规则。

2026-09-21 用户要求补齐主动查询补偿。同日真实 Sandbox 只读验证确认：[交易查询](https://developers.onerway.com/payments/api-reference/endpoints/query-transactions)省略 `txnTypes`、按原操作 `merchantTxnIds` 可分别返回 CAPTURE/VOID 成功记录，包含独立操作 `transactionId`、同一 `paymentId`、原 AUTH `originTransactionId`，但不含 `paymentStatus`；[Payment 查询](https://developers.onerway.com/payments/api-reference/endpoints/query-payments)按该 `paymentId` 返回当前 S/N，且 `lastTransactionId` 对应同一操作。公开交易查询枚举尚未列出两种操作，不据此要求 Provider 新增字段；本项目按上述实际返回组合核验，不把 transaction S 单独映射为资金成功。

主动补偿仅从现有恢复入口触发，沿用签名 recovery cookie、customer scope、Sandbox 与查询限流。服务端从持久化状态选择目标：已有操作 claim 时查该 CAPTURE/VOID，否则查原 AUTH；所有 ID、金额和币种均不由客户端输入。先查询唯一交易，严格核对 merchantTxnId、交易类型、CARD/DIRECT、appId、金额币种、已有 Payment/交易 ID，以及操作的原 AUTH ID；交易 S 后再查唯一 Payment，核对同一 Payment、merchantTxnId、appId、金额币种及 `lastTransactionId`。只有 AUTH S + 当前 A、CAPTURE S + 当前 S、VOID S + 当前 N 才形成 `source=query` 的资金事实。AUTH 查询不能使用创建响应的交易 ID 冒充成功授权锚点；没有 Payment ID 的创建响应未知场景可按原 merchantTxnId 找回关联，但不得重建订单或重发 create。

查询在数据库事务外执行，落库时锁定并重新校验原目标与最新授权/操作关联，避免覆盖查询期间到达的通知。query 事件按 Attempt、Payment、交易及实际状态组合幂等，时间表示服务端查询观察时间；重复查询不刷新原事件。query 与 Webhook 可各自保留来源，迟到 AUTH 或冲突事实不能改写当前终态的来源、原 AUTH 锚点或再次开放资金操作；相互矛盾的资金终态继续保留冲突，不自动撤销已确认状态。对 pending/authorized 且尚无操作的授权，若严格关联的当前 Payment 已不是该 AUTH 的 A 状态或最新交易已变化，则传递查询实际核验的 AUTH/Payment 标识，事务性重验并保留最后资金事实、标记 conflict、关闭操作资格；这条否定观察先于 AUTH 通知到达时也必须保存，迟到通知不得重新开放操作。不把这种明确否定授权的观察当作网络失败忽略。空结果、一般查询拒绝、网络故障、未知或未完成操作状态均不证明资金操作未执行，只恢复最新持久化状态并保留 claim。后续匹配通知或成功查询都可完成原操作。

AUTH 回跳仅记录导航事实，再通过恢复入口查询；结果页刷新及重新打开复用同一入口，不签发普通 SALE query capability，不调用 SALE 查询映射，也不新增后台轮询。无冲突的 captured/voided 已有可信终态时直接恢复，避免确认性重复查询。已授权状态查询仍必须核对当前 Payment；原 AUTH 历史成功不能证明资金现在仍冻结。查询恢复不会创建新的 AUTH、CAPTURE、VOID 或普通付款 Retry。真实查询、通知恢复及浏览器验收的具体范围记录在 [Issue #11](https://github.com/abel-wang777-showcase/onerway-payment-showcase/issues/11)。

## 6. 回跳、通知和最终状态

支付结果采用多来源收敛，不采用“最后到达者覆盖”：

1. SDK 客户端 `payment_result` 或 `confirmPayment()` resolve 只更新交互状态，不能单独确认最终成功；`rawResult` 不保存、不记录日志、不进入 Technical details。
2. `returnUrl` 用于恢复 Order / PaymentAttempt，并触发服务端 query；它不是支付成功证据。Issue #11 的 AUTH 通过上节专用恢复查询核验，回跳本身不确认授权或资金结果。
3. Webhook 先可靠持久化、幂等处理，再按 Onerway 契约返回 ACK。
4. query 与 Webhook 都产生 PaymentEvent，并通过明确的优先级和状态迁移规则收敛 PaymentAttempt。
5. `processing` 必须可刷新恢复和后续收敛；重复回调不得重复创建业务结果或触发重复扣款。
6. 浏览器一旦调用 `confirmPayment()`，除当前仍存活的 v4 Checkout 明确返回顶层 `paymentStatus=O`，或没有顶层支付状态的 `reason.type=canceled / validation_error` 外，不得把同一 PaymentAttempt 恢复为可再次提交；`R`、`P`、`A`、离页或客户端结果未知时只允许查询该 attempt，直到服务端真值收敛。刷新会丢失该临时 SDK 交互许可，因此 provider-created Attempt 仍恢复为 query-only。

### 6.1 Card 初始订阅与独立合约状态

初始订阅继续使用同一个 `Order → PaymentAttempt → PaymentEvent` 支付模型承载首次扣款，并新增相邻的服务端 `SubscriptionContract` 承载合约生命周期。二者通过不可变的 initial Order / Attempt 审计快照关联，但 SubscriptionContract 不受 Payment 30 天级联清理控制；Payment succeeded、SDK callback、configured `returnUrl`、Provider result page 或同步 `respCode=20000` 都不能单独证明合约 active。

首个计划由服务端固定为：内部 `planId=halden-daily-essentials-v1`、version `1`、Provider `productName=Halden Daily Essentials`、首次及每周期 USD 5.00、`frequencyType=D`、`frequencyPoint=1`、`expireDate=2099-12-31`。未来计划使用独立、稳定且版本化的 `planId`；`productName`、金额和周期只是该版本的不可变 Provider projection，不能作为本地主键。客户端只能提交 allowlist 中的 `planId`，不能覆盖金额、币种、customer、subscription terms 或 Provider routing 字段。

Sandbox create 固定使用 `paymentMode=WEB`、`productType=ALL`、`subProductType=SUBSCRIBE`、`txnType=SALE`、`subscription.requestType=0`、`subscription.selfExecute=2`、`subscription.mode=2`，并让 top-level 与 subscription 内的 `merchantCustId` 精确相同。当前官方 SDK 字段表仍把 SDK scope 写成 `productType=CARD`，但 controlled Sandbox 已确认 `ALL + SUBSCRIBE`；Showcase 不实现 `CARD` fallback、双请求或自动兼容。`selfExecute=2` 不发送 Onerway-managed 专用的 cycle、trial、notification 或 `bindCard` 字段。

Web JS SDK 同步 create 的受控响应为 `status=U + paymentStatus=U + contractId=null + tokenId=null`，且不返回 `dataStatus` / `subscriptionStatus`。服务端在 Provider create 前原子建立 contract placeholder，并以本地、已确认的 `dataStatus=0 + subscriptionStatus=paymentdue` 投影为 `pending`；SDK 只用 response 的同笔 `paymentId` 初始化。Card 初始订阅固定进入 3DS，不提供绕过 3DS 的成功路径。

已收到但不符合上述精确契约的 create response 是不可恢复的 runtime drift：服务端必须为该 Attempt 持久化 stop-gate，通用 merchant transaction recovery 不得绕过 parser 后继续打开 SDK。只有网络结果未知、尚未确认收到何种 Provider response 时，才允许用既有 `merchantTxnId` 查找同一 creation。

同一 `merchantNo + appId + environment + merchantCustId` customer scope 与相同 `planId` 下，任何未进入终态的 SubscriptionContract 都禁止再次创建同一 product。该规则由数据库唯一约束与事务串行化执行；Provider Create 已实证会接受重复 customer + product，因此 Provider duplicate error 不能替代本地 gate，普通订阅入口也不能通过随机 productName、随机 plan、新 customer 或自动取消绕过。已恢复的终态合约不再占用该入口：Demo Hub 显示正常初始订阅按钮，沿用原客户创建新的 Order/Attempt；终态不提供仅限非终态的“新的 Sandbox 测试客户”按钮。为保持公开 Showcase 可重复演示，Sandbox profile 可在当前签名 recovery 已恢复相同 plan 的非终态合约、且该合约已有 `paymentId` 或 `contractId` Provider evidence 后，由用户显式选择“新的 Sandbox 测试客户”；服务端据此生成全新的 `merchantCustId` 与独立 Order，替换当前浏览器 recovery 绑定，但不取消、覆盖或修改旧客户的 Order、Attempt 或 SubscriptionContract。该入口不接受客户端 customer id、不自动触发、不属于同一 customer 的 Retry，并且不在 Production profile 开放；每个新测试客户仍独立受相同 duplicate guard 约束。尚未取得任何 Provider identifier 的本地 placeholder 不开放该入口，避免 intent 响应未知时重复生成测试身份。

本项目 Card 初始 SUBSCRIBE 路径接收一条 `scenarios=SUBSCRIPTION_INITIAL` 的 Subscription payment Webhook，不等待 ordinary Payment Webhook。该通知在同一事务内写入 PaymentEvent、收敛 PaymentAttempt、发现并保存非空 `contractId` / opaque `tokenId`、更新 SubscriptionContract；全部关联和写入成功后才返回 HTTP 200、`text/plain`、原 `transactionId`。`SUBSCRIPTION_RENEWAL` 不得误写 initial Attempt。普通通知的 `scenarios` 缺省或为 `null` 时进入 ordinary Payment 校验；不能仅因存在空字段而误入订阅路径。其他非空值以及空字符串继续交给订阅校验并拒绝未知场景，不兜底为普通支付。Webhook 复用 ordinary Payment 的唯一显式签名 exclusion contract；不得增加“只排除 sign”的第二套验签或 fallback。

SubscriptionContract 自持久化初始 `merchantTxnId`、create 后的 `paymentId` 与首次 Subscription Webhook `transactionId` 幂等键；这些字段只用于服务端关联，不进入公开 DTO。Payment 记录 30 天后删除，迟到或重复 initial Webhook 仍能直接关联长期合约。已成功处理的相同 Webhook 重试必须先用本地幂等事实 ACK，不得因 Provider 当前 Query 状态变化或暂时不可用而拒绝重复通知。

已知 `contractId` 后，服务端才可调用 Query subscription details，并必须关联 merchant、customer、plan、amount、currency 和 token；wire `merchantCustomerId` 对应当前 server-owned customer，`products` 先从 JSON string 安全解析再匹配。未知 `contractId` 时不扫描 customer、不猜测合同，也不伪造 active。非空 `tokenId` 不一致、未知状态或关联歧义均 fail closed。

结果页始终显示 Payment 与 Subscription 两条状态轴。至少区分 `Payment pending`、`Payment succeeded + Subscription pending`、`Subscription active`、`Subscription needs attention` 和终态；Payment success 不会提前激活 Subscription。`tokenId` 永远不进入客户端 DTO、URL、日志、Issue、截图或 Technical details；`contractId` 也不进入公开页面或 URL。

configured `returnUrl` 始终发送，Provider 自动导航到 canonical merchant return/result 是首选 UX，但只用于恢复。自动回跳成功时，页面通过 HttpOnly recovery cookie 恢复同一 Order / Attempt 并按持久化接入方式无条件 fresh query：SDK 查询同一 `paymentId`，Checkout 查询同一 `merchantTxnId`；自动回跳缺席、浏览器停在 Provider result page 时，Webhook 仍可在服务端收敛，用户手动返回、刷新或重新打开 Showcase 后以同一 cookie 恢复并执行相同 Query。降级路径不得创建新 Order / Attempt、不得再次 Provider Create 或 `confirmPayment()`，不得把 provider identifier 或 recovery capability 放进 URL；cookie 已失效时 fail closed。

SubscriptionContract 自有 customer scope、plan projection、初始审计标识、标准状态、白名单 Provider 状态、可空唯一 `contractId`、server-only `tokenId` 与生命周期时间戳。`initialAttemptId` 唯一；Payment Order 30 天删除后，非终态合约仍可独立执行 duplicate guard、Webhook 关联和 known-contract query。合约明确进入 `dataStatus=3`、`canceled` 或 `ended` 时立即擦除 token，只保留最小 contract/customer/plan tombstone 与首次 `terminalAt`，30 天后删除；重复终态事实不得刷新 `terminalAt`。Payment 最终失败/取消且 `contractId` 仍为空时，placeholder 同样进入 30 天清理；已有 contract 且仍为 `0 + paymentdue` 时保持并等待 query，`dataStatus=2` 在 Provider 明确不可恢复前保持 needs-attention，不自动删除。

Card merchant confirm 使用独立的持久化 submission latch：浏览器在调用 `confirmPayment()` 前，必须以当前 HttpOnly recovery cookie 加精确匹配的 `orderId + attemptId + paymentId` 请求服务端原子写入 `PaymentAttempt.submissionStartedAt`。该时间只证明服务端已经签发一次 confirm 前置许可，不证明浏览器实际调用、confirm 返回或支付成功。首次 claim 返回 `claimed=true` 后客户端才允许调用 confirm；重复 claim 或响应未知不得再次 confirm，只能恢复并查询原 Attempt。顶层 `O` 或没有顶层支付状态的 `reason.type=canceled / validation_error` 仍可在同一未刷新的 Checkout 中沿用已签发的临时许可再次 confirm，但不会清除持久化 latch；刷新后仍一律 query-only。历史 provider-created Attempt 无法证明从未提交，迁移时保守回填该 latch，不能因部署升级重新开放提交。

新 PaymentAttempt Retry 与“重载原 Payment”或“启动独立 Sandbox Order”是三种不同动作：SDK 脚本 / Element 在 pre-confirm 阶段加载失败时先重载同一个 `paymentId`，不创建新 Attempt；create、confirm 或网络结果未知以及 `created / requires_action / processing` 只恢复和 query 原 Attempt；独立 clean-run 继续创建新 Order。只有 query / Webhook 权威建立的 `cancelled`，以及未来具有同等权威来源的 `failed`，才允许服务端在同一 Order 下创建带 `retryOf` 的新 Attempt。当前 transaction `F`（包括 Checkout 查询返回的 `F`）不能单独映射 Payment-level `failed`，在正式来源确认前真实 Sandbox `failed` 路径保持 stop gate。

Retry 由服务端在单一数据库事务中锁定 parent、重新计算资格并 get-or-create 唯一直接 child；数据库以非空 `retry_of` 唯一索引防止多击、请求重放或跨实例并发产生兄弟 Attempt。child 继承 parent 的 integration / method，复用原 Order 及其金额，使用新的 `merchantTxnId`，不覆盖旧 Attempt/Event。切换 recovery cookie 前 child 记录必须已完成数据库提交；响应丢失后，无论浏览器仍持有旧 parent cookie，还是已经收到响应头并切换为该 child cookie，重放同一个 parent retry 请求都只回读同一 child，其他 cookie lineage 一律拒绝。child 调用 Provider create 前必须再次锁定并核验 parent 资格，防止 parent 在建 child 后被 fresh query 调和为 `succeeded` 仍产生新扣款；一旦 child 已有 create claim 或 Provider 标识，后续只恢复该 child，不能重放 create。若 pre-create child 因 parent 真值变化而不再具有 Retry 资格，claim 事务必须先持久化本地、非投影且不可逆的拒绝事件，再永久关闭该 child；recovery 只在该拒绝事实存在时恢复并重绑 direct parent，不查询被拒 child 的 Provider creation、不删除 child 历史，也不把 child 伪装为 Provider `cancelled / failed`。

Demo Hub 初始化探测恢复会话期间，普通支付的恢复与新单入口保持禁用，并明确显示正在检查。恢复与创建独立订单使用固定、分离的动作：用户点击恢复后，即使会话缺失、失效或异步状态变化，也不得自动转为创建 Order / Attempt 或调用 Provider create；只有明确的新订单入口可以创建独立 Sandbox 订单。

客户端异常动作使用结构化 operation + action 契约，不从任意错误 message 或 HTTP 状态单独猜测：pre-confirm SDK / Element load 失败只重载同一个 `paymentId`；明确的 SDK 本地表单校验失败保留同一存活表单供用户补填；create 结果未知只恢复已有 Attempt；query / confirm 结果未知只核验已有 Attempt；暂时性 recovery 失败只重试 restoration；只有服务端权威允许的终态才显示同 Order Retry；clean-run 始终创建独立 Order。query capability 被拒绝时最多先通过 HttpOnly recovery 刷新一次 capability，再查询同一 Attempt，不循环复用旧 token。Retry 或 child create 响应未知时优先恢复 cookie 当前绑定的 parent/child；不得因此再次 confirm 或无条件重放 Provider create。

授权 recovery 同时返回该 Order 的白名单 Attempt 历史，并显式保留 cookie 当前绑定的 active Attempt；客户端不得用数组末项猜 active。历史只展示 Attempt id、标准状态、active 标记与 `retryOf` 关系，不新增原始 Event/provider payload 暴露面。

#4 在 #5 持久化交付前只保证同一次 SPA 导航内的真实普通支付：服务端签发绑定 `attemptId + paymentId + expiresAt`、五分钟内有效的 query capability，浏览器不能用任意 Payment ID 查询同商户交易，过期或异常远期 capability 必须拒绝。该 capability 不展示、不记录、不持久化；刷新后的可靠恢复仍由 #5 交付。

#5 通过 HttpOnly、SameSite=Lax、绑定单个 `orderId + attemptId` 且最长覆盖 30 天保留期的服务端签名 cookie 恢复当前真实 Sandbox Attempt。恢复接口允许省略 URL / query `orderId`，此时只使用签名 cookie 内绑定的 `orderId + attemptId` 授权；调用方提供 `orderId` 时必须与 cookie 精确匹配。不能仅凭可枚举的 `orderId`、`attemptId`、`merchantTxnId` 或 `paymentId` 公开读取。恢复后服务端重新签发五分钟 query capability，不把长期恢复能力暴露给 JavaScript。恢复响应只根据持久化 `submissionStartedAt` 判断 merchant confirm 是否已开始，不再用 Payment status 猜测提交边界；已开始的 Attempt 恢复为 query-only，未开始的 Card Attempt 才能重新挂载同一个 Payment Element。

同一 recovery 链还用于延续匿名 customer，但 customer identity 不写入 cookie：每个 Order 在服务端私有保存 `environment + merchantNo + appId + merchantCustId`，新 Order 只在 scope 完全一致时继承上一 Order 的 customer；旧数据缺少 customer 时在首次 Provider create 前以数据库行锁原子补齐。浏览器必须用同源 Web Lock 只串行化 `/api/payment/intent` 请求，使并发首开标签页在前一个响应写入 recovery cookie 后再创建或恢复 Order；锁不覆盖 Provider create、SDK 生命周期或后续查询，不支持 Web Locks 时必须在发出 intent 前 fail closed，不能退回到 IP / User-Agent 指纹或客户端 customer id。`merchantCustId` 少于 64 个字符，只使用大小写字母、数字、下划线与 dash，并且不进入共享 `Order` / `PaymentAttempt`、公开 API 响应、URL、浏览器存储、Technical details 或日志。清除 recovery cookie 或连续 30 天没有新 Order 后，Showcase 会把后续访问视为新的匿名 customer；这只表示本地不再关联，不能表述为 Onerway 侧 saved card 已删除。

#6 的 create 使用 `ONERWAY_SHOWCASE_ORIGIN` 生成 canonical `GET /halden/return/:orderId` 回跳地址。Onerway 通过顶层 browser navigation 自动回跳，并可能在 `returnUrl` 后附加 query parameters；Showcase 不解释、不转发、不保存或展示这些参数；服务端在渲染回跳页面前以 303 跳转到无 query 的同一路径，并设置 no-store 与 no-referrer，避免参数进入 Nuxt hydration 数据。客户端恢复时仍清除 SPA 导航附加的 query。v4 SDK 在 3DS 顶层跳转分支可能不产生客户端 callback，因此 callback 缺席不能触发新 Attempt。回跳页只用 URL order 与 SameSite=Lax 签名 cookie 完成绑定，幂等写入一次 `source=return`、`status=processing`、以 Attempt id 为 source key 的 PaymentEvent；该事件不投影更新 PaymentAttempt。服务端随后无条件对同一 `paymentId` 执行 fresh query 并持久化 query event，即使 Webhook 已先形成终态也由 query 调和冲突；非终态时浏览器继续轮询同一 Payment。Webhook 先到、query 先到、return 先到或重复 return 都不得倒退终态或产生第二次提交。

Provider create 采用两步 BFF：第一步先持久化 Order 与 Attempt，并在独立 HTTP 响应中把恢复 cookie 交付浏览器；第二步以该 cookie 认领同一 Attempt，再调用 Onerway。认领本身写入唯一 `source: server` PaymentEvent，因此取消请求、并发调用或结果未知都不能再次发起 create。Onerway 文档把 `merchantTxnId` 定义为每次交易请求唯一且用于防重复，但没有承诺重复 create 会返回原结果，因此网络或第二次本地事务失败后不得自动重放 create。恢复只使用同一 Attempt 已保存的 `merchantTxnId` 调用 `/v1/txn/list` 找回并关联既有 `paymentId + transactionId`；该 transaction 查询的 `S / F / N` 也只形成非终态事实，最终状态仍必须再经 Payment query。2026-08-04 已用当前新鲜 Sandbox 交易不落盘验证 merchantTxnId 查询返回唯一精确匹配。未查到既有 Provider 记录时保持恢复 pending，不能创建平行 Attempt。

公开 create / query BFF 对带浏览器来源信息的请求执行同源 gate，并共享按 runtime 可信客户端地址计数的应用层速率与并发安全阀；不信任请求自带的通用 `X-Forwarded-For`。Vercel runtime 只读取平台覆盖的 `x-vercel-forwarded-for`，其他 runtime 使用 H3 提供的可信地址；Nuxt dev adapter 未提供 runtime 地址时只使用固定 loopback bucket，非开发 runtime 缺失可信地址则拒绝请求。该安全阀是单进程、单实例边界，不提供 Serverless 跨实例精确配额，也不替代部署平台的 edge / WAF 限流。

Web JS SDK 最终核验调用 `POST /v1/txn/queryPayments`，以 v4 SDK 使用的 `paymentId` 查询 Payment 级 `paymentStatus`，并只白名单化 `paymentId`、`lastTransactionId` 与原始状态。2026-08-03 的真实 Sandbox 验证显示：同一 v4 Payment 在该接口可立即查询，而使用创建阶段 `transactionId` 调用 `/v1/txn/list` 返回空记录；因此 M0 不以旧 transaction query 作为最终真值入口。

支付方式归因是独立的服务端 enrichment：先由 `/v1/txn/queryPayments` 取得同一 Payment 的 `lastTransactionId` 并持久化状态真值，再以该 transaction id 调用 `POST /v1/txn/list`。只有 fresh Query 已给出终态，且 transaction id、payment id、`subProductType=DIRECT` 与 `txnType=SALE` 全部严格匹配唯一记录时，才可把 `walletTypeName=GooglePay / ApplePay` 分别归一化为 `actualWallet=google-pay / apple-pay`，并把受限的 `paymentMethod`（例如 `VISA`）保存为底层 `fundingNetwork`。归因必须满足 `attributionTransactionId = PaymentAttempt.transactionId`；同一 Payment 的 `lastTransactionId` 变化时先清除旧归因，再以新 transaction 原子替换，绝不把新 transaction 与旧钱包 / 网络拼接。存储层允许同一 transaction 的单项白名单事实先落库并只补缺失字段，但 Google Pay / Apple Pay 验收只有在 `actualWallet + fundingNetwork` 均存在时才视为归因完成；任一项缺失时，终态结果页会再执行一次 same-payment fresh Query。该短超时 enrichment 缺失、暂不可用或响应不匹配时不得阻断或回退已经建立的 Payment 状态；recovery 本身只恢复已经持久化的归因，不能使用 create 阶段 transaction id 自行归因。SDK callback 的 `paymentMethod` 只属于当前内存交互事实；Webhook 的 `walletTypeName` / `paymentMethod` 按当前实测验签规则被排除，二者都不得替代 transaction query 成为持久化实际方式真值。

Payment result Webhook 的字段选取与摘要算法曾于 2026-08-04 用新鲜 Sandbox 通知做不落盘差分验证。2026-09-14 按用户授权迁移公共 header 验签入口；新入口的真实通知验收仍待完成：

- 验签只使用 `X-Rh-Signature`，支持逗号分隔的多项 `v1=<小写 SHA-256>`；当前 profile secret 计算的摘要与任一有效 v1 项 timing-safe 匹配才通过。缺 header、无有效 v1 或不匹配均拒绝，即使 body `sign` 正确也不回退。Relay 必须原样透传该 header；原始 header 与 body `sign` 均不保存或展示。
- 摘要从解析后的顶层字段中剔除 `originTransactionId`、`originMerchantTxnId`、`customsDeclarationAmount`、`customsDeclarationCurrency`、`paymentMethod`、`walletTypeName`、`periodValue`、`tokenExpireTime` 和 `sign`；其余非 `null`、非空字符串字段按字段名 ASCII 升序，只拼接 value，末尾追加当前 profile 的服务端 `secret`，计算小写 SHA-256，并使用 timing-safe comparison。
- `reason`、`products`、`paymentMethodDetails` 等 JSON string 使用收到并由 JSON parser 解码后的字符串值参与验签；它们只在验签进程内短暂存在，不保存、不记录日志、不进入错误或诊断响应。
- Webhook 拒绝日志只记录固定白名单错误码，用于区分 body、signature 与 fields 三类失败；字段拒绝可额外记录代码内定义的固定 `diagnosticCode`，定位校验步骤。诊断码只留在服务端日志，不进入 HTTP 响应、PaymentEvent 或客户端；映射以 `server/utils/webhook.ts` 为准，不从请求动态生成。不得记录原始 payload、字段名、字段值、签名或任何交易标识；诊断不改变验签、字段接受规则、订阅分流或支付真值。
- 2026-09-14 发布 API Reference 已把 `paymentMethod` / `walletTypeName` 标为不参与验签，与现有受控排除矩阵一致。更换环境或 Provider 规则后仍需重新验证，不实现 body/header 双规则回退或验签降级。
- 验签、商户号、`merchantTxnId`、金额和币种以及 provider 标识关联全部通过（`paymentId` 缺失仅允许本节定义的 Checkout 取消例外），且 PaymentEvent 与 PaymentAttempt 在同一数据库事务中可靠提交后，才返回 HTTP 200、`text/plain`，响应体严格为收到的 `transactionId`。
- Onerway 在首次通知失败后以 30 分钟间隔重试两次，最多在 T+0、T+30、T+60 投递三次；`transactionId` 是 Webhook PaymentEvent 的 provider 幂等键。

SDK / Checkout Webhook 同时保留 transaction 级 `status` 和 Payment 级 `paymentStatus` 白名单值。`paymentStatus=S / O / N` 分别投影 `succeeded / processing / cancelled`；缺少 Payment 级状态时，transaction `N` 可投影 `cancelled`，`S / F` 只保留为 `processing` 并等待 query。`status=F + paymentStatus=O` 表示单笔交易失败但 Payment 仍开放，不得投影为 Attempt 失败。按 2026-09-14 用户再次确认的项目规则，query 是终态冲突的调和权威：新 query 可替换冲突的 Webhook 终态；Webhook 不得覆盖已有 query 终态；任何中间态都不得回退终态，冲突事实仍作为 PaymentEvent 保留。此规则有意区别于当前官方通用指南的 Webhook 优先建议，适用于 SDK、Checkout 与 Direct 的终态冲突调和（各自状态映射保持独立），不能在实现中隐式改成最后写入覆盖。

正式持久层采用 Vercel Marketplace 管理的 Neon Postgres：

- 只保存 `Order → PaymentAttempt → PaymentEvent` 的最小白名单字段，以及 Order 私有的匿名 customer scope；`PaymentAttempt.id` 是 Showcase 内部关联标识，不发送给 Onerway。Attempt 的 `method` 是预期方式，nullable `actualWallet` / `fundingNetwork` / `attributionTransactionId` 只来自严格关联的 transaction query，且三者满足“全部为空或归因 transaction 非空并至少有一项方式元数据”的约束；`submissionStartedAt` 只记录服务端签发 merchant confirm 前置许可的时间，不保存 SDK 请求或结果。
- Order 保存商品摘要、整数 minor amount、currency 和履约状态；Attempt 分开保存 `merchantTxnId`、Payment `paymentId` 与 transaction `transactionId`；Event 保存 source/source key、双轴原始状态、标准状态、冲突标记和时间。
- 不存在原始 request/response/Webhook payload、`sign`、`secret`、PAN、CVV、`reason`、`paymentMethodDetails`、`tokenId` 或卡详情列；私有 `merchantCustId` 用于 Checkout / Web JS SDK create 和同 scope 后续支付。
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
- 保存和展示请求、响应、Webhook、Technical details 前统一脱敏；仅第 5 节明确授权的 Sandbox 当前访问 token 调试区允许用户主动展示/复制完整标准 Apple token 或 Google gateway token，仍禁止持久化。
- Onerway `production` profile 默认锁定。基础域名已确认不代表允许交易；启用实际交易仍需单独确认凭据、回调验签、审计、错误处理和显式开关。
- 所有 Vercel scope 都不得配置或开放 Onerway Production 实际交易；Vercel Production target 也必须继续服从该锁定。
- Onerway `production` profile 锁定时，公开 Demo Hub 的付款入口保持禁用，并明确说明当前预览尚未启用 Sandbox 支付；不自动降级为模拟付款。自动化测试仍可显式初始化纯本地模拟 fixture，保留 Simulation 标识且不产生上游请求或交易。

Sandbox 基础域名为 `https://sandbox-acq.onerway.com`，create 与 query 请求来源必须已加入 Sandbox IP allowlist。Production 基础域名为 `https://acq.onerway.com`；启用条件尚未确认。

## 8. UI、响应式和可访问性

冻结参考为 [`docs/design/sdk-m0.html`](design/sdk-m0.html)，它定义 M0 的信息架构、主要状态和视觉方向，不定义支付真值或生产代码结构。

实现要求：

- 使用 Nuxt UI 原语和 registry 提供的语义 token，不复制原型中的硬编码样式。
- 初始只安装 `geist-foundation`；复制动作复用同一已锁定 revision 的 registry `foundation-copy-button` / `foundation-use-copy`，不复制旧 `assets/starter`、旧 export、playground 或 API Docs kit。
- 验收 1440、834、390、320 宽度；独立静态画板不等于真实响应式已通过。
- Demo Hub 的接入页签使用 `tablist` / `tab` / `tabpanel` 语义，配置下拉使用 `combobox` / `listbox` / `option` 语义，并支持键盘选择。
- Demo Hub 优先展示当前可运行选择与明确的启动入口；未开放选项保留在展开区。移动端按配置、启动摘要的顺序展示，补充详情可展开，并提供长页面返回启动区的入口；链接只记录 journey、method、mode、plan 等公开选择。跨接入方式切换时保留仍受支持的钱包，订阅模式不展示不能控制初次支付的普通支付方式选择。
- 商户支付页先展示订单摘要、付款表单和当前可执行动作，再展示排查引用。无法执行且未加载的付款按钮不占据移动端固定操作栏。结果页先展示结果与下一步，再展示尝试历史和技术详情；刷新失败保留此前确认状态并单独报告本次更新失败。
- 页面提供 `main`、`nav`、`aria-current`、`aria-controls`、可见键盘焦点和状态播报。
- `Change`、`Back to cart` 等控件在演示中必须有真实行为，否则删除。
- 不承诺未实现的邮件发送；卡数据文案只陈述经 SDK / 合规确认的边界。
- SDK 托管输入区的键盘、验证、错误和 iframe 可访问性必须基于真实 SDK 验证。
- 仅供自动化测试保留的模拟 Payment Element 是明确标记的非交互 simulation 区域，不渲染 PAN / CVV、伪钱包按钮或伪 SDK 输入；公开 Demo Hub 不提供该入口。
- 自动化模拟 fixture 结果的 Technical details 只展示白名单化的 mode、journey、order / attempt 标识、minor amount / currency、标准状态、3DS 模拟标记和 attempt 数量；不得伪造 Onerway transaction id、响应码或 provider payload。
- 真实 Sandbox checkout 在终态形成前必须直接展示可跨系统排查的白名单引用：`merchantTxnId`、Onerway `transactionId`、`paymentId`、Showcase `orderId` 与 `attemptId`；缺失的 provider 标识不伪造。Technical details 可展示 mode、integration、当前 SDK release 标签、受控 journey / 3DS journey 标记、是否观察到 return、上述 order / attempt / merchant transaction / transaction / payment 标识、minor amount / currency、标准状态、query 原始状态、核验 source、预期方式、transaction query 核验的实际钱包和底层网络；SDK callback method 必须另标为非持久的交互事实。当前交互提示还可展示上一段定义的受约束 reason type、reason code 与清洗后的 reason message。不得展示 provider 附加的 return query、query capability、完整 `reason`、未清洗的 `reason.message`、`rawResult` 或其他 provider payload。
- 自动化模拟 fixture 不得请求 Onerway API、SDK CDN 或银行页面，也不得把结果写成真实 Sandbox 付款完成；公开 Sandbox 旅程必须使用真实 adapter，不能由模拟替代。
- 共用启动入口使用中性的订单准备与恢复文案；Direct API 不称为 Hosted Checkout 创建。已有订单恢复失败时保留恢复错误及对应操作，不在同次启动中重复恢复或覆盖为创建失败；可展示 HTTP 状态码，不透出原始响应或异常内容。
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
- 本期 Direct API 仅处理 Apple Pay 与 Google Pay 的钱包 token，不采集 PAN / CVV；merchant session 仅瞬时转交，token 可依第 5 节授权在本次 Sandbox 页面内存调试，不记录或持久化。
- Delete card token 接口的 `id` 是 binding record id，不是 `tokenId`。
- Checkout、Web JS SDK、Direct API 共用统一支付模型。
- 客户可以从 Demo Hub 自助选择已开放场景，不依赖内部 Console。
- 项目由单人维护，以固定场景和能力模型控制范围，不接受一次性演示分支。
- 公开 Demo Hub 只提供真实 Sandbox 旅程；确定性模拟仅保留为自动化测试 fixture，与真实支付 adapter 共用领域模型，但 simulation 事件显式使用独立 source，浏览器模拟会话恢复不是支付真值或正式持久层。
- Web JS SDK v4 当前使用 `paymentId` 初始化且不需要 `redirectUrl`；客户端结果始终经 `/v1/txn/queryPayments` 按 `paymentId` 服务端核验后才形成最终事件。
- 当前 Web SDK 使用 `productType=ALL + subProductType=DIRECT + merchantCustId` 提供用户主动选择的保存卡能力；不使用旧 SDK 保存卡逻辑的 `subProductType=TOKEN`，且不回退到 `productType=CARD`；不新增绑卡 journey、卡列表或 CardBinding 状态。
- Web JS SDK 内的 Google Pay / Apple Pay 复用 `standard-success` 与聚合 SDK Element；Showcase 不新增钱包 create 分支、钱包专属 fixture、自绘按钮、Apple merchant-validation / certificate 处理或 token 处理。`PaymentAttempt.method` 是预期方式，实际钱包 / 底层网络只由 `queryPayments.lastTransactionId → /v1/txn/list` 的严格服务端关联记录补齐；钱包归因需要钱包类型与底层网络两项事实齐全。
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
| Checkout 新 header 验签与真实支付端到端验收 | 标为 Available 前 |
| 其余 Direct API 方式的字段契约 | 对应里程碑排期前 |
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
10. [Canonical #1](https://github.com/abel-wang777-showcase/onerway-payment-showcase/issues/1)（迁移自 Legacy #21）：验收 Web JS SDK v4 Apple Pay 真实设备、同 Checkout 取消恢复与支付方式归因。

可靠的回跳恢复依赖持久化，因此 #5 是 #6 的前置条件；两者均已完成，#7 在该基线上补齐持久化提交边界、安全 Retry 和异常旅程。每一步由 GitHub Issue 跟踪；Issue 关闭时，新增的长期决定必须同步回写本契约。

## 12. 三端 Demo v1 目标契约（B0）

以下为三端 v1 的目标业务语义与首批接口结构：`/api/demo/v1`，替代未交付 mobile v0 的设计；首批实现 Native SDK SALE 及会话、客户、能力、恢复、启动租约与查询任务，其他能力按后续批次实施。在现有领域层之上增加应用服务层，不重写 gateway/webhook/store；阶段 B 安排 Web 一起迁入 v1，阶段 C 补订阅与时间线。新会话、客户、操作、任务及条款按领域拆模块，不继续堆进 store.ts。旧恢复路由、recovery.ts 和 mobile v0 仅在消费者检查、存量恢复/数据迁移与回滚方案确认并完成切换后删除，不以契约准备授权删除或让两套状态机长期并存。无认证迁移内容。金额始终整数 minor units，时间为 UTC ISO 8601，ID 为不透明字符串；状态版本 `revision` 单调递增，客户端拒绝旧视图覆盖新视图。

**响应结构与协议边界**：本节只定义 Showcase `/api/demo/v1/*` 返回给 Web、Android、iOS 的 Demo 接口，不修改 Onerway API 响应、SDK 回调或 Webhook 协议。

成功响应直接返回业务资源，不加统一 data/session 外层：单资源直接返回 PaymentView、Operation 等；订阅创建及其恢复返回 `{subscription,payment}`，续费返回 `{operation,payment}`，分页返回 `{items,nextCursor}`（末页 nextCursor=null）。连接与会话接口同样直接返回各自公开字段。错误保持 `{error:<统一错误>}`，不增加 session。会话期限**只通过 X-Demo-Session-Expires-At 响应头返回**，包括会话签发、读取与 renew；204 无 body。不存在 JSON session.expiresAt 或会话期限的 body expiresAt，业务资源自己的 recordExpiresAt/leaseExpiresAt 等字段不受影响。

Showcase 只适配 Demo 共同职责：会话/归属、客户引用、幂等恢复、历史分页、allowedActions、查询进度、保留期限及脱敏。PaymentView/Operation 是 Demo 视图，不是 Onerway 原始返回。Onerway 标识与原始状态保留含义，不用归一值覆盖：例如 Demo 的 status.rawPaymentStatus 对应 Onerway paymentStatus，status.rawTransactionStatus 对应 transactionStatus；normalized/fundsState/allowedActions 是明确标注的 Demo 投影。技术时间线展示 Onerway 请求、响应和 Webhook 的脱敏投影，保留被展示字段的原名及来源，不以 PaymentView 冒充原始报文；完整敏感报文仍不得保存或透传。SDK 回调不因此变成最终支付依据。这里不重新封装 Onerway 全部 API，也不扩大已有演示范围。

### 三端产品范围与交互边界

普通演示公开，Web、Android、iOS 各自只访问本会话的客户、支付、订阅与脱敏记录；内部调试使用独立凭证。无需输入内部 Demo Token，不建设账号系统、跨端历史同步、配对登录、组织或角色管理；清除浏览器数据或卸载 App 后不提供身份找回。共享后端不意味着共享数据访问权限，公开资源 ID 不是凭据。

客户选择仅限当前客户、新建客户或本会话已有客户，不接受任意 merchantCustId。移动端首页“待继续”显示最近一笔可继续或创建结果未知的支付，导航为首页、记录、订阅、设置。页面组织建议：连接地址/访问凭证放设置或首次配置，可预置默认服务地址，自定义地址放高级设置；SDK 外观配置放设置，金额/客户/条款/回跳放场景配置，不新增每笔下单必经的配置页；订单和订阅详情为业务入口，不长期藏在临时调试页。Android 本地50条缓存上限不成为后端业务限制，本地清理不取消支付或 Provider 合约，重要未完成支付不得静默失去关联。

“继续原支付”“恢复未知创建结果”“开始独立测试”分别处理。用户显式开始独立 Sandbox 测试可以保留旧支付，不自动取消旧支付；新支付不必等同新商业订单，Order/Attempt 关系须避免重复履约。托管收银台在未发生支付且状态与 URL 可用性核验通过时可继续原 redirectUrl。Direct API 已提交的原支付只查询；用户明确再付款才使用新请求/交易标识，首次响应要求的外部动作仍属原流程。

阶段 B 的 Web Direct 范围为既有 Apple Pay / Google Pay 的 US/USD/SALE 钱包旅程，不扩展通用 PAN/CVV 表单、APM 或 Direct AUTH/SUBSCRIBE。Apple Pay 流程包括服务端商户验证和钱包授权；Google Pay 首次 R 的受校验托管 CVC 跳转保留，transactionId/paymentId 可为空时以 merchantTxnId 关联。钱包 token 仅瞬时提交，不进入永久幂等摘要、日志、outbox 或共享示例；结果未知只查原交易，不重发 token。安全 action 投影及导航 URL 保存/恢复期限在 Web 批次补契约。固定账单/收货测试信息由服务端提供，商户手动 token 调试入口不作为三端主链路。

诊断记录与领域事件分开，不参与支付真值或任意重放；先脱敏再保存/展示，脱敏副本不能用于复验原始签名，保留验签结果与安全元信息。Provider 跳转/管理 URL 按受保护导航信息处理；保存恢复用 URL 不等于公开原始 payload。客户端事件缺失不阻碍后台收敛，不伪造事件补齐时间线。notifyUrl 由共享后端控制，自定义 returnUrl 不改变通知归属；外部地址能否唤回 App 取决于域名关联。

### SDK 场景支持与防重复边界（2026-10-26 确认）

| 能力 | 参数/行为 | 依据 |
| --- | --- | --- |
| 同 paymentId 防重复扣款 | 同一个 paymentId 最多成功扣款一次；允许按已确认 U/O 规则继续原支付，P/R/A 不再次提交 | 用户确认，user_confirmed |
| Android / iOS APP 预授权 | `/v1/sdkTxn/doTransaction`，`paymentMode=APP`、对应 `osType`，`txnType=AUTH + subProductType=DIRECT` | 两个平台的支持性由用户确认；[SDK 创建接口](https://developers.onerway.com/payments/api-reference/endpoints/sdk-create-transaction)提供参数定义 |
| Android / iOS APP 首次订阅 | 同一 SDK 创建入口，`paymentMode=APP`、对应 `osType`，`txnType=SALE + subProductType=SUBSCRIBE`，提供 subscription | 两个平台的支持性由用户确认；SDK 创建接口提供订阅字段定义 |
| Web SDK 一次性支付 | `SALE + DIRECT` | [Web SDK 接入](https://developers.onerway.com/payments/online-payments/sdk)，documented |
| Web SDK 首次订阅 | `SALE + SUBSCRIBE`，`subscription.requestType=0` | [订阅场景](https://developers.onerway.com/payments/online-payments/scenarios/subscriptions)，documented |
| Web SDK 预授权 | `AUTH + DIRECT`，成功后由服务端 CAPTURE 或 VOID | [预授权场景](https://developers.onerway.com/payments/online-payments/scenarios/pre-authorization)，documented |

公开文档经 Onerway 开发者文档 MCP list-pages → get-page 于 2026-10-26 回读，未提供发布 revision。APP 交叉组合与同 ID 最多成功扣款一次的保证以2026-10-26 用户确认为依据，不从字段枚举或调用图推导；不再列为支持性未知。Web SDK 的三类路径有明确发布说明。

AUTH 表示预授权，资金先冻结、后续请款或撤销；SUBSCRIBE 表示首次订阅子产品。二者是不同场景，不能推导 `AUTH + SUBSCRIBE`，也不能将首次订阅支持扩大为 SDK 承担续费或全部合约管理。具体支付方式、商户配置和对应参数约束仍按发布协议执行。

Provider 的单 paymentId 防重复保证与 Demo 的请求幂等、权限和状态校验同时适用。不得据此自动新建 paymentId、重复发送结果未知的上游创建请求，或跳过 AUTH 的 CAPTURE/VOID 校验；订阅后续扣款按独立支付关联处理。重复提交的具体响应码未作为新的业务保证，客户端仍按既定未知结果恢复与服务端查询处理，不把 Provider 内部锁审计列为实施前置条件。

上述确认更新支持性证据，不代表当前 v1 已实现、已部署或真实 Sandbox 已验收。首批 OpenAPI 保持 Native SDK SALE 范围，AUTH 与 Web 按阶段 B 后续批次、订阅按阶段 C 补齐结构；不能再以 APP 支持性未知阻断相应契约准备，也不能仅因支持性确认将未交付组合标 Available。paymentId 的 30 分钟期限及过期边界见 §13.1。

### 12.1 会话、连接与规则

首批路径、请求及响应结构统一见 [OpenAPI](api/demo-v1.openapi.json)。

Native 凭证通过 Authorization Bearer 传输，保存在 Keystore/Keychain；Web 使用 Secure/HttpOnly/host-only Cookie，变更接口必须有同源/CSRF 保护。后端只存凭证哈希，响应 no-store；不把凭证放 URL、报文或 SDK 参数。内部入口凭证与普通匿名会话分开。

新会话不立即生成测试客户，currentCustomerId 可为 null；首笔 current 支付在本地幂等事务中创建/关联默认 Customer，并生成稳定 merchantCustId，不调用独立的 Provider 客户创建 API。不同支付并发也只能认领同一默认客户。POST /customers 同样只是本地持久化，响应丢失仍按原 operationId 回读。客户数额度由 capabilities.limits.customersPerSession 返回并计入创建中占位，超额返回 409 CUSTOMER_LIMIT_REACHED/not_started；**已确认初值为 20**，是可调整的服务端配置，客户端读取规则而非写死；占位与已创建客户原子计数，同键重放不重复占额度。新建测试客户成功后自动成为当前客户，适用于 POST /customers 和支付/订阅中的 {kind:new}。客户创建与当前引用更新同一本地事务提交；并发以服务端最后成功提交的事务为准，不按请求开始或响应抵达顺序覆盖。失败不切换；幂等重放只回读原资源，不再次切换。响应的 currentCustomerId 读取响应时实际当前值，不沿用旧操作快照；并发响应乱序时 App 通过 GET /session 核对最终当前引用，不能用旧响应强制回滚。每笔支付仍持有首次解析的固定 customerId，不随当前客户切换。revision 只覆盖支付资源字段，currentCustomerId 是响应时的会话信息，不参与 revision 比较；支付 revision 相同不表示当前客户引用未变，也不能用响应抵达顺序裁定会话引用。

capabilities 分开返回 scenes[] 与 presets[]。稳定场景 ID：one_time、pre_auth、subscription_hosted、subscription_merchant（采纳现有 App 占位命名，不宣称已正式接入）；建议预设 ID：usd_standard_5、usd_3ds_50，后者是参数/旅程预设，不是保证发起 3DS 的新场景。preset 返回适用 sceneIds/integrations/platforms、defaults 与自身 availability/verification；客户端按组合 availability 判断能否执行，而不以 verification 单独阻断。integration 闭集为 native-sdk/web-sdk/checkout/direct-api，platform 为 ANDROID/IOS/WEB，服务端校验配对，不接受客户端自选跨平台绕过规则。

规则返回只使用有限表单类型：amount、enum、integer、date、text、httpsUrl，包含 min/max/precision/enum/requiredWhen 和稳定错误码；requiredWhen 仅单层 {field,equals} 或 {field,in}，两者互斥，不支持递归/逻辑表达式；不传可执行表达式或要求 App 做通用脚本引擎。`availability=available|conditional|planned|unavailable` 与 `verification=user_confirmed|documented|source_checked|sandbox_verified|unverified` 分离。decision_required 仅是阶段方案的决策登记状态，不加入 availability 枚举；待产品决定的能力以 planned + reasonCode=PRODUCT_DECISION_PENDING 表达，相关动作 enabled=false。Provider 事实未知则 conditional/unverified + CAPABILITY_UNVERIFIED；不能混为产品已拒绝。iOS SDK 1.0.0 支持 Sandbox 已由交付包公开 Swift interface 核实，verification=source_checked；present/resumeFromReturn 显式传 .sandbox，默认均为 .production，且无 Android 式 configure(merchantId)。U/O/P/R/A 的原生再次 present 规则仍记 user_confirmed。两项事实不再因旧证据缺口标 unverified；真实 Sandbox 验收单独保持 unverified，不能把源码检查升级为交易通过；是否自动附加 paymentId 仍待 SDK 团队确认，本契约按“不附加”设计 merchantTxnId 回跳查单，不以此阻塞 App 自有结果页方案。user_confirmed 不等于 sandbox_verified，也不自动将尚未部署/验收的整个场景标 available。金额初始可沿用既有 USD 1..1_000_000 cents，订阅模式规则单独计算；不能用一次性范围推定所有 Provider 产品均可受理。

规则要返回托管/自管理的不同频率和取消/更新选项，不把月、年转换为自管理天然支持的单位。最低客户端版本是兼容规则，不允许通过旧版绕过校验；不兼容可连接查看升级提示，但支付动作不可用。请求使用 X-Demo-Client: <platform>/<clientBuild>，平台必须与会话一致；服务端每次请求校验，不依赖 /connection 的客户端判断。最低版本由能力配置决定，不虚构数值。Android clientBuild 使用 versionCode；移动端已确认 iOS Demo 的 CFBundleVersion（CURRENT_PROJECT_VERSION）固定为单调递增整数，clientBuild 直接取该整数，构建时校验整数约束；展示版本使用 appVersion。此项已确认，不再标 decision_required。旧版读接口与结果恢复照常允许；新资金动作、创建、启动/接替收银台返回 426 CLIENT_VERSION_UNSUPPORTED/UPGRADE_CLIENT；已认领键仍先回读结果。续期与幂等释放等安全维护入口不受此业务写入门禁阻断。请求头是兼容提示而非安全身份，权限、归属、能力规则仍由服务端强制执行。

客户端执行规则：available 可执行；conditional 同样可执行，并展示 verification 证据等级及 reasonCode 提示；planned/unavailable 不可执行，隐藏或置灰并提供 reasonCode 原因；未知 availability 不可执行。服务端创建支付对 conditional 组合同样放行，不能仅因 unverified 拒绝创建。组合及所选快捷预设分别校验，planned 预设不可选择，不影响以合法自定义参数使用 conditional 组合。所有执行仍须通过会话权限、平台、参数、版本、资源状态与 allowedActions 校验；本规则不代表能力已部署或已完成真实 Sandbox 验收。

响应兼容规则：严格响应 schema 用于校验服务端输出和共享示例；客户端忽略未知响应字段，不用 additionalProperties=false 拒绝整个响应。未知 ErrorAction 按 NONE 处理；未知 attention.kind 或 creationState 按“无可执行操作 + 提示刷新”处理，不启动 SDK 或资金动作；仍可通过既定安全查询恢复。未知 reasonCode 显示通用原因提示；未知 PaymentAction.type 隐藏。未知 rawPaymentStatus、Refresh.state 或 Operation.execution 保留未核实状态并提示刷新，不推断执行完成或支付成功，不放行资金动作。客户端须覆盖 ActionReason、PaymentAction.type、rawPaymentStatus、ErrorAction、Attention.kind、creationState、Refresh.state、Operation.execution 的未知值兜底。新增响应字段或枚举值在遵守这些安全兜底规则时不算破坏性变更，也不因此提高 minimumClientBuild；删除、改名、改变既有含义或必需结构仍须评估兼容性。请求 schema 的字段白名单及服务端输入校验不因此放宽。

GET /connection 以 X-Demo-Client 为客户端平台和构建号的唯一权威；保留的 platform/clientBuild 查询参数必须与请求头一致，不一致返回 400，不允许覆盖请求头。

首批输入边界：客户 label 先拒绝 Unicode 控制字符（Cc），再去首尾空白，按 Unicode 码点计数 1–40；规范化后用于存储及意图比较。cursor 为不透明字符串，最长 512 字符；custom 回跳 URL 最长 2048 字符，仍遵守 §12.7 安全校验。冻结错误码 RATE_LIMITED、RECORD_EXPIRED、SESSION_EXPIRED、REQUEST_NOT_FOUND；401 分别使用 SESSION_MISSING（无凭证）、SESSION_EXPIRED（已过期）、SESSION_INVALID（无效凭证），均不续期，不泄露他人会话信息。

### 12.2 支付接口与幂等

首批支付与操作恢复路径统一见 OpenAPI。payment_create 恢复优先 GET /payment-requests/{requestId}，按原 requestId 找回支付视图；通用 Operation 查询不替代该入口。CAPTURE/VOID 为后续批次资金操作，不在 B0 SDK SALE 结构中开放；执行时仍须资金证据、权限及互斥校验。首版如仅支持全额，金额由服务端取，不因接口扩展默默开放部分请款。

`customer` 为 `{kind:"current"}`、`{kind:"existing",id}` 或 `{kind:"new",label}`。首个请求在同一事务中解析为固定客户；同 requestId 再次执行不能因 current 已切换而换客户或再创建 new。幂等比较采用规范化的原始提交意图 hash，同时保存解析后的不可变快照（包含实际金额/默认 returnUrl/规则版本）；同键同参数回读原记录，同键不同参数 409。不能在重放时重新套用变化后的默认值。

requestId/operationId 在同一 Demo 后端环境内共用全局唯一认领命名空间，原子绑定 sessionRef、操作类型与意图 hash；其他会话用过的键统一 409 IDEMPOTENCY_KEY_UNAVAILABLE，不带视图或原所有者信息。不同环境不共享数据；跨环境禁止客户端重放。请求到达前客户端保存键、原始请求和 (origin,environment,sessionRef)，恢复队列按此分区；换会话后旧分区只读，不迁移/重放。尚未到服务端的旧请求服务器无法认出，不能声称全局认领可以代替客户端分区。

相同所有者/类型/参数并发请求返回同一资源，未完成为 202；完成回读 200，首次准备完成 201。GET 404 仅表示当前读点未找到认领，不证明原请求永远未到；只可在原会话、下述客户端 24 小时窗口内用原键原参数重新 POST，唯一认领使竞态也不重复创建。已认领且上游结果未知只查原交易，不能换键或重发上游扣款。所有持久受理响应返回本地引用；相同键参数不一致才是 409 幂等冲突。

operationId 提供同样 hash、claim、结果未知及查询规则。请款/撤销互斥，未知结果不解锁相反操作；不同键也必须满足资源状态与并发约束。用户有意的独立测试使用新键；不会取消旧支付。SDK 内部多次交易尝试仍关联同一 paymentId，不被误记成多份本地新订单。

**Operation 语义**：结构与枚举见 OpenAPI。创建接口的 requestId 就是对应 Operation 的 operationId，不生成第二个幂等键。恢复 GET 对已知未过期操作返回 200，未结束由 execution 表达；POST 未完成返回 202。accepted/unknown 的 outcome 为 null，completed 给出确定的操作结果；App 以 PaymentView 判断支付状态。未持久受理时没有 Operation 视图，返回 not_started 错误。已建立占位资源时返回其 Demo 本地引用，resource.id 不是 Provider paymentId；未建立或明确拒绝可无资源引用。unknown 可带诊断 error，但不能据此判为 rejected。

创建类 payment_create/subscription_create/customer_create/checkout_session 的 effective=资源已建立，rejected=确定未建立；资金类 capture/void/subscription_renewal 的 effective/rejected=资金操作成功/拒绝已核验；订阅变更类 subscription_change/subscription_cancel 的 scheduled/effective 按相应来源的受理与生效语义：托管按 Provider；自管理 period_end 在 Demo 预约持久化成功即 completed/scheduled（来源 Demo），不代表 Provider 已取消。后续 Provider 取消结果在合约视图及取消执行记录体现，不改写原预约已成功的历史事实；开发者文档未给出自管理 requestType=2 的支持承诺，不能照搬托管接口；阶段 C 按文档补证，未覆盖前 self_managed 的 CHANGE_PLAN 保持不可执行（planned 或 BILLING_MODE_NOT_SUPPORTED），不借此宣称 Provider 已改条款。

主资源映射：payment_create/capture/void/subscription_renewal → payment；subscription_create/subscription_change/subscription_cancel → subscription；checkout_session → checkout_session；customer_create → customer。订阅初始创建的恢复接口仍同时返回订阅与初始支付视图。leaseState 随租约状态更新，GET 不续租；领取操作已 completed/effective 后租约过期不把历史 outcome 改为 rejected。对结束租约 GET 返回 200 + ended leaseState，旧键 POST 仍返回 CHECKOUT_SESSION_ENDED；需要新 operationId 才能再次领取，不重用旧领取操作。

创建请求本地首次保存时记录不可变 clientCreatedAt（客户端队列字段，不是新增 Provider 参数），重启/重试不重置。客户端重放限制：仅在此时间后 24 小时内、原分区原键原参数重 POST；超过窗口只 GET 恢复，不因 404 换键自动下单。时间丢失或时钟回退无法可靠确定窗口时仅 GET，并提示人工开始独立测试。此窗口不限制同一 paymentId 的继续体验，也不延长记录保留期；服务端记录的 createdAt 是首次认领时间，不拿客户端时间作信任依据。资金操作结果未知仍只恢复原操作，不应用该窗口自动重新扣款。

“待继续”不是只有 UI 看过的记录：详情和列表统一返回 `attention:{kind:creation_unknown|continue_sdk|continue_checkout}|null`；包括尚无 paymentId 的已持久创建记录。不把所有 P/A 都默认列为可继续；记录页仍能查看 query-only 支付。查询失败但旧视图可用时标 stale，不删除条目。首页 limit=1 不限制服务端保留数量，也不阻止新建独立测试。

### 12.3 支付视图与动作

PaymentView 的字段、必填与可空约束见 [OpenAPI](api/demo-v1.openapi.json)，合成示例见 [共享示例](api/demo-v1.examples.json)。


P 禁止再次 present 是2026-10-26 用户确认的业务规则，仅允许查询原支付，不表示支付失败。`verified` 指当前状态有可信服务端查询/已验签关联通知证据，不是“本次请求查过”或“支付成功”。客户端回调永不设置它。刷新失败保留旧观察时间和来源；外部状态的陈旧程度由 observedAt 表达，不把所有查询失败重置为未支付。

creationState 闭集为 pending/ready/unknown/rejected：pending=已持久受理、尚未准备好；unknown=上游创建结果无法确定；rejected=有明确证据确认未创建或已拒绝，不包含网络超时；ready=已取得可关联结果。删除 expired：支付记录超过 recordExpiresAt 后，详情/对应支付创建恢复/该支付时间线返回 410，列表和待继续均不再列出，不存在对外的 expired PaymentView；内部最小核验投影不是 API 详情。资源或操作自己的保留期独立：仍有效的 Operation 可返回原资源引用，随后访问已过期支付仍为 410；操作自身过期则 GET /operations 返回 410。订阅 initialPayment.state=expired 仅是合约内引用摘要，继续保留。

status.normalized 闭集为 created/requires_action/processing/succeeded/failed/cancelled/unknown；前六个沿现有领域模型，unknown 是新 API 的安全视图兜底，不擅改内部状态映射。status.source 闭集为 server/query/webhook；模拟场景不进入v1 API，client/return 只能进时间线。未知原始状态不得推进既有可信终态，视图保留最近可信值并记录刷新错误；无可信值则 unknown、verified=false、isTerminal=false。AUTH fundsState=authorized/captured/voided/unknown；非 AUTH 使用 not_applicable，不能因为 payment A 就允许新扣款。

**服务端支付映射**：下表输入是可信、已关联同一支付的 `rawPaymentStatus`，不是 SDK 回调或 `rawTransactionStatus`。txnType 指原始支付的 SALE/AUTH，CAPTURE/VOID 是后续操作，不覆盖原 txnType；PaymentView 与列表新增 txnType=SALE|AUTH。原始状态解释依据 [Query payments](https://developers.onerway.com/payments/api-reference/endpoints/query-payments)，AUTH 组合依据当前 mobile worktree `shared/payment/authorization.ts:60–80`；此为 Demo 草案映射，不证明原生 APP 能力已验收。

| rawPaymentStatus | SALE → normalized / fundsState | AUTH → normalized / fundsState |
| --- | --- | --- |
| P | processing / not_applicable | processing / unknown（已有资金事实则保留） |
| A | processing / not_applicable，不显示已收款 | processing / authorized **仅在关联 AUTH 交易 S 已核验时**；仅有 A 则 processing / unknown，继续查交易 |
| R | requires_action / not_applicable | requires_action / unknown（已有资金事实则保留） |
| N | cancelled / not_applicable | cancelled / voided **仅在关联 VOID 交易 S 已核验时**；否则 unknown，不能将关闭都当撤销成功 |
| S | succeeded / not_applicable | succeeded / captured **仅在关联 CAPTURE 交易 S 已核验时**；缺资金操作证据则 unknown，禁用请款/撤销直到核实 |
| F | 不是已发布 Payment 状态：保留已有可信视图，无可信值则 unknown | 同左，不从 F 推出授权失败或释放资金 |
| U | processing / not_applicable | processing / unknown（已有资金事实则保留） |
| O | processing / not_applicable | processing / unknown（已有资金事实则保留） |
| I（补齐发布枚举） | processing / not_applicable | processing / unknown（已有资金事实则保留） |

AUTH 的 A 选择 **processing + authorized**，保持现有资金生命周期口径：授权成功但支付待请款/撤销，isTerminal=false；App 按 txnType+fundsState 显示“已授权，待请款”，不能展示仍在授权中。可信 S/N 的 Payment isTerminal=true，U/O/I/P/R/A 为 false；终态不等于所有资金信息都已查齐，也不阻止 QUERY。created 仅用于本地尚无 Provider 状态的占位，failed 只能用于已有明确终止支付依据的适配器，不从 Transaction F 自动产生。

若输入只有 `rawTransactionStatus`，先关联交易类型和 Payment，不能套用上表：交易 F + Payment O 是一次尝试失败、支付仍 processing；交易 F + 已可信 Payment S 不得覆盖成功。AUTH S + Payment A、CAPTURE S + Payment S、VOID S + Payment N 按上述资金组合处理，其他资金组合保留旧投影并查询。无 Payment 证据的一般交易 F 暂用 processing/未核实，不宣告整个支付 failed。未知或冲突组合记录错误，不发放依赖该状态的资金动作。查询 AUTH/CAPTURE/VOID 需使用适用的交易查询/通知证据；已发布 Query payments 请求 txnType 仅允许 SALE/REFUND，不能将此映射表当作该接口可传 AUTH 的声明。

可信状态合并允许纠正先前关单：对同一支付完成归属、金额/币种及资金结果关联核验后，可信查询得到 S 可以覆盖此前 N，递增支付 revision 并记录脱敏异常；不得以“终态不可覆盖”丢弃成功资金结果。SDK 回调、本地超时或无资金结果证据的响应不能触发该覆盖，旧 N 也不得回退已确认的 S。该规则不允许 N 状态再次启动或提交支付。关单竞态自动全额退款按 2026-10-26 转述源码调研登记为已知缺口：一次性支付视图暂无退款表达，不能将 S 宣称为最终净收款，也不能仅凭竞态推断已退款；本批不扩展退款模型或退款操作。

PaymentView 顶层新增 merchantTxnId，服务端在首次认领支付时生成并冻结，用于回跳匹配；它是公开引用，不是访问凭据。订阅初始支付及每次手动续费各自持有自己的引用。

列表摘要与 refresh 结构见 OpenAPI。Provider 原始字段仅详情返回，尚无 paymentId 时 provider=null；轮询等待按服务端返回的秒数执行。App 仅前台有界轮询 GET 视图，不反复 POST refresh，不引入推送/SSE；失败保留旧状态。尚无 Provider ID 的 QUERY 表示恢复/查询原创建操作，不是对空 paymentId 查单。

动作集合：CONTINUE_SDK、OPEN_CHECKOUT、QUERY、CAPTURE、VOID、VIEW_SUBSCRIPTION。按钮 disabled 必须有稳定 reasonCode；UI 翻译文案，不依赖后端自然语言判断。新测试是创建入口，不伪装成旧支付的 RETRY。checkout-session 执行时重新查询必要状态；revision 只能避免旧显示，不能授权资金动作。Provider 暂时不可查询时不凭旧动作自动 launch。

checkout-session 的 sdk 只提供 present 启动数据 merchantNo/paymentId/environment/configRevision，不返回 resume_return 指令。首次领取时 App 在原 (origin,environment,sessionRef) 分区保存公开配置快照及支付关联，不含完整 URL、凭据或报文。原生回跳时，有匹配快照可按平台接口配置 SDK 并尝试 resumeFromReturn；本地快照缺失或不匹配时**只 refresh**，不从支付详情重新拼配置、不调用 present。支付详情不提供 provider.environment/configRevision；/connection 与 checkout-session.sdk 既有配置字段保留，不能用当前配置冒充历史快照。iOS 依实际 SDK 接口适配；默认 SDK baseUrl 按官方环境选择，不接受任意远端地址。

原生 App 收到实际回跳后读取唯一 merchantTxnId，在原会话本地映射中找到 Demo payment.id；本地未命中可用现有支付列表的 merchantTxnId 精确过滤恢复本会话引用，再 refresh 并显示 App 自己的结果页。来源地址/路径须匹配已配置的回跳入口，引用只用于定位；后端仍校验凭证/所有权，不能凭 URL 显示成功或访问其他会话。会话过期走 401、不在新会话认领；未知引用无匹配时保持未找到/可从记录页查询，不新建支付。App 没有收到自定义商户地址的回跳时，仍可从记录页刷新。

SDK resumeFromReturn 是可选的原界面接回，不是 App 结果页依赖：Android 0.1.5 解析器只认名为 paymentId 的参数，当前按 Provider 不附加该参数设计，返回 false 时走上述 merchantTxnId 查单。不要把 merchantTxnId 改名或塞进 paymentId，也不由 App 合成一个 paymentId 回跳 URL。Android SDK 源码 CheckoutActivity.kt:366–368（完整判断见 :358–383）显示：仅在已发起外跳、确实离开收银台且该回跳尚未处理时，收银台回到前台才会自行查单，并非每次前台恢复都查询；宿主读取/刷新兜底必须保留。此为 Android 0.1.5 源码事实，不能自动扩展为 iOS 内部触发条件。若 SDK 团队以后确认会附加 paymentId，可启用 SDK 接回原界面，后端接口不变；true 只表示 URL 被接纳，不能作为付款成功。此链路尚无对应真实 Sandbox 验收。

**原生再次 present 动作规则（用户/Onerway 侧确认）**：

| 可信 paymentStatus | CONTINUE_SDK | 原因/后续 |
| --- | --- | --- |
| U | enabled=true | 允许同 paymentId 继续，正常归属、平台能力、有效期与租约校验仍适用 |
| O | enabled=true | 上次尝试失败但支付仍开放，同 U；不是创建新的 Payment |
| P | enabled=false | PAYMENT_PROCESSING；仅 QUERY，不再提交 |
| R | enabled=false | EXTERNAL_ACTION_IN_PROGRESS；保留 SDK 回跳恢复与 QUERY，不重新 present/提交 |
| A | enabled=false | 新增 PAYMENT_AUTHORIZED；禁止再付款，预授权资金后续仅走 CAPTURE/VOID，仍可 QUERY 核验 |

选择 PAYMENT_AUTHORIZED 而非 PAYMENT_TERMINAL，避免与 AUTH A 的 normalized=processing、isTerminal=false 混淆。CAPTURE/VOID 仍须关联授权成功证据、无并发资金操作且通过实时核验，A 本身不直接授予操作权限。U/O 不再以 CAPABILITY_UNVERIFIED 拦截“同 ID 再 present”本身；APP×AUTH/SUBSCRIBE 支持性已获用户确认；未知/失效状态、具体配置及部署门禁仍独立处理。S/N 不允许继续，使用 PAYMENT_TERMINAL；I/未知状态没有新增复用承诺，保持查询。动作规则的证据等级 user_confirmed，不等同 Sandbox 通过；同 paymentId 最多成功扣款一次另由用户确认，不要求 Provider 内部机制审计。

并发启动使用可接替、可释放的租约，三端一致：按 Payment 原子领取租约。同 operationId 在有效租约内回读；不同 operationId 遇活跃租约返回 409 CHECKOUT_IN_USE，含本会话 leaseExpiresAt/checkoutSessionId，不泄漏其他会话。supersedes 如提供，须属于当前支付/会话；不存在或不属于该支付的引用按统一归属策略拒绝，不能绕过权限。租约冲突的 409 仅在有有效租约且 supersedes 未指向它时返回；指向当前有效租约则原子接替。若 supersedes 指向已结束的本会话租约且当前无有效租约，按普通领取处理；未传 supersedes 且当前无有效租约也正常领取。检查有效期、判断当前租约与领取/接替必须原子执行，避免两个请求同时认为无租约。其他状态/能力/幂等冲突仍可返回各自的 409，不受此租约冲突规则替代。App 新进程从原分区恢复该 ID 后可申请接替，Web 先提示用户确认；每次仍重新校验 Provider 状态/能力，租约不能越过 P/R/A 的已确认提交限制。可先用当前 checkout-session 操作的 GET /operations 回读丢失的 ID。释放旧租约不能释放新租约；同旧操作在已释放/过期/被接替后返回 409 CHECKOUT_SESSION_ENDED，提示重新核验获取启动信息，不返回可用旧票据。TTL 建议 2 分钟、不自动续用，属于 Demo 草案并发参数，绝非 3DS/Provider 有效期。SDK 回跳恢复不要求租约仍有效，后台查询也不受租约阻挡。已发出的 SDK 标识无法被 Demo 租约撤销，Provider 同 paymentId 最多成功扣款一次的保证来自用户确认，Demo 租约仅承担并发启动控制。

动作 reasonCode 闭集见 OpenAPI。未知 reasonCode 用通用提示；未知动作隐藏；未知状态安全提示刷新，绝不据此允许扣款。颜色/文案由 App 映射，不增加后端 UI 字段。

### 12.4 订阅接口

| 方法与路径 | 输入/结果 |
| --- | --- |
| POST `/subscriptions` | requestId、customer、integration、returnTarget、terms；创建合约占位与初始 payment，直接返回 {subscription,payment} |
| GET `/subscription-requests/{requestId}` | 无副作用恢复初始创建，和 payment-request 恢复共享同一 operation，不形成第二次创建 |
| GET `/subscriptions?cursor=…&limit=20&customerId=…` | 本会话本 Demo 创建/关联的合约列表；不声称是 Provider 全量列表 |
| GET `/subscriptions/{id}` | originalTerms、effectiveTerms、pendingChange、changeHistory、status、payments 链接、allowedActions |
| POST `/subscriptions/{id}/refresh` | 合并合约查单任务，返回已存视图与统一 refresh 对象 |
| POST `/subscriptions/{id}/changes` | operationId、目标条款、effectiveMode；先仅对有正式协议的模式开放 |
| POST `/subscriptions/{id}/cancellations` | operationId、timing=immediate|period_end；能力不支持的明确拒绝，不暗中转成立即取消 |
| POST `/subscriptions/{id}/renewals` | operationId、当前 termsRevision、amount；只允许 self_managed，生成独立扣款记录；未知结果不换键自动重扣 |
| POST `/subscriptions/{id}/management-access` | 校验归属后返回受控短时导航入口；不返回至列表或日志 |

terms 建议字段：productRef/label、billingMode=`managed|self_managed`、initialCharge=`authorize_only|charge_after_authorization`、amount、frequency={kind:managed,code:D1|D7|D14|M1|M3|M6|Y1} 或 {kind:self_managed,days:正整数}、duration={kind:cycles|until_date,value}。托管可选 cycles 或 until_date，自管理仅 until_date；上限有争议的 expireDate 不伪造验证规则，对依赖它的组合保持 conditional/unverified。原始条款不可改，变更增加版本并记录 acceptedAt/effectiveAt/source；过期或尚未核实的字段不能默认可编辑。

后端映射 selfExecute/mode/requestType，不让 App 直接拼 Provider payload。首版不因字段存在而自动扩张到 trial/优惠/退款等未约定场景。升级/降级不能只凭金额大小推断即时差价；交互显示将修改哪些条款、何时生效、是否触发即时扣款。降级退款仍是独立动作，不在此范围默默自动执行。

合约视图至少包括 normalized/raw dataStatus/raw subscriptionStatus、statusSource、observedAt、cancelRequestedAt、cancelEffectiveAt（Provider 侧实际取消时间，未知为 null）、localCancelEffectiveAt、cancellationSource=demo|provider|null、providerCancelConfirmedAt（Demo 通过查询核验取消的观察时间，非 Provider 实际生效时间）、cancelExecution、originalTerms/effectiveTerms、revision、retention 信息。预约取消受理不能提前显示 canceled。订阅归一状态为 pending/active/needs_attention/cancel_scheduled/canceled/ended/unknown；cancel_scheduled 必须有可信预约受理依据：托管为 Provider 预约受理，自管理为 Demo 已提交的完整预约记录（cancellationSource=demo）；不能只看 cancelRequestedAt，也不能把 Demo 记录伪装成 Provider 预约。终止态仍须查询核验。initialPayment={id,state:available|expired,summary}，expired 时 id=null，summary 仅金额/时间等安全摘要。条款列表与扣款列表分页，不把大量报文内嵌。

订阅归一投影优先级：可信 subscriptionStatus=canceled/ended → 对应终态；其余非终态中，pastdue 或 paused、dataStatus=2、或已识别字段组合互相矛盾 → needs_attention。正常 active+dataStatus=1 → active；paymentdue+dataStatus=0 或本地未核验占位 → pending；trialing 暂以 pending 展示原始值，不因此开放新建试用能力。有可信预约记录且 Provider 取消尚未核验时（包括自管理已过 localCancelEffectiveAt 但补调未确认），非异常 active/pending 投影为 cancel_scheduled；若同时欠款/暂停，needs_attention 优先，预约信息仍独立保留。单独 dataStatus=3 不证明取消完成，且无可信预约证据时继续核验，不推断 canceled；已知 active+3 却无预约依据归 needs_attention。未知枚举无可信旧投影则 unknown；普通网络查询失败只令 refresh.failed，保留旧状态，不单独变 needs_attention；自管理预约取消执行的连续多轮失败按下述取消失败阈值进入 needs_attention，预约和禁止续费事实继续保留。以上是 Demo 展示规则，依据 [Query subscription details](https://developers.onerway.com/payments/api-reference/endpoints/query-subscription-details)，不照搬旧实现 dataStatus=3 就 terminal 的行为。

订阅 allowedActions 闭集 REFRESH/OPEN_MANAGEMENT/CHANGE_PLAN/CANCEL_IMMEDIATE/CANCEL_AT_PERIOD_END/RENEW_MANUAL；共用通用 reasonCode，增加 BILLING_MODE_NOT_SUPPORTED/PRODUCT_DECISION_PENDING/CANCEL_ALREADY_SCHEDULED/MANAGE_URL_MISSING/MANAGE_URL_KNOWN_EXPIRED/OPERATION_PENDING/CYCLE_ANCHOR_UNAVAILABLE。GET /operations/{id} 区分 execution=accepted|unknown|completed 与 outcome=null|scheduled|effective|rejected；completed+scheduled 是预约操作已受理，不是合约已经取消。手动续费返回 Operation（type=subscription_renewal、resource.kind=payment、resource.id 为本次新建 Demo 支付引用）及该 payment 视图；不再把本地引用命名为 paymentId。该 payment 详情带 subscriptionId 关联原合约；accepted/unknown 时 outcome=null，只有本次续费结果经核验才 completed/effective 或 completed/rejected。仅创建好续费记录不算扣款已成功；若需 3DS 等客户动作，继续原记录查询并显示待处理，对应批次完成协议适配与验证前 conditional/unverified，不显示伪成功或默认重扣，也不把“仅显示状态”当成该旅程完成。

**自管理周期末取消采用本地预约 + 每日补调，托管不变。**

- 托管 timing=period_end 仍用 Provider expireMode=2；自管理不向 Provider 冒发预约参数，而是在 POST /subscriptions/{id}/cancellations 的幂等事务中保存完整本地预约。记录 cancelRequestedAt、cancellationSource=demo、localCancelEffectiveAt，返回 Operation completed/scheduled。首版无撤销预约接口。
- localCancelEffectiveAt = 最近一次已核验成功扣款（首期或手动续费）的成功时间 + frequency.days × 86400 秒，按 UTC 计算、App 本地时区展示。预约保存锚点及当时条款版本，不随重放重新计算。若计算值已过去，立即成为每日扫描的到期任务；不能人为顺延一周期。仅授权尚无成功扣款、或成功时间尚未取得时没有合法锚点，CANCEL_AT_PERIOD_END 暂禁用，reasonCode=CYCLE_ANCHOR_UNAVAILABLE，允许查询核验或立即取消，不擅用创建时间替代。
- 预约事务与续费认领按同一合约串行校验；若已有续费 accepted/unknown，拒绝预约，409 OPERATION_PENDING/not_started。预约成功立即禁用 RENEW_MANUAL，reasonCode=CANCEL_ALREADY_SCHEDULED；后端拒绝新续费键，旧键仍按原操作回读。即使尚未到周期末也已禁止手动续费；没有自动周期扣款。
- 到 localCancelEffectiveAt 后，由现有每日 Cron 查询并核验当前合约：未取消则按适用协议执行 Provider 立即取消，再查询确认。取消结果未知时先查询恢复原执行，不盲目换操作重复提交；这属于取消任务，不授权扣款。任务持久保存、跨扫描复用，同一合约只允许一个取消执行者。
- 补调失败次日继续，cancelExecution={state:scheduled|pending|unknown|failed|confirmed,attempts,consecutiveFailures,lastAttemptAt,lastErrorCode} 可见；其中多次失败阈值采用服务端可配置初值 3 个连续日扫描失败轮次（可逆技术参数，不是新增用户决策）。达到阈值显示 needs_attention，但不停止次日补调。Provider 查询确认取消才显示 canceled，记录 providerCancelConfirmedAt；Provider 提供实际生效时间时填 cancelEffectiveAt，否则保持 null，不以查询时刻冒充实际生效时刻。若查询已是 ended，按 ended 收敛，不伪造一次成功取消。
- 预约期间仍允许用户 CANCEL_IMMEDIATE；与 Cron 共用合约执行互斥，已受理/未知的取消先恢复，不重复执行。立即取消完成后停止未执行的到期任务；结果未知时保留取消意图及续费禁用，继续核验，不恢复续费。原预约 Operation 的 completed/scheduled 不被改成付款或取消成功。
- App 分开展示“Demo 已停止续费”（预约成功即停止接受手动续费，并展示本地周期末时间）和“Onerway 已确认取消”；过本地时间但尚未核验时提示等待取消确认，不显示 Provider 准时生效。自管理无自动扣款，补调延迟不会引入新的自动扣款。
- self_managed 的 CANCEL_AT_PERIOD_END 已获产品授权，目标能力 availability=available、verification=user_confirmed，删除 PRODUCT_DECISION_PENDING；这是 Demo 本地预约能力，不是宣称 Provider 支持自管理预约取消。实际部署尚未实现前仍显示整体场景 planned，运行时还须满足有效锚点、归属及无在途续费等条件；真实 Sandbox 验证仍未完成。

管理页链接：Demo 可以签发自身短时一次性入口（建议 60 秒、no-store、不记录完整 URL），使用后端已安全保存的 Provider URL 跳转。**这不延长或重签 Provider URL**，也不能在跳转后撤销其权限。Provider URL 不存在/已失效/期限未知时分别返回原因，不假装每次都能生成新的管理地址；URL 的保存加密、允许 origin 和获取方式实施前核实。缺失时禁用并给 MANAGE_URL_MISSING，已知过期给 MANAGE_URL_KNOWN_EXPIRED；存在但期限未知时以 warningCode=MANAGE_URL_EXPIRY_UNKNOWN 提示风险，只有受控 origin/所有权等检查通过才允许打开，不假设 URL 永久有效。客户端只因用户点击打开系统浏览器，不预取、不调用 mayLaunchUrl；Demo 票据被消费或过期后可重新申请 Demo 票据，不据此重签 Provider URL。可撤销性/期限不作为已证实的 Provider 能力。

### 12.5 时间线与客户端摘要

GET `/payments/{id}/timeline?cursor=…&limit=20`：条目字段 id、occurredAt、receivedAt、source、kind、summaryCode、operationId、transportStatus、verification、redactedPayload、truncated、schemaVersion。kind 闭集为 create_request/create_response/sdk_callback/query_request/query_response/webhook_received/webhook_ack/operation；source 闭集 server/query/webhook/client/return；verification 闭集 valid/invalid/missing/not_applicable，专指 Webhook 签名验证，非通知项均 not_applicable，不能将 HTTP 成功等同验签 valid。只返回本会话可访问支付的数据；普通列表不含报文。

白名单投影：业务类型、脱敏商户标识、已授权订单/支付标识、金额币种、已核对状态/响应码、产品及条款的安全字段、HTTP 状态/耗时、验签结果。不返回 Authorization/ApiKey/Cookie/sign/完整请求 Header、PAN/CVV、tokenId/钱包 payload、个人地址/邮箱/电话、签名 URL、management URL、完整 SDK rawResult。未知字段默认不收录；字符串必须清洗和限长，单条投影建议 <=16 KiB，界面明确“脱敏投影，非完整原始报文”。签名缺失/无效记录不能作为业务事件；无法安全关联到会话的非法通知不向客户端公开。

采纳阶段 C 的 POST `/payments/{id}/client-events`，不作为阶段 B 接入阻断。字段：eventId(UUIDv4)、checkoutSessionId（已知则传；冷启动回跳或启动前失败可 null）、eventType=callback_delivered|present_failed|return_accepted|return_rejected、platform、sdkVersion、appBuild、rawPaymentStatus=S|P|A|N|null、paymentMethod（^[A-Za-z0-9_]{1,32}$ 或 null）、reasonType=canceled|validation_error|api_error|sdk_error|null、reasonCode（^[a-z0-9_]{1,64}$ 或 null）、clientOccurredAt。未知 SDK 状态不强行映射；丢弃该原始值为 null。版本字段长度受限，平台须匹配会话，时间只是客户端声明。拒收 reason.message/param/declineCode/errors、nextAction、rawResult、URL，以及 body paymentId（以路径归属校验为准）；仅格式正则不能替代字段白名单与敏感语义清洗。

服务端补 receivedAt，按 payment+eventId 去重：同内容回读，同键不同内容 409；有效 checkoutSessionId 必须属于原支付/会话，允许已结束租约作历史引用；null 不绕过 payment 所有权。source 固定 client、trusted=false、verification=not_applicable，不推进支付状态、不触发资金动作。SDK 回调漏报不阻碍支付闭环；410 后停止该事件重试，401 保留原分区但不在新会话重发。

### 12.6 统一错误与过期

错误结构、动作与执行状态枚举见 OpenAPI 的 ErrorEnvelope / Error。retryAfter 单位秒；retryable 表示推荐动作可重试，不代表可以重新扣款。

| HTTP | 语义 |
| --- | --- |
| 400 | 输入无效，fieldErrors=[{field,code}]，无副作用 |
| 401 | 凭证缺失/失效/撤销，明确区分 code；不能自动新建会话并重放旧支付 |
| 403 | 有效会话无权限；不返回其他人的当前视图/是否存在。不存在与非本会话资源使用同一不泄漏存在性的响应策略 |
| 404 | 原会话恢复查询在当前读点没有认领；仅在客户端 24 小时窗口内允许原分区同键原参数重试，与并发原请求由服务端唯一约束合并；已清理键不返回此类 404 |
| 409 | 幂等参数冲突、状态变化、操作互斥；只在已确认归属时返回 currentView |
| 410 | 已知请求/记录过期，禁止旧键重建；action 可提示明确开始新测试，不自动执行 |
| 429 | 应用错误信封保证 execution=not_started，Retry-After 与 error.retryAfter 一致；已认领同键先回读，不按新动作额度返回 429 |
| 426 | CLIENT_VERSION_UNSUPPORTED、action=UPGRADE_CLIENT，execution=not_started；升级不删除原分区恢复记录 |
| 502/504 | 上游失败/超时；不能仅凭 HTTP 判定结果未知。写请求可能已执行用 execution=unknown + RECOVER_OPERATION；查单失败保留原视图；明确未发送则 not_started |
| 503 | 存储/任务基础设施不可用；未持久受理就不得 ACK 或报告 accepted |

写请求未收到可验证的结构化应用结果时（断连、超时、HTML/非 JSON 502/504/429 或网关错误），客户端一律按 unknown 恢复原操作，不按 HTTP 猜 not_started、不换键。此规则不改变服务端已知未发送的事实；有效 JSON 信封可明确 not_started。基础设施可能限流恢复读，App 遵守 Retry-After，不能承诺 CDN 永不 429。

资源身份采用服务端不可猜本地引用，requestId 不是授权。通用 403 策略需与前端统一；不得为“409 带当前视图”泄漏另一会话资源。

### 12.7 returnUrl 与关联文件

returnTarget 为 `{kind:"preset",id}` 或 `{kind:"custom",url}`。首批固定 preset：`app_android` 对应 `/mobile/return/android`（仅 ANDROID），`app_ios` 对应 `/mobile/return/ios`（仅 IOS）；服务端校验与会话平台一致。实际 canonical HTTPS origin 来自服务端配置，由服务端解析 preset，客户端不拼接 origin；/connection 不返回 canonical origin。Web 沿用受控结果入口。预设路径冻结不表示关联文件或 App Link 已部署验证。验证 HTTPS、无 userinfo、无 fragment、长度上限；自定义 query 可为商户自有订单参数，但不含 Demo 凭证，不进入诊断正文。服务端不访问/探测用户 URL，不能制造 SSRF；地址合法不代表已完成 Provider 白名单或 App Link 验证。

商户在创建请求传 returnUrl；Demo 后端在支付首次认领时取得 merchantTxnId，以 URL 编码后的 query 参数追加到默认/自定义 returnTarget，并将最终 returnUrl 放入创建意图解析快照，重放不重新生成。merchantTxnId 是 Demo 保留参数：用户自定义 URL 若已携带同名参数，返回字段校验错误，避免覆盖商户值或形成重复参数；其余允许的自定义参数保留。完整 URL 继续不入时间线。Onerway 是否另加 paymentId 尚待 SDK 团队确认，Demo 不依赖它；App 的 merchantTxnId 匹配/查单见 §12.3。

回跳提示页不解释、不反射附加参数，不凭参数形成状态；no-store、Referrer-Policy=no-referrer，不加载第三方分析。App 的 SDK return handler 仍需按平台协议处理其收到的 URL，这与网页不解释参数不矛盾。提示页之外的后端查询不依赖回跳。

Codex 后续可在 Showcase `public/.well-known/assetlinks.json` 与 `public/.well-known/apple-app-site-association` 提供静态 JSON，HTTPS 直接 200、正确 Content-Type、无登录/重定向；不修改 Apple Pay 关联文件。按平台限制 path，不把整个网站路径关联给 App。

Android 最终 applicationId 在阶段 C 与实际构建复核。用户于 2026-10-25 提供的本机调试签名 SHA-256 为 `A9:86:DC:F9:C0:52:53:92:BC:64:F9:11:D2:17:2A:B1:AF:03:AC:E2:2E:B1:81:94:2A:5A:BD:44:FA:DE:05:F7`；此值仅登记用户提供事实，尚未与 APK 证书核验，关联文件未据此发布。不得作为分发签名，也不自动删除仍在使用的调试关联。Claude 交接 applicationId、实际 SHA-256、允许路径、构建用途；iOS 交接 Team ID、Bundle ID、Associated Domains。专用 Demo 分发签名另登记，不把调试签名自动用于分发。两端用真机验证冷/热启动和域名实际关联后才标通过。

## 13. 三端 Demo v1 生命周期与可靠任务

### 13.1 三个期限独立

**2026-10-26 用户确认范围**：Demo（Web、Android、iOS）只使用 Sandbox，不涉及 beta/uat。生产字典值只作调研背景，不作为 Demo 依据。后续 AUTH、订阅、Checkout、Direct 的 Onerway 侧参数与协议以 Onerway 开发者文档为准；各批次按 已确认语义与文档参数补齐 v1 OpenAPI 和共享示例，不再单独列为调研缺口。文档未覆盖的订阅管理 URL 有效期、自管理 expireDate 上限仍留阶段 C，按“期限未知”兜底（管理链接使用 MANAGE_URL_EXPIRY_UNKNOWN 等既定规则），不写成已确认。

- **会话访问期限（已确认）**：任何已认证请求（读或写）都以服务端活动时间自动滑动续期至最后一次活动后 30 天，不轮换 token、不设绝对最长寿命、不新建客户。先校验会话尚未过期再原子更新，已过期不能通过请求复活；并发更新时间单调不回退。业务校验失败但凭证有效的请求同样计入活动；Webhook、Cron、无认证连接探测不代表用户活动。POST /session/renew 保留为无额外业务副作用的兼容入口，等同一次认证活动。过期后不能续期、不凭旧订单找回；不能把访问过期显示为合约取消，也不自动取消活跃托管合约。
- **会话期限响应**：每个已认证响应通过 X-Demo-Session-Expires-At 返回持久化后的准确会话期限（UTC ISO 8601）；会话签发成功响应也带此 Header。JSON 不包含统一 session 字段或会话 expiresAt；成功直接返回资源，错误保持 {error}，204 无 body。跨域显式 expose 该 Header。有效凭证产生的 400/403/409/429 等业务响应也包含期限；未认证响应不伪造期限，401 不续期。若会话读写失败，返回基础设施错误，不能伪造续期成功。App 读取响应头，不自行加 30 天；并发响应以较晚的服务端期限为准。该协议只属于 Demo 会话，不改变 Onerway 响应或业务资源 recordExpiresAt，也不让后台任务保活会话。
- **支付记录期限**：沿用创建后 30 天，返回 recordExpiresAt；查询不能延长 Provider 支付有效期。对仍在处理的支付到期清理必须留最小关联/幂等记录，不因 UI 明细清理而重建。幂等认领摘要与支付明细独立保留；全局键已用过的事实不能随旧会话失效就删除，否则新会话可重用。
- **订阅期限**：非终态合约独立保留，终态密钥清理与审计保留沿既有契约；不受初始 Payment 30 天级联删除。详情保留初始支付安全摘要和“支付明细已过期”，不能引用消失记录导致整个页面失败。
- **Provider paymentId/管理 URL 期限**：paymentId 有效期 30 分钟已由用户确认。2026-10-26 用户转交 Claude/糖糖针对 `rhcn-acquiring@f3cd2a75` 的本地源码调研：有效期取全局字典 `CHECKOUT_MIMUTES`（原拼写），从交易流水 createTime 起算；报告中的生产/Sandbox 值均为 30，SDK 与收银台同规则、不分商户/产品。报告称 `orderCancellExecuteJob` 按 30 分钟宽切片扫描，实际关单晚于到期；SDK 流水不走交易级关单，仅支付置 N，不发 Webhook；P/R/A 不被关单；SDK confirm 未校验有效期，受 60 分钟缓存限制，缓存失效返回 50018，商户查单在关单后返回 N。这是用户转交的源码调研证据，本端未独立回读源码或运行环境；不将生产/Sandbox 字典值写成仓库已证明的部署事实。实际关单 cron 频率仍未核实，但不影响 Demo；N 后仍可支付与竞态自动退款留阶段 D Sandbox 实测。Onerway 回跳是否追加 paymentId 待 SDK 团队确认；Web Cookie/CSRF 在 Web 批次前冻结。管理 URL 有效期、自管理 expireDate 上限仍为阶段 C 的期限未知项。
- **Demo 保守继续窗口**：服务端持久化首次向 Provider 发出创建请求的时间及本次有效期配置快照，窗口截止为该时间 + 有效期；初值 30 分钟，对应 `CHECKOUT_MIMUTES`，不得写死在客户端。按调研中的起算顺序，该截止早于 Provider createTime + TTL，仅作为 Demo 保守门禁，不保证 Provider 可受理。到达截止时 CONTINUE_SDK disabled、reasonCode=PAYMENT_EXPIRED、attention=null；即使 30–60 分钟之间查询仍为 U 或 SDK 仍可打开，也不允许重新启动。服务端签发/回读启动租约时同样检查期限：保守继续窗口到期返回 HTTP 409、code=PAYMENT_EXPIRED，附已确认归属的 currentView，不返回可用 SDK 启动资料；已打开的 Provider UI 不由 Demo 本地关单或再次提交控制。缺少可靠请求发送时间/配置时不放行继续，先查询核实。窗口不写入 providerExpiresAt；未取得可靠 Provider 时间时该字段仍为 null。不把保守窗口到期直接映射为 N 或支付失败；保留原可信状态、允许 QUERY，P/R/A 及已有资金事实不因本地窗口清除。
- **过期收敛**：不能等待 SDK 过期 Webhook；首次创建时安排持久查询任务，到保守截止仍未收敛的支付由读取/刷新和既有每日扫描核验，方案 D 不变。本地窗口截止不删除待查任务；N 后迟到资金结果仍按 §12.3 合并，在既有任务截止/保留边界内核验，不扩展为永久轮询。

**全局幂等认领摘要永久保留，不做删除机制。** 只保留 keyHash、ownerScopeHash、intentHash、操作类型/过期等必要标记，不保留明文幂等键、资源 ID、报文、URL、凭据或客户信息。完整操作/支付记录按各自保留策略清理后，本会话旧键命中摘要返回 410，其他会话命中返回 409 IDEMPOTENCY_KEY_UNAVAILABLE，不恢复已删除视图。摘要必须有足够的所有者/类型标记支持此判断，但不能反查用户明文数据。客户端 24 小时原键重 POST 窗口保持，不删除服务端永久认领以换取有限保留。

永久保留仅限幂等哈希与标记，不扩大支付明细 30 天、订阅独立保留或待查任务最小投影的期限；尚未到服务端的旧请求仍靠客户端原分区规则防止跨会话重放。会话过期后新会话不得认领旧合约；托管订阅可能继续扣款，匿名访问失效按现有提示边界处理，不能自动取消或向新会话转移合约。

### 13.2 可靠查询任务

**可靠查询采用方案 D**：复用现有 Neon 和单一 Showcase 部署，保留持久 outbox；不增加每分钟 Cron、队列或外部触发。用户转述 2026-10-25 只读查询：团队 Abel's projects 为 Hobby，该记录不是实时团队状态。[Vercel Cron 规则](https://vercel.com/docs/cron-jobs/usage-and-pricing)确认 Hobby 单个 Cron 最短一天一次、按小时精度（表述 ±59 分钟，示例为计划小时内触发）。使用现有每日 Cron，不通过新建多个任务绕过所选方案。

三种查询收敛入口共用任务领取逻辑，均不重新下单、不自动续费；阶段 C 在同一个每日 Cron 增加 已约定的到期立即取消任务，只有该任务和用户显式取消入口可以调用对应取消写接口，客户端读取不能暗中触发取消：

1. Webhook 验签并完成安全关联后，同事务记录白名单通知事实与待查任务，提交后 ACK；同一次函数调用通过平台支持的响应后执行机制尽力查单。必须绑定请求生命周期（例如可用的 waitUntil），不能仅启动无人等待的 Promise。该次查询成功则 App 已关闭也随即收敛；失败/函数中止保留待查任务，不影响已提交 ACK。对必须查单才可最终关联的订阅通知先保存受控 pending 事实，不提前投影 active；未知/冲突关联仍按失败策略处理。
2. 已认证客户端读取/刷新某支付时，顺带有界处理该资源的待查任务；不是只读出旧视图后假装刷新完成。GET 可更新内部查询投影，但不调用 Provider 资金写接口，响应 no-store；超时返回已有视图和 refresh 状态。列表仅有界处理本页资源，不扫描整个会话，重复读共享去重/限流。订阅详情/刷新可用同样机制处理对应订阅任务。
3. 现有每日 Cron 分批扫描到期 payment-query/subscription-query 任务，并在阶段 C 执行到期 subscription-cancel 任务，受函数时长和批量上限约束；按 dueAt 公平领取、租约和断点推进，剩余任务持久保留，不因一批未完成被标成功。cleanup 与待查处理协调，不先删掉待核验依据。

job 保存资源、dueAt、leaseUntil、attempts、lastErrorCode、revision，合并新事件版本，完成前检查是否又有新通知，避免中途通知被去重吞掉；超时租约可恢复。查询任务失败保留有界退避、重试上限与 unresolved 状态，客户端仍可手动刷新；到期取消失败按 §12.4 次日继续，达到提示阈值不终止补调。响应后执行也受函数同一超时上限约束，参考 [Vercel waitUntil](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#waituntil)；实现时核对当前 Nuxt/Nitro 部署适配，部署适配未验证。

**阶段 B 验收边界已获用户同意**：Webhook 本次查询成功则 App 关闭也立即收敛；失败则下次打开 App 读取/刷新，或每日扫描再核验。正常调度、批次覆盖且上游查询成功时，每日兜底等待按最长约 25 小时设计，不再以“约 1 分钟”为目标。约 25 小时是下一次日扫描的正常等待口径，不是持续上游故障、平台漏执行或批次积压下的成功 SLA；这些情况下明确显示旧观察时间/待查/失败，不能伪报已收敛。阶段 B 验证三入口、失败任务留存、批次预算与恢复；不要求新增调度设施。客户端路径和 refresh 结构不变。

清理须与任务协调：仍需收敛的支付保留受控最小核验投影（所属作用域、Provider 标识、金额/币种、最近可信状态及版本、任务截止时间），只更新该投影，不重建已过期报文或延长 UI 的 30 天保留期。Native SALE 首批查询任务截止与支付明细 30 天期限一致；到期后清理报文、回跳 URL 和业务明细。已过期资源额外保留 30 天的资源哈希/所属作用域哈希，用于返回 410，不保留明文资源引用或客户资料；仍有效的 Operation 保留其租约结束状态。永久幂等摘要不受该墓碑清理影响。支付查询任务截止仍未收敛时停止自动重试并留 unresolved；该投影保留与截止参数在实施时按记录生命周期落实，不新增用户业务选择，也不与永久幂等哈希摘要或持续补调的活跃订阅取消任务混为一类。

### 13.3 限流

会话+operation 持久计数为主，匿名 session 签发另设可信 IP/全局桶，避免靠创建新会话绕过。IP 仅作较宽保护，不把同一办公室所有人共享 4 次/分钟当作每用户配额。使用 Neon 原子更新窗口/租约，当前进程内 Map 仅作保险，不能作跨实例正确性依据。查询/写动作/客户端事件/worker 分桶，公共刷新合并同资源任务；具体阈值经负载验证再确认。限流要先判是否已有可回读操作，不能把一次已受理超时变成不可找回。
