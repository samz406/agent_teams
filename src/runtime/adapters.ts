import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  PermissionSet,
  RuntimeInfo,
  RuntimeType,
} from "../shared/contracts";
import { extractFinalResponse, extractSessionId } from "../main/runtime/parser";
import {
  detectRuntimes,
  resolveLoginEnvironment,
} from "../main/runtime/environment";

export interface AdapterRunInput {
  executable: string;
  prompt: string;
  cwd: string;
  permissions: PermissionSet;
  nativeSessionId: string | null;
  argsTemplate?: string | null;
}

export interface AdapterLaunch {
  child: ChildProcessWithoutNullStreams;
  redactedCommand: string;
}

export interface RuntimeAdapter {
  readonly type: RuntimeType;
  readonly supportsNativeResume: boolean;
  detect(all: RuntimeInfo[]): RuntimeInfo | undefined;
  start(input: AdapterRunInput): Promise<AdapterLaunch>;
  resume(input: AdapterRunInput): Promise<AdapterLaunch>;
  interrupt(child: ChildProcessWithoutNullStreams): Promise<void>;
  cancel(child: ChildProcessWithoutNullStreams): Promise<void>;
  parse(output: string): {
    finalResponse: string;
    nativeSessionId: string | null;
  };
}

abstract class ProcessAdapter implements RuntimeAdapter {
  abstract readonly type: RuntimeType;
  abstract readonly supportsNativeResume: boolean;
  protected abstract startArgs(input: AdapterRunInput): string[];
  protected resumeArgs(input: AdapterRunInput): string[] {
    return this.startArgs(input);
  }

  detect(all: RuntimeInfo[]): RuntimeInfo | undefined {
    return all.find((item) => item.type === this.type);
  }

  async start(input: AdapterRunInput): Promise<AdapterLaunch> {
    return this.launch(input, this.startArgs(input));
  }
  async resume(input: AdapterRunInput): Promise<AdapterLaunch> {
    if (!this.supportsNativeResume || !input.nativeSessionId)
      return this.start(input);
    return this.launch(input, this.resumeArgs(input));
  }

  private async launch(
    input: AdapterRunInput,
    args: string[],
  ): Promise<AdapterLaunch> {
    this.assertPermissionSupport(input.permissions);
    const env = await resolveLoginEnvironment();
    const child = spawn(input.executable, args, {
      cwd: input.cwd,
      env: {
        ...env,
        MOXT_PERMISSION_WRITE: String(input.permissions.write),
        MOXT_PERMISSION_NETWORK: String(input.permissions.network),
      },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    return {
      child,
      redactedCommand: `${input.executable} ${args.map((arg) => (arg === input.prompt || arg.includes(input.prompt.slice(0, 30)) ? "<prompt>" : arg)).join(" ")}`,
    };
  }

  protected assertPermissionSupport(permissions: PermissionSet): void {
    if (!permissions.read)
      throw new Error("Agent 没有 Workspace Read 权限，Runtime 拒绝启动");
    if (!permissions.shell || !permissions.git)
      throw new Error(
        "当前 Adapter 无法可靠执行部分 Shell/Git 权限；已拒绝执行而不是静默放宽权限",
      );
  }

  parse(output: string): {
    finalResponse: string;
    nativeSessionId: string | null;
  } {
    return {
      finalResponse: extractFinalResponse(output),
      nativeSessionId: extractSessionId(output),
    };
  }
  interrupt(child: ChildProcessWithoutNullStreams): Promise<void> {
    return stopProcessTree(child, false);
  }
  cancel(child: ChildProcessWithoutNullStreams): Promise<void> {
    return stopProcessTree(child, true);
  }
}

class ClaudeAdapter extends ProcessAdapter {
  readonly type = "claude" as const;
  readonly supportsNativeResume = true;
  protected startArgs(input: AdapterRunInput): string[] {
    return [
      "-p",
      input.prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      input.permissions.write ? "acceptEdits" : "plan",
    ];
  }
  protected resumeArgs(input: AdapterRunInput): string[] {
    return [
      "--resume",
      input.nativeSessionId!,
      "-p",
      input.prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      input.permissions.write ? "acceptEdits" : "plan",
    ];
  }
  protected assertPermissionSupport(p: PermissionSet): void {
    super.assertPermissionSupport(p);
    if (!p.network)
      throw new Error(
        "Claude Code Adapter 无法可靠强制禁用 Network；已拒绝执行而不是忽略权限",
      );
  }
}

class CodexAdapter extends ProcessAdapter {
  readonly type = "codex" as const;
  readonly supportsNativeResume = true;
  protected startArgs(input: AdapterRunInput): string[] {
    return [
      "exec",
      "--json",
      "--sandbox",
      input.permissions.write ? "workspace-write" : "read-only",
      input.prompt,
    ];
  }
  protected resumeArgs(input: AdapterRunInput): string[] {
    return [
      "exec",
      "resume",
      input.nativeSessionId!,
      "--json",
      "--sandbox",
      input.permissions.write ? "workspace-write" : "read-only",
      input.prompt,
    ];
  }
}

class OpenCodeAdapter extends ProcessAdapter {
  readonly type = "opencode" as const;
  readonly supportsNativeResume = true;
  protected startArgs(input: AdapterRunInput): string[] {
    return ["run", input.prompt, "--format", "json"];
  }
  protected resumeArgs(input: AdapterRunInput): string[] {
    return [
      "run",
      "--session",
      input.nativeSessionId!,
      input.prompt,
      "--format",
      "json",
    ];
  }
  protected assertPermissionSupport(p: PermissionSet): void {
    super.assertPermissionSupport(p);
    if (!p.write)
      throw new Error("OpenCode Adapter 当前不能强制只读沙箱，已拒绝执行");
  }
}

class PiAdapter extends ProcessAdapter {
  readonly type = "pi" as const;
  readonly supportsNativeResume = false;
  protected startArgs(input: AdapterRunInput): string[] {
    return ["-p", input.prompt];
  }
  protected assertPermissionSupport(p: PermissionSet): void {
    super.assertPermissionSupport(p);
    if (!p.write)
      throw new Error("pi Adapter 当前不能强制只读沙箱，已拒绝执行");
  }
}

class CustomAdapter extends ProcessAdapter {
  readonly type = "custom" as const;
  readonly supportsNativeResume = false;
  protected startArgs(input: AdapterRunInput): string[] {
    if (!input.argsTemplate) return [input.prompt];
    const marker = "__MOXT_PROMPT__";
    return (
      input.argsTemplate
        .replaceAll("{prompt}", marker)
        .match(/(?:[^\s"]+|"[^"]*")+/g) ?? []
    ).map((value) =>
      value.replace(/^"|"$/g, "").replaceAll(marker, input.prompt),
    );
  }
  protected assertPermissionSupport(p: PermissionSet): void {
    super.assertPermissionSupport(p);
    if (!p.write || !p.network)
      throw new Error(
        "Custom CLI 无法证明所需权限隔离，已拒绝执行；请使用受支持的 Adapter",
      );
  }
}

export class AdapterRegistry {
  private adapters = new Map<RuntimeType, RuntimeAdapter>([
    ["claude", new ClaudeAdapter()],
    ["codex", new CodexAdapter()],
    ["opencode", new OpenCodeAdapter()],
    ["pi", new PiAdapter()],
    ["custom", new CustomAdapter()],
  ]);
  get(type: RuntimeType): RuntimeAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) throw new Error(`不支持的 Runtime: ${type}`);
    return adapter;
  }
  detect(): Promise<RuntimeInfo[]> {
    return detectRuntimes();
  }
}

async function stopProcessTree(
  child: ChildProcessWithoutNullStreams,
  force: boolean,
): Promise<void> {
  if (!child.pid) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn(
        "taskkill",
        ["/pid", String(child.pid), "/T", force ? "/F" : ""],
        { windowsHide: true },
      );
      killer.once("close", () => resolve());
      killer.once("error", () => resolve());
    });
    return;
  }
  try {
    process.kill(-child.pid, force ? "SIGTERM" : "SIGINT");
  } catch {
    child.kill(force ? "SIGTERM" : "SIGINT");
  }
  await new Promise((resolve) => setTimeout(resolve, force ? 300 : 1200));
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}
