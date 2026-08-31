import type { Evidence } from '../shared/contracts'

export interface DerivedEvidence { type: Evidence['type']; title: string; status: Evidence['status']; detail: string }

export class EvidenceService {
  derive(stdout: string, stderr: string, exitCode: number | null): DerivedEvidence[] {
    const evidence: DerivedEvidence[] = []
    const commands = this.extractCommands(stdout)
    for (const command of commands) {
      evidence.push({ type: 'COMMAND', title: command.command, status: command.exitCode === null ? 'UNVERIFIED' : command.exitCode === 0 ? 'PASS' : 'FAIL', detail: command.output.slice(-4000) })
      if (isTestCommand(command.command)) evidence.push({ type: 'TEST', title: command.command, status: command.exitCode === 0 ? 'PASS' : command.exitCode === null ? 'UNVERIFIED' : 'FAIL', detail: command.output.slice(-8000) })
    }
    if (!evidence.some(item => item.type === 'TEST')) {
      const combined = `${stdout}\n${stderr}`
      const proof = combined.match(/(?:Tests?|Test Files?)\s*[:：]?\s*(?:\d+\s+)?(?:passed|PASS|通过)[\s\S]{0,500}/i)
      if (proof) evidence.push({ type: 'TEST', title: 'Runtime reported test result', status: exitCode === 0 ? 'PASS' : 'UNVERIFIED', detail: proof[0] })
    }
    return evidence
  }

  private extractCommands(output: string): Array<{ command: string; exitCode: number | null; output: string }> {
    const results: Array<{ command: string; exitCode: number | null; output: string }> = []
    for (const line of output.split(/\r?\n/)) {
      try {
        const value = JSON.parse(line) as unknown
        this.walk(value, results)
      } catch { /* plain text is retained as transcript, not promoted to command evidence */ }
    }
    return dedupe(results)
  }

  private walk(value: unknown, results: Array<{ command: string; exitCode: number | null; output: string }>): void {
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    const command = firstString(record.command, record.cmd, record.shell_command, record.input)
    if (command && looksLikeCommand(command)) {
      const exit = firstNumber(record.exit_code, record.exitCode, record.code)
      results.push({ command: command.slice(0, 500), exitCode: exit, output: firstString(record.output, record.stdout, record.aggregated_output, record.result) ?? '' })
    }
    for (const child of Object.values(record)) {
      if (Array.isArray(child)) child.forEach(item => this.walk(item, results))
      else if (child && typeof child === 'object') this.walk(child, results)
    }
  }
}

const testPatterns = [/\bnpm\s+(test|run\s+test)/i, /\bpnpm\s+(test|vitest)/i, /\byarn\s+test/i, /\bvitest\b/i, /\bjest\b/i, /\bpytest\b/i, /\bmvn\s+.*test/i, /\bgradle\w*\s+.*test/i, /\bgo\s+test\b/i, /\bcargo\s+test\b/i]
const isTestCommand = (command: string): boolean => testPatterns.some(pattern => pattern.test(command))
const looksLikeCommand = (value: string): boolean => value.length < 2000 && /(?:\s|\/|\\|-)/.test(value)
const firstString = (...values: unknown[]): string | null => values.find(value => typeof value === 'string') as string | undefined ?? null
const firstNumber = (...values: unknown[]): number | null => { const value = values.find(item => typeof item === 'number'); return typeof value === 'number' ? value : null }
const dedupe = <T extends { command: string }>(values: T[]): T[] => [...new Map(values.map(value => [value.command, value])).values()]
