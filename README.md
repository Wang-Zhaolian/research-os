# Research OS

Research OS 是一套本地运行的个人科研与学习控制台，面向长期的自主学习、科研、论文、个人项目、竞赛、目标和本科成绩管理。它关注成果是否推进、下一步行动、停滞与截止日期，不记录番茄钟或精确学习时长。

应用固定运行在 **http://127.0.0.1:3000**。它不部署公网、不依赖云数据库；电脑关机或服务停止时，地址自然无法访问。桌面入口会启动服务、等待就绪并打开浏览器。

## 安装与启动

需要 Node.js **22.19 或更高版本**。Git 仅在使用版本管理和跨设备同步时需要。应用不要求 Docker，也不要求任何 AI API Key。

### Windows

1. 在项目目录双击 `install-shortcut.cmd`，在桌面创建“Research OS”快捷方式。
2. 之后双击该快捷方式启动；也可以双击 `start-research-os.cmd`。
3. 首次启动会安装锁文件指定的依赖并构建应用。日常打开后保持启动窗口运行；关闭窗口或按 Ctrl+C 会停止服务。

如果 3000 端口被其他程序占用，启动器会给出中文提示，不会偷偷改用另一个地址。

### macOS

首次在终端进入项目目录并运行：

```bash
chmod +x start-research-os.command start-research-os.sh scripts/install-shortcut.sh
./scripts/install-shortcut.sh
```

安装脚本会在桌面创建可双击的 `Research OS.command`。之后双击并保持启动的终端窗口打开。macOS 首次可能要求确认打开本地脚本；Finder 双击体验需在 Mac 上最终验证。

也可以在项目目录执行 `npm run launch`。开发调试可用 `npm run dev`，日常使用推荐桌面入口。

## 首次初始化

首次打开后进入“初始化”。页面会先显示现有数据数量；服务端只有在完整快照成功并通过校验后才会执行初始化。输入“清空并开始”确认后，当前活动记录和归档记录会清空，**不会重新生成演示数据**。初始化会更换 `dataEpoch`，旧标签页中的复盘、浏览器草稿和 AI 待确认操作不能写回新工作区。

之后在个人档案确认称呼、学校、专业、入学年份、学期与发展方向，再逐项录入当前真实课程、科研、目标和任务。预填的学校与发展方向都需要你自己确认；系统不推断导师、课程进度、科研成果或成绩。手工录入在未连接 AI 时也可使用。

初始化前的完整快照保存在 `data/.backups/`，可在“设置 → 本地备份、初始化与恢复”预览并整组恢复。恢复前系统也会备份当前状态。

## 每晚使用方式

1. 双击桌面入口，先看“总览”：手工确认的重点、本周任务、遗留待安排、科研状态、逾期与即将到期事项。
2. 记录任务时，把标题写成一个交付成果，把“下一步行动”写成现在可以开始的具体动作。新任务可先放收件箱；排入周计划或置顶前必须关联有效的主对象。
3. 晚上进入“今晚更新”，集中记录完成事项、未完成原因、任务/科研进展、新论文、截止日期、收件箱分流和重点变化。草稿只存在当前浏览器，最终提交才一次性保存。
4. 同一天可以补充修订同一份复盘。撤销已经完成的任务需要明确执行，不会因取消勾选而自动回退。
5. 跨设备使用前先关闭应用、拉取最新数据；当天使用结束后提交并推送，避免两台设备同时编辑。

## 数据与备份

正式数据保存在项目目录的 `data/`，使用可读 UTF-8 JSON 文件：

```text
data/
  profile.json         # 个人档案
  tasks.json           # 成果任务、主/次关联、周计划和重点
  learning.json        # 课程、模块与知识点
  research.json        # 独立科研项目、会议、论文关系和科研材料/代码路径
  papers.json          # 论文元数据、阅读笔记、Zotero 来源标识
  projects.json        # 非科研个人项目与参考项目
  competitions.json    # 竞赛与结果
  goals.json           # 长期/学期/年度目标、里程碑与证据
  grades.json          # 成绩和是否计入统计
  reviews.json         # 每天一份、可修订的晚间复盘
  progressEvents.json  # 任务、对象与目标里程碑共用的进展流水
  settings.json        # schema、dataEpoch、GPA 规则、模型连接等非敏感设置
  ai-conversations/    # 可读的 AI 会话 JSON
  .backups/            # 本机校验快照，不进入 Git
```

普通日期为 `YYYY-MM-DD`，默认时区 `Asia/Shanghai`；时间戳为 UTC ISO 8601。跨模块关系使用 `{ type, id }`，不复制关联对象。数据升级会执行显式迁移，迁移前先备份；必要文件缺失时应用会停止并提示恢复，不会把缺失文件默认为空数据。

跨文件写入使用事务日志，服务启动时会恢复未完成的事务。每次复盘成功后保存快照并只保留最近 30 份；初始化、恢复、迁移、归档与永久删除前也会先备份。`.backups/` 和事务临时文件已加入 `.gitignore`。本机快照不是跨设备备份，仍要将正式 JSON 提交到你的私有 Git 仓库。

聊天 JSON 会随 `data/` 提交，因此它可能包含个人提问、模型回答以及你曾在某轮允许模型读取的成绩信息。推送前请检查会话内容。OAuth 令牌和 API Key **不在** `data/`、聊天记录、快照或 Git 中。

### 凭据位置与保护

模型凭据保存在项目目录外的本机用户目录，原子更新并限制访问：

- Windows：`%LOCALAPPDATA%\Research OS\credentials\credentials.json`，ACL 限制为当前用户和 SYSTEM。
- macOS：`~/Library/Application Support/Research OS/credentials/credentials.json`，目录和文件仅当前用户可访问。
- Linux：`$XDG_CONFIG_HOME/research-os/credentials/credentials.json`（未设置时为 `~/.config/research-os/credentials/credentials.json`）。

凭据文件本身不加密；请保护好 Windows/macOS 用户账户和设备磁盘。自定义 API 的连接名称、Base URL 和模型 ID 可以同步，但每台设备都要单独填写 API Key；ChatGPT 订阅也需要每台设备各自完成官方登录。

### 从快照恢复

优先通过设置页选择快照，先看记录数量和个人档案，再输入“恢复此备份”确认整组恢复。不要在应用运行时手动覆盖 JSON，也不要仅恢复关系链上的单个文件。必要时先退出应用并把整个 `data/` 复制到另一个安全位置，再检查快照或 Git 历史。

## 模型配置与 AI 助手

默认渠道是 **ChatGPT 订阅**：在“设置 → 模型配置”选择“Continue with ChatGPT”，浏览器会打开 OpenAI 官方授权页。授权回调使用临时的 `127.0.0.1` 端口，不会改变 Research OS 的固定地址。连接成功后从该账号实时模型列表选择模型，并用一次完整响应测试连接。

订阅权限或额度不可用时，页面会说明原因；应用**不会自动切换到 API**。只有你主动配置并手动将备用 API 设为默认，之后才会走 OpenAI 兼容的 Responses 或 Chat Completions 接口。使用备用 API 可能产生该服务的 API 费用。

AI 助手会把本轮提问及本地检索到的相关活动记录发给当前选定的模型服务；“本地优先”不等于 AI 推理也离线。成绩默认不进入上下文；每轮发送前可单独勾选允许读取成绩。助手会展示所用渠道和本地引用，只生成可编辑、可逐项取消的操作草稿。服务端先按业务规则进行无写入试运行，只有你点击“确认所选操作并保存”才会应用；AI 不能永久删除记录、初始化工作区或改动凭据/Git。

Zotero API、联网搜索、文件解析和 AI 自动写入目前没有实现。AI 使用 `@earendil-works/pi-ai` 1.0.0 作为模型适配层；ChatGPT 订阅登录遵循 OpenAI 官方 Sign in with ChatGPT 开源应用流程：[授权与登录](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)。

## GitHub 私有仓库同步

项目已配置现有的 **Private** 远端。同步是手动的：脚本只执行安全的 `git pull --ff-only` 或 `git push`，不会自动暂存、提交、stash、rebase 或强推。工作区有未提交改动、拉取分叉或同步失败时会立即停止。

每台设备使用同一私有仓库，并按这个顺序操作：

```text
关闭 Research OS
运行 sync-pull
启动并使用 Research OS
关闭 Research OS
检查 git status
git add data
git commit -m "data: 更新 Research OS 记录"
运行 sync-push
```

Windows 可以双击 `sync-pull.cmd` 与 `sync-push.cmd`；macOS 使用：

```bash
./sync-pull.sh
./sync-push.sh
```

若 GitHub 凭据失效，可在终端运行 `gh auth login` 重新登录；也可以按 Git 提示完成浏览器认证。脚本不会处理 JSON 冲突；出现冲突先复制备份整个 `data/`，再逐项核对。不要让两台设备同时改同一个文件。

## 更新应用但保留数据

应用代码与业务数据分开。先备份并提交本机改动，再拉取更新；不要用新目录覆盖旧项目，尤其不要覆盖 `data/`。日常启动器根据锁文件安装依赖、根据代码指纹按需重新构建。

本版数据结构为 v3。v1/v2 数据首次读取时会先保存迁移前快照，再升级到 v3；升级本身不会清空工作区。初始化和恢复是另一个明确操作，必须从设置页预览并输入确认语句。

## 架构与开发命令

- `app/`：Next.js 页面入口和本地 API 路由。
- `components/research-os.tsx`：中文导航、业务模块、初始化、复盘和 AI 审阅界面。
- `lib/types.ts`、`lib/domain.ts`、`lib/validation.ts`：实体类型、领域逻辑与写入校验。
- `lib/store.ts`：JSON 存储、迁移、事务恢复、校验快照、复盘与 AI 提案应用。
- `lib/credentials.ts`、`lib/chatgpt-auth.ts`、`lib/model-runtime.ts`：本机凭据、官方订阅授权与 Pi 模型适配；与业务 JSON 分离。
- `scripts/launch.mjs`、`scripts/sync.mjs`：跨平台启动与保守 Git 同步。
- `tests/`：GPA、初始化/恢复、并发代次、跨模块关联、AI 草稿、模型流、OAuth 模拟和同步失败测试。

运行检查：

```bash
npm test
npm run lint
npm run build
```

数据模型与事务约束见 [`docs/architecture.md`](docs/architecture.md)。

## 已知限制与下一步

- 这是本地单用户应用。机器关机、服务停止或离开这台电脑时不能访问；不提供公网登录或手机远程访问。
- Git 同步仍需人工提交；并行修改相同 JSON 文件会冲突。
- 尚未用你的真实 ChatGPT 账号完成授权。首次连接需要你亲自在 OpenAI 官方页面登录并同意；自动化测试用的是隔离密钥和模拟服务，不代表真实订阅已验证。Mac 上 Finder 启动入口也需要在 Mac 实机确认。
- 值得后续扩展：更方便的课程/Topic 逐层编辑、科研时间线、Zotero 导入、日历导入与从进展事件派生的统计。
