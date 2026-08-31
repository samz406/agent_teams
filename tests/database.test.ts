import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AppDatabase } from '../src/main/database'

const paths: string[] = []
afterEach(() => { for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }) })

describe('transactional local persistence', () => {
  it('persists changes, messages, artifacts and evidence lineage', () => {
    const directory = mkdtempSync(join(tmpdir(), 'moxt-test-'))
    paths.push(directory)
    const db = new AppDatabase(join(directory, 'moxt.db'))
    const snapshot = db.snapshot([])
    const workspace = db.addWorkspace({ name: 'repo', path: directory, repoRoot: null, branch: null, baseCommit: null })
    const change = db.createChange({ title: 'Fix issue', description: 'Reproduce and fix', workflowType: 'bug-fix', priority: 'P1', workspaceIds: [workspace.id], agentIds: [snapshot.agents[0].id], tags: ['test'] })
    const artifact = db.createArtifact(change.id, 'REPORT', 'Root Cause', '# Evidence')
    db.approveArtifact(artifact.id, true)
    const restored = db.snapshot([])
    expect(restored.changes[0].id).toBe(change.id)
    expect(restored.messages.some(message => message.changeId === change.id)).toBe(true)
    expect(restored.artifacts[0].status).toBe('APPROVED')
  })
})
