import type { Evidence, OutputContract } from "../../shared/contracts";
import {
  parseStructuredOutput,
  validateJsonSchema,
} from "../skills/skill-validator";

export interface OutputValidation {
  valid: boolean;
  errors: string[];
  structured: unknown;
}

export function validateOutput(
  content: string,
  contract: OutputContract,
  evidence: Evidence[],
): OutputValidation {
  const errors: string[] = [];
  const structured = parseStructuredOutput(content);
  if (contract.schema && Object.keys(contract.schema).length)
    errors.push(...validateJsonSchema(structured, contract.schema).errors);
  for (const section of contract.requiredSections ?? [])
    if (
      !new RegExp(`(^|\\n)#{1,6}\\s+${escape(section)}(?:\\s|$)`, "i").test(
        content,
      )
    )
      errors.push(`缺少章节：${section}`);
  for (const word of contract.forbidden ?? [])
    if (word && content.includes(word)) errors.push(`包含禁止内容：${word}`);
  const required = new Set([...(contract.requiredEvidence ?? [])]);
  for (const type of required)
    if (!evidence.some((item) => item.type === type && item.status === "PASS"))
      errors.push(`缺少通过的 ${type} Evidence`);
  if (
    contract.mustCite &&
    !evidence.some((item) => item.type === "SOURCE" && item.status === "PASS")
  )
    errors.push("未提供可核验来源");
  return { valid: errors.length === 0, errors, structured };
}

const escape = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
