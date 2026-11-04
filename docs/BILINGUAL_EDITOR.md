# 双语写作模块 · 完整设计文档（Bilingual Editor · Translate）

| | |
|---|---|
| 版本 | v1.2（v1.1 移除语法校对模块；v1.2 配置整合，见变更记录） |
| 日期 | 2026-10-26（v1.1：2026-11-04；v1.2：2026-11-05） |
| 宿主项目 | Outline（`/Users/wang/worker/english/outline`） |
| 参考仓库 A | FluentRead（`/Users/wang/Worker/english/FluentRead`）——划词翻译交互与服务商体系 |
| 关联文档 | `docs/ARCHITECTURE.md`、FluentRead 本地报告 `docs/reports/web-version-feature-inventory-20261026.md` |

> 本文档回答三件事：① 参考项目里**哪些东西能搬、怎么搬**；② 双语写作与划词翻译在 Outline 里的**完整技术设计**（数据模型 / API / 同步引擎 / 编辑器插件 / UI 规范）；③ **所有已识别的设计漏洞与实现坑**，每条给出根因与解法（第 12 章）。
>
> **变更记录**
>
> - 2026-10-31 定稿（v1.0）：整合需求基线与扩展能力取舍，含当时的语法校对模块（LanguageTool）设计。
> - 2026-11-04（v1.1）：**语法校对模块整体移除**（LanguageTool sidecar、`grammar.*` API、`GrammarCheck` 编辑器扩展、`GrammarAssist` 面板、相关偏好与环境变量）。原因：语法纠错改由自定义 LLM 模型承担（FluentRead-Go proofread 模式，另行实现）。本文已同步删除相关章节与条目；§8 保留编号占位以维持后续章节引用。>
> - 2026-11-05（v1.2）：**配置整合**。删除死配置（`BILINGUAL_EDITOR_ENABLED`、`TeamPreference.TranslationTrigger`、legacy localStorage 迁移）；设置页合并 —— `Settings → Models` 并入 `Settings → AI`（旧路径重定向），双语开关、翻译/校对绑定、模型网关、静态服务商凭据全部在单一页面；用户级目标语言与翻译服务商覆盖由 localStorage 迁入服务端用户偏好（跨设备）；`resolveChatChannel` 增补 `team_ai_configs` 兜底（校对可见 AI 页凭据）；翻译回退链尊重 `isDefault`「设为默认」。配置模型见 §4.4。

---

## 1. 目标与范围

### 1.1 一句话概述

在 Outline 中新增一个「双语写作」模块，包含两个能力，共用一套编辑器基础设施：

1. **双语分屏**：左侧写英文文档，右侧出现结构一致、可手动修改的中文文档；保存时生成同名的两份文档（en / cn）。
2. **划词翻译**：编辑时鼠标悬停单词或选中句子，旁边出现一个可点击的小圆点，点开后显示翻译结果（移植 FluentRead 交互）。

### 1.2 用户故事

- **US-1（双语）**：作者在工作区侧边栏进入「双语写作」，新建一篇双语文档（或对已有文档开启双语）；左侧输入英文，中文侧自动按段落跟翻；作者随时可以手改中文侧（改过的段落不再被自动覆盖）；系统自动保存为同名两份文档，出现在同一集合中，带语言徽标。
- **US-2（翻译）**：写作时选中一句话或悬停一个单词 → 出现小圆点 → 点击弹出翻译卡片，可切换翻译服务、复制、朗读，并可「写入右侧中文段」。

### 1.3 范围

| 范围内（v1） | 范围外（后续版本） |
| --- | --- |
| EN→CN 双语对（左英右中） | 反向 CN→EN / 其他语言对（数据模型已预留 `sourceLanguage/targetLanguage`） |
| 段落级结构镜像 + 段落级自动翻译 | 句子级对齐、术语表（glossary）、翻译记忆 |
| 悬停单词 / 选中句子翻译，多服务商 | 整页沉浸式翻译、PDF 翻译 |
| 服务端代理翻译、缓存、限流 | 客户端直连第三方（存在 CORS 与密钥泄漏问题，明确不做） |
|  | LLM 语法纠错（FluentRead-Go proofread 模式，另行设计） |

---

## 2. 参考仓库调研结论（能搬什么、怎么搬）

### 2.1 Outline 已有的轮子（直接复用，不重造）

| 已有能力 | 位置 | 对本设计的意义 |
| --- | --- | --- |
| **SplitView 分屏**（`?split=` 打开第二个文档面板、可拖拽分隔条 `useResizeHandle`、`ui.splitViewRatio`、`SplitViewContext` 焦点管理） | `app/components/SplitView/index.tsx`、`app/utils/splitView.ts` | 双语场景直接复用其视觉语言与拖拽实现；但双语需要**联动**（结构同步），所以新建专用 Scene 而不是把两份独立文档拼起来 |
| **浮动选区工具条**（SelectionToolbar 插件 + Portal 定位 + 菜单描述符 `selectionToolbarMenus()`） | `app/editor/extensions/SelectionToolbar.tsx`、`app/editor/components/FloatingToolbar.tsx`、`app/editor/menus/formatting.tsx` | 翻译入口 A：在既有选区工具条加「翻译」菜单项（低风险）；翻译入口 B：FluentRead 式小圆点（新插件） |
| **Diff 装饰插件**（`props.decorations` 高亮变更） | `shared/editor/extensions/Diff.ts` | （v1.1 已随语法模块移除其唯一消费方；装饰范式仍适用于未来扩展） |
| **Hocuspocus 协作**（每文档一条 WS `/collaboration/<docId>`、PersistenceExtension 3000ms 防抖落库） | `server/services/collaboration.ts`、`app/scenes/Document/components/MultiplayerEditor.tsx` | 双屏 = 两个 provider；两个文档各自实时协作保存，「保存两份」由协作落库天然完成 |
| **服务端缓存/限流/校验**（`CacheHelper.getDataOrSet`、`rateLimiter` 中间件、zod `validate`） | `server/utils/CacheHelper.ts`、`server/middlewares/rateLimiter.ts` | 翻译与校对代理端点直接套用（`server/routes/api/urls/urls.ts` 是现成范式） |
| **TeamPreference 机制** | `shared/types/team.ts`、`shared/constants.ts` | 功能开关（BilingualEditor / GrammarChecking 等）走工作区偏好 |
| 文档 `language` 列（ISO 639-1） | `server/models/Document.ts:419` | 中文副本直接打 `language: "zh"` 标记 |

### 2.2 FluentRead：移植资产清单

> 结论：**不引入扩展运行时，只移植「框架无关的纯逻辑」+ 按其接口重新实现服务端 provider**。该项目的 userscript 构建（`userscript/main.ts`）已经证明了核心逻辑可以在非扩展环境运行，只需替换 `platform/` 端口（fetch / storage / UI）。

| 要移植的东西 | FluentRead 参考文件 | 在本设计中的落点 |
| --- | --- | --- |
| 触发模式定义（icon / dot / hover / direct / 快捷键） | `src/core/config/catalog.ts:580`、`src/features/selection-translation/ui/SelectionTranslator.vue:233` | `TranslationTrigger` 设置（v1：dot + selection 两种） |
| 选区"落定"延迟与定时器版本化（防止选区抖动反复弹出） | `SelectionTranslator.vue:750-771`、`src/features/selection-translation/core.ts:120-127` | `HoverTranslatePlugin` 的呈现延迟逻辑 |
| **圆点定位算法**：正向前选取末行右缘、反向取首行、视觉视口钳制（桌面 14px / 触屏 28px 内边距） | `core.ts:465-468`（`chooseSelectionRect`）、`SelectionTranslator.vue:960-1011`（`updatePosition`） | `FloatingDot` 组件（Portal + `coordsAtPos`） |
| 弹层定位算法：优先上方、10px 间距、12px 视口安全边、打开后冻结锚点、可拖动 | `core.ts:474-497`（`calculateSelectionPopupPosition`）、`SelectionTranslator.vue:833-951` | `TranslatePopover` |
| 单词判定与归一化（折叠弯引号 `'`、连字符词、≤64 字符） | `src/features/selection-translation/services/wordNormalization.ts` | 悬停翻译的 word card 判定 |
| 忽略自家 UI / 不可翻译区域（`notranslate`、input、contenteditable） | `core.ts:435-460` | 插件事件过滤 |
| 目标语言防呆（选区已是目标语言则跳过；纯中文选区不译） | `src/core/language/detect.ts` | 服务端+客户端双重判断 |
| Provider 接口形态（函数式、`abortSignal`、批量文本、配置快照注入） | `src/services/translation/types.ts`、`src/providers/translation/registry.ts` | 服务端 `TranslationProvider` 接口（改为服务端实现，密钥不出网） |
| 免费池 + 加权降级 + 冷却恢复 | `src/core/config/freeTranslation.ts:12-27`、`src/services/translation/freeFallback.ts` | 服务端 fallback 链（v1 精简为 2-3 个） |

**不可移植 / 不移植**：Shadow DOM 挂载（我们有 React Portal）、IndexedDB 缓存（改 Redis）、词库 ECDICT 大 JSON（v1 不做词典卡，v1.5 再议）、40+ 服务商目录（v1 只做 3 类，见 §7.2）。

### 2.3 languagetool：已移除

> v1.1：基于 LanguageTool sidecar 的语法校对模块已整体移除（详见文首变更记录）。原 §2.3 的 LT API 契约与集成调研不再维护。

---

## 3. 总体架构

```
┌──────────────────────────── 浏览器（React + MobX + ProseMirror）────────────────────────────┐
│                                                                                            │
│  BilingualScene（/doc/:slug/bilingual）                                                     │
│  ┌───────────────────────────┐   结构镜像(本地事务)   ┌───────────────────────────┐          │
│  │ EN 编辑器                  │ ───────────────────────▶ │ CN 编辑器                  │          │
│  │ DocumentEditor + 双扩展:   │      段落翻译(经API)      │ DocumentEditor             │          │
│  │ · HoverTranslatePlugin    │ ◀─────────────────────── │ （结构被动跟随）            │          │
│  └────────────┬──────────────┘                          └────────────┬──────────────┘          │
│               │ 选中/悬停                                                │                   │
│               ▼                                                         ▼                   │
│        TranslatePopover                                          镜像写入高亮               │
│               │ fetch                                                                  │
└───────────────┼────────────────────────────────────────────────┬─────────────────────────┘
                │ /api/*（Koa, JWT）                              │ /collaboration/<docId> ×2
┌───────────────▼──────────────────────────── Outline Server ─────▼─────────────────────────┐
│  routes/api/bilingual      routes/api/translations                                       │
│  （文档对 CRUD、状态持久化） │ （provider 注册表+代理）                                        │
│        │                         │  Redis 缓存(CacheHelper)                               │
│        ▼                         ▼                                                        │
│  bilingual_pairs 表        TranslationProvider×N                                          │
│  （EN/CN 链接+块状态）      （OpenAI兼容/DeepL/免费池）                                      │
│  TeamPreferences / env      密钥仅存服务端 env                                              │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

**三条铁律**（后面所有设计的出发点）：

1. **EN 是结构唯一权威**：结构（块的数量/类型/顺序）只允许从 EN 单向镜像到 CN；CN 上用户只改「块内文本」，不改结构。这把「CN 也能编辑」与「结构一致」这对天然冲突（原需求的设计漏洞）收敛成一个明确规则。
2. **所有第三方调用走服务端**：翻译是 Outline API 端点；API key 只存在服务端 env / 加密配置。
3. **协作能力继承 Outline 现状**：两份文档都是普通 `Document` 行，靠 Hocuspocus 自动保存——不做新的「保存」按钮，双语创建的那一刻即产生同名两份。

### 3.1 为什么不做成 `plugins/` 插件

Outline 的插件系统：服务端有 `Hook.API`（可挂路由）、`SearchProvider`、`Task` 等；**客户端只有 Settings/Imports/Icon 三个 hook，没有 editor 扩展、scene、侧边栏入口的挂载点**（`app/utils/PluginManager.ts`）。因此：

- 翻译代理 → **可以**做成 `plugins/translation/server`（挂 API 路由）；
- 双语场景、编辑器扩展 → **必须改 core**（`app/editor/extensions`、`app/scenes`、`app/routes`）。

本设计按「一个内聚模块」组织代码（§10/§11 的文件清单），服务端部分保持可拆成 plugin 的形状，等 Outline 客户端 hook 扩展后再迁移。

---

## 4. 数据模型设计

### 4.1 新表 `bilingual_pairs`

评估过三个方案：① `Document` 加自引用列（改动热表，双向链接易失同步）；② 复用 `relationships` 表（含 `userId`、语义是 backlink/similar，`findSourceDocumentIdsForUser` 已废弃，强塞会污染语义）；③ 独立新表。**选 ③**：不动 Document schema、可承载块状态、迁移最安全。

```
bilingual_pairs
  id                 UUID PK
  team_id            UUID NOT NULL FK teams          -- 索引: idx_bilingual_pairs_team
  source_document_id UUID NOT NULL UNIQUE FK documents  -- EN（左侧、结构权威）
  target_document_id UUID NOT NULL UNIQUE FK documents  -- CN（右侧、镜像）
  source_language    VARCHAR(5) NOT NULL DEFAULT 'en'
  target_language    VARCHAR(5) NOT NULL DEFAULT 'zh'
  block_states       JSONB NOT NULL DEFAULT '[]'     -- 见 4.2
  created_at / updated_at / deleted_at (paranoid)    -- 软删，与 Document 一致
```

- 两个 FK 都 `UNIQUE`：一篇文档最多属于一个双语对（创建/移动时命令层校验）。
- 不设双向列：`target → source` 查一次 `WHERE source_document_id = ?`（有唯一索引）即可，避免双向失同步。

### 4.2 `block_states`：块级翻译状态（防覆盖的核心）

与 EN 顶层块按下标平行的数组，**只在服务端持久化，客户端缓存于内存**：

```ts
interface BilingualBlockState {
  status: "empty" | "pending" | "auto" | "manual" | "stale" | "failed" | "skipped";
  enHash: string;      // 最近一次成功翻译时 EN 块文本 sha256（前 16 位）
  autoText: string;    // 最近一次自动写入 CN 的文本（用于判「是否被人工改过」）
  error?: string;      // failed 时的原因
}
```

状态机（每个块独立）：

```
           EN 块文本变化(防抖后)
 empty ────────────────▶ pending ──翻译成功──▶ auto ──CN 被人工修改──▶ manual（永不自动覆盖）
                           │ 翻译失败 ▼            │ EN 再变化且 CN 文本==autoText        │
                           └──▶ failed             ▼                                    │
                                                    auto（可安全覆盖）◀──「重新翻译」确认──┘
auto + EN 变化 + CN 文本 != autoText ──▶ stale（提示「英文已更新」+ 一键重译）
代码块/空块 ──▶ skipped（不翻译不校验）
```

关键规则：**自动翻译只在「CN 块当前文本 === autoText」时才允许覆盖**（即上一次也是机器写的）；否则进入 `manual`/`stale`，只能用户手动确认重译。这一条规则同时解决了「人工编辑被覆盖」「多端同时写」两个问题。

### 4.3 文档对在文档树中的形态（同名两份）

- 创建时机：`bilingual.create` 在**一个事务**里 `documentCreator` 两次（EN + CN），CN 复制 EN 的 `title`（同名）、`collectionId`、`parentDocumentId`；若 EN 已发布则把 CN `publish` 到集合中 EN 的**紧邻下一位**（`collection.documentStructure` 插入）。EN 是草稿则 CN 同为草稿（`collectionId=null`）。
- CN 文档：`language: "zh"`、`icon` 固定用一个中文标记色（复用文档 `color` 列），正文为空。
- 重名问题：Outline 允许同名（urlId 唯一即可）；侧边栏、面包屑、搜索结果、文档列表统一渲染**语言徽标**（`EN` / `中`，纯文字徽标，见 §9.3）消歧。
- 协作保存：两份文档各自走 Hocuspocus `PersistenceExtension` 自动落库（debounce 3s）——用户理解的「保存的时候保存成两份」在 Outline 语义下就是「创建时成对生成，之后各自实时保存」。

### 4.4 配置模型（v1.2 整合后）

配置分三层，**唯一管理入口是 `Settings → AI`**（`/settings/models` 已重定向至此）：

**① 环境（env）** —— 自托管兜底与静态服务商默认值：

```bash
TRANSLATION_PROVIDER_ORDER=openai-compatible,deepl,microsoft-free  # 静态回退链顺序
OPENAI_BASE_URL=            # OpenAI 兼容端点兜底（网关与 AI 页凭据均未配置时）
OPENAI_API_KEY=
OPENAI_TRANSLATION_MODEL=gpt-4o-mini
DEEPL_API_KEY=              # deepL 官方 API（含 free :fx 后缀 key）
```

**② 工作区（team）** —— 管理员在「AI 服务」页配置：

- `TeamPreference.BilingualEditor`（默认 `true`）：双语编辑开关
- `TeamPreference.TranslationModel` / `ProofreadModel`（`mp:{uuid}` 绑定）：翻译 / 校对绑定的模型网关，空 = 自动路由
- 表 `team_model_providers`（+ `team_model_provider_models`）：任意协议模型网关（凭据加密存储、模型清单、连接测试）
- 表 `team_ai_configs`：静态服务商凭据（`openai-compatible` / `deepl`），`isDefault` 将该服务商提到翻译回退链最前

**③ 用户（user preference）** —— 个人偏好，跨设备同步（`app/utils/bilingual/prefs.ts` 统一读写）：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `bilingualTranslationTrigger` | `off` | 划词翻译触发模式（off/dot/hover） |
| `bilingualAutoTranslate` | `true` | 双语视图打开时自动翻译 |
| `bilingualProofreading` | `false` | 纠错模式（选中即查）开关 |
| `bilingualTargetLang` | `zh` | 划词翻译卡目标语言 |
| `bilingualTranslationProvider` | `""` | 划词翻译卡服务商覆盖（空 = 自动） |

**解析链（v1.2 统一后）**：校对 `resolveChatChannel` = 绑定网关 → 启用网关 → **AI 页 `openai-compatible` 凭据** → env 兜底；翻译 = 请求覆盖（用户偏好）→ 绑定网关 → 启用网关 → 默认静态服务商 → 静态回退链。已删除：`BILINGUAL_EDITOR_ENABLED` 环境变量、`TeamPreference.TranslationTrigger`（均无消费者）。

### 4.5 迁移

`yarn db:create-migration --name=create-bilingual-pairs`（产物 `server/migrations/<ts>-create-bilingual-pairs.js`）：

- `up`：`createTable("bilingual_pairs", ...)`，`teamId/index`、两个 `unique` FK，JSONB 默认 `[]`；**不放事务外操作**，`down`：`dropTable`。仅新表，无 Document 列变更——回滚零风险。

---

## 5. API 设计

全部挂到 `server/routes/api/` 现有约定：`auth()` → `rateLimiter(...)` → `validate(T.XxxSchema)`（zod, `BaseSchema`）→（需要写库时）`transaction()` → command → presenter。返回 `{ data, policies }`。

| 端点 | 方法 | 说明 | 限流 |
| --- | --- | --- | --- |
| `bilingual.create` | POST | `{documentId?}`（对已有文档开启）或 `{title, collectionId?, parentDocumentId?, publish?}`（新建）。事务内创建两文档+pair，返回 `{ pair, source, target, policies }` | 10/min |
| `bilingual.info` | POST | `{documentId}` → 该文档所在 pair（含 blockStates 摘要）；无则 `{pair:null}` | 60/min |
| `bilingual.list` | POST | 当前团队全部 pair（含两侧标题/集合/同步状态摘要），供「双语写作」首页 | 60/min |
| `bilingual.updateState` | POST | `{pairId, blocks: BilingualBlockState[]}`，客户端镜像引擎持久化块状态 | 120/min |
| `bilingual.realign` | POST | `{pairId}`：服务端按 EN 顶层结构重建 `block_states`（修错位） | 10/min |
| `translations.providers` | POST | 已配置服务商列表（**不含密钥**）+ 默认链 | 60/min |
| `translations.translate` | POST | `{text?, texts?, from?, to, provider?}`；单条≤8000 字符、批量≤50 条；命中 Redis 缓存直接返回 `{results:[{text, provider, cached}]}` | 60/min/user + 每日配额 |

要点：

- **zod schema**（`server/routes/api/bilingual/schema.ts` 等）严格 `unknown` 白名单；`texts[]` 每条 `string().max(8000)`，数组 `max(50)`。
- **缓存**：`CacheHelper.getDataOrSet`，key 用 `RedisPrefixHelper` 前缀 + `sha256(provider|from|to|text)`，翻译 TTL 24h。
- **每日配额**：`RateLimiterStrategy` 新增 `FiftyPerDayPerTeam`（Redis 计数），免费翻译上游被限流时熔断降级到下一个 provider。
- **安全**：见 §12 P0-5。

---

## 6. 双语同步引擎（核心算法）

### 6.1 块的定义

**块 = EN 文档的顶层节点**（paragraph / heading / 代码块 / 引用 / 列表节点整体 / 表格…）。列表的增删列表项属于「块内内容变化」（触发整块重译），不触发结构镜像——v1 有意为之：顶层 diff 才是低歧义、可镜像的操作面；列表项级对齐放到 v2。

### 6.2 结构镜像：EN 顶层 diff → CN 索引操作

**谁来做**：只有**发起 EN 变更的那个客户端**镜像自己的事务（ProseMirror 里 `transaction.local === true` 才处理；远端 Yjs 同步进来的 `local === false` 跳过）。这样任意时刻每个结构变更恰好被镜像一次，CN 文档用 CRDT 合并多端写入。

**怎么做**（每个 EN 本地事务，防抖 300ms 合并后执行）：

```
old = 上次快照的 EN 顶层块序列 [{type, textLen}]
new = 本次事务后的 EN 顶层块序列
ops = diffBlocks(old, new)        // 简单 LCS（按 type 对齐 + 相邻插入/删除合并），附录 A
for op in ops（必须按索引从大到小应用，同理 fix-all 倒序）:
  insert(i, type) → 在 CN 文档顶层 i 处插入同类型空块（heading 保持 level）
  remove(i)       → 删除 CN 顶层块 i，并同步 block_states.splice(i,1)
  replace(i, t1→t2)（如段落变标题，罕见）→ CN 同步替换节点类型，标记该块 stale
应用后：CN 块数 == EN 块数？ 否 → 本地立即自愈（按 6.5 补/删），并上报 realign
```

镜像写入 CN 用的是**普通 ProseMirror 事务**（经 CN 编辑器的 view dispatch）→ 走 y-prosemirror → CRDT 广播 → 其他端自动收到。**不直接操作 Yjs**，保证 undo/重渲染一致。

### 6.3 内容翻译管线（EN 块文本 → CN 块文本）

```
EN 事务后，对文本变化的块（跳过 codeFence/空块）:
  防抖 1500ms（打字连续输入时合并）/ 失焦立即
  → 块文本抽取（node.textContent，UTF-16）
  → POST /api/translations.translate {texts:[...], to:"zh"}
  → 响应回来先复核: EN 块 hash 未变？未变才继续
  → 读 block_states[i]: status ∈ {empty,auto} 且 CN 块当前文本==autoText
       且 CN 该块当前无光标焦点 → dispatch 替换 CN 块内容（纯文本, 保留块类型）
  → 更新 block_states[i] = {status:"auto", enHash, autoText}
  → 每完成 N 块（或 5s）批量 POST /api/bilingual.updateState 持久化
```

手动重译入口：块状态 chip（`stale`/`manual`）上点「重新翻译」→ 确认覆盖 → 强制走一遍管线（忽略 manual 保护一次）。

### 6.4 多用户与并发

- 同一 EN 文档多人协作：各自的本地事务各自镜像 → CN 收到多次小操作，CRDT 合并；**索引插入的并发竞态**（两人同时在第 3 块后插入）可能导致 CN 顺序与 EN 不一致——**接受此风险**（低频），靠 §6.5 自愈 + 「结构不一致」告警条兜底。
- CN 侧手动编辑与其他端自动写入冲突：CRDT 合并不会丢字；状态机保证不会覆盖 `manual`。

### 6.5 一致性校验与自愈

BilingualScene 挂载时 + 每 30s：比对 EN/CN 顶层块数与类型序列。不一致 → 顶部黄色告警条「双语结构不一致 [重新对齐]」→ `bilingual.realign`：以 EN 为准，CN 多的块删除、少的块补空块（带确认，避免误删人工内容——删除前 diff 展示）。

### 6.6 从已有文档开启双语

`bilingual.create {documentId}`：创建空 CN 副本 → 打开双语场景 → 立即触发全篇翻译管线（批量、带进度条，走 `translations.translate` 批量端点，逐块写入并持久化状态）。翻译完成前 CN 块显示 `pending` 骨架。

---

## 7. 翻译模块（FluentRead 移植）

### 7.1 客户端交互规格

**触发 A：选区翻译（默认关闭，通过文档头部全局开关或设置开启）**
- 选区"落定"后 250ms（FluentRead 的 settle 延迟 + 版本化定时器），在选区末行边缘出现 **8px 圆点**（触屏保持 44px 命中区，视觉仍是 8px——FluentRead 用 `::after` 画点的做法）。
- 定位：正向前选取取**最后一个 clientRect** 的右缘外 14px、`rect.bottom` 对齐；反向选取取首行左缘；钳制在视口内（安全边距 14px，触屏 28px）。坐标来源用 ProseMirror `view.coordsAtPos(selection.to)`（比 DOM Selection 更贴近编辑器坐标系）。
- 点击圆点 → `TranslatePopover`。

**触发 B：悬停单词（设置开启 `TranslationTrigger=hover` 时）**
- `mouseover` rAF 节流（150ms），命中文本节点 → 用光标 PM 位置取所在词（正则 `[A-Za-z]+([-'][A-Za-z]+)*`，折叠弯引号——直接移植 FluentRead `wordNormalization.ts`）；悬停 500ms 出圆点。
- 悬停单词 + 目标语言为中文 → 走词典卡样式（单词、音标占位、词义列表——v1 用翻译 API 返回多义项，格式约定见下）；悬停句子/选区 → 走普通翻译卡。

**TranslatePopover（卡片）**：

```
┌────────────────────────────────────────┐
│ 原 EN · 检测 English      [服务商 ▾] ✕ │   ← 服务商下拉=服务端已配置列表
│ ┌────────────────────────────────────┐ │
│ │ disfluencies, and maintain         │ │   ← 原文（选区回显）
│ └────────────────────────────────────┘ │
│ 不流畅之处，并确保整个文档中使用的术语   │   ← 译文（加载中=骨架 shimmer）
│ 保持一致。                              │
│ [🔊] [⧉复制] [↥写入中文段]              │   ← 写入中文段=写入 CN 文档对应块
└────────────────────────────────────────┘
```

- 定位：优先锚点行上方（放得下），否则下方；间距 10px、视口安全边 12px；**打开后冻结锚点**（滚动/编辑不跟随，Esc 或点击外部关闭）——全部照搬 FluentRead `calculateSelectionPopupPosition`。
- Portal 渲染到 body（`PortalContext` 已有），`z-index` 用 `depths` token。

### 7.2 服务端 Provider 抽象（v1 三类）

```ts
interface TranslationProvider {
  id: string;
  label: string;                       // 显示名（i18n key）
  maxBatch: number;
  translate(req: {
    texts: string[]; from?: string; to: string;
    signal: AbortSignal;
  }): Promise<{ results: string[]; detectedFrom?: string }>;
}
```

| v1 Provider | 实现 | 备注 |
| --- | --- | --- |
| `openai-compatible` | OpenAI 兼容 chat 端点，system prompt 约束逐段返回 JSON 数组（支持 deepseek/自建网关，改 `OPENAI_BASE_URL` 即换） | 上下文质量最好；批量分段；失败重试 1 次 |
| `deepl` | 官方 REST `v2/translate`（天然支持批量 `text[]`） | 稳定、便宜；key 含 `:fx` 自动走 free 域名 |
| `microsoft-free` | FluentRead 同款 Edge 免费端点（server 端用 undici 实现） | **仅作免费兜底**，加权降级链的最后一环；上游不可控，失败静默切换 |

链式降级按 `TRANSLATION_PROVIDER_ORDER` 顺序尝试；每次失败记录冷却（60s 内不再首试），可观测（日志 + `translations.providers` 返回各 provider 最近健康态）。

词典卡数据约定：`openai-compatible` 的 prompt 对「单英文单词」返回 `{ word, phonetic?, senses: [{pos, meaning}] }` JSON；其余 provider 返回纯文本译文时前端隐藏词典样式降级为普通卡。

### 7.3 与双语模块的联动

Popover 的「写入中文段」：当前选区在 EN 块 `i` 内 → 直接把译文写入 CN 块 `i`（等价一次强制 auto 写入，更新 `block_states[i]`）。这是三个模块咬合的关键交互。

---

## 8. 语法校对模块（v1.2 已按 FluentRead-Go proofread 模式重新实现）

> v1.1：LanguageTool 集成移除，留位给自定义 LLM 纠错。**v1.2（2026-11-04）已实现**，方案为 FluentRead-Go proofread 模式移植：
>
> - **服务端**：`server/routes/api/proofread/`（`proofread.check`，限流 25/min，Redis 缓存按绑定的纠错模型分域，TTL 1h）+ `server/services/proofread/`（system prompt 移植 FluentRead-Go：只输出 JSON、original 必须逐字子串、类别枚举 spelling/grammar/punctuation/style/word_choice、教学理由、不整段重写；服务端逐条校验丢弃不合规建议；CJK 短路返回空）。
> - **模型配置**：新表 `team_model_providers`（多供应商行，协议 openai/anthropic/gemini，密钥 AES 加密存 keyHint 尾 4 位）+ 协议适配层 `server/services/ai/adaptors/`（移植 FluentRead-Go adaptor，含 base URL 版本段检测、Anthropic 温度钳制、Gemini 安全档位）+ 设置页「模型供应商 / 模型绑定」（`aiModelProviders.*` API，测试连接/拉模型/启停；翻译与纠错经 TeamPreference `translationModel`/`proofreadModel` 分开绑定）。
> - **编辑器**：`app/editor/extensions/Proofread.tsx`（选区工具条「Grammar check」项 + 文档头部按钮，无选区时检查光标所在顶层块；AllSelection 钳制到首块）+ `ProofreadPanel.tsx` 浮动面板（类别色标签、红删除线→绿建议、教学理由、逐条采纳/忽略；采纳 = 块内第一次出现处替换 + 600ms 高亮渐隐，剩余建议对更新后文本重新校验；全部处理完自动关闭并 toast）。
> - 测试：`server/services/proofread/validate.test.ts`、`server/services/ai/adaptors/index.test.ts`、`app/utils/proofread/findFragment.test.ts`。

---

## 9. UI/UX 设计规范

> 遵循 ui-ux-pro-max 检索结论：产品型工具 + Minimalism/Swiss（与 Outline 既有视觉一致）；不引入新字体（Outline 既有字体栈优先于技能建议的 Atkinson Hyperlegible）；动效 150–250ms；对比度 ≥4.5:1；`prefers-reduced-motion` 支持；可点击元素 `cursor: pointer`；图标用 Outline 既有 outline 图标族（不用 emoji 做结构图标）。

### 9.1 双语场景布局

宽屏（≥1024px）：

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 面包屑 …/PRD-2026      [EN ⇄ 中]   ● 已同步   [译▾] [退出双语]                 │ ← BilingualHeader
├───────────────────────────────────────┬┬─────────────────────────────────────┤
│  EN · 结构权威                          ││  中文 · 可自由编辑                    │
│                                       ││                                     │
│  # Product Plan                       ││  # 产品计划                          │
│  Intro paragraph …                    ││  简介段落……              [自动]      │ ← 块状态 chip 悬停显示
│  every one , can …                    ││  大家好，你们……          [人工]      │
│                        ●              ││                                     │ ← 翻译圆点（选区末行缘）
│                                       ││                                     │
│        （分隔条 4px，可拖拽，双击复位 50%） ││                                     │
├───────────────────────────────────────┴┴─────────────────────────────────────┤
└──────────────────────────────────────────────────────────────────────────────┘
```

- 分隔条复用 SplitView 的 `useResizeHandle` 交互（拖拽比例本地持久化，等价 `ui.splitViewRatio` 的做法）。
- 窄屏（<768px）：上下两栏 + 底部 [EN|中文] 切换 Tab（不并排；悬停翻译自动禁用，仅保留选区翻译）。
- 两侧标题栏常显，与 EN 保持同步：CN 标题 = EN 标题（编辑 EN 标题 → CN 同步更新；CN 侧标题只读，避免同名失联——这是「同名两份」约束的必然设计）。

### 9.2 颜色 / 状态 token 映射（全部走 `shared/styles/theme.ts` + `s()` mixin）

| 用途 | 亮色 | token | 暗色来源 |
| --- | --- | --- | --- |
| 卡片/面板背景 | — | `s("backgroundSecondary")` + `s("divider")` 边 | 自动 |
| 状态 chip：auto/empty | 中性灰 | `s("textSecondary")` | 自动 |
| 状态 chip：manual | 绿 | `s("noticeSuccessText")` | 自动 |
| 状态 chip：pending/stale | 蓝/橙 | `s("noticeInfoText")` / `s("noticeWarningText")` | 自动 |
| 状态 chip：failed/skipped | 红/灰 | `s("danger")` / `s("textTertiary")` | 自动 |
| 翻译圆点 | 主题蓝 8px（带 1px 白描边保证在深色正文上可见） | `s("accent")` | 自动 |

> 说明：FluentRead 圆点是品牌粉（#ef4b86）；宿主内改为主题 accent，保持 Outline 原生观感（如坚持粉色可做成偏好，不默认）。

### 9.3 语言徽标

侧边栏文档行、搜索结果、面包屑追加 14px 高、`border-radius: 2px`、`font-size: 10px` 文字徽标：EN 文档无徽标（默认），CN 文档显示 `中`（背景 `s("backgroundTertiary")`）。徽标数据来自 `document.language`，双语 pair 不需要额外字段。

### 9.4 动效

- 圆点出现：150ms fade + 2px 上浮；消失 100ms（退出快于进入）。
- Popover：180ms ease-out scale(0.97→1)+fade；关闭 120ms。
- `prefers-reduced-motion: reduce` 时全部降为纯 fade 或瞬时。
- 状态 chip 变化：颜色过渡 150ms，不位移（技能「稳定交互状态」规则）。

### 9.5 键盘与 a11y

- 圆点/卡片全部可达：`Tab` 焦点顺序 EN 编辑器 → 圆点 → 头部按钮 → 分隔条 → CN 编辑器；卡片 `role="dialog"` + `aria-label`，Esc 关闭并归还焦点到编辑器光标处。
- 翻译圆点 `aria-label="翻译选中文本"`；触屏 44px 命中；焦点环用 `s("accent")` 2px outline。
- 写入镜像结果用 `aria-live="polite"` 播报。

### 9.6 设置页

工作区设置 → 功能（新 section「双语写作」）：总开关（BilingualEditor）、翻译触发方式、翻译服务商下拉（读 `translations.providers`）。文档级临时开关在 BilingualHeader。

---

## 10. 前端实现清单

| 动作 | 文件 | 内容 |
| --- | --- | --- |
| 新增 | `app/scenes/Bilingual.tsx` | 「双语写作」首页（pair 列表 + 新建入口） |
| 新增 | `app/scenes/BilingualDocument.tsx` + `components/Bilingual*` | 分屏场景：Header、双编辑器、分隔条、同步状态、告警条 |
| 修改 | `app/routes/authenticated.tsx`、`app/routes/scenes.ts`、`app/utils/routeHelpers.ts` | 新路由 `/doc/:documentSlug/bilingual`、`/bilingual`（lazy + preloadEditor） |
| 修改 | `app/actions/definitions/documents.tsx`、`app/menus/DocumentMenu.tsx` | 「双语编辑/开启双语」Action（policy: update） |
| 修改 | `app/components/Sidebar/App.tsx` | 「双语写作」入口（受 TeamPreference.BilingualEditor 门控） |
| 新增 | `app/editor/extensions/HoverTranslate.tsx` | 圆点 + 选区/悬停触发（参照 SelectionToolbarExtension 结构） |
| 新增 | `app/editor/components/TranslatePopover.tsx` | 翻译卡片（定位算法移植自 FluentRead core.ts） |
| 修改 | `app/editor/menus/formatting.tsx` | 选区工具条加「翻译」项（触发 A 的低风险入口） |
| 新增 | `app/stores/BilingualStore.ts`、`TranslationStore.ts` | MobX 状态（镜像引擎、providers、缓存） |
| 新增 | `shared/types/bilingual.ts` | pair / blockState / API 载荷类型（前后端共用） |
| 新增 | `app/utils/bilingual/*.ts`（纯函数，重点测试对象） | `blockDiff.ts`、`wordNormalize.ts`（移植）、`statusMachine.ts` |

---

## 11. 后端实现清单

| 动作 | 文件 | 内容 |
| --- | --- | --- |
| 新增 | `server/models/BilingualPair.ts` | §4.1 模型 + 关联 |
| 修改 | `server/storage/database.ts` | 注册模型关联 |
| 新增 | `server/migrations/<ts>-create-bilingual-pairs.js` | §4.5 |
| 新增 | `server/commands/bilingualCreator.ts`、`bilingualPairDeleter.ts`、`bilingualRealigner.ts`、`documentUpdater` 内 hook | 事务化创建/级联/重对齐；`documentDeleter`/`documentMover` 中处理配对级联（见坑 12-4） |
| 新增 | `server/routes/api/bilingual/{bilingual.ts,schema.ts,index.ts}` | §5 端点 |
| 新增 | `server/services/translation/{types.ts,registry.ts,providers/*.ts}` | §7.2（形状按 plugin 可拆设计） |
| 新增 | `server/routes/api/translations/{translations.ts,schema.ts}` | 代理 + 缓存 + 配额 |
| 修改 | `docker-compose.yml`、`.env.example`、`server/env.ts`、`app/env.ts` | §4.4 |
| 修改 | `shared/constants.ts`、`shared/types/team.ts` | TeamPreference |
| 修改 | `server/policies/document.ts`（如需要） | `bilingual.create` 复用 `update`/`createChildDocument` 能力，不新增 policy 类型 |

---

## 12. 坑与设计漏洞清单（每条：现象 → 根因 → 解法）

> P0 = 丢数据/功能不可用；P1 = 明显缺陷/性能；P2 = 体验/打磨。**这是本文档最重要的章节。**

**P0**

1. **自动翻译覆盖人工修改**。解法：§4.2 状态机（`autoText` 对比 + `manual` 终态 + 焦点暂停 + 重译需确认）。验收：手改 CN 块后改 EN，CN 不变且出现 stale 提示。
2. **装饰/翻译状态写进共享文档**。根因：误把 DecorationSet 或状态存进 Yjs/文档 attr → 所有端互相污染、历史版本带垃圾。解法：装饰只存在于 PluginState（客户端本地）；`block_states` 只落 `bilingual_pairs` 表。
3. **过期响应回写**（连续打字时先发后至）。解法：块文本 hash 复核（§6.3）。
4. **删除/移动/归档单侧文档破坏配对**。解法：`documentDeleter/documentMover/archive` 前置检查 pair：默认**成对操作**（二次确认列出两份文档）；CN 侧 DocumentMenu 隐藏「移动」等破坏性项。pair 悬空（手删库等边缘）→ `bilingual.info` 返回 `pair:null` 自愈展示。
5. **SSRF / 密钥泄漏**。解法：翻译 key 仅服务端 env；`translations.providers` 不回显密钥；上游响应透传前过滤非白名单字段，避免把内部信息暴露。
6. **翻译写入 CN 时该块正被（其他端）人工输入**。解法：写入前重读 CN 块文本并二次比对 `autoText` + 该端焦点检查（§6.3）；CRDT 保证不覆盖远端未同步编辑。

**P1**

7. **并发结构编辑错位**。解法：§6.2 local-only 镜像 + §6.5 校验自愈 + 顶部告警。
8. **双编辑器性能**（两个 HocuspocusProvider、两份 IndexedDB、双 Yjs）。解法：进入场景才挂载；离开即断开 provider（Outline MultiplayerEditor 已有销毁路径）；大文档先测 >1MB state 场景。
9. **翻译费用/上游限流**。解法：路由级 limiter + Redis 缓存 + 批量端点 + provider 冷却降级链。
10. **弯引号/撇号分词失败**。解法：移植 FluentRead `normalizeEnglishWord`（折叠 `’‘`、连字符词）。
11. **hover 翻译引发渲染风暴**。解法：rAF 节流 + 触发开关 + 命中即缓存 + 忽略自家 UI（`isExtensionSelection` 同款判断）。
12. **Popover 遮挡选区/被裁剪**。解法：FluentRead 钳制算法 + 打开冻结锚点 + body Portal + `depths` z-index。
13. **触屏交互冲突**（原生选区菜单）。解法：触屏 44px 命中 + 视口 28px 安全边 + 窄屏禁 hover 模式（§7.1/9.1）。
14. **两个编辑器的全局快捷键/焦点**。解法：复用 SplitView 的 pane focus 上下文；Find&Replace 等 app 级功能只在焦点 pane 生效；Tab 顺序显式管理。
15. **滚动联动眩晕与性能**。解法：默认关；开启时按顶层块顶部 rAF 对齐，不用像素逐帧同步。
16. **中文搜索失效**（PostgreSQL 触发器硬编码 `'english'`，CJK 连续串被切成一整块 token）。解法：v1 接受 + 文档说明（标题可搜、`document.language` 已标 zh）；v1.5 方案：为 zh 文档单独 `to_tsvector('simple', ...)` 列/触发器或引入 zhparser 插件——**不要在 v1 改全局触发器**（影响所有文档的索引重建）。
17. **同名文档歧义**。解法：§9.3 徽标 + CN 标题锁定随 EN（§9.1）。
18. **代码块/行内代码被翻译**。解法：管线跳过 `code_fence`/`code_inline`（状态 `skipped`；FluentRead 的 notranslate 思路）。
19. **列表被当多块拆分**。解法：§6.1 块=顶层节点（列表整块翻译），明确写进产品行为。

**P2**

20. 复制/模板不复制 pair（`duplicateDocument` 产物为普通单文档，面板提示「可开启双语」）。
21. 分享链接只分享单侧文档（v1 文档说明；v1.5 分享页加语言切换）。
22. 导出：v1 单侧导出维持现状；v1.5 ExportDialog 增加「双语对照（Markdown 表格）」。
23. i18n：全部文案走 `t()`（纯英文 key），**不要手动编辑 locale JSON**，跑 `yarn build:i18n` 提取（AGENTS.md 规则）。
24. 测试隔离：用了 `vi.mock`/`resetModules` 的 server 测试文件头加 `// @vitest-isolate true`；翻译上游用 MSW 模拟（`server/test/msw.ts`）；Sequelize 内存态不可信，断言前 reload。
25. 迁移安全：仅新表；`down` 完整；上线顺序=先迁移后发码。
26. a11y：§9.5 全清单；暗色主题下弹层对比度单独验证（不要只测亮色）。
27. 大文档：批量翻译上限 50 块/请求；**翻译整篇**走后台队列（Bull task）+ 进度条，避免 HTTP 超时。
28. 语言误判：目标为 zh 时跳过纯中文选区（FluentRead `shouldSkipChineseSelection`）。
29. Outline `Document.state` 列默认排除查询：双语场景加载 twin 用标准 loader（协作者预加载 scope），不要手写裸查询漏掉 membership 导致策略误判。

---

## 13. 实施里程碑

| 里程碑 | 内容 | 验收标准 | 估算 |
| --- | --- | --- | --- |
| M1 双语核心 | 迁移/模型、`bilingual.create/info/list`、BilingualScene（分屏/标题/徽标）、结构镜像+校验自愈 | 两端同屏编辑、结构增删镜像正确、并发编辑可自愈、同名两份落库 | 5–7 人日 |
| M2 翻译 | provider 注册表+3 provider、`translations.*`、圆点+Popover、写入中文段、批量整篇翻译（后台队列） | 悬停/选中触发流畅、断网降级、缓存命中、密钥零暴露 | 4–6 人日 |
| M3 打磨 | realign、设置页、i18n、a11y、暗色、窄屏、导出提示、测试补齐、文档 | §12 全表逐条过验收；lint/tsc/test 全绿 | 4–6 人日 |

合计约 **13–19 人日**（单人）。M1/M2 可并行。

---

## 14. 测试计划

- **纯函数单测**（重点，成本低收益高）：`blockDiff.ts`（插入/删除/移动/类型替换/并发序列）、`wordNormalize.ts`（移植后回归）、`statusMachine.ts`。
- **服务端 API 测试**（真 Postgres + MSW）：`bilingual.create`（含集合结构插入/草稿/权限拒绝）、配对级联删除、`translations.translate`（MSW 模拟 OpenAI/DeepL/免费池 + 降级链 + 缓存命中）。
- **客户端测试**：Popover 定位钳制（jsdom 下纯函数部分）。
- **手工 e2e 清单**：§12 每条坑的最小复现；375px/768px/1440px 三档；亮/暗主题；`prefers-reduced-motion`；双浏览器多用户并发。

---

## 15. 附录

### A. 顶层块 diff（伪代码）

```ts
type Block = { type: string; level?: number };
function diffBlocks(oldB: Block[], newB: Block[]): Op[] {
  // LCS on (type, level)；长度为 tie-breaker；合并连续插入/删除
  // 输出: {op:"insert"|"remove"|"replace", index, block?}[]，应用时按 index 降序
}
```

### B. 参考文件索引

- Outline：`app/components/SplitView/index.tsx`、`app/utils/splitView.ts`、`app/editor/extensions/SelectionToolbar.tsx`、`app/editor/components/FloatingToolbar.tsx`、`shared/editor/extensions/Diff.ts`、`server/services/collaboration.ts`、`server/commands/documentCreator.ts`、`server/utils/CacheHelper.ts`、`server/middlewares/rateLimiter.ts`、`shared/styles/theme.ts`
- FluentRead：`src/features/selection-translation/ui/SelectionTranslator.vue`（圆点/弹层/延迟）、`src/features/selection-translation/core.ts`（定位/过滤纯逻辑）、`.../services/wordNormalization.ts`、`src/core/config/freeTranslation.ts`、`src/services/translation/{types,freeFallback,broker,cache,queue,requestScheduler}.ts`、`src/providers/translation/registry.ts`、`userscript/main.ts`（无扩展运行证明）

---

## 16. 实现审计补充（v1.1 · 对照代码库逐项核实后的修正与落地细节）

> 本章为编码前的强制审计结果，与前文冲突处以本章为准。

| # | 审计项 | 核实结果 → 修正 |
| --- | --- | --- |
| 1 | 限流策略 | `RateLimiterStrategy` 是对象常量（`server/utils/RateLimiter.ts`），无按天策略；可用值：`FivePerMinute/TenPerMinute/TwentyFivePerMinute/OneHundredPerMinute/OneThousandPerHour/OneHundredPerHour/FiftyPerHour/TenPerHour/FivePerHour`。**§5 修正**：`bilingual.create`→`TenPerMinute`；`translations.translate`→`TwentyFivePerMinute`；「每日配额」取消，由缓存 + 每分钟限流 + provider 冷却降级覆盖 |
| 2 | 环境变量 | `server/env.ts` 为 Environment 类：字段 + class-validator 装饰器 + `this.toOptionalString(environment.X)`。新增：`TRANSLATION_PROVIDER_ORDER`（默认 `"openai-compatible,deepl,microsoft-free"`）、`OPENAI_BASE_URL`/`OPENAI_API_KEY`/`OPENAI_TRANSLATION_MODEL`、`DEEPL_API_KEY` |
| 3 | 路由注册 | react-router v5 `Switch`：在 `authenticated.tsx` 的 `/doc/${documentSlug}` 系列之后追加 `<Route path={`/doc/${documentSlug}/bilingual`} component={Scenes.BilingualDocument.Component} />`；`scenes.ts` 增加 `export const BilingualDocument = lazy(() => import("~/scenes/BilingualDocument"))`；`routeHelpers.ts` 增加 `bilingualPath(documentSlug)` |
| 4 | 分屏拖拽 | 直接复用 `~/hooks/useResizeHandle`（`measure`/`onResize`/`onResizeEnd`/`min`/`max`），SplitView 内部即用它；分隔条交互无需新写 |
| 5 | 前端 Store 归置（**修正 §10**） | 不注册进 RootStore（避免大改核心装配）：`BilingualStore`/`TranslationStore` 为独立 MobX store，在双语场景内实例化并经 React Context 下发；编辑器扩展通过构造参数接收回调，不读全局 |
| 6 | 编辑器复用（**修正 §10**） | 每个 pane 直接挂 `AsyncMultiplayerEditor`（`app/scenes/Document/components/AsyncMultiplayerEditor`，props = `EditorProps & { id }`，内部按 id 建 provider）；**不**复用完整 `DocumentEditor`（其 DocumentContext/评论/标题机制与双实例冲突）。双侧标题为独立受控输入，CN 侧只读、随 EN 同步 |
| 7 | 删除级联（补充 §12-4 落点） | Outline 无独立 `documentDeleter` 命令：软删在 `documents.delete` 路由内 `document.destroyWithCtx(ctx)`（`server/routes/api/documents/documents.ts:1698`）。落点：该路由软删/永久删除分支前检查 pair，经 `bilingualPairDeleter` 在同一事务内连删 twin + pair（软删）；永久删除路径同样清理 pair 行 |
| 8 | 校验/呈现 | schema 用 `BaseSchema.extend({ body: z.object({...}) })`（参考 `DocumentsCreateSchema`）；响应 `{ data: {...presentDocument(x)}, policies: presentPolicies(...) }` |
| 9 | 验收访问 | 开发机无 `local.outline.dev` hosts/证书；验收启动用 `URL=http://localhost:3000` 覆盖（不改动 `.env.development` 既有配置，仅追加新变量） |
| 10 | i18n | 新组件文案全部 `t("...")`（纯英文 key），提取靠 `yarn build:i18n`，不手动编辑 locale JSON |
| 11 | 依赖环境 | yarn 4.18（corepack 托管，`corepack yarn <cmd>`）；postgres/redis 容器已运行（`outline-postgres-1`/`outline-redis-1`） |

---

## 17. 实施状态与验收（v1.1 · 已实施）

**分支**：`feat/bilingual-editor`（7 个 commit，`da9c7bcc2..bc6fe2ced`）。**质量门**：`yarn tsc --noEmit` 干净；oxlint 0 error；54 项测试全绿（44 纯函数单测 + 10 服务端 API 测试）；GLM 三轮代码审查（一轮 FAIL 2P0+4P1 → 全部修复；二轮 FAIL 4P1 → 全部修复；三轮 **PASS**）。**浏览器端到端冒烟已通过**：选区圆点+翻译卡（microsoft-free 免费端点）、双语分屏（结构镜像 + 两段自动翻译写入）、级联删除、防覆盖保护。**v1.1 补充**：语法校对模块已整体移除（见文首变更记录），移除后 `tsc`/`lint`/单测重新全绿。

### 验收方式

```bash
PORT=3100 URL=http://localhost:3100 corepack yarn dev:watch   # 后端 :3100，vite :3101
# 浏览器打开 http://localhost:3100（验证码邮件在 http://localhost:8025 Mailpit）
```

`.env.local` 保存了：`SECRET_KEY`、`UTILS_SECRET`、`TRANSLATION_PROVIDER_ORDER=microsoft-free`、`SMTP_HOST/PORT`（Mailpit）。

### 已知问题（v1 范围内接受，v1.5 处理）

| # | 问题 | 说明 |
| --- | --- | --- |
| 1 | MCP 工具与集合删除不经配对级联 | MCP documents 删除、Collection 整体删除（`server/models/Collection.ts:430`）绕过 `bilingualPairDeleter`，会留下 active pair + 孤儿 twin；垃圾箱永久删除时由 FK CASCADE 自愈（GLM 二轮 finding 6） |
| 2 | 单侧归档未处理 pair | 归档源文档时 twin 保持活跃，仅显示「结构不一致」横幅（可 repair） |
| 3 | 不可镜像类型（列表/表格/代码块）的 CN 侧为空占位 | 结构镜像 v1 保证顶层索引平行（同类型空节点，fallback paragraph），内容不自动填充，状态 `skipped`（设计 §6.1/§18 的既定范围） |
| 4 | 中文全文搜索失效 | PostgreSQL 触发器硬编码 `'english'` 配置（§12-16 既有限制，非本模块引入） |
| 5 | 弹层主题 | 翻译弹层使用基础亮/暗主题重建（挂载于 body，不继承自定义工作区主题） |
