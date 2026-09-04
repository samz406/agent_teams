export interface TeamAction {
  agent: string;
  prompt: string;
}
export interface WorkEvidence {
  sources: Array<{
    url: string;
    retrievedAt: string;
    sha256?: string;
    note?: string;
  }>;
  dataFreshness?: { asOf: string; coverage: string };
}

const agentAliases: Record<string, string> = {
  backend: "Code Agent",
  frontend: "Code Agent",
  developer: "Code Agent",
  coder: "Code Agent",
  "code agent": "Code Agent",
  qa: "QA Agent",
  tester: "QA Agent",
  test: "QA Agent",
  "qa agent": "QA Agent",
  architect: "Architect",
  architecture: "Architect",
  leader: "Leader",
  lead: "Leader",
};

export function extractSessionId(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      const id =
        value.session_id ??
        value.sessionId ??
        value.thread_id ??
        value.threadId;
      if (typeof id === "string") return id;
    } catch {
      /* raw text line */
    }
  }
  return null;
}

export function extractFinalResponse(output: string): string {
  const lines = output.split(/\r?\n/);
  const text: string[] = [];
  for (const line of lines) {
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      const candidate =
        value.result ?? value.final_response ?? value.message ?? value.text;
      if (typeof candidate === "string") text.push(candidate);
      else if (
        candidate &&
        typeof candidate === "object" &&
        typeof (candidate as Record<string, unknown>).content === "string"
      )
        text.push(String((candidate as Record<string, unknown>).content));
    } catch {
      if (line.trim()) text.push(line);
    }
  }
  return (
    text.join("\n").trim().slice(-20000) ||
    "CLI 已结束，但没有返回可解析的 Final Response。请打开 Run 查看原始输出。"
  );
}

export function extractTokenUsage(
  output: string,
  prompt: string,
  response: string,
): { inputTokens: number; outputTokens: number } {
  let inputTokens = 0;
  let outputTokens = 0;
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const usage =
      record.usage && typeof record.usage === "object"
        ? (record.usage as Record<string, unknown>)
        : record;
    const input =
      usage.input_tokens ??
      usage.inputTokens ??
      usage.prompt_tokens ??
      usage.promptTokens;
    const outputValue =
      usage.output_tokens ??
      usage.outputTokens ??
      usage.completion_tokens ??
      usage.completionTokens;
    if (typeof input === "number") inputTokens = Math.max(inputTokens, input);
    if (typeof outputValue === "number")
      outputTokens = Math.max(outputTokens, outputValue);
    for (const child of Object.values(record)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  for (const line of output.split(/\r?\n/)) {
    try {
      visit(JSON.parse(line));
    } catch {
      /* plain output */
    }
  }
  return {
    inputTokens: inputTokens || estimateTokens(prompt),
    outputTokens: outputTokens || estimateTokens(response),
  };
}

export function extractTeamActions(output: string): TeamAction[] {
  const actions: TeamAction[] = [];
  const blockPattern = /```(team-actions|json)\s*([\s\S]*?)```/gi;
  for (const match of output.matchAll(blockPattern)) {
    try {
      const parsed = JSON.parse(match[2]) as unknown;
      if (!Array.isArray(parsed) || !parsed.length) continue;
      const valid = parsed.filter((item): item is TeamAction =>
        Boolean(
          item &&
          typeof item === "object" &&
          typeof (item as TeamAction).agent === "string" &&
          typeof (item as TeamAction).prompt === "string",
        ),
      );
      // A generic json block is considered delegation only when the whole array is made of team actions.
      if (match[1].toLowerCase() === "json" && valid.length !== parsed.length)
        continue;
      actions.push(...valid);
    } catch {
      /* ignore malformed delegation blocks */
    }
  }

  const merged = new Map<string, TeamAction>();
  for (const action of actions) {
    const agent = canonicalAgentName(action.agent);
    const prompt = action.prompt.trim();
    if (!agent || !prompt) continue;
    const existing = merged.get(agent);
    merged.set(
      agent,
      existing
        ? {
            agent,
            prompt: `${existing.prompt}\n\n--- Additional delegated work ---\n${prompt}`,
          }
        : { agent, prompt },
    );
  }
  return [...merged.values()].slice(0, 3);
}

export function extractWorkEvidence(output: string): WorkEvidence {
  const merged: WorkEvidence = { sources: [] };
  for (const match of output.matchAll(/```work-evidence\s*([\s\S]*?)```/gi)) {
    try {
      const value = JSON.parse(match[1]) as Partial<WorkEvidence>;
      if (Array.isArray(value.sources))
        merged.sources.push(
          ...value.sources.filter((item) =>
            Boolean(
              item &&
              typeof item.url === "string" &&
              typeof item.retrievedAt === "string",
            ),
          ),
        );
      if (
        value.dataFreshness &&
        typeof value.dataFreshness.asOf === "string" &&
        typeof value.dataFreshness.coverage === "string"
      )
        merged.dataFreshness = value.dataFreshness;
    } catch {
      /* malformed evidence is ignored and later fails the evidence gate */
    }
  }
  merged.sources = [
    ...new Map(merged.sources.map((item) => [item.url, item])).values(),
  ].slice(0, 50);
  return merged;
}

function canonicalAgentName(value: string): string {
  const trimmed = value.trim();
  return agentAliases[trimmed.toLowerCase()] ?? trimmed;
}

const estimateTokens = (value: string): number =>
  Math.max(1, Math.ceil(value.length / 3));
