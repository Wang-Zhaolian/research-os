# Research OS 架构与数据模型

## 运行边界

Research OS 是本机单用户 Web App。Next.js 页面通过固定绑定 `127.0.0.1:3000` 的本地 API 读写分模块 UTF-8 JSON；不依赖云数据库或 Docker。所有写请求校验同源主机和工作区 `dataEpoch`，避免浏览器旧标签页在初始化或恢复后覆盖当前代数据。

```text
浏览器 / 中文成长画布
       │ JSON / SSE
       ▼
Next.js 本机路由 ── 同源、代次、字段和关系校验
       │
       ▼
lib/store.ts ── 串行写入、跨文件事务、崩溃恢复、快照
       │
       ▼
data/*.json ── Git 可读、按模块拆分
       ├── 本机附件目录（项目外、受限权限）
       ├── 本机 AI 未确认草稿（项目外、受限权限）
       └── 本机 ChatGPT 授权凭据（项目外、受限权限）
```

服务只监听本机回环地址。纯本地 Web App 的链接只在服务运行期间有效，并非公网永久地址。

## 三阶段与专业资料

阶段档案是三组独立记录，不是同一个记录的状态改名：

- **待开始** `PendingItem`：保存想法、期望结果、类别、标签、证据和既有来源关联。
- **进行中** `ActivePlan`：通过 `sourcePendingId` 指回原始待开始记录；日期、建议时限、下一步和关联任务可独立编辑。
- **已完成** `Achievement`：通过 `sourcePlanId` 指回结束计划，并保留成果摘要、来源和证据引用。

待开始启动和计划完成各自是跨文件事务；重复请求可找到已有目标对象，不会复制第二份。源记录不会因交接删除。任务、成绩、课程、科研、项目、竞赛和实习是专业资料/事实证据，保留在各自集合；已完成页自动汇总可验证的已完成任务、已完成专业记录和已有成绩。AI 不会把一章学习记录称为掌握整门课程。课程总结门槛为：用户明确标记 `syllabusComplete`，课程至少有一个模块，且所有模块与 Topic 状态均为完成。

阶段 `categoryId` 引用 `settings.stageCategories`。类别支持用户编辑名称、图标、颜色与顺序，三阶段共用。进行中计划的 `horizonId` 引用 `settings.planningHorizons`；预设短期 3–7 天、中期 14–180 天、长期至少 365 天都是建议范围，并不约束实际日期。资料库中仍有课程、科研、论文、个人/参考项目、竞赛、实习、目标与 GPA 页面。

普通学习任务仍使用 `Task` 成果对象：`nextAction` 是独立的下一步；`primaryParent`、`relatedRefs` 与 `milestoneRefs` 通过 ID 建立主、次和目标里程碑关联。周安排保存本地周一日期 `plannedWeek`；过期未完成项进入待重新安排状态，不自动滚动。

## 核心实体与引用

- `LearningCourse.modules[].topics[]` 为逐层课程结构；仅在用户确认的完整目录全部完成后，允许把整门课程标为完成。
- `ResearchProject.paperIds` 与 `Paper.relatedResearchIds` 在 Store 边界双向维护。研究问题、方法、实验结果、会议、代码和材料路径始终属于科研记录。
- `PersonalProject` 只用于非科研个人开发项目或参考项目，不包含科研项目。
- `Goal.milestones[]` 和 `linkedItems[]` 连接目标与成果；任务通过 `{ goalId, milestoneId }` 引用里程碑。
- `Grade` 区分百分制、合格制和免修，`includeInAverage` 由用户决定是否计入。百分制加权均分为主，GPA 依 `settings.gpa.rules` 配置规则计算；待出分、合格制和免修不作为零分参与统计。重修不会自动合并。
- `Internship` 单独记录实习组织、岗位、时间、职责、结果与证据；可链接到进行中计划。
- `ProgressEvent` 是有日期的进展流水，可同时关联任务、上层对象和目标里程碑；不复制被关联对象。
- `LocalAttachment` 仅为附件原件元数据，字段含文件名、MIME、大小、SHA-256、外部本机文件 ID 和简短摘要。业务记录使用 `{ type: "attachment", id }` 引用证据。

ID 使用前缀 + UUID 随机片段，例如 `task_…`、`plan_…`、`achi_…`；跨实体引用只依赖稳定 ID。普通日期为 `YYYY-MM-DD`，以 `Asia/Shanghai` 为默认日历时区；时间戳用 UTC ISO 8601。标签目前按实体保存为字符串数组，不另存全局 Tag 主表。

## 文件、附件与隐私边界

主数据位于 `data/`，包括 `profile.json`、`settings.json`，每个业务集合的 JSON，以及 `ai-conversations/*.json`。AI 同步会话记录短指令、简短回答、模型渠道、引用对象和已应用操作 ID；**不会保存未确认操作正文**。AI 待确认草稿仅位于项目目录外的受限本机目录，并绑定 `dataEpoch`；过期、取消或确认后即失效/移除。

上传与长文本原件在项目外的本机附件目录保存，ACL/POSIX 权限仅限当前用户（Windows ACL 亦允许 SYSTEM）。路径通过平台本机应用数据目录确定，测试可用隔离的 `RESEARCH_OS_ATTACHMENTS_DIR`。附件原件不进入 Git、快照和聊天 JSON；`data/attachments.json` 只保存元数据、摘要和哈希。设置页附件包导出把原件与 `manifest.json` 打进 ZIP，并标识缺失原件；原件目录需单独备份/迁移。

文本、Markdown、CSV、DOCX 和有文本层的 PDF 在本机提取预览；JPG/PNG/WebP 的原件按模型图像输入能力发送。每次发送附件都须当前用户确认附件清单和提取预览。扫描 PDF 无文字层时不做 OCR，会提示用户自行 OCR 后再导入。选择 ChatGPT 订阅模型后，用户所选指令、已授权的活动上下文和确认发送的材料会传给该远程模型处理；本地优先不表示推理离线。成绩上下文每次单独授权。AI 回复、操作草稿只会先验证；确认后才调用业务事务写入。

OAuth 访问令牌与刷新凭据、潜在的 API Key 都保存在项目目录外的本机用户凭据库，不返回浏览器，不能进入业务快照或 Git。当前前端只开放 ChatGPT 订阅连接；服务端发送与连接测试明确只接受 `chatgpt_subscription`，订阅不可用时失败停止。底层 `openai_compatible` 适配器保留用于未来扩展，但当前助手不调用，不能作为静默回退渠道。

## 版本迁移与 `dataEpoch`

`settings.schemaVersion` 当前为 **4**。v1–v3 升级先对完整现有工作区建立带 SHA-256 清单的本机快照，再迁移任务字段、双向科研论文关系、逐层课程字段、GPA/档案、三阶段集合、附件元数据与类别/时限配置；没有历史三阶段记录时不伪造成果。已有个人档案和 GPA 配置保留。迁移不会触发清空。

`settings.dataEpoch` 标识当前工作区代次，`dataRevision` 在业务写入时递增。初始化或整组恢复会生成新 epoch；旧标签页、旧复盘草稿、AI 待确认草稿和延迟提交请求不能写回。每次本地写接口必须带 `x-research-os-epoch`。恢复时可读 v3 快照并升级到 v4；恢复操作本身先备份当前工作区。

## 事务、恢复与幂等

单文件使用同目录临时文件再 rename 替换。多文件提交先落盘 `.pending-transaction.json` 日志，再依次替换数据文件及会话文件，最后删除日志；应用启动时优先重放未完成事务。业务写队列在进程内串行。

计划交接、成就卡建立、今晚更新和 AI 确认都在同一事务提交。AI 草稿先进行纯内存 dry-run，校验实体字段、状态、证据、日期和同批新建 ID 引用，不写任何业务文件；确认操作还会核验 `dataEpoch`、`dataRevision`，并带幂等 `operationId`。聊天 JSON 的 `appliedOperations` 只保留方案 ID、操作 ID、提交时间和结果 ID，不保存提案内容。初始化、删除记录不属于 AI 能力。

迁移、初始化、恢复、归档和永久删除前创建校验快照；今晚更新成功后保留最近 30 份。快照目录 `data/.backups/` 与事务日志被 `.gitignore` 排除。引用记录不能永久删除；仍有未完成任务关联的上层对象需先重新安排或完成任务。

## 模块边界

- `lib/types.ts`：领域实体、阶段档案和 API 操作的共享类型。
- `lib/domain.ts`：GPA/学分加权、搜索、任务周桶、截止排序、下一步回退、停滞判断和可解释重点推荐。
- `lib/validation.ts`：日期、实体字段、引用、阶段交接与删除保护。
- `lib/store.ts`：JSON 读取写入、迁移、快照、事务、关系同步、档案交接和复盘/AI 确认。
- `lib/attachments.ts`、`lib/attachment-export.ts`：文件签名验证、提取、本机私有原件和附件 ZIP 导出。
- `lib/assistant-drafts.ts`：Git 外的本机私有 AI 待确认草稿。
- `lib/credentials.ts`、`lib/chatgpt-auth.ts`：凭据权限、官方 OAuth/PKCE、授权校验、实际模型目录、刷新与撤销。
- `lib/model-runtime.ts`：固定订阅执行路径；通过锁定版本 `@earendil-works/pi-ai` 调用 Responses 流，要求 `store:false`、完整终止事件与非空响应。
- `app/api/`：本地请求解析与错误映射；外部远程登录仅用官方 OAuth 浏览器跳转及临时环回回调。
- `components/research-os.tsx`：中文三阶段档案、专业资料库、设置、晚间复盘、附件预览与 AI 操作审阅。

## 扩展点

- Zotero 可把 library/item 标识映射到 `Paper.source`，不需要改动论文实体关系。
- 日历可将事件期限转换为当前截止列表模型，无需记录逐小时活动。
- 自动统计可以从 `ProgressEvent` 和专业事实推导，避免存冗余百分比。
- API 适配代码仍留在服务端，但新增接入必须显式启用前端和权限，不可作为订阅回退。
- 附件恢复可增加从已导出的 ZIP 按 SHA-256 匹配并恢复缺失原件。
- Store 与 UI/API 分离；以后需要别的本地数据后端时仍可保留 JSON 导入导出。
