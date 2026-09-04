import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";
import type { RuntimeInfo, RuntimeType } from "../../shared/contracts";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

const definitions: Array<Omit<RuntimeInfo, "path" | "version" | "available">> =
  [
    {
      type: "claude",
      label: "Claude Code",
      executable: "claude",
      capabilities: [
        "stream",
        "native-session",
        "resume",
        "interrupt",
        "usage",
      ],
    },
    {
      type: "codex",
      label: "Codex CLI",
      executable: "codex",
      capabilities: [
        "stream",
        "native-session",
        "resume",
        "interrupt",
        "structured-output",
        "usage",
      ],
    },
    {
      type: "opencode",
      label: "OpenCode",
      executable: "opencode",
      capabilities: ["stream", "session", "structured-output"],
    },
    {
      type: "pi",
      label: "pi",
      executable: "pi",
      capabilities: ["stream", "interrupt"],
    },
    {
      type: "custom",
      label: "Custom CLI",
      executable: "",
      capabilities: ["configurable"],
    },
  ];

export async function resolveLoginEnvironment(): Promise<NodeJS.ProcessEnv> {
  if (process.platform === "win32") return { ...process.env };
  const shell = process.env.SHELL || "/bin/zsh";
  try {
    const { stdout } = await execFileAsync(shell, ["-ilc", "env"], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    const loginEnv = Object.fromEntries(
      stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const index = line.indexOf("=");
          return index > 0
            ? [line.slice(0, index), line.slice(index + 1)]
            : [line, ""];
        }),
    );
    return { ...process.env, ...loginEnv };
  } catch {
    return { ...process.env };
  }
}

export async function detectRuntimes(): Promise<RuntimeInfo[]> {
  const env = await resolveLoginEnvironment();
  const result: RuntimeInfo[] = [];
  for (const runtime of definitions) {
    if (runtime.type === "custom") {
      result.push({ ...runtime, path: null, version: null, available: true });
      continue;
    }
    try {
      const locate =
        process.platform === "win32"
          ? `where ${runtime.executable}`
          : `command -v ${runtime.executable}`;
      const { stdout: pathOut } = await execAsync(locate, {
        env,
        timeout: 3000,
      });
      const path = pathOut.trim().split(/\r?\n/)[0];
      const { stdout, stderr } = await execFileAsync(path, ["--version"], {
        env,
        timeout: 5000,
        maxBuffer: 256 * 1024,
      });
      result.push({
        ...runtime,
        path,
        version: (stdout || stderr).trim().split(/\r?\n/)[0],
        available: true,
      });
    } catch {
      result.push({ ...runtime, path: null, version: null, available: false });
    }
  }
  return result;
}

export function runtimeArgs(
  type: RuntimeType,
  prompt: string,
  argsTemplate?: string | null,
): string[] {
  if (type === "claude")
    return ["-p", prompt, "--output-format", "stream-json", "--verbose"];
  if (type === "codex") return ["exec", "--json", prompt];
  if (type === "opencode") return ["run", prompt, "--format", "json"];
  if (type === "pi") return ["-p", prompt];
  if (!argsTemplate) return [prompt];
  const token = "__MOXT_PROMPT__";
  const templated = argsTemplate.replaceAll("{prompt}", token);
  const args =
    templated
      .match(/(?:[^\s"]+|"[^"]*")+/g)
      ?.map((value) => value.replace(/^"|"$/g, "")) ?? [];
  return args.map((value) => value.replaceAll(token, prompt));
}
