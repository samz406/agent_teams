# V0.1 实现与验收矩阵

本表区分“代码能力已实现”和“需要在真实项目/目标操作系统上完成发布验收”。产品底线是 No Simulated Workers：没有真实 CLI、真实 Workspace 或真实 Evidence 时，界面只能显示未执行/未验证，不能显示虚假的 Agent 完成消息。

| 能力 | 实现状态 | 验收证据 |
|---|---|---|
| 真实 CLI Worker | 已实现 | Claude/Codex/OpenCode/pi 自动检测，Custom executable；spawn 真实进程并保存原始输出、Exit Code、Session ID |
| 自定义 Agent | 已实现 | 名称、责任、质量标准、Runtime、权限、Workspace Scope 数据模型与创建页 |
| 独立 Runtime / Adapter | 已实现 | Electron Utility Process 托管 DB、Adapter 和真实 CLI；Main 只做代理；五类 Adapter 有统一启动、恢复、终止和解析契约 |
| 多 Workspace / 并发队列 | 已实现 | 一个 Change 可挂多个目录；全局 RuntimeQueue 限制最多三个活动 Run，队列支持取消且事件按 Run 隔离 |
| Session、Run、Evidence | 已实现 | AgentSession 保存原生 Session ID；Claude/Codex/OpenCode 可原生 Resume；Inspector 下钻 Command、Git、Diff、Test 与 Runtime Evidence |
| Agent → Agent | 已实现 | 真实 Final Response 中的 `team-actions` 只可委派当前 Team，产生结构化 Task、Handoff 和真实 Worker Run |
| No Fake Completion | 已实现 | `RUN_COMPLETED` 进入 VERIFYING；Leader 按阶段验证 PASS Evidence，不满足则 REWORK 并创建 Blocking Issue |
| Human Override | 已实现 | Pause/Stop 作用于真实进程；Resume/Retry 创建 Parent Run 并保留现场和旧证据 |
| 五种 Workflow | 已实现 | 阶段、Goal、Deliverable、Exit Criteria、Human Mode 预置并可视化 |
| Human Gate / Artifact Current Truth | 已实现 | IN_LOOP 阶段未批准 Artifact 时拒绝推进；新版本可 supersede 旧版本 |
| 崩溃恢复 | 已实现 | 启动时事务性标记残留 Run 为 INTERRUPTED、Session 为 INTERRUPTED、Task/Workstream 为 BLOCKED，Chat/Artifact/Evidence 不丢失 |
| 协作领域模型 | 已实现 | Task、Workstream、AgentSession、Handoff、Issue、HumanIntervention 均为 SQLite 实体并进入统一 Snapshot |
| Git Worktree 隔离 | 已实现 | 写 Binding 强制 Git Workspace，并按 Change/Agent 创建持久 Branch/Worktree；越界路径与非 Git 写入均拒绝 |
| 独立 QA 强约束 | 已实现 | Bug Fix Verify 阶段在验收和推进两层拒绝实现 Agent 作为最终 Verifier |
| 发布 Go/No-Go 阻塞规则 | 已实现 | 未解决 Blocking Issue 在领域层阻止任何阶段推进；测试/Runtime FAIL 不能满足 Evidence Gate |
| 跨平台安装包 | 构建配置已完成 | macOS arm64/x64、Windows x64、Linux x64 需分别在目标 Runner 重建 Native Module 并签名验收 |

## 已自动验证

- TypeScript 严格类型检查；Electron Main、Preload、Renderer 生产构建。
- 五种 Workflow 完整性、Human Gate、阶段投影单元测试。
- CLI JSONL 的 Session/Final Response 解析和 Agent 委派协议单元测试。
- SQLite 协作模型与异常恢复集成测试。
- RuntimeQueue 并发/取消、真实 Git Worktree 隔离、Leader Evidence 验收/返工测试。
- 构建后 Electron Utility Process 冒烟测试，验证独立 Runtime 可启动并返回完整 Snapshot Contract。
- GitHub Actions 在 push / pull request 时自动执行安装、测试、类型检查和生产构建。

## 发布前真实 E2E

必须使用已登录 CLI 与真实 Git Repo 完成：双 Repo 跨项目协作、三个 Agent 线上会诊、Bug 独立复验、两步受控重构、包含 Blocking FAIL 的发布检查。每次 E2E 都要从最终结果反向追踪到 Phase → Agent → Run → Command/Diff/Test/Evidence；未跑过的场景不得标记通过。
