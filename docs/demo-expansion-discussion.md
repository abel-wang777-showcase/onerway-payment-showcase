# 三端 Demo 阶段计划与交接

> 更新日期：2026-10-28（Asia/Shanghai）
> 本文维护计划、分工、基线、剩余缺口与交接。进度和验收证据由关联 Issue / PR 维护，不在此记录逐轮审阅或执行流水。
> 当前文档工作不授权业务实施、部署、真实交易或远程配置变更。实施阶段新开 Codex 会话；本会话完成文档收敛后停止。

## 1. 目标与文档归属

Web、Android、iOS 共用一个 Sandbox Demo 后端，支持参数化支付、原支付恢复、客户复用、订阅管理与脱敏记录。分批交付不缩减最终范围。

全部共享文档存放于 Showcase 仓库，由 Codex 维护：

| 文件 | 职责 |
| --- | --- |
| [showcase-contract.md](showcase-contract.md) | 产品、支付语义与安全边界的长期权威；明确旧实现与 v1 目标的适用范围 |
| [demo-v1.openapi.json](api/demo-v1.openapi.json) | 唯一接口结构、字段和响应头定义 |
| [demo-v1.examples.json](api/demo-v1.examples.json) | 服务端、Web、Android、iOS 共用的合成示例 |
| 本文 | 阶段计划、分工、基线、缺口与交接入口 |

native-sdk 不复制上述正文。Claude 在 Android 实施时只在其 CLAUDE.md 引用 Showcase 文件路径与已合并 commit；本次不修改 native-sdk。

## 2. 基线使用规则

本地历史快照见 §7。实施会话与 Android 接入会话从本次文档 PR 合并后的同一 main commit 开始；该 commit 以 PR 合并结果为准，不预写候选 SHA。

实施前 fetch 最新 main，核对与文档基准的差异，再建隔离分支。定向接入 mobile worktree 的必要未提交成果，不整体覆盖、重置或删除现有两个 worktree 的修改。契约同步不表示源码同步；旧接口仍有实际消费者。

## 3. 范围与批次依赖

Demo 三端只使用 Sandbox，不涉及 beta/uat；生产字典值仅作调研背景。普通演示公开、会话数据隔离、内部调试独立凭证；产品和权限规则以契约 §12–13 为准。

首批为 Native SDK SALE 及会话、能力、客户、创建/恢复/查询、启动租约与释放、Operation 恢复、持久幂等认领和待查任务。AUTH、订阅、Checkout、Direct 依既定批次补齐；Onerway 侧参数与协议以开发者文档为准，按已确认语义补 v1 OpenAPI 与示例，不另设广泛 Provider 调研阶段。

管理 URL 有效期、自管理 expireDate 上限仍为阶段 C 未知项，详见 §7。API Key 鉴权迁移独立于本计划，不更换 Provider 域名、鉴权或 Webhook 协议。旧接口删除须通过消费者、存量数据、恢复迁移和回滚验收，并单独取得该范围授权。

## 4. 契约与验证方法

每批先补契约和共享示例，再实施服务端和客户端。交换字段沿用已确认命名，区分 Demo id、Provider paymentId 和 merchantTxnId，不另建移动端契约或重复字段表。

服务端输出与示例严格校验；客户端按契约处理未知字段与枚举。接口检查与首个接口同时落地，覆盖实际响应及响应头；幂等、归属、并发、恢复、租约和查询任务用行为测试验证。类型生成不是开工前提，手写 DTO 也须解析共享示例。自动化合成数据不替代真实 Sandbox 验收。

## 5. 验收证据与归档

Issue 描述下一步范围与验收要求，PR 记录实现、检查结果、实际未完成项及证据版本；讨论稿不维护进度表。尚未执行的验证保持未验证，文档通过不代表已部署或交易通过。

阶段 D 完成且最终验收、迁移结果和未结事项已进入 Issue / PR 后归档本计划。归档前保留长期决定于契约、移除契约对本计划的依赖；归档不删除 Git 历史，也不把未完成事项标成通过。

## 6. 分工

| 职责 | 维护方 |
| --- | --- |
| 共享契约、OpenAPI、示例、阶段计划、后端与 Web | Codex（Showcase） |
| Android/iOS、设备生命周期、原生解析与接入反馈 | Claude（native-sdk） |
| 产品选择、实施范围、部署与交易授权 | 用户 |

后端保持共享领域模型与应用服务分工，不复制多套状态机。移动端只消费状态与动作，不保存商户 secret。具体 UI 风格由各端维护，支付语义必须一致。

## 7. 推进顺序与完成标准

### 会话与启动条件

顺序：本会话完成文档收敛并提 PR → Claude 回读语义未变 → 按仓库门禁合并 → 用户明确授权并新开 Codex 后端实施会话及 Claude Android 接入会话。两端从同一合并后的 main commit 开始。本会话不接续实施，也不自动创建或发送其他会话消息。

阶段 A 的决定直接作为契约规则使用；B0 的审阅与静态验证证据见文档 PR。实现、部署和真实交易分别授权。后续 Web、iOS、阶段 C 在职责或上下文边界处交接，不按每个接口创建会话。

### 开发基线快照（Showcase：2026-10-25；Native：2026-10-26）

| 工作区 | 提交与分支 | 快照核对时观察与处理 |
| --- | --- | --- |
| `/Users/abel.wang/projects/onerway_payment_showcase` | `6d1adf91f4498e40673331dfc7c17800031d7108`，`abel/issue-8-checkout-3ds` | 原有 Apple Pay 关联文件修改、`.apifox/` 和未跟踪讨论稿保留；B0 文档在此目录准备，源码不迁移 |
| `/Users/abel.wang/projects/onerway-payment-showcase-mobile` | `fa7c4a859c63d33bb5c34e98c539efa37313b2e6`，`codex/native-demo-api` | 与本地缓存 origin/main 相同，未 fetch，不代表实时远端；有 staged/unstaged/untracked 的 mobile v0 与迁移成果，全程只读 |
| `/Users/abel.wang/projects/onerway-native-sdk` | `7b385b27f5ca463b0c4508a1a4dd8b027ea05ef3`，`redesign/compose-ui-kit` | Android 首页成果已提交；tracked 文件无暂存或未暂存改动，仍有未跟踪交付包目录 `Onerway-Native-SDK-20261023/`。未推送为 Claude 报告状态，未实时核验远端；快照核对时只读 |

Native 本地核对：`e421f5bced287f08e095a0c12d90de4f94ac8989` 提交首页假数据与截图，`7b385b27f5ca463b0c4508a1a4dd8b027ea05ef3` 为其直接后继，确立首页黄金页面并删除旧范例。`android/app/src/screenshots/` 内以 `com.onerway.demo.ui.screens.home.` 开头的 21 张截图均已进入 e421f5b，当前文件逐一与该提交一致。快照核对时未重新构建、运行测试或验收截图视觉效果；提交说明中的历史验证不当作快照核对时执行结果。未跟踪交付包不是未提交首页代码，保持原处；未 fetch、切换、重置、提交或推送 Native 分支，也未修改 native-sdk 文件。这些记录不代表 v1 已实现。

mobile 未提交文件及 index/worktree 双层摘要快照共 17 个文件，SHA-256 为 `58b517245f555eb4c5265b5a9a97089ddf29b6b734ad849e7467efac2b26ae46`（快照核对时临时清单 `/tmp/showcase-b0-snapshot/mobile-manifest.json`，不是提交）。

两分支共同祖先为 `1af5c6e49846f077527ae23a8cf961cd2453bff7`，非直接快进关系。mobile 已提交基线包含主目录缺失的 Direct 钱包、Checkout AUTH/订阅、金额编辑和迁移 0008/0009。长期契约第 1–11 节已从该提交同步，未复制 mobile 工作区末尾的旧 v0 契约，也没有同步源码。后续实施应先 fetch 核对最新 main，再在安全隔离基线上定向接入必要的未提交成果和 B0 文档；不在旧分支直接重做这些功能，不自动合并两个 dirty worktree。

mobile 已暂存：`.env.example`、README、契约、gateway/profile/store、attempt、profile/store integration tests；README、契约、store 还有未暂存修正，另有 amount e2e/store 单测修改。未跟踪：`server/api/mobile/`、`server/routes/`、`server/utils/mobile.ts`、`server/db/migrations/0010_native_sdk.sql`、`tests/mobile.test.ts`。其中 0010 仅扩展 integration 约束，不是 v1 会话/客户/操作/outbox 迁移；暂存文档曾写 0008，工作区已修正 0010，不以重置抹掉修正。

旧接口存在真实消费者：native-sdk 的 `android/app/src/main/java/com/onerway/demo/MobilePaymentApi.kt` 调用 `/api/mobile/payment/$action`，`CheckoutViewModel.kt` 使用它。Web 旧接口由 `useSdk.ts`、`useApplePay.ts`、`useGooglePay.ts`、支付/订阅返回页及授权组件消费。旧恢复 Cookie 的 Path 为 `/api/payment`，不会自动发送给 `/api/demo/v1`；切换前须处理历史订单、回跳、迟到通知与恢复凭证，不能只替换客户端路径就删除旧入口。

### Provider 依据

支持性与防重复规则见契约 §12 的 SDK 能力证据表；过期机制、保守窗口与源码调研边界见 §13.1。用户确认、发布文档、源码检查及真实 Sandbox 验收分别记录，不互相替代。后续参数按开发者文档补结构，不把旧调用图索引作为新的实施门禁。

### 剩余缺口（2026-10-28 更新）：

- 关单 cron 频率：未核实，不影响 Demo 的保守窗口和方案 D。
- 创建拒绝分类：首批保持保守，不写入 creationState=rejected；是否依据特定 Provider 拒绝码确认未创建并标记 rejected，待用户决定。网络超时和结果不确定仍查询恢复原支付，不换键重建。
- N 后仍可支付与竞态自动退款：阶段 D Sandbox 实测，当前保留源码调研与推断的证据边界。
- Web Cookie/CSRF：Web 批次前冻结。
- 订阅管理 URL 有效期：开发者文档未覆盖，阶段 C 按“期限未知”兜底（MANAGE_URL_EXPIRY_UNKNOWN），不写成已确认。
- 自管理 expireDate 上限：开发者文档未覆盖，阶段 C 按“期限未知”兜底，不猜测上限或写成已确认。
- 自管理升降级：开发者文档未覆盖，阶段 C 补证。

阶段 C 的续费客户动作恢复仍属既定契约与实施工作，不另列为 Provider 调研缺口。

### 阶段 B：共享后端先形成完整链路，Android 首先联调

交付参数化一次性支付、稳定客户、状态核验、幂等恢复、服务端记录、默认/自定义回跳，以及方案 D 的持久待查任务。按以下顺序推进，而非先做完整 Android 再补后端：

1. **契约先行，再完成共同基础与第一条后端链路**：B0 先落实下述命名、唯一 OpenAPI 和共享示例，由 Claude 在已有审阅会话简短确认；获得后端实施授权后，再实现会话、能力规则、客户、创建/恢复/查询、记录与回跳关联；持久幂等和查询任务一起进入基础，不延后到最后补安全边界。契约检查随首个接口进入，不留到全部功能完成后补做。
2. **Android 并行准备与首先联调**：获实施授权后，Claude 可按契约用明确标记的假数据开发对应界面和数据层。后端就绪后先接一次性原生 SDK 链路：选择客户/金额 → 创建 → 打开 SDK → 关闭或中断 → 找回原支付 → 查询结果。重点验证不重复创建、不永久卡住。上线联调、部署和真实 Sandbox 交易分别遵守用户授权，不能以假数据宣称支付通过。
3. **Web 紧接着迁移，补收银台与 Direct API**：Web 消费同一套 v1 接口，逐条完成三种接入及各自恢复方式，避免后端围绕单一 App 特化。页面按共同功能重新组织，必要部分可替换；不要求三端 UI 完全一致。
4. **iOS 接入稳定契约**：在共享契约经 Android 与 Web 接入检查后实现 iOS，适配其实际公开接口。两端均使用 merchantTxnId → refresh → App 自有结果页；SDK 原界面恢复为独立能力，不依赖 Provider 自动附加 paymentId。
5. **收敛旧实现**：检查外部消费者、存量订单/订阅、回跳、迟到 Webhook 与迁移回滚，完成切换后删除被替代的 Web 恢复链/路由与 mobile v0，不永久保留双状态机。旧业务记录仍需正确关联，不能因页面退役丢失通知或合约。

阶段 B 完成标准：上述三端一次性支付范围及约定接入方式完成对应验证，形成同一套业务规则和接口；各平台未具备的组合明确列出，不能静默删减交付范围或伪标支持。最先交付 Android SDK 只是先打通一条链路，不代表阶段 B 仅交付 Android。恢复、归属、幂等、回跳与 Webhook/客户端/每日扫描三入口按契约 §12–13 验收；方案 D 正常日扫描兜底约 25 小时的条件见契约 §13.2。

### 阶段 C：订阅与交互记录

在共享支付基础上完成首次订阅配置、模式选择、列表详情、托管页面入口、自管理管理页面、升降级、两种取消、手动续费及脱敏时间线。按契约 §12.4 的本地预约 + 每日补调方案实现，不重新等待产品选择；自管理不做自动周期扣款调度。沿用阶段 B 的通知查询任务基础，扩展订阅关联与收敛，不另建状态机或第二套后端。

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

## 8. 简短决策记录

日期为现有记录中的确认/登记日期；逐轮原文保留在收敛前快照 commit 695a633。编号仅用于追溯，不作为契约规则名称。

| 决定 | 日期 | 依据 | 理由 | 被否决或替代的方案 |
| --- | --- | --- | --- | --- |
| 租约接替与释放（Q1/M1） | 2026-10-25 | A1 审阅与原生恢复源码 | 原子接替可恢复崩溃并保留并发保护 | 仅依赖进程锁；旧租约释放新租约 |
| 全局幂等摘要永久保留（Q2/M5） | 2026-10-26 | 用户确认 | 防止资源清理后旧键重新认领 | 按业务记录期限删除认领摘要 |
| 方案 D（U3） | 2026-10-26 | 用户确认及既有部署约束 | outbox 加三入口查询，保留可恢复性 | 高频 Cron、外部队列、约一分钟目标 |
| 撤回详情配置恢复（O1/F2） | 2026-10-25 | 原生恢复依赖本地上下文 | 缺快照只刷新，避免用当前配置冒充历史 | 详情 provider 配置重建 SDK 恢复 |
| 保守过期窗口（B2） | 2026-10-26 | 用户转交源码调研，运行时未实测 | 服务端限制继续窗口且不伪造 Provider 到期时间 | 用 Demo 时间填 providerExpiresAt；放行30–60分钟窗口 |
| 可信资金结果 N→S（B5） | 2026-10-26 | 用户转交竞态调研及资金证据规则 | 不丢弃迟到成功结果 | 绝对“终态不可覆盖”；由回调直接确认成功 |
| Android 外跳恢复主路径 | 2026-10-28 | 用户转交的 Android 0.1.5 sources.jar 审查（source_checked）；SDK 开发说明经用户转述（user_confirmed） | CheckoutActivity.onResume 在已外跳、确实离开且尚未处理返回时自行查单，不依赖回跳带 paymentId；外跳期间进程被杀时 resumeFromReturn 返回 false，由 returnUrl 的 merchantTxnId 查单及“待继续”兜底，仅损失 SDK 界面连续性，不影响结果正确性；真实 Sandbox 未验证 | 等待确认回跳追加 paymentId 才能接入；将 SDK 界面恢复视为正确性前提 |
| 新实施会话与文档单一归属 | 2026-10-27 | 用户明确决定 | 固定基线与职责，避免复制漂移 | 当前会话接续实施；native-sdk 复制契约 |

## 9. 交接读取入口与版本

新实施会话先只读以下文件，不要求重读逐轮历史；阅读或创建会话本身不构成实施授权：

1. 本文 §2、§3、§7：基线、范围与计划。
2. [长期契约](showcase-contract.md)：产品目标与适用范围，重点 §12–13。
3. [OpenAPI](api/demo-v1.openapi.json)：首批 Native SDK SALE 结构及依赖。
4. [共享示例](api/demo-v1.examples.json)：解析与契约检查输入。

三文件 SHA-256 用于核对内容；版本基准仍为文档 PR 最终合并后的 main commit。任何修改后同步更新快照；不以哈希或合并推断业务已经实现。

| 文件 | SHA-256 |
| --- | --- |
| `docs/showcase-contract.md` | `a8e05b123c3d8ad4ba7588f30d5fa51f7f022cdc90d61f605750653f3e987c91` |
| `docs/api/demo-v1.openapi.json` | `30f06f818281d766ed26082c2e5a31bbd4790d4fde32e160ec2c211f9435a992` |
| `docs/api/demo-v1.examples.json` | `40df1f8fbc0a8cc91fb39f69e4491b7567bcf184874ea0c159d0df60b3f917ad` |

交回 Claude：只读本次 PR 的收敛前快照与最终提交，按 PR 决定对照表确认语义未变、无规则遗漏及证据升级；核对上述 SHA-256。只报告具体差异或确认语义未变，不实施、不部署、不交易。回读通过前不合并。历史审阅编号的完整落点表只保存在 PR 描述，不在本文重复维护。
