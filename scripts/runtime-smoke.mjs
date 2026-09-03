import { app, utilityProcess } from 'electron'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('ozone-platform', 'headless')
const directory = mkdtempSync(join(tmpdir(), 'moxt-runtime-smoke-'))

const timeout = setTimeout(() => finish(new Error('Runtime smoke test timed out')), 15000)
let child

app.whenReady().then(() => {
  child = utilityProcess.fork(resolve('out/main/runtime.js'), [], { env: { ...process.env, MOXT_DATA_DIR: directory }, stdio: 'pipe' })
  child.stderr?.on('data', value => process.stderr.write(value))
  child.on('message', message => {
    if (message?.event) return
    if (!message.ok) return finish(new Error(message.error))
    if (message.id === 'smoke') {
      if (!Array.isArray(message.result?.agents) || !Array.isArray(message.result?.tasks) || !Array.isArray(message.result?.conversations)) return finish(new Error('Runtime snapshot contract is incomplete'))
      const agents = message.result.agents.slice(0, 2)
      child.postMessage({ id: 'create-conversation', request: { type: 'conversation.create', input: { title: 'Runtime smoke discussion', topic: 'Can agents share a bounded context?', background: 'Smoke test', mode: 'roundtable', maxRounds: 1, participants: agents.map((agent, index) => ({ agentId: agent.id, roleName: agent.name, rolePrompt: 'Provide a distinct view', isLeader: index === 0 })) } } })
      return
    }
    if (message.id === 'create-conversation') {
      if (message.result?.status !== 'DRAFT') return finish(new Error('Conversation creation contract is incomplete'))
      child.postMessage({ id: 'verify-conversation', request: { type: 'snapshot.get' } })
      return
    }
    if (message.id === 'verify-conversation') {
      if (message.result?.conversations?.length !== 1 || message.result?.conversationParticipants?.length !== 2) return finish(new Error('Conversation persistence is incomplete'))
      process.stdout.write(`Runtime process OK · ${message.result.agents.length} seeded agents · conversation persistence OK\n`)
      finish()
    }
  })
  child.on('exit', code => { if (code && code !== 0) finish(new Error(`Runtime exited with ${code}`)) })
  child.postMessage({ id: 'smoke', request: { type: 'snapshot.get' } })
})

function finish(error) {
  clearTimeout(timeout)
  child?.kill()
  rmSync(directory, { recursive: true, force: true })
  if (error) { console.error(error); app.exit(1) }
  else app.exit(0)
}
