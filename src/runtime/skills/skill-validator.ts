export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateJsonSchema(
  value: unknown,
  schema: Record<string, unknown>,
  path = "$",
): ValidationResult {
  const errors: string[] = [];
  visit(value, schema, path, errors);
  return { valid: errors.length === 0, errors };
}

function visit(
  value: unknown,
  schema: Record<string, unknown>,
  path: string,
  errors: string[],
): void {
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))
  )
    errors.push(`${path} 不在允许值中`);
  const type = schema.type;
  if (typeof type === "string" && !matchesType(value, type)) {
    errors.push(`${path} 应为 ${type}`);
    return;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const required = Array.isArray(schema.required)
      ? schema.required.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
    for (const key of required)
      if (!(key in record)) errors.push(`${path}.${key} 为必填字段`);
    const properties =
      schema.properties && typeof schema.properties === "object"
        ? (schema.properties as Record<string, unknown>)
        : {};
    for (const [key, child] of Object.entries(properties))
      if (key in record && child && typeof child === "object")
        visit(
          record[key],
          child as Record<string, unknown>,
          `${path}.${key}`,
          errors,
        );
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems)
      errors.push(`${path} 至少需要 ${schema.minItems} 项`);
    if (schema.items && typeof schema.items === "object")
      value.forEach((item, index) =>
        visit(
          item,
          schema.items as Record<string, unknown>,
          `${path}[${index}]`,
          errors,
        ),
      );
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength)
      errors.push(`${path} 长度不能小于 ${schema.minLength}`);
    if (typeof schema.pattern === "string") {
      try {
        if (!new RegExp(schema.pattern).test(value))
          errors.push(`${path} 不匹配 ${schema.pattern}`);
      } catch {
        errors.push(`${path} 的 pattern 无效`);
      }
    }
  }
}

function matchesType(value: unknown, type: string): boolean {
  if (type === "object")
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number")
    return typeof value === "number" && Number.isFinite(value);
  if (type === "null") return value === null;
  return typeof value === type;
}

export function parseStructuredOutput(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  for (const candidate of [fenced, content]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate.trim());
    } catch {
      /* keep trying */
    }
  }
  return content;
}
