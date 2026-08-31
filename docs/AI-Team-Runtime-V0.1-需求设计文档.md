# AI Team Runtime V0.1 需求设计文档

> 产品定位：面向真实软件研发场景的 AI Native Team Runtime。用户通过 Chat 指挥由多个可自定义 Agent 组成的团队，Agent 背后绑定本地真实 Coding Agent CLI（如 Claude Code、Codex、pi、OpenCode 或 Custom CLI），由 Leader 根据任务目标、当前 Team、Workspace、Agent 责任和真实执行结果动态组织协作。系统不是 Multi-Agent Chat Demo，也不是固定 DAG 编排器，而是一套让多个真实 Coding Agent 能够被组织、观察、约束、协同、验收和持续复用的研发执行系统。

## 1. 产品目标

V0.1 的目标不是证明“多个 Agent 可以聊天”，而是证明多个真实 Coding Agent 可以在一个统一 Team Runtime 中，围绕真实代码仓库完成可验证的软件研发任务。用户能够创建一个 Change/任务会话，挂载一个或多个本地项目，加入或由 Leader 自动选择 Agent；Leader 能根据 Agent 的角色描述、责任、Workspace 权限和实时状态分配工作；Worker Agent 通过真实 CLI Session 执行任务并返回真实结果；Leader 基于 Session、Diff、测试、Artifact、命令结果等 Evidence 判断下一步；用户全程可以看到每个 Agent 的工作状态、完整历史 Session，并可随时通过 @leader 或直接 @agent 暂停、终止、纠偏、继续或重试。V0.1 必须支持 5 种基本协作模式：跨项目协同开发、线上问题会诊、Bug 修复、大型重构、发布前检查。

产品成功标准不是“任务能跑完”，而是同时满足四个条件：第一，所有 Worker 都是真实 Execution-backed Agent，不允许模拟 Worker；第二，所有关键任务结论都有可追踪的 Session 和 Evidence；第三，Leader 的下一步决策建立在真实 Agent Result 与 Workflow 状态之上；第四，用户可以透明观察并随时取得控制权。

## 2. 核心设计原则

### 2.1 No Simulated Workers

Worker Agent 的任务反馈必须来源于真实 CLI Runtime Session。系统不能额外调用一个普通 LLM 模拟“DE Agent 已经调查完成”“测试已经通过”之类结果。Team Chat 中 Worker 的正式回复必须能够定位到真实 `AgentSession + Run`，并展示对应执行证据。

### 2.2 Evidence-backed Execution

Agent 的“我完成了”不是事实。系统事实包括 Workspace、Git 状态、命令输出、Exit Code、Diff、测试结果、生成 Artifact、Commit、Integration Result 等。`RUN_COMPLETED` 只表示一次 CLI 执行结束，只有经过 Leader 或 Workflow 验收后才能进入 `TASK_ACCEPTED`。

### 2.3 Transparent by Default

用户默认能看到：当前 Agent 状态、当前任务、运行时、Workspace、Session、Run、实时 Activity、完整 Transcript、命令、文件访问、Diff、测试、Artifact、历史 Session。Team Chat 只展示高层协作消息，详细过程通过 Agent Inspector 下钻，避免聊天区域被日志淹没。

### 2.4 Human Always in Control

用户拥有最高优先级控制权，可以通过 UI 或 Chat 执行 Pause、Resume、Stop、Retry、Send Instruction、Reject Result、Change Constraint、Force Replan。用户可以 `@leader` 让 Leader 纠偏某个 Agent，也可以直接 `@agent` 修改执行要求；直接干预 Worker 时，Leader 必须自动收到变更事件，保证团队认知一致。

### 2.5 Context Must Be Relevant and Trustworthy

Context 不追求越多越好。Agent 每次执行应获得：Role Context + Current Task + Private Session + Relevant Team Events + Relevant Artifacts + Relevant Workspace Evidence。系统还必须区分内容可信度和生命周期：当前有效事实、Approved Proposal、当前源码和真实测试 Evidence 优先于历史讨论、草稿和 Deprecated Artifact。

### 2.6 Agent Is a Responsibility Unit

Agent 不是“一个 Prompt + 一个模型”，而是长期可管理的责任主体。Agent 应包含 Identity、Responsibility、Quality Standard、Runtime、Workspace Scope、Permission、Rules/Memory。CLI Runtime 是 Agent 的执行引擎，可以替换；Agent 的角色、责任和历史仍保留。

### 2.7 Workflow Is Responsibility Flow

Workflow 不是固定 `A → B → C` 的 DAG，而是“事情在不同状态下由谁负责、需要什么输入、必须交付什么、什么时候交给谁、卡住时谁判断”的责任状态机。Leader 在 Workflow 护栏内动态决定调用哪个 Agent、是否并行、是否加人、是否返工、是否回退或升级。

## 3. 核心领域模型

### 3.1 Change / Mission

Change 是一个完整业务或技术目标，是 V0.1 的顶层工作单元，例如“GF 接入 DE 的 XXX 能力”“修复订单重复支付”“重构 OrderService”。一个 Change 可以跨多个 Repo、多个 Agent、多个 Workstream、多个 Session 和多个阶段。历史列表优先展示 Change，而不是孤立 Task。

### 3.2 Team Session

一个 Chat 会话对应一个 Change 的协作空间。Team Session 保存用户、Leader、Agent 之间的协作消息、Workflow 状态、Handoff、Artifact、Human Override、关键 Decision 等。Team Session 不是任一 CLI Agent 的原生 Session。

### 3.3 Agent

Agent 是团队中的责任角色。V0.1 至少包含以下字段：`id`、`name`、`description`、`responsibility`、`quality_bar`、`runtime`、`command`、`workspace_scope`、`permissions`、`rules`、`status`。Agent 可由用户自定义，不预设“Claude=架构师、Codex=开发”等固定映射。

示例：

```yaml
id: de-agent
name: DE Engineer
responsibility: 负责 DE 项目功能分析、开发、单测和对外 Contract 实现正确性
quality_bar:
  - 保持旧接口兼容
  - 修改必须有测试证据
runtime: claude-code
command: claude
workspace:
  read: [de, gf]
  write: [de]
```

### 3.4 Agent Pool、Session Team、Active Agents

系统需要区分四层关系：`Agent Pool` 是用户长期维护的 Agent 库；`Session Team` 是本次 Change 可能参与的 Agent；`Task Participants` 是当前阶段关联的 Agent；`Active Agents` 是此刻实际执行或等待输入的 Agent。默认由 Leader 选择最小可行团队，避免所有 Agent 全程参与造成 Context 和协调爆炸。

### 3.5 Workspace

Workspace 是真实代码工作现场，可以对应本地目录、Git Repo，后续可扩展到 WSL、SSH、Docker。Team Session 可以同时挂载多个 Workspace。Agent 与 Workspace 不永久绑定，Assignment/Workstream 决定本次“谁在什么 Workspace 做什么”。执行型 Agent 默认独立 Git Worktree/Branch；架构、Review 类 Agent可只读多个 Workspace。

### 3.6 Workstream

Workstream 表示某个 Agent 在某个 Workspace 上围绕 Change 持续推进的一条工作线。例如 `DE Agent → /xxx/de → 实现 XXX API`、`GF Agent → /xx/gf → 接入 DE API`。Workstream 保存 owner、workspace、task、branch/worktree、status、milestones、dependencies、sessions、evidence。

### 3.7 Agent Session 与 Run

`Agent Session` 是某个 Agent 的真实 Runtime 工作上下文，可对应 Claude Code Session、Codex Thread 或其他 CLI Session。一个 Session 中可以存在多个 Run。`Run` 是一次真实 CLI 执行，记录 input、parent_run、runtime_session_id、workspace、base_commit、status、start/end time、stdout/structured events、final_response、commands、files、diff、tests、artifacts、exit_code、usage、human_intervention。失败或重试不能覆盖旧 Run，必须形成 Execution Lineage。

### 3.8 Artifact、Current Truth、Evidence

Artifact 用于正式团队共识，不应只靠 Chat 口头同步。V0.1 至少支持 Requirement、Investigation Result、Proposal、API Contract、Integration Plan、Review Report、Release Readiness Report。Artifact 必须包含 `type/status/version/owner/scope/supersedes/source`。Approved Proposal、当前源码、真实 Test/Runtime Evidence 属于高可信内容；历史讨论、旧版本、草稿必须标注生命周期。Current Truth 用于指示“现在到底以什么为准”。

### 3.9 Handoff

`@mention` 是沟通，Handoff 是责任转移。Agent 完成正式 Deliverable 后，Workflow 可生成 `HANDOFF(from, to, artifact, reason)`，使下一 Workstream 从 Waiting 变为 Ready。不能依赖 Agent 是否记得手动 @ 下一位，避免流程停死。

## 4. 总体交互结构

桌面端采用“左侧 Team/Workspace + 中部 Team Chat + 右侧 Work Status/Agent Inspector”三栏结构，右侧可折叠。中部 Chat 是主要操作入口，用户以自然语言和 @mention 管理团队；复杂执行细节通过右侧下钻，不要求用户使用 DAG 或项目管理视图。

```text
┌─────────────────┬──────────────────────────────────────────┬──────────────────────┐
│ TEAM/WORKSPACES │                TEAM CHAT                 │     WORK STATUS      │
│ ★ Leader        │ User: @leader GF 接入 DE XXX...          │ Change               │
│ ● DE Agent      │ Leader: 进入 Discovery...               │ Phase: Development   │
│ ● GF Agent      │ DE Agent: ● Running [真实Session]        │ DE ● Coding          │
│ ○ Architect     │ GF Agent: ● Running [真实Session]        │ GF ● Coding          │
│ ○ Reviewer      │ ...                                      │ Proposal v2 🔒       │
│ ○ QA            │                                          │ [Sessions][Artifacts]│
│                 │ @ 输入消息...                            │                      │
│ DE /xxx/de      │                                          │                      │
│ GF /xx/gf       │                                          │                      │
└─────────────────┴──────────────────────────────────────────┴──────────────────────┘
```

Agent Chat 消息需要显示 Runtime、Session、Run 与关键 Evidence 摘要，例如：

```text
DE Agent · Claude Code · Session S-DE-108 · Run R-DE-311
✓ Investigation Complete
结论：……
Evidence: Files read 32 · Changed 0 · Commands 18 · Exit 0
[Open Session]
```

点击 Agent 进入 Inspector，可查看 Current Task、Runtime、Workspace、Session、Live Activity、Transcript、Commands、Files、Diff、Tests、Artifacts、Session History，以及 Pause/Resume/Stop/Retry/Send Instruction。

## 5. Leader 设计

Leader 是拥有 Team Control Tools 的特殊 Agent，同时是 Workflow 责任协调器。Leader 不应只是 Router。核心循环为：`Observe → Understand → Decide → Delegate → Verify → Replan`。Leader 必须能读取当前 Team Roster、Agent Responsibility、Workspace、Workflow、Current Truth、Agent Result、Artifact、Evidence、Issue，并调用 `assign_agent`、`send_message`、`pause_run`、`cancel_run`、`request_review`、`create_handoff`、`replan`、`accept_task` 等工具。

Leader 的关键规则：第一，分配任务前根据责任和 Scope 选择 Agent，而不是按 CLI 名称；第二，收到 `RUN_COMPLETED` 后必须检查任务要求、Proposal、Final Response 和 Evidence，再决定 Accept/Rework；第三，Agent 之间观点冲突时按 claim/evidence/risk/recommendation 收敛，不能简单多数投票；第四，出现重大 Contract Change、缺权限、证据不足、产品/架构取舍等情况必须升级到 Leader 或 Human；第五，用户 Human Override 具有最高优先级。

## 6. CLI Runtime 设计

V0.1 支持 Claude Code、Codex、pi 和 Custom CLI，架构上统一为 Runtime Adapter。Adapter 至少提供：`detect()`、`start()`、`resume()`、`interrupt()`、`cancel()`、`streamEvents()`、`parseResult()`、`getSessionId()`、`capabilities()`。Capability 至少包含：supports_stream、supports_resume、supports_interrupt、supports_native_session、supports_structured_output、supports_usage、supports_checkpoint。

应用启动时扫描本地 CLI，并在 Settings 展示安装状态和路径。Custom CLI 至少允许配置 executable、args/template、working directory、environment、output mode、resume command、session parser、cancel signal。UI 上的 Pause/Resume 必须作用于真实 Runtime；不支持原生 Resume 的 Runtime 必须通过 Checkpoint + 新 Run 模拟恢复，并明确记录为新的 Run，不得伪装为原生同一进程继续。

## 7. 执行控制与状态机

Run 状态至少包括：`QUEUED → STARTING → RUNNING → WAITING/BLOCKED/PAUSED → COMPLETED/FAILED/CANCELLED`。Task 状态至少包括：`ASSIGNED → RUNNING → RUN_COMPLETED → VERIFYING → ACCEPTED/REWORK/BLOCKED/CANCELLED`。暂停表示准备继续；Blocked 表示缺依赖、权限或外部输入；Stop/Cancel 表示结束当前 Run。终止 Run 不得自动 `git reset --hard`，必须保留 Diff 和现场，用户或 Leader 后续选择保留修改、丢弃 Run 修改、从 Run 前 Checkpoint 重做或新 Worktree 重做。

每个 Run 开始前必须记录 `base_commit/worktree/checkpoint`；重试必须记录 `parent_run + retry_reason + new_constraints`。例如用户要求“不要改 GamePublishService，走 IntegrationProvider”，旧 Run 进入 Cancelled，新 Run 继承 Session/Context，并记录 Human Constraint 和 Parent Run。

## 8. Context 与知识治理

Context Router 每次给 Agent 组装 Context 时必须考虑 relevance、authority、freshness、scope。推荐优先级：当前 Approved Contract/Proposal > 当前 Workspace 代码与 Evidence > 当前 Task Artifact > 当前 Decision > 历史 Verified Artifact > Session Summary > Discussion/Draft > Deprecated。禁止把所有 Team Chat、所有 Agent 历史 Session 全量塞给每个 Worker。

V0.1 不要求做复杂长期 Memory 学习，但必须从数据模型上保留以下层次：Execution Memory（做过什么）、Role Memory（这个岗位长期规则）、Project Truth（当前项目事实）、Decision History（为什么做这个决定）、Workflow Memory（后续版本）。Human Correction 需要标记为 Task Constraint、Agent Rule Candidate、Project Truth Candidate 或 Workflow Improvement Candidate，V0.1 可以只记录，不自动长期写入 Rule。

## 9. Adaptive Workflow

Workflow 是阶段、责任和 Gate 的护栏。每个 Phase 定义：Goal、Owner、Workers、Input、Deliverable、Policy、Exit Criteria、Handoff、Fallback、Human Mode。Human Mode 支持 `AUTO / ON_LOOP / REVIEW / IN_LOOP`。Workflow 可以由 Leader 根据任务自动选择，也可由用户指定；执行过程中 Leader 可以升级或调整 Workflow，但必须保留历史并说明原因。

V0.1 提供 5 种标准 Workflow，不提供可视化 DAG 编辑器。用户创建任务时默认选择 Auto，Leader 判断任务类型并给出所采用 Workflow；用户可修改。

## 10. 五种基本协作模式

### 10.1 模式一：跨项目协同开发 Cross-Project Change

适用于一个业务需求同时影响多个 Repo/系统，例如“GF 接入 DE XXX，同时 DE 也需要改造”。默认阶段：`Discovery → Joint Proposal → Human Approval → Parallel Development → Integration → Review → Done`。Discovery 阶段相关 Agent 并行读取各自 Workspace，并允许通过 @mention 横向补充信息；Proposal 必须形成正式 Cross-Project Proposal 和 Contract，方案确认前禁止写代码；Human Approval 是强 Gate；开发时每个项目建立独立 Workstream 和 Worktree，双方围绕 Approved Contract 并行开发；重大 Contract Change 必须发起 Change Request；开发完成后 Leader 创建 Integration Plan，QA 或相关 Agent执行真实联调并形成 Issue Ownership；全部阻塞 Issue 关闭、Review 通过后才能 Done。

验收标准：至少支持 2 个 Workspace、2 个执行 Agent 并行调查与开发；双方 Agent 可通过真实 Runtime Session 互相 @ 提问并收到真实回复；系统可生成 Proposal v1/v2 并支持 Human Approve/Request Changes；Approval 前代码变更数必须为 0；开发阶段能够显示两个 Workstream 的独立 Session、Diff 和测试；Contract 变更可暂停相关 Workstream 并记录 Change Request；Integration 至少支持 3 个 Case、Issue Owner、Fix、Retest；最终 Done 页面可追踪两个 Repo 的最终 Commit、测试、Integration Result、所有 Agent Session。

### 10.2 模式二：线上问题会诊 Incident Investigation

适用于 CPU、GC、慢接口、错误率上升等生产问题。默认阶段：`Incident Intake → Parallel Investigation → Evidence Collection → Root Cause Proposal → Human/Leader Confirm → Fix → Verify → Done`。Leader 根据当前 Agent Pool 最小化组队，例如 Code、DB、Runtime 三类责任；多个 Agent 可并行读取源码、日志或用户提供的 Evidence；Agent 之间可互相质疑和补证据；Leader 必须区分症状、根因和假设，形成 Root Cause Report，再决定是否修改代码。

验收标准：支持至少 3 个 Agent 并行 Investigation；每个结论可定位到对应 Session/Evidence；Leader 能在一个 Agent“完成”后继续等待其他 Evidence，而不是自动进入 Fix；Root Cause Report 必须标注 Confirmed/Probable/Unknown；用户可以在 Root Cause 阶段要求补查某方向；Fix 完成后必须提供性能/功能验证 Evidence，不能仅凭 Agent 文字宣布恢复。

### 10.3 模式三：Bug 修复 Bug Fix with Independent Verification

适用于可复现缺陷。默认阶段：`Reproduce → Root Cause → Fix → Independent Verify → Regression → Review → Done`。Bug/QA Agent 首先建立 Reproduction Case，开发 Agent 根据真实复现信息修复；实现 Agent 不能自己作为最终验收人，修复后 Handoff 给独立 QA/Verifier，用原 Reproduction Case 重跑。

验收标准：Reproduction Artifact 必须包含条件、步骤、Expected、Actual、Evidence；开发 Agent 修复前必须关联 Reproduction；修复完成后 `RUN_COMPLETED` 不等于 Done；独立 Agent 必须执行原复现 Case 并产出真实结果；如仍失败，Task 自动回到 REWORK，保留失败 Run；Regression 通过、Review 无 Blocking Issue 才允许 Done。

### 10.4 模式四：大型重构 Controlled Refactor

适用于高风险、行为必须保持稳定的重构。默认阶段：`Behavior Discovery → Characterization Tests → Architecture Proposal → Human Approval → Incremental Refactor → Regression → Review → Done`。重构前必须建立行为基线；Proposal 明确拆分步骤；每一步只允许有限 Scope 修改，并在下一步前通过测试和 Leader 验收；Leader 可因证据不足停止继续迁移。

验收标准：没有 Characterization Test/等价行为 Evidence 时禁止进入正式 Refactor；Human Approval 是强 Gate；支持至少 2 个增量 Step，每个 Step 有独立 Run、Diff、Tests；任一步失败可回退到上一个已验收 Checkpoint，不影响已验收步骤；最终 Regression 需要证明核心行为未改变；Reviewer 必须检查是否出现超出 Proposal Scope 的额外改动。

### 10.5 模式五：发布前检查 Release Readiness

适用于版本上线前的多方验证。默认阶段：`Scope Freeze → Parallel Checks → Risk Triage → Fix Blocking Issues → Recheck → Go/No-Go → Done`。Reviewer、QA、Security/Release 等 Agent 可并行检查代码 Diff、测试、配置、Migration、依赖和部署风险。Leader 必须基于 Evidence 输出 Go/No-Go，不得把“Agent 没发现问题”直接等价为 Go。

验收标准：至少支持 3 类并行检查；每个 Check 有 PASS/WARN/FAIL 和 Evidence；任何 Blocking FAIL 都必须阻止 Go；修复后只能重跑受影响 Check 或依赖 Check，保留原失败记录；最终 Release Readiness Report 必须列出所有检查项、Blocking/Warn、Owner、Resolution 和最终 Go/No-Go 决策；No-Go 后任务可继续修复而不是关闭 Change。

## 11. Chat 与 Agent 透明执行体验

Team Chat 只展示高层协作与 Agent 正式 Final Response，但任何正式 Worker 消息必须绑定 Runtime Session/Run。实时工作状态以卡片或一行进度展示，例如 `DE Agent ● Running · Claude Code · /xxx/de · 3m12s [查看执行过程] [暂停] [终止]`。点击后右侧展示 Agent Inspector。Session 历史按 Agent 保留，用户可以查看“这个 Agent 当前任务的所有历史 Session”和历史任务 Session。

Agent 对 Agent 的 @mention 必须触发目标 Agent 的真实 Runtime Session Resume/Run，不能由系统模拟回答。发送给目标 Agent 的上下文至少包含发送者真实 Final Response、相关 Artifact 和当前任务必要信息。Leader 可以读取 Worker Session Result、Evidence 和必要的 Transcript，再做下一步判断。

## 12. Human Override

支持两条路径：`@leader 某 Agent 方向错了，按 XXX 重新做`；或直接 `@agent 先停，这里应该按 XXX`。第一种由 Leader执行 pause/inspect/update constraint/retry；第二种直接更新 Worker，但必须自动生成 `HUMAN_INTERVENTION` 并通知 Leader。Human Override 需要记录 target、reason、new_constraints、affected_run、operator、time。用户纠偏后旧 Run 不覆盖，新 Run 与旧 Run 建立 Parent 关系。

## 13. 权限与安全边界

V0.1 权限至少支持 Workspace Read/Write、Shell、Git、Network。加入 Team 不代表获得所有 Workspace 权限。执行 Agent 默认只写自己负责 Workspace；Architect/Reviewer 可多 Workspace 只读；涉及删除、大规模覆盖、危险 Shell 命令的权限策略应可配置。Runtime 凭据优先使用用户本机已有 CLI 登录态，不在 Team Chat 中暴露密钥。所有 Agent 的真实命令与文件修改必须可审计。

## 14. 数据持久化

V0.1 使用本地 SQLite 保存 Project/Workspace、Agent、Agent Runtime Config、Change、Team Session、Workflow、Phase、Task、Workstream、Message、Agent Session、Run、Artifact、Decision、Handoff、Issue、Evidence、Human Intervention 等元数据。大型 CLI Transcript 可以采用文件 + SQLite 索引。系统重启后，用户必须可以恢复 Change、Chat、Agent Session 历史、Run 状态和未完成 Workflow；对于运行中进程异常退出，需要明确显示 Interrupted，并允许 Resume/Retry，不能静默标记完成。

## 15. 非功能要求

### 15.1 可靠性

任何 Agent CLI 崩溃、桌面 UI 重启、Runtime 进程异常都不能丢失已持久化 Chat、Run、Diff、Artifact 和 Workflow 状态。关键状态变更采用事件持久化或事务方式，避免 Chat 显示“Done”而底层 Run 未落盘。

### 15.2 可追踪性

从最终 Change Done 必须能够向下追踪到 Phase → Workstream/Task → Agent Session → Run → Command/Diff/Test/Evidence；从任何 Run 也能反向知道它属于哪个 Change、哪个 Task、由谁触发、为什么重试。

### 15.3 性能与并发

V0.1 至少支持一个 Team Session 内 3 个 Agent 同时运行真实 CLI，不因任一 Agent 的 stdout 阻塞 UI；流式日志不能导致 Team Chat 卡顿；长 Transcript 采用增量加载。

### 15.4 跨平台

V0.1 支持 macOS、Windows、Linux 桌面。推荐 Electron + React/TypeScript，Local Agent Runtime 独立 Node.js/TypeScript 进程，CLI/PTY 通过统一 Runtime Adapter 管理。Windows 需要考虑 PowerShell/cmd/WSL PATH；V0.1 可先保证 Local Host，WSL/SSH/Docker 作为后续 ExecutionEnvironment 扩展点。

## 16. V0.1 核心页面

1. **Workspace/Change Home**：最近 Change、状态、Workflow、参与 Agent、Workspace。
2. **Team Chat**：主要交互入口，支持 @leader/@agent、真实 Agent Response、状态卡片、Artifact 卡片、Human Gate。
3. **Agent Inspector**：当前任务、状态、Runtime、Workspace、Session、Live Activity、Pause/Resume/Stop/Retry。
4. **Agent Session History**：当前 Agent 所有历史 Session，进入后查看 Transcript、Runs、Commands、Files、Diff、Tests、Artifacts、Usage。
5. **Workflow/Change Status**：轻量 Phase Bar、当前 Owner、Active Agents、Exit Criteria、Blocking Issue。
6. **Artifact Viewer**：Proposal/Contract/Integration Plan/Report，支持版本、Approve、Request Changes、Supersedes。
7. **Agent Management**：创建自定义 Agent，配置 Responsibility、Runtime、CLI、Workspace Scope、Permissions。
8. **Runtime Settings**：检测 Claude Code/Codex/pi/OpenCode/Custom CLI，查看 Path/Capability/Status。

V0.1 不做：复杂 DAG 设计器、Agent Avatar/虚拟办公室、自动 Team 自进化、长期绩效体系、跨公司 Agent Marketplace、移动端完整执行、云端托管 Coding Runtime。

## 17. 核心验收总表

| 编号 | 验收项 | 通过标准 |
|---|---|---|
| AC-01 | 真实 CLI Worker | 至少 Claude Code、Codex 两种 CLI 可以作为自定义 Agent Runtime 被真实调用并返回真实 Final Response |
| AC-02 | 自定义 Agent | 用户可以创建 Agent，自定义名称、职责描述、Runtime、Workspace Scope、权限；Leader 能读取这些信息做任务分配 |
| AC-03 | 多 Workspace | 一个 Change 可以挂载至少 2 个 Repo/目录，不同 Agent 可分别读写不同 Workspace |
| AC-04 | 并行执行 | 同一个 Team Session 至少 3 个 Agent 可以同时真实执行 CLI，状态和流式 Activity 独立可见 |
| AC-05 | Agent Session | 每个 Agent 的真实 Runtime Session/Thread 可被保存并继续；用户可查看当前及历史 Session |
| AC-06 | Agent→Agent | `@agent` 可以触发目标 Agent 的真实 Session Run，并把真实回复回写 Team Chat |
| AC-07 | Leader 判断 | Leader 收到 Worker 完成事件后能读取 Final Response + Evidence，再决定 Accept/Rework/Next Task |
| AC-08 | No Fake Completion | Worker 输出“完成”但缺少要求的测试/Evidence 时，Leader 可以拒绝验收，Task 不进入 Accepted |
| AC-09 | Human Override | 用户可通过 @leader 或直接 @agent 暂停、纠偏并重新执行；旧 Run 保留，新 Run 有 Parent/Reason |
| AC-10 | Pause/Resume/Stop/Retry | UI 操作必须控制真实 Runtime/Process；状态切换与 Session/Checkpoint 可追踪 |
| AC-11 | Workflow | 支持 5 种标准 Workflow；每个 Phase 有 Owner、Deliverable、Exit Criteria、Handoff、Fallback、Human Mode |
| AC-12 | Human Gate | 跨项目 Proposal 和大型重构 Proposal 未人工 Approve 前禁止进入代码开发阶段 |
| AC-13 | Artifact 信任结构 | Artifact 支持 Draft/Approved/Deprecated/Version/Supersedes；Agent Context 优先当前 Approved 版本 |
| AC-14 | Handoff | Deliverable 完成后可正式将责任从一个 Agent/Phase 转移到下一个 Agent/Phase，不依赖手工 @ |
| AC-15 | Worktree 隔离 | 并行写代码的 Agent 使用独立 Worktree/Branch；终止 Run 不自动破坏其他 Agent 工作 |
| AC-16 | Evidence | Run 至少记录 exit code、commands、files、diff、tests（如存在）、final response；Chat 可打开对应证据 |
| AC-17 | 失败恢复 | App/Runtime 重启后，已完成 Run、Session、Artifact、Chat、Workflow 不丢失；未完成 Run 显示 Interrupted 并可处理 |
| AC-18 | 跨项目联调 | Cross-Project 模式可以创建 Integration Plan、Case、Issue Owner、Fix、Retest，最终形成 Integration Result |
| AC-19 | 独立验证 | Bug Fix 模式中开发 Agent 不能自己完成最终验收，必须由独立 QA/Verifier 重跑原 Reproduction Case |
| AC-20 | Go/No-Go | Release Readiness 模式中 Blocking FAIL 必须阻止 Done/Go，修复后保留原失败历史并重新检查 |

## 18. V0.1 端到端验收场景

最终发布前必须用真实项目完成以下 5 个 E2E 验收，而不是 Mock：第一，选择两个真实 Repo，执行一次“跨项目协同开发”，完成双方调查、Proposal Approval、并行开发、至少一次 Agent-to-Agent 沟通、一次 Human Override、联调和 Final Review；第二，对一个真实性能问题执行 3 Agent 并行 Investigation，并让 Leader基于不同 Evidence 形成 Root Cause；第三，对一个真实或可构造 Bug 创建 Reproduction、修复并由独立 Agent 重跑；第四，对一个真实模块执行至少两步受控重构，并验证中途失败可基于 Checkpoint 回退/重试；第五，对一个真实版本执行 Release Readiness，制造至少一个 Blocking Check，确认系统能阻止 Go，修复后重新验证。

V0.1 只有在上述 5 个场景全部可以由真实 CLI Agent 完成，并且用户可以从最终结果回溯到每一个真实 Session、Run、Diff、Test 和 Human Decision 时，才认为具备“可实际使用”的最低标准。只完成 UI 对话、模拟 Agent 消息、无法恢复 Session、无法追踪 Evidence、无法真实暂停/继续、无法跨 Repo 联调，均不得判定 V0.1 完成。

## 19. 产品边界与后续方向

V0.1 聚焦 Coding/研发团队，因为代码、Git、Diff、Test、Runtime Log 可以提供客观 Evidence，是验证 AI Native Team 机制最合适的场景。后续可扩展 Team Memory、Agent Owner、Rules/Skills 改进、Workflow Improvement、Agent Performance、自动 Team Formation、WSL/SSH/Docker Executor、Web/Mobile Remote Controller，以及产品/研究/运营等非 Coding Agent。长期方向不是增加更多 Agent 数量，而是让责任划分、可信 Context、Workflow、Handoff、Evidence 和 Human Review 逐步沉淀为可复用的团队运行方式。

## 20. 一句话产品定义

**一个让人通过 Chat 管理真实 AI 软件团队的本地执行平台：Agent 是责任角色，CLI Agent 是执行引擎，Workspace 是真实工作现场，Session/Run 是执行事实，Artifact 是团队共识，Workflow 管责任流转，Leader 基于 Evidence 动态协调，而人始终拥有最终控制权。**