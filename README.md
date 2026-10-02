# Research OS

Research OS 是一个本地优先的个人科研与学习控制台，适合长期管理本科阶段的自主学习、科研、论文、项目、竞赛、目标与成绩。它不是番茄钟或精确日程工具：重点是当前推进到哪里、下一步是什么、哪些事情停滞、近期截止日期，以及长期目标是否持续前进。

系统只在本机运行，不部署公网、不依赖云数据库，也不需要任何 AI API Key。默认网址固定为 **http://127.0.0.1:3000**。电脑关机、服务关闭或网络浏览器重启后，这个本地网址不会自行提供页面；需要通过桌面入口重新启动服务。

## 快速开始

需要安装 Node.js **22.13 或更高版本**。Git 仅在使用版本管理和跨设备同步时需要。

### Windows

首次使用时，在项目目录双击 `install-shortcut.cmd`，在桌面创建“Research OS”快捷方式。之后双击桌面快捷方式即可启动并自动打开浏览器；也可以双击 `start-research-os.cmd`。

第一次启动会按锁文件安装依赖并构建应用，以后只在依赖或应用代码变化时重新安装/构建。启动窗口在使用期间必须保持打开；关闭窗口或按 Ctrl+C 会停止本地服务。若 3000 端口正被别的软件占用，程序会用中文提示，不会偷偷换地址。

### macOS

在终端进入项目目录并运行一次：

```bash
chmod +x start-research-os.command start-research-os.sh scripts/install-shortcut.sh
./scripts/install-shortcut.sh
```

安装脚本会在桌面创建可双击的 `Research OS.command` 入口。之后双击即可启动并打开浏览器；保持启动的终端窗口打开。首次 Finder 双击可能需要在系统提示中确认打开本地脚本。实际 Finder 双击仍需在 macOS 设备上验证。

也可以在项目目录用 `node scripts/launch.mjs` 启动。开发调试可使用 `npm run dev`，但日常使用推荐桌面入口。

## 每天怎么用

1. 晚上双击桌面入口，进入“总览”。
2. 查看手工确认的 3–5 项重点、过周遗留、本周任务、科研状态和逾期/近期截止日期。
3. 在“今晚更新”一页勾选完成项、记录实际进展和下一步、收录论文或截止事项，并分流收件箱任务。
4. 复盘草稿只保存在当前浏览器；点“完成今晚更新”后，服务器才一次性写入正式 JSON 数据。若同一天再次打开，可补充修订同一份复盘。
5. 需要跨设备时，先按下方步骤提交并同步数据。复盘成功后的提醒不会自动推送数据。

任务标题应描述一个交付成果；“下一步行动”写成可以开始执行的具体动作。新任务可先放收件箱；安排到某一周或置顶前，必须关联一个课程、科研、论文、普通项目、竞赛或长期目标。旧数据中缺少主关联的任务会进入“待补归属”，不会被删除或隐藏。

## 数据与备份

正式数据保存在项目目录的 `data/`，按模块拆成 UTF-8 JSON 文件，适合人工查看和 Git diff：

```text
data/
  tasks.json          # 任务、主/次关联、周计划和当前重点
  learning.json       # 课程、模块和知识点
  research.json       # 科研上下文、会议、材料和代码路径
  papers.json         # 论文元数据、阅读笔记和 Zotero 来源标识
  projects.json       # 非科研个人项目与参考项目
  competitions.json   # 竞赛与材料
  goals.json          # 长期目标、里程碑和关联
  grades.json         # 成绩
  reviews.json        # 每日一份、可修订的晚间复盘
  progressEvents.json # 任务、对象和里程碑可查看的进展记录
  settings.json       # 数据版本、GPA 换算、时区和停滞天数
  .backups/           # 本机快照，不进入 Git
```

日期使用 `YYYY-MM-DD` 日历日期；默认时区是 `Asia/Shanghai`，可以在设置中调整。时间戳使用 UTC ISO 8601。跨模块关系用 `{ type, id }` 引用，避免复制整份记录。

每次成功复盘会保存一份本机快照，并只保留最近 30 份复盘快照；迁移、归档和永久删除前也会先创建快照。事务日志在启动时自动恢复。`.backups/` 和临时事务文件已加入 `.gitignore`，因此换电脑时不要只依赖这些本机快照，仍需定期提交数据或复制整个 `data/` 目录到安全位置。

当前数据为 v1 时，首次由新版应用读取会先把原始文件备份到 `data/.backups/migration-v1-*`，再执行 v1→v2 转换。迁移保留现有记录、目标多关联和科研—论文双向关系；如启动前后有疑问，可在迁移快照中核对。

### 从快照恢复

先停止 Research OS，并把当前整个 `data/` 复制到另一个安全目录。然后选择 `data/.backups/` 下的一份快照，将快照内对应 JSON 文件复制回 `data/`，再启动应用。不要在服务运行时手动覆盖 JSON，也不要只恢复一个包含跨模块关系的文件，除非你确认关联 ID 仍然存在。也可从 Git 历史恢复已提交的数据版本。

## GitHub 私有仓库同步

当前远端是现有的 **Private** 仓库。同步完全由你手动触发，不会自动联网。首次使用前需要在本机配置 GitHub 凭据和 Git 的用户名/邮箱；如果 `git push` 提示认证失败，使用 GitHub CLI 的登录流程重新授权。

跨设备建议始终遵守：**关闭应用 → 拉取 → 使用 → 检查并提交 → 推送**。不要在两台电脑同时编辑同一份数据。

Windows：

```text
双击 sync-pull.cmd
启动并使用 Research OS
关闭 Research OS
在项目目录打开终端，检查 git status
git add data/*.json
git commit -m "data: 更新 Research OS 记录"
双击 sync-push.cmd
```

macOS：

```bash
./sync-pull.sh
# 启动并使用 Research OS，之后关闭它
git status
git add data/*.json
git commit -m "data: 更新 Research OS 记录"
./sync-push.sh
```

同步脚本只做安全的 `git pull --ff-only` 和 `git push`：工作区有未提交改动、拉取发生分叉或推送失败时会立即停止；脚本不会自动暂存、提交、stash、rebase 或强推。出现 JSON 冲突时先备份 `data/`，再逐项核对合并结果；不要直接用“本地/远端版本”覆盖全部数据。同步完成后再启动应用。

## 更新应用而不损坏数据

应用代码与数据分开存放。更新前先提交自己的数据和代码改动，再安全拉取更新；不要用新下载的文件夹覆盖整个旧目录，尤其不要覆盖 `data/`。启动入口检测锁文件和源码变化：依赖锁文件变化时运行 `npm ci`，应用源码变化时重新构建。数据结构升级会通过显式版本迁移完成，并在迁移前创建快照。

## 架构与维护

- `app/`：页面入口和本地 JSON API
- `components/`：中文界面、模块页面和复盘流程
- `lib/types.ts`：核心实体、引用和请求类型
- `lib/domain.ts`：日期、周计划、推荐、停滞、搜索与 GPA 领域逻辑
- `lib/validation.ts`：API 写入字段、日期和关联校验
- `lib/store.ts`：本地 JSON 持久化、迁移、事务恢复、快照和复盘提交
- `scripts/launch.mjs`：固定地址启动、依赖安装、按需构建和浏览器打开
- `scripts/sync.mjs`：跨平台安全同步命令实现
- `tests/`：领域逻辑、存储与迁移、事务、归档和同步失败路径测试

数据模型细节见 [`docs/architecture.md`](docs/architecture.md)。运行验证：

```bash
npm test
npm run lint
npm run build
```

## 当前边界与后续方向

- 完全本地单用户；机器关机或服务停止时不能访问，也不能从手机直接打开这台电脑的数据。
- GitHub 同步需要手工提交；两台设备同时修改同一 JSON 文件仍可能产生冲突。
- Zotero、日历、GitHub API、自动统计与 AI 助手尚未接入；目前没有 AI 调用或 API Key。
- macOS 脚本已按跨平台 shell 编写，但 Finder 入口需要在 macOS 设备上最终体验验证。

后续值得优先做的事：为学习模块/Topic 增加更顺手的逐层编辑体验；为科研会议和进展事件增加独立时间线；在真实使用一段时间后再按需要加入 Zotero 导入和自动统计。
