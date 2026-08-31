# V0.1 实现与验收矩阵

本表区分“代码能力已实现”和“需要在真实项目/目标操作系统上完成发布验收”。产品底线是 No Simulated Workers：没有真实 CLI、真实 Workspace 或真实 Evidence 时，界面只能显示未执行/未验证，不能显示虚假的 Agent 完成消息。

| 能力 | 实现状态 | 验收证据 |
|---|---|---|
| 真实 CLI Worker | 已实现 | Claude/Codex/OpenCode/pi 自动检测，Custom executable；spawn 真实进程并保存原始输出、Exit Code、Session ID |
| 自定义 Agent | 已实现 | 名称、责任、质量标准、Runtime、权限、Workspace Scope 数据模型与创建页 |
| 多 Workspace / 并行 Run | 已实现 | 一个 Change 可挂多个目录；RunManager 用独立 Child Process 并行执行，事件按 Run 隔离 |
| Session、Run、Evidence | 已实现 | SQLite 持久化；Chat 正式回复绑定 Run；Inspector 下钻 Transcript、Command、Git、Diff、Files |
| Agent → Agent | 已实现 | 真实 Final Response 中的 `team-actions` 产生目标 Agent 新 Run，最多并行三项 |
| No Fake Completion | 已实现 | Runtime `COMPLETED` 只表示 CLI 退出；Workflow 不自动推进，测试文本只记为 UNVERIFIED |
| Human Override | 已实现 | Pause/Stop 作用于真实进程；Resume/Retry 创建 Parent Run 并保留现场和旧证据 |
| 五种 Workflow | 已实现 | 阶段、Goal、Deliverable、Exit Criteria、Human Mode 预置并可视化 |
| Human Gate / Artifact Current Truth | 已实现 | IN_LOOP 阶段未批准 Artifact 时拒绝推进；新版本可 supersede 旧版本 |
| 崩溃恢复 | 已实现 | 启动时将残留活动 Run 事务性标记 INTERRUPTED；Chat/Run/Artifact 不丢失 |
| Git Worktree 隔离 | 数据模型/方案已保留，自动创建未完成 | 发布前需实现每个写 Agent 的独立 Branch/Worktree 与安全回收 |
| 独立 QA 强约束 | Workflow 已实现，身份级自动校验未完成 | Bug Fix E2E 需阻止实现 Agent 作为最终 Verifier |
| Integration Case / Handoff / Issue | Workflow/Artifact 可承载，结构化实体未完成 | 跨项目 E2E 需补 Case、Owner、Fix、Retest 和正式 Handoff 状态 |
| 发布 Go/No-Go 阻塞规则 | Workflow Gate 已实现，Evidence 依赖图未完成 | Blocking FAIL 必须在领域规则层阻止 Go，而不只依赖人工 Gate |
| 跨平台安装包 | 构建配置已完成 | macOS arm64/x64、Windows x64、Linux x64 需分别在目标 Runner 重建 Native Module 并签名验收 |

## 已自动验证

- TypeScript 严格类型检查；Electron Main、Preload、Renderer 生产构建。
- 五种 Workflow 完整性、Human Gate、阶段投影单元测试。
- CLI JSONL 的 Session/Final Response 解析和 Agent 委派协议单元测试。
- SQLite Change/Message/Artifact 审批恢复集成测试。
- GitHub Actions 在 push / pull request 时自动执行安装、测试、类型检查和生产构建。

## 发布前真实 E2E

必须使用已登录 CLI 与真实 Git Repo 完成：双 Repo 跨项目协作、三个 Agent 线上会诊、Bug 独立复验、两步受控重构、包含 Blocking FAIL 的发布检查。每次 E2E 都要从最终结果反向追踪到 Phase → Agent → Run → Command/Diff/Test/Evidence；未跑过的场景不得标记通过。
