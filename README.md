# Research OS

Research OS 是为本科阶段长期使用设计的本地个人成长档案与科研学习控制台。主线分为「进行中、待开始、已完成」三阶段，同时保留课程、科研、论文、项目、竞赛、实习、目标、成绩等专业资料页。系统关注成果、证据、下一步和长期推进，不记录番茄钟或精确学习时长。

应用固定在 **http://127.0.0.1:3000**。它只在本机启动时可访问；电脑关机、应用停止或启动窗口关闭后，链接不会工作。桌面启动器会启动服务、等待就绪并打开浏览器；它不会让纯本地服务变成永久在线网站。

## 安装与运行

需要 Node.js **22.19 或更高版本**。Git 用于备份或跨设备同步；不需要 Docker、云数据库或 AI API Key。

### Windows

1. 在项目目录双击 `install-shortcut.cmd` 创建桌面快捷方式。
2. 之后双击桌面的「Research OS」，或直接双击 `start-research-os.cmd`。
3. 首次运行会按锁文件安装依赖并构建；以后代码未变时会复用构建结果。保持启动窗口打开即可使用，按 Ctrl+C 或关闭窗口会停止服务。

若 3000 端口已被其他程序占用，启动器会给出中文提示，不会悄悄改用另一个地址。

### macOS

在项目目录打开终端，首次运行：

```bash
chmod +x start-research-os.command start-research-os.sh scripts/install-shortcut.sh
./scripts/install-shortcut.sh
```

之后双击桌面生成的 `Research OS.command`，并保持终端窗口打开。macOS 可能首次询问是否允许运行本地脚本；Finder 双击和 ChatGPT 授权回调仍需在 Mac 实机验证。

也可以在项目目录运行 `npm run launch`。开发时用 `npm run dev`；日常使用推荐桌面入口。

## 主界面与日常使用

- **进行中**：按可编辑类别分组显示计划；预设短、中、长期时限是建议范围，起止日期仍可自由设置。页面还展示你手动排序的重点、本周任务、逾期和近期截止日期。
- **待开始**：先收纳值得做的想法。启动时保留待开始来源记录，并建立链接到进行中计划的新记录。
- **已完成**：成果卡与原始事实分开保存。任务、课程、科研、竞赛、实习和成绩等已完成记录会在时间线上显示；汇总卡需要手动创建或审阅 AI 建议后确认。
- **资料库**：继续维护自主学习课程与章节、科研与论文关联、个人/参考项目、竞赛、实习、长期目标和成绩。科研代码及材料仍属于科研记录，不会混入普通项目。
- **今晚更新**：集中记录任务完成、未完成原因、进展、论文、截止日期、收件箱分流和重点变化；最终确认后才一次保存。

每天可按「打开 → 看重点和到期事项 → 推进工作 → 今晚更新 → 关闭」使用。完成一个进行中计划时，系统会结束原计划并创建相互关联的成果卡；原计划和任务仍保留，作为可追溯证据。

课程整门完成的 AI 建议有额外门槛：须由你在课程详情确认章节清单完整，且所有模块和知识点都完成。条件不满足时，AI 只能总结证实过的部分。

## 数据位置、备份与附件

可读的业务 JSON 保存在项目 `data/` 目录，可手工查看并通过 Git diff/history 管理：

```text
data/
  profile.json              # 你确认的个人档案
  settings.json             # 数据版本、代次、类别、时限、GPA 与连接元数据
  tasks.json                # 任务、周计划、下一步和关联
  pendingItems.json         # 待开始档案
  activePlans.json          # 进行中档案
  achievements.json         # 独立的已完成成果卡
  learning.json             # 课程、模块、Topic 与大纲完整性确认
  research.json             # 科研项目、论文关系和科研代码/材料引用
  papers.json               # 论文元数据与阅读笔记
  projects.json             # 非科研个人项目和参考项目
  competitions.json         # 竞赛
  internships.json          # 实习经历
  goals.json                # 长期/学期/年度目标
  grades.json               # 成绩与计入统计选项
  attachments.json          # 附件元数据、摘要和哈希（不是原件）
  reviews.json              # 今晚更新
  progressEvents.json       # 关联任务和目标的进展记录
  ai-conversations/         # 指令、简短回答、引用和确认结果
  .backups/                 # 被 Git 忽略的本机恢复快照
```

v3 到 v4 会先创建并校验迁移快照再升级；升级不清空工作区，已有个人档案和 GPA 设置会保留。初始化或恢复与普通版本升级是不同操作。初始化、恢复前都会先备份；`dataEpoch` 变化后，旧标签页和旧 AI 草稿不能再写入新工作区。跨文件保存使用事务日志，服务重启时恢复未完成事务。

源材料和上传文件原件保存在**项目目录外**的本机附件目录，不进入 Git、JSON 快照或聊天 JSON：

- Windows：`%LOCALAPPDATA%\Research OS\attachments`
- macOS：`~/Library/Application Support/Research OS/attachments`
- Linux：`$XDG_DATA_HOME/research-os/attachments`，未设置时为 `~/.local/share/research-os/attachments`

支持 JPG、PNG、WebP、含可提取文字的 PDF、DOCX、TXT、MD、CSV。扫描版 PDF 不含可提取文字时需先用 OCR 处理。原件是否存在会在附件列表中检查；换电脑仅同步 JSON 时会标记原件缺失。设置页可导出 ZIP 附件包，并含文件哈希清单；请把附件包放在安全的私人备份位置。

聊天中只保存你本轮的短指令、文件名/摘要/哈希/来源关联、AI 简短回答和引用；长篇粘贴内容按本机附件处理，不写入同步聊天。未确认 AI 操作草稿只存本机用户目录，初始化或恢复后失效。快照与附件包是两类不同备份。

## ChatGPT 订阅与 AI

前端只提供 **ChatGPT 订阅**连接，没有备用 API 配置入口。底层保留的 API 适配器处于停用状态；不论旧设置中是否有 API 连接，AI 助手都只调用 ChatGPT 订阅，不会静默切换渠道。

在「设置 → 模型连接」选择登录。系统会打开 OpenAI 官方授权页，由你本人完成授权；登录密钥只存于项目外的本机用户专属目录。订阅和 API Key 不进入 Git、应用数据、快照或浏览器存储。连接状态区分：

1. **本机已保存登录凭据**：只说明授权信息存在。
2. **完整模型推理测试成功**：完成一次实际请求并收到完整响应后才会显示已验证。

尚未由真实用户账号完成授权或测试时，不能把自动化模拟测试当作订阅已接通。若账号权限、额度或模型能力不支持，界面显示错误和重试方式；不会回退到 API。账号实时提供的模型列表才是可选范围；模型能否接收特定附件，要由该模型实际能力决定，拒绝时请手动换模型或移除附件。

文字、图片、PDF、DOCX、TXT/MD、CSV 在发送前可预览提取结果。**每次发送附件都须你明确确认本轮所选文件和提取内容**；原件留在本机。文档在本机解析为文本，图片按所选 ChatGPT 模型支持的图像输入方式发送；应用不使用 Files 上传接口。较长文本应作为附件而非对话正文输入。

AI 可整理资料、拆分计划、生成阶段建议和复盘草稿。它展示来源与变更预览；你可以编辑、移除建议，再点击确认。未经确认不写入业务数据。AI 不执行永久删除、初始化、凭据变更或 Git 操作。成绩上下文默认关闭，每轮须单独授权；含成绩的旧会话重新发送前也要检查授权。

授权和模型推理遵循 OpenAI 的 [Sign in with ChatGPT 指南](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) 与[模型和推理要求](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)。实际可用权限和额度以你的 ChatGPT 账号及官方服务响应为准。

## Git 私有同步

同步保持手动，推荐一台设备使用时另一台先退出应用。同步脚本只执行 `git pull --ff-only` 或 `git push`，遇到未提交改动、分叉、冲突或失败会停止；不会自动暂存、提交、stash、rebase、强推或覆盖冲突。

每台电脑的流程：

```text
关闭 Research OS
运行 sync-pull
启动并使用
关闭 Research OS
检查 git status
git add data
git commit -m "data: 更新 Research OS 记录"
运行 sync-push
```

Windows 可双击 `sync-pull.cmd` 和 `sync-push.cmd`；macOS 使用：

```bash
./sync-pull.sh
./sync-push.sh
```

首次使用前确认 GitHub 远端是 **Private**，并在各设备登录 GitHub。当前工作副本使用 SSH 地址 `git@github.com:Wang-Zhaolian/research-os.git`；首次换电脑时运行 `gh auth login --git-protocol ssh`，选择或配置 SSH 密钥后，用 `ssh -T git@github.com` 验证认证。HTTPS 远端也可用，但需把本地 `origin` 设置成 HTTPS 并确保当前网络能访问 GitHub Git 服务。冲突时先复制整个 `data/` 做额外备份，再逐文件人工合并；不要让两台设备同时编辑同一份 JSON。凭据和附件原件需在每台设备分别准备，或通过加密的私人备份单独迁移。

## 升级与恢复

升级前先关闭旧的 Research OS 启动窗口（旧的生产服务不会热加载代码），检查 `git status`，为当前 JSON 建立 Git 提交或副本，然后拉取代码并重新启动。应用会按 schema 版本迁移数据；正常升级不会重置、覆盖或重新生成演示数据。保持项目中的 `data/`，不要用新目录覆盖旧数据。需要恢复时，在设置页先预览快照，再确认恢复整组数据；恢复前系统会再备份当前状态。

## 技术结构与检查

- `app/`：Next.js 页面入口和固定本机 API。
- `components/research-os.tsx`：三阶段画布、专业资料库、今晚更新与 AI 审阅。
- `lib/types.ts`、`lib/domain.ts`、`lib/validation.ts`：数据类型、业务规则和输入校验。
- `lib/store.ts`：JSON 存储、v1–v4 迁移、事务恢复、备份、档案交接和 AI 操作确认。
- `lib/attachments.ts`、`lib/assistant-drafts.ts`：项目外附件及未确认 AI 草稿的本机私有存储。
- `lib/chatgpt-auth.ts`、`lib/credentials.ts`、`lib/model-runtime.ts`：官方授权、本机凭据保管和 Pi 模型适配。
- `scripts/`：跨平台启动器、Git 同步与桌面入口。
- `tests/`：隔离 JSON 数据下的迁移、持久化、成绩、附件、OAuth、模型流、AI 确认与 Git 失败路径。

开发检查命令：

```bash
npm test
npm run lint
npm run build
```

更多数据关系与事务约束见 [`docs/architecture.md`](docs/architecture.md)。

## 当前限制与下一步

- 这是本机单用户服务。服务停止时固定本机网址不可访问；不支持公网或手机远程访问。
- 真实 ChatGPT OAuth 登录和推理需要你本人通过官方页面授权后再验证；测试中的模拟数据不能替代真实账号测试。macOS 桌面入口也需在 Mac 实机检查。
- 聊天历史与业务 JSON 会随 Git 同步，推送前请检查个人信息；未确认 AI 草稿、登录凭据和附件原件不随 Git 同步。
- 当前不提供图片 OCR、联网搜索、Zotero 自动同步、日历同步或自动统计。可作为后续优先项的是恢复时导入附件包、课程清单导入、Zotero 元数据同步，以及真实订阅模型的端到端验证。
