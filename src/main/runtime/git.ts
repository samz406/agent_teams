import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename } from "node:path";

const run = promisify(execFile);

async function git(path: string, args: string[]): Promise<string | null> {
  try {
    return (
      await run("git", ["-C", path, ...args], {
        timeout: 10000,
        maxBuffer: 8 * 1024 * 1024,
      })
    ).stdout.trim();
  } catch {
    return null;
  }
}

export async function inspectWorkspace(
  path: string,
): Promise<{
  name: string;
  repoRoot: string | null;
  branch: string | null;
  baseCommit: string | null;
}> {
  const repoRoot = await git(path, ["rev-parse", "--show-toplevel"]);
  return {
    name: basename(path),
    repoRoot,
    branch: repoRoot ? await git(path, ["branch", "--show-current"]) : null,
    baseCommit: repoRoot ? await git(path, ["rev-parse", "HEAD"]) : null,
  };
}

export async function collectGitEvidence(
  path: string,
  baseCommit: string | null,
): Promise<{
  status: string;
  diff: string;
  files: string[];
  head: string | null;
}> {
  const status =
    (await git(path, ["status", "--short"])) ?? "Not a Git workspace";
  const head = await git(path, ["rev-parse", "HEAD"]);
  const diff = baseCommit
    ? ((await git(path, ["diff", "--stat", baseCommit, "--"])) ?? "")
    : ((await git(path, ["diff", "--stat"])) ?? "");
  const names = baseCommit
    ? await git(path, ["diff", "--name-only", baseCommit, "--"])
    : await git(path, ["diff", "--name-only"]);
  return {
    status,
    diff,
    files: names?.split("\n").filter(Boolean) ?? [],
    head,
  };
}
