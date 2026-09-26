# Research OS

Research OS 是一个本地优先的个人科研与学习控制台，用于长期管理本科阶段的自主学习、科研、论文、项目、竞赛、目标与成绩。

它不是番茄钟，也不是精确日程工具。系统关注的是：事情有没有推进、当前处于什么状态、下一步是什么、哪里发生了停滞，以及现在最值得做什么。

## 已实现功能

- 总览：手工排序的当前重点、本周任务、长期目标、科研状态和未来 7/30 天截止日期
- 自主学习：课程 → 模块 → 知识点三级结构
- 科研：研究问题、研究空白、方法、数据、实验、写作、会议记录和科研代码/材料
- 论文：书目信息、阅读状态、核心方法、结果、贡献、局限、个人理解和科研价值
- 项目：独立管理非科研个人项目与参考项目
- 竞赛：准备阶段、任务、队友、材料、结果和获奖情况
- 长期目标：年度、学期和长期目标，以及里程碑和关联对象
- 成绩 / GPA：可配置换算规则、学期 GPA、累计 GPA 与学分统计
- 今晚更新：六步更新任务、科研进展、论文、截止日期和当前重点
- 全局搜索、标签、筛选、跨模块关联、归档与恢复
- 可读、可对比、适合 Git 管理的本地 JSON 数据

## 技术方案

- **Next.js + React + TypeScript**：跨平台、本地浏览器访问、完整类型约束
- **Node 本地接口**：实现真正的数据增删改查，不依赖云服务
- **JSON 文件**：便于 Git 对比、合并、迁移与手工查看
- **Tailwind CSS + 可访问 UI 组件**：响应式深色/浅色界面
- **Node 测试运行器**：不额外引入大型测试框架

整体链路保持简单：浏览器 → 本地 Next.js 接口 → JSON 数据文件。详细关系模型见 [架构说明](docs/architecture.md)。

## 安装

前置条件：Node.js 22.13 或更高版本，以及 Git。

### Windows

```powershell
cd research-os
npm install
./start-research-os.cmd
```

也可以直接运行：

```powershell
npm run dev
```

### macOS

```bash
cd research-os
npm install
chmod +x start-research-os.sh sync-pull.sh sync-push.sh
./start-research-os.sh
```

随后打开 [http://localhost:3000](http://localhost:3000)。如果 3000 端口已被占用，终端会显示实际地址。

## 日常启动

开发模式：

```bash
npm run dev
```

生产模式：

```bash
npm run build
npm start
```

程序只绑定 `127.0.0.1`，默认仅当前电脑可以访问。

## 建议的每日使用方式

1. 晚上进入“今晚更新”。
2. 勾选今天已经完成的任务。
3. 记录未完成事项的原因或计划偏差。
4. 更新一个科研项目的最近进展。
5. 快速收录新论文或新截止日期。
6. 重新选择明天最重要的 3～5 件事。
7. 完成复盘，总览会自动更新。

创建课程、科研项目或详细论文笔记时，再进入相应模块深入维护。总览应当始终是用于做决定的页面，而不是堆满所有数据。

## 数据存储

所有持久数据都位于 [`data/`](data/) 目录，以格式化的 UTF-8 JSON 保存：

```text
data/
  tasks.json          # 周任务、当前重点、截止日期
  learning.json       # 课程、模块、知识点
  research.json       # 科研项目、会议、科研材料与代码
  papers.json         # 论文信息与阅读笔记
  projects.json       # 非科研项目
  competitions.json   # 竞赛
  goals.json          # 长期目标与里程碑
  grades.json         # 成绩
  reviews.json        # 晚间复盘记录
  settings.json       # GPA 规则和数据版本
```

不同模块使用独立文件，可以让 Git 变更更集中，减少冲突。写入操作采用排队和原子替换，防止保存到一半时损坏文件。

- 普通日期格式：`YYYY-MM-DD`
- 时间戳格式：ISO 8601 UTC
- 跨模块关系：使用稳定 ID 引用，不复制整份数据

服务器停止时，可以直接阅读或手工修改 JSON 文件。

### 备份

最简单的备份方式是提交一次 Git。也可以完整复制整个 `data/` 目录。

不要只复制一个包含大量关联关系的文件，除非对应的关联 ID 在目标位置也存在。

### 示例数据

初始数据覆盖了所有模块。熟悉系统后，可进入“设置 → 清理示例数据”。清理操作需要二次确认，并会保留默认 GPA 规则。

## GitHub 私有仓库同步

本项目只应使用 **Private 私有仓库**。

首次创建远程仓库：

```bash
gh auth login
gh repo create research-os --private --source=. --remote=origin --push
```

也可以在 GitHub 网页中创建一个空的私有仓库，再执行：

```bash
git remote add origin git@github.com:你的用户名/research-os.git
git push -u origin main
```

### Windows 日常同步

```powershell
./sync-pull.cmd
# 使用 Research OS 并更新数据
./sync-push.cmd
```

### macOS 日常同步

```bash
./sync-pull.sh
# 使用 Research OS 并更新数据
./sync-push.sh
```

`sync-push` 会创建带时间戳的提交、拉取远程变更并推送；`sync-pull` 使用变基与自动暂存，避免静默覆盖本地改动。

### 更换电脑

1. 安装 Node.js 和 Git。
2. 克隆私有仓库。
3. 执行 `npm install`。
4. 运行对应系统的启动脚本。
5. 换设备前先推送；在另一台设备开始更新前先拉取。

为减少冲突，建议在一台设备完成晚间更新并推送后，再使用另一台设备。同一个 JSON 文件被两台设备同时修改时，仍可能需要手工处理 Git 冲突。

## 安全升级

1. 执行同步脚本，或手工提交全部 `data/` 改动。
2. 拉取或应用代码更新。
3. 如果 `package.json` 或 `package-lock.json` 变化，执行 `npm install`。
4. 执行 `npm test` 和 `npm run build`。
5. 启动系统并检查总览。

代码升级不应覆盖 `data/`。`data/settings.json` 中的 `schemaVersion` 用于未来显式的数据迁移。重大升级前建议创建 Git 标签或额外备份。

## 目录结构

```text
app/                    Next.js 页面与本地接口
components/             应用外壳、模块页面、编辑器与 UI 组件
lib/types.ts            统一实体类型
lib/domain.ts           GPA、搜索、重点任务和截止日期逻辑
lib/store.ts            JSON 原子存储与 ID 生成
data/                   用户持久数据
docs/architecture.md    实体关系与扩展边界
tests/                  数据持久化与业务逻辑测试
```

界面不会直接读写文件，而是调用 `/api/data` 与 `/api/entities`；接口再调用 `lib/store.ts`。这样可以将数据、业务规则和界面分离。

## 质量检查

```bash
npm test
npm run lint
npm run build

# 测试和构建一起执行
npm run check
```

测试覆盖可配置 GPA、截止日期排序、当前重点排序、跨模块搜索、创建、编辑、归档、原子保存和重新启动后的数据持久化。

## 当前限制

- 当前按单个本地用户、单个运行进程设计，不应同时启动多个服务写入同一 `data/` 目录。
- JSON 适合个人规模；论文库非常大以后，可以增加索引层，但仍以 JSON 作为可同步的数据源。
- 两台设备在同步前同时编辑同一个集合文件，Git 仍可能产生冲突。
- 论文元数据目前手工录入，尚未连接 Zotero。
- 尚未接入日历、GitHub API、系统通知、登录或 AI。
- 进度统计依据明确记录的里程碑，不会根据学习时长自动推测。

## 后续开发方向

1. **Zotero 集成**：使用 `source.provider`、`libraryId` 和 `externalId` 导入元数据，并保留个人笔记。
2. **日历集成**：可选导入带截止日期的事件。
3. **GitHub API**：连接科研代码仓库和普通项目，同时保持两类项目分离。
4. **自动统计**：成绩趋势、科研推进量、论文阅读节奏和停滞事项报告。
5. **AI 助手**：未来可选的复盘总结和论文梳理功能，但绝不成为基础功能的必需依赖。

## 隐私

Research OS 不会调用外部 API，也不要求账号或 API Key。隐私取决于仓库的存储与同步方式：必须使用 GitHub **Private 私有仓库**，并避免提交密码、密钥、受版权保护的论文全文、敏感研究数据或参与者信息。
