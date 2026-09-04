import type { Run } from "./contracts";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface UsageSummary {
  schemaVersion: 1;
  provider: "openai" | "anthropic" | "unknown";
  model: string | null;
  usage: TokenUsage;
  costUsd: number | null;
  costType: "REPORTED" | "ESTIMATED" | "UNAVAILABLE";
  pricingVersion: string | null;
}

export interface UsageAggregate {
  usage: TokenUsage;
  costUsd: number;
  pricedRuns: number;
  usageRuns: number;
  unpricedRuns: number;
}

interface Pricing {
  pattern: RegExp;
  provider: UsageSummary["provider"];
  input: number;
  cachedInput: number;
  output: number;
  cacheCreation?: number;
  version: string;
}

type PartialUsage = Omit<TokenUsage, "totalTokens"> & { totalTokens?: number };

// USD per 1M tokens. These are intentionally versioned so historical runs keep the
// estimate that was current when their Usage Evidence was recorded.
// OpenAI: ChatGPT Work / Codex token rate card, effective 2026-07-30.
// Anthropic: public model pricing current 2026-09-01.
const PRICING: Pricing[] = [
  {
    pattern: /gpt-5\.6[-_ ]?sol/i,
    provider: "openai",
    input: 4,
    cachedInput: 0.4,
    output: 20,
    version: "openai-codex-2026-07-30",
  },
  {
    pattern: /gpt-5\.6[-_ ]?terra/i,
    provider: "openai",
    input: 2,
    cachedInput: 0.2,
    output: 12,
    version: "openai-codex-2026-07-30",
  },
  {
    pattern: /gpt-5\.6[-_ ]?luna/i,
    provider: "openai",
    input: 0.2,
    cachedInput: 0.02,
    output: 1.2,
    version: "openai-codex-2026-07-30",
  },
  {
    pattern: /gpt-5\.5(?!.*rosalind)/i,
    provider: "openai",
    input: 5,
    cachedInput: 0.5,
    output: 30,
    version: "openai-codex-2026-07-30",
  },
  {
    pattern: /gpt-5\.3[-_ ]?codex/i,
    provider: "openai",
    input: 1.75,
    cachedInput: 0.175,
    output: 14,
    version: "openai-codex-2026-07-30",
  },
  {
    pattern: /gpt-5\.2/i,
    provider: "openai",
    input: 1.75,
    cachedInput: 0.175,
    output: 14,
    version: "openai-codex-2026-07-30",
  },
  {
    pattern: /claude[-_ ]?sonnet[-_ ]?5/i,
    provider: "anthropic",
    input: 2,
    cachedInput: 0.2,
    cacheCreation: 2.5,
    output: 10,
    version: "anthropic-2026-09-01",
  },
  {
    pattern: /claude[-_ ]?opus[-_ ]?5/i,
    provider: "anthropic",
    input: 5,
    cachedInput: 0.5,
    cacheCreation: 6.25,
    output: 25,
    version: "anthropic-2026-09-01",
  },
  {
    pattern: /claude[-_ ]?opus[-_ ]?4[-_. ]?8/i,
    provider: "anthropic",
    input: 5,
    cachedInput: 0.5,
    cacheCreation: 6.25,
    output: 25,
    version: "anthropic-2026-09-01",
  },
  {
    pattern: /claude[-_ ]?fable[-_ ]?5/i,
    provider: "anthropic",
    input: 10,
    cachedInput: 1,
    cacheCreation: 12.5,
    output: 50,
    version: "anthropic-2026-09-01",
  },
];

const emptyUsage = (): TokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
});
const emptyPartialUsage = (): PartialUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  reasoningOutputTokens: 0,
});

export function extractUsageSummary(output: string): UsageSummary | null {
  if (!output.trim()) return null;
  const candidates: Array<{ usage: PartialUsage; model: string | null }> = [];
  const models: string[] = [];
  const costs: number[] = [];
  let provider: UsageSummary["provider"] = "unknown";

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as unknown;
      const signal = detectProvider(value);
      if (signal !== "unknown") provider = signal;
      walkJson(value, (record) => {
        const model = firstString(
          record.model,
          record.model_name,
          record.modelName,
        );
        if (model) models.push(model);
        const cost = firstNumber(
          record.total_cost_usd,
          record.totalCostUsd,
          record.cost_usd,
          record.costUSD,
        );
        if (cost !== null && cost >= 0) costs.push(cost);

        const usageRecord =
          asRecord(record.usage) ??
          asRecord(record.token_usage) ??
          asRecord(record.tokenUsage);
        if (usageRecord) {
          const usage = normalizeUsage(usageRecord);
          if (hasUsage(usage)) candidates.push({ usage, model });
        }
        if (looksLikeUsageRecord(record)) {
          const usage = normalizeUsage(record);
          if (hasUsage(usage)) candidates.push({ usage, model });
        }

        const modelUsage =
          asRecord(record.modelUsage) ?? asRecord(record.model_usage);
        if (modelUsage) {
          const entries = Object.entries(modelUsage).filter(([, item]) =>
            asRecord(item),
          );
          const aggregate = emptyPartialUsage();
          let aggregateCost = 0;
          let validEntries = 0;
          for (const [modelName, item] of entries) {
            const itemRecord = asRecord(item)!;
            const normalized = normalizeUsage(itemRecord);
            if (!hasUsage(normalized)) continue;
            validEntries += 1;
            models.push(modelName);
            aggregate.inputTokens += normalized.inputTokens;
            aggregate.outputTokens += normalized.outputTokens;
            aggregate.cachedInputTokens += normalized.cachedInputTokens;
            aggregate.cacheCreationInputTokens +=
              normalized.cacheCreationInputTokens;
            aggregate.reasoningOutputTokens += normalized.reasoningOutputTokens;
            const itemCost = firstNumber(
              itemRecord.costUSD,
              itemRecord.cost_usd,
            );
            if (itemCost !== null) aggregateCost += itemCost;
          }
          if (validEntries)
            candidates.push({
              usage: aggregate,
              model:
                validEntries === 1
                  ? (entries.find(([, item]) =>
                      hasUsage(normalizeUsage(asRecord(item)!)),
                    )?.[0] ?? null)
                  : "multiple-models",
            });
          if (aggregateCost > 0) costs.push(aggregateCost);
        }
      });
    } catch {
      /* Runtime transcripts can contain plain text alongside JSONL. */
    }
  }

  if (!candidates.length) return null;
  const selected = candidates.sort(
    (a, b) => rawTokenScore(b.usage) - rawTokenScore(a.usage),
  )[0];
  const model = selected.model ?? mostSpecificModel(models);
  if (provider === "unknown") provider = inferProviderFromModel(model);
  const usage = finalizeUsage(selected.usage, provider);
  if (!usage.totalTokens) return null;

  const reportedCost = costs.length ? Math.max(...costs) : null;
  if (reportedCost !== null && reportedCost > 0) {
    return {
      schemaVersion: 1,
      provider,
      model,
      usage,
      costUsd: roundCost(reportedCost),
      costType: "REPORTED",
      pricingVersion: "runtime-reported",
    };
  }
  const estimate = estimateCost(model, usage);
  return {
    schemaVersion: 1,
    provider: estimate?.provider ?? provider,
    model,
    usage,
    costUsd: estimate?.costUsd ?? null,
    costType: estimate ? "ESTIMATED" : "UNAVAILABLE",
    pricingVersion: estimate?.version ?? null,
  };
}

export function parseUsageEvidence(detail: string): UsageSummary | null {
  try {
    const value = JSON.parse(detail) as UsageSummary;
    if (
      value?.schemaVersion !== 1 ||
      !value.usage ||
      typeof value.usage.totalTokens !== "number"
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

export function usageForRun(
  run: Run,
  liveOutput?: string,
): UsageSummary | null {
  if (liveOutput && ["QUEUED", "STARTING", "RUNNING"].includes(run.status)) {
    const live = extractUsageSummary(liveOutput);
    if (live) return live;
  }
  const evidence = [...run.evidence]
    .reverse()
    .find((item) => item.type === "USAGE");
  return evidence ? parseUsageEvidence(evidence.detail) : null;
}

export function aggregateRunUsage(
  runs: Run[],
  live: Record<string, string> = {},
): UsageAggregate {
  const aggregate: UsageAggregate = {
    usage: emptyUsage(),
    costUsd: 0,
    pricedRuns: 0,
    usageRuns: 0,
    unpricedRuns: 0,
  };
  for (const run of runs) {
    const summary = usageForRun(run, live[run.id]);
    if (!summary) continue;
    aggregate.usageRuns += 1;
    aggregate.usage.inputTokens += summary.usage.inputTokens;
    aggregate.usage.outputTokens += summary.usage.outputTokens;
    aggregate.usage.cachedInputTokens += summary.usage.cachedInputTokens;
    aggregate.usage.cacheCreationInputTokens +=
      summary.usage.cacheCreationInputTokens;
    aggregate.usage.reasoningOutputTokens +=
      summary.usage.reasoningOutputTokens;
    aggregate.usage.totalTokens += summary.usage.totalTokens;
    if (summary.costUsd !== null) {
      aggregate.costUsd += summary.costUsd;
      aggregate.pricedRuns += 1;
    } else aggregate.unpricedRuns += 1;
  }
  aggregate.costUsd = roundCost(aggregate.costUsd);
  return aggregate;
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trim(value / 1_000)}K`;
  return String(value);
}

export function formatCost(
  aggregate: Pick<UsageAggregate, "costUsd" | "pricedRuns" | "usageRuns">,
): string {
  if (!aggregate.usageRuns || !aggregate.pricedRuns) return "成本暂无";
  const amount =
    aggregate.costUsd < 0.01
      ? aggregate.costUsd.toFixed(4)
      : aggregate.costUsd.toFixed(2);
  return `~$${amount}${aggregate.pricedRuns < aggregate.usageRuns ? "+" : ""}`;
}

export function formatDuration(
  run: Pick<Run, "startedAt" | "endedAt">,
): string | null {
  if (!run.startedAt) return null;
  const end = run.endedAt ? Date.parse(run.endedAt) : Date.now();
  const ms = Math.max(0, end - Date.parse(run.startedAt));
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes < 60
    ? `${minutes}m${rest ? `${rest}s` : ""}`
    : `${Math.floor(minutes / 60)}h${minutes % 60}m`;
}

function estimateCost(
  model: string | null,
  usage: TokenUsage,
): {
  costUsd: number;
  version: string;
  provider: UsageSummary["provider"];
} | null {
  if (!model) return null;
  const pricing = PRICING.find((item) => item.pattern.test(model));
  if (!pricing) return null;
  const million = 1_000_000;
  let cost = 0;
  if (pricing.provider === "openai") {
    const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
    cost =
      (uncached * pricing.input +
        usage.cachedInputTokens * pricing.cachedInput +
        usage.outputTokens * pricing.output) /
      million;
  } else {
    cost =
      (usage.inputTokens * pricing.input +
        usage.cachedInputTokens * pricing.cachedInput +
        usage.cacheCreationInputTokens *
          (pricing.cacheCreation ?? pricing.input) +
        usage.outputTokens * pricing.output) /
      million;
  }
  return {
    costUsd: roundCost(cost),
    version: pricing.version,
    provider: pricing.provider,
  };
}

function normalizeUsage(record: Record<string, unknown>): PartialUsage {
  return {
    inputTokens:
      firstNumber(
        record.input_tokens,
        record.inputTokens,
        record.prompt_tokens,
        record.promptTokens,
      ) ?? 0,
    outputTokens:
      firstNumber(
        record.output_tokens,
        record.outputTokens,
        record.completion_tokens,
        record.completionTokens,
      ) ?? 0,
    cachedInputTokens:
      firstNumber(
        record.cached_input_tokens,
        record.cachedInputTokens,
        record.cache_read_input_tokens,
        record.cacheReadInputTokens,
      ) ?? 0,
    cacheCreationInputTokens:
      firstNumber(
        record.cache_creation_input_tokens,
        record.cacheCreationInputTokens,
        record.cache_write_input_tokens,
        record.cacheWriteInputTokens,
      ) ?? 0,
    reasoningOutputTokens:
      firstNumber(
        record.reasoning_output_tokens,
        record.reasoningOutputTokens,
        asRecord(record.output_tokens_details)?.reasoning_tokens,
      ) ?? 0,
    totalTokens:
      firstNumber(record.total_tokens, record.totalTokens) ?? undefined,
  };
}

function finalizeUsage(
  raw: PartialUsage,
  provider: UsageSummary["provider"],
): TokenUsage {
  const totalTokens =
    raw.totalTokens ??
    (provider === "anthropic"
      ? raw.inputTokens +
        raw.cachedInputTokens +
        raw.cacheCreationInputTokens +
        raw.outputTokens
      : raw.inputTokens + raw.outputTokens + raw.cacheCreationInputTokens);
  return {
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
    cachedInputTokens: raw.cachedInputTokens,
    cacheCreationInputTokens: raw.cacheCreationInputTokens,
    reasoningOutputTokens: raw.reasoningOutputTokens,
    totalTokens,
  };
}

function detectProvider(value: unknown): UsageSummary["provider"] {
  const record = asRecord(value);
  if (!record) return "unknown";
  const type = firstString(record.type);
  if (type && /^(thread\.|turn\.|item\.)/i.test(type)) return "openai";
  if (
    record.total_cost_usd !== undefined ||
    record.modelUsage !== undefined ||
    record.model_usage !== undefined
  )
    return "anthropic";
  return "unknown";
}

function inferProviderFromModel(
  model: string | null,
): UsageSummary["provider"] {
  if (!model) return "unknown";
  if (/^(gpt|o\d|codex)/i.test(model)) return "openai";
  if (/claude/i.test(model)) return "anthropic";
  return "unknown";
}

function walkJson(
  value: unknown,
  visit: (record: Record<string, unknown>) => void,
): void {
  const record = asRecord(value);
  if (!record) return;
  visit(record);
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) child.forEach((item) => walkJson(item, visit));
    else if (asRecord(child)) walkJson(child, visit);
  }
}

function looksLikeUsageRecord(record: Record<string, unknown>): boolean {
  return [
    "input_tokens",
    "inputTokens",
    "output_tokens",
    "outputTokens",
    "prompt_tokens",
    "completion_tokens",
  ].some((key) => typeof record[key] === "number");
}

function hasUsage(usage: PartialUsage): boolean {
  return rawTokenScore(usage) > 0;
}
function rawTokenScore(usage: PartialUsage): number {
  return (
    usage.totalTokens ??
    usage.inputTokens +
      usage.outputTokens +
      usage.cachedInputTokens +
      usage.cacheCreationInputTokens
  );
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function firstString(...values: unknown[]): string | null {
  return (
    (values.find((value) => typeof value === "string" && value.length > 0) as
      string | undefined) ?? null
  );
}
function firstNumber(...values: unknown[]): number | null {
  const value = values.find(
    (item) => typeof item === "number" && Number.isFinite(item),
  );
  return typeof value === "number" ? value : null;
}
function mostSpecificModel(models: string[]): string | null {
  return models.filter(Boolean).sort((a, b) => b.length - a.length)[0] ?? null;
}
function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
function trim(value: number): string {
  return value >= 100
    ? value.toFixed(0)
    : value >= 10
      ? value.toFixed(1).replace(/\.0$/, "")
      : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
