const fieldRanges = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
] as const;

export function nextCronOccurrence(
  expression: string,
  timezone: string,
  after: Date,
): Date {
  assertTimezone(timezone);
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5)
    throw new Error("Cron 必须包含 5 个字段：分 时 日 月 周");
  const matchers = fields.map((field, index) => {
    const [min, max] = fieldRanges[index];
    return compileField(field, min, max);
  });
  let candidate = new Date(
    Math.floor(after.getTime() / 60_000) * 60_000 + 60_000,
  );
  const end = candidate.getTime() + 370 * 24 * 60 * 60_000;
  while (candidate.getTime() <= end) {
    const parts = localParts(candidate, timezone);
    if (
      matchers[0](parts.minute) &&
      matchers[1](parts.hour) &&
      matchers[2](parts.day) &&
      matchers[3](parts.month) &&
      matchers[4](parts.weekday)
    )
      return candidate;
    candidate = new Date(candidate.getTime() + 60_000);
  }
  throw new Error("未来一年内没有匹配的 Cron 时间");
}

export function renderScheduleTemplate<T>(
  value: T,
  scheduledFor: Date,
  timezone: string,
  prevRunAt: string | null,
): T {
  const local = localParts(scheduledFor, timezone);
  const date = `${local.year}-${pad(local.month)}-${pad(local.day)}`;
  const weekdayOffset = (local.weekday + 6) % 7;
  const weekStart = new Date(
    scheduledFor.getTime() - weekdayOffset * 86_400_000,
  );
  const weekEnd = new Date(weekStart.getTime() + 6 * 86_400_000);
  const variables: Record<string, string> = {
    scheduledFor: scheduledFor.toISOString(),
    date,
    weekStart: formatDate(weekStart, timezone),
    weekEnd: formatDate(weekEnd, timezone),
    prevRunAt: prevRunAt ?? "",
  };
  return JSON.parse(
    JSON.stringify(value).replace(
      /\{\{(scheduledFor|date|weekStart|weekEnd|prevRunAt)\}\}/g,
      (_, key: string) => variables[key],
    ),
  ) as T;
}

function compileField(
  source: string,
  min: number,
  max: number,
): (value: number) => boolean {
  const allowed = new Set<number>();
  for (const part of source.split(",")) {
    const [range, rawStep] = part.split("/");
    const step = rawStep ? Number(rawStep) : 1;
    if (!Number.isInteger(step) || step < 1)
      throw new Error(`Cron 步长无效：${part}`);
    let start: number;
    let end: number;
    if (range === "*") {
      start = min;
      end = max;
    } else if (range.includes("-")) [start, end] = range.split("-").map(Number);
    else {
      start = Number(range);
      end = start;
    }
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < min ||
      end > max ||
      start > end
    )
      throw new Error(`Cron 字段越界：${part}`);
    for (let value = start; value <= end; value += step) allowed.add(value);
  }
  return (value) => allowed.has(value);
}

function localParts(
  date: Date,
  timezone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
} {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
      weekday: "short",
    })
      .formatToParts(date)
      .map((item) => [item.type, item.value]),
  );
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    weekday: weekdays[values.weekday],
  };
}

function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new Error(`无效 IANA 时区：${timezone}`);
  }
}
const pad = (value: number): string => String(value).padStart(2, "0");
const formatDate = (date: Date, timezone: string): string => {
  const p = localParts(date, timezone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};
