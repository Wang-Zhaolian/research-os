# Research OS

Research OS is a local-first research and learning command center for long-term undergraduate study, research, projects, competitions, goals, and academic records. It is deliberately not a timer or a day planner: the core unit is meaningful progress, the current state, and the next action.

## What is included

- Dashboard with manually ordered Top 3–5 priorities, weekly tasks, goal milestones, research status, and unified 7/30-day deadlines
- Learning courses with module/topic hierarchy
- A dedicated research workspace covering question, gap, method, data, experiments, writing, meetings, materials, and research-owned code
- Paper library with structured reading notes and a Zotero-ready `source` boundary
- Separate personal/reference projects, competitions, long-term goals, and recoverable archive
- Configurable GPA mapping, semester GPA, cumulative GPA, credits, and course records
- Six-step Evening Review that updates tasks, research progress, paper inbox, deadlines, and dashboard priorities
- Global search, module filters, tags, statuses, priorities, relations, and soft deletion
- Human-readable, Git-friendly JSON persistence with atomic writes

## Technology

- **Next.js + React + TypeScript**: one cross-platform local Web app, typed end to end
- **Node route handlers**: local-only CRUD API with no cloud dependency
- **JSON files**: readable diffs and simple Git backup/merge; no binary database
- **Tailwind + accessible UI primitives**: compact, responsive light/dark interface
- **Node test runner**: zero additional test framework

The architecture stays intentionally small: browser → local Next.js API → JSON store. See [docs/architecture.md](docs/architecture.md) for the relationship model and extension boundaries.

## Installation

Prerequisite: Node.js 22.13 or newer and Git. Node 24 LTS/current works.

### Windows

```powershell
cd research-os
npm install
./start-research-os.cmd
```

Or start it directly with `npm run dev`.

### macOS

```bash
cd research-os
npm install
chmod +x start-research-os.sh sync-pull.sh sync-push.sh
./start-research-os.sh
```

Open [http://localhost:3000](http://localhost:3000). The development server prints the exact address if port 3000 is already occupied.

## Running

For daily use:

```bash
npm run dev
```

For a production-style local run:

```bash
npm run build
npm start
```

The application binds to `127.0.0.1`, so it is available only on the current computer by default.

## Daily workflow

1. Open **今晚更新** once in the evening.
2. Mark completed tasks and note why unfinished work moved.
3. Record the latest research progress.
4. Capture a newly discovered paper or deadline.
5. Re-select the 3–5 priorities that deserve tomorrow's attention.
6. Finish the review; Dashboard updates immediately.

Use the deeper module pages when creating a course/research project or when writing detailed paper and research notes. The Dashboard should remain a decision surface, not a database dump.

## Data

All durable user data is stored in [`data/`](data/) as formatted UTF-8 JSON:

```text
data/
  tasks.json          # weekly tasks, priorities, deadlines
  learning.json       # courses, modules, topics
  research.json       # research projects and research-owned resources/code
  papers.json         # paper metadata and reading notes
  projects.json       # non-research personal/reference projects
  competitions.json
  goals.json
  grades.json
  reviews.json        # evening review history
  settings.json       # GPA mapping and schema version
```

Each collection is separate to keep diffs focused and reduce conflicts. Writes are queued and atomic. You may read or edit these files manually while the server is stopped. Dates use `YYYY-MM-DD`; timestamps use ISO 8601 UTC; relations use stable IDs.

### Backup

The simplest backup is a Git commit. You can also copy the entire `data/` directory. Never copy only one relation-heavy file unless you know its referenced IDs also exist in the destination.

### Demo Data

The initial data demonstrates every module. After exploring it, open **设置 → 清理 Demo Data**. The deletion requires confirmation and retains the default GPA rules.

## Git Sync

Initialize once if this folder has not yet been committed:

```bash
git init
git add .
git commit -m "feat: initial Research OS MVP"
```

### GitHub private repository

Install and authenticate GitHub CLI if it is not already available:

```bash
gh auth login
gh repo create research-os --private --source=. --remote=origin --push
```

Keep `--private`. Alternatively, create a **Private** empty repository in the GitHub website and run:

```bash
git remote add origin git@github.com:YOUR_NAME/research-os.git
git push -u origin main
```

### Pull and push

Windows:

```powershell
./sync-pull.cmd
# use Research OS
./sync-push.cmd
```

macOS:

```bash
./sync-pull.sh
# use Research OS
./sync-push.sh
```

`sync-push` creates a timestamped commit, pulls with rebase, and pushes. `sync-pull` uses rebase with auto-stash so uncommitted local edits are not silently overwritten.

### Move to another computer

1. Install Node.js and Git.
2. Clone the private repository.
3. Run `npm install`.
4. Run the platform start script.
5. Always pull before editing on a different computer, and push when finished.

To minimize conflicts, finish and push the evening update on one device before starting on another. Git can merge changes to different collection files automatically; simultaneous edits to the same JSON array may need a manual merge.

## Updating Research OS safely

1. Run `sync-push` or commit all `data/` changes.
2. Pull or apply the code upgrade.
3. Run `npm install` if `package.json` or `package-lock.json` changed.
4. Run `npm test` and `npm run build`.
5. Start normally and inspect Dashboard.

Application upgrades should never overwrite `data/`. The `schemaVersion` in `data/settings.json` is reserved for explicit future migrations. Keep a Git tag or backup before a major version upgrade.

## Architecture

```text
app/                    Next.js pages and local API routes
components/             application shell, module pages, editors, UI primitives
lib/types.ts            canonical entity contracts
lib/domain.ts           pure GPA, search, priority, and deadline logic
lib/store.ts            atomic JSON persistence and ID generation
data/                   durable user-owned records
docs/architecture.md    entity relationships and extension boundaries
tests/                  persistence and domain tests
```

The UI never reads files directly. It uses `/api/data` and `/api/entities`; the API delegates to `lib/store.ts`. This keeps data, business logic, and rendering separable.

## Quality checks

```bash
npm test
npm run build
# or both
npm run check
```

Tests cover configurable GPA, deadline ordering, priority ordering, cross-module search, create/edit/archive operations, atomic saving, and persistence after a store restart.

## Known MVP limitations

- Designed for one local user/process. Do not run multiple Research OS server processes against the same `data/` directory.
- JSON works well for personal scale, but very large paper libraries may eventually benefit from an indexed read model while retaining JSON as the source of truth.
- Git cannot prevent conflicts when two devices edit the same collection before syncing.
- Paper metadata is manual; Zotero is intentionally not connected yet.
- No calendar, GitHub API, notifications, authentication, or AI is included.
- Progress visualizations summarize explicit milestones rather than inferring progress from time spent.

## Future development

1. **Zotero Integration** — adapter using `source.provider`, `libraryId`, and `externalId`; metadata import without replacing personal notes.
2. **Calendar Integration** — optional read/import adapter for deadline-bearing events.
3. **GitHub API** — connect research-owned repositories and non-research projects while preserving their separate domains.
4. **Automatic Statistics** — semester trends, research throughput, paper reading cadence, stalled-item reports.
5. **AI Assistant** — strictly optional local/bring-your-own-provider layer for review summaries and paper synthesis; never required for core use.

## Privacy

Research OS makes no external API calls and requires no account or API key. Privacy depends on where you store and sync the repository. Use a GitHub **Private** repository and avoid committing secrets, licensed papers, sensitive research data, or participant data.
