# Research OS 架构与数据模型

## 运行边界

Research OS 是单用户、本地运行的 Web App。React 页面通过 Next.js Route Handlers 调用 Node 本地 API；服务只绑定 `127.0.0.1:3000`。API 使用 `lib/store.ts` 管理分模块 JSON 文件，不依赖外部数据库或服务。界面通过实体 ID 关联模块数据，不复制上层对象。

```text
浏览器 UI
   │ JSON 请求
   ▼
Next.js API ── 校验与领域规则
   │
   ▼
JSON Store ── 事务日志 / 崩溃恢复 / 本地快照
   │
   ▼
data/*.json
```

## 实体关系

- 任务代表一个交付成果，包含独立 `nextAction`、状态、优先级、截止日期和实际 `plannedWeek`。
- `primaryParent` 是任务主对象，仅允许课程、科研、论文、普通项目、竞赛或目标；任务可另有 `relatedRefs` 次要关联和 `milestoneRefs` 里程碑引用。
- 任务的 `planningState` 为 `inbox`、`needs_parent`、`week` 或 `later`。只有 `week` 计划必须有有效主关联和周一日期；未关联旧任务标记为 `needs_parent`，并显示在待分流区域。
- `Goal` 包含里程碑、证据和 `linkedItems`；任务不保存目标副本，而通过 `{ goalId, milestoneId }` 引用里程碑。
- `ResearchProject.paperIds` 与 `Paper.relatedResearchIds` 在存储边界双向维护。`Paper.source` 为 Zotero 等未来来源适配预留。
- 科研材料和研究代码路径属于 `ResearchProject.resources`，普通 `Project` 仅存放非科研个人项目或参考项目。
- `ProgressEvent` 是不可覆盖的进展流水，可引用任务、主对象和目标里程碑；总览/目标/科研视图按这些 ID 显示最近进展。
- 每个日期最多一条 `EveningReview`，修订号支持并发检测；`operationIds` 支持安全重试，避免重复建立论文或截止任务。
- `PersonalProfile` 保存用户主动确认的背景，不从模块名或模型推断真实事实。
- `AIConversation` 保存在 `data/ai-conversations/*.json`；消息记录模型渠道、引用、本轮成绩上下文授权，以及待审阅/已应用提案。

## 标识符与时间

新增实体 ID 使用类型前缀加随机 UUID 片段，例如 `task_…`、`pape_…`。关系判断只使用 `type + id`；可选 `label` 仅供展示，不当作数据源。普通日期是设置时区下的 `YYYY-MM-DD`；创建/更新时间为 UTC ISO 8601 字符串。周计划日期固定为当地日历周的周一。

Tag 当前是每个实体上的字符串数组，不维护冗余的全局标签实体。链接通过显式引用字段实现，不存储整段关联对象。

## JSON 文件

`data/` 每个模块一个文件：`profile.json`、`tasks.json`、`learning.json`、`research.json`、`papers.json`、`projects.json`、`competitions.json`、`goals.json`、`grades.json`、`reviews.json`、`progressEvents.json` 与 `settings.json`。AI 会话在 `ai-conversations/` 中拆分保存。业务数据格式可手工查看和 Git 对比；本地快照位于被忽略的 `data/.backups/`。

`settings.schemaVersion` 当前为 3。v1/v2 数据升级到 v3 前先制作带 SHA-256 清单的快照，再转换旧任务周分桶/关联、目标证据、复盘修订字段、成绩字段、个人档案和科研—论文双向关系。升级本身不清空数据。缺少必要文件时 Store 会停止并提示恢复，不会把缺失文件默认为空集合。

`settings.dataEpoch` 标识当前工作区代次，`dataRevision` 在业务变更时递增。初始化、整组恢复都会换发新 epoch；浏览器写请求携带 `x-research-os-epoch`，过期标签页、AI 草稿和今晚更新请求会被拒绝。初始化前必须完成可校验快照，否则不清理数据。恢复前也先备份当前库，并通过事务替换全部 JSON 与会话。

成绩主指标为百分制按学分加权平均；GPA 规则存在 `settings.gpa`，用户可编辑。待出分、合格制、免修、归档和手动排除的记录不进入均分/GPA。确认适用入学年份后才启用西财 2024 规则预设；同名重修课程不自动合并。

## 写入安全

单文件通过同目录临时文件 + rename 原子替换。跨文件更新先写 `.pending-transaction.json` 意图日志，再逐个原子替换相关文件，最后删除日志；启动读取时如发现日志，会先重放使事务完整。并发请求在进程内串行执行。

晚间复盘作为一个服务端事务统一修改任务、论文、截止事项、进展事件、复盘和重点顺序。相同 `operationId` 重试时不重复创建实体；旧复盘修订号不匹配时拒绝覆盖。浏览器本地草稿按 date + `dataEpoch` 隔离，不写入服务器，直到用户确认提交。

AI 提案不是业务数据库写入入口。模型输出先做结构验证；服务端 `dryRun` 对实体字段、状态、日期和同批 ID 引用执行完整校验但不写数据。仅用户确认的操作再次校验后通过事务应用，检查 `dataEpoch`、`dataRevision` 和幂等 `operationId`。永久删除、成绩写入、初始化、凭据和 Git 操作不属于助手的操作集合。

迁移、初始化、恢复、归档、永久删除前以及每次成功复盘后都创建带清单和摘要的 JSON 快照。复盘快照保留最近 30 份；快照不进入 Git。引用中的对象不能直接永久删除；仍有未完成关联任务的上层对象必须先处理相关任务。

## 模块边界

- `lib/types.ts` 定义实体及 API 输入的共享类型。
- `lib/domain.ts` 实现 GPA、搜索、周桶、截止排序、下一步回退、停滞判断和可解释重点推荐。
- `lib/validation.ts` 负责日期、状态、主/次关联、里程碑、GPA 规则以及删除保护。
- `lib/store.ts` 负责 JSON 读写、版本迁移、事务日志恢复、快照、关系同步和复盘提交。
- `lib/credentials.ts` 将订阅令牌与 API Key 放在项目目录外的用户专属凭据文件；使用原子替换和 Windows ACL/POSIX 文件权限，不返回凭据明文给浏览器。
- `lib/chatgpt-auth.ts` 实现官方 Sign in with ChatGPT 开源应用 OAuth/PKCE、环回回调、JWT/nonce/scope 校验、实际模型目录、串行刷新和撤销。
- `lib/model-runtime.ts` 使用锁定版本 `@earendil-works/pi-ai` 调用模型。订阅调用强制 `store:false`、流式响应，并仅把 `response.completed` 视为成功；失败不会自动切换 API。
- `app/api/` 只做请求解析和统一错误映射；所有本地写接口校验固定 Host/Origin 与 `dataEpoch`，不从 UI 直接改文件。
- `components/research-os.tsx` 负责页面和交互；当前 API 不做用户认证，因为只绑定本机回环地址，不对公网开放。

## 扩展点

- **Zotero**：`Paper.source` 可承载 provider、Library ID、Item ID 和同步元数据；未来导入层只需把 Zotero item 转换为现有 Paper 模型。
- **日历**：可将活动期限导入任务或扩展统一截止查询，不需要按小时记录使用时间。
- **GitHub**：Git 同步脚本仅调用 fast-forward pull/push，绝不自动暂存或强推；未来 API 集成仍应显式授权。
- **自动统计**：优先从进展事件和现有记录派生统计，避免重复保存统计值。
- **AI**：适配层可增加模型渠道；当前聊天与提案为可读 JSON，但选择远程模型时会把本轮提示和选中的本地上下文发送给该模型服务。
- **存储**：UI 依赖 API 和领域类型而非文件结构，必要时可以替换 Store，同时保持 JSON 导入/导出兼容。
