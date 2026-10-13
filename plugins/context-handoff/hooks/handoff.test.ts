import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const

const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

const USAGE = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

const SUMMARY = '## 目前的目標\n做交接 mod\n## 做完了什麼\n寫好 register.tsx\n## 還沒做的\n安裝\n## 改過哪些檔案\n無\n## 要注意的地方\n無'

function engine(on: On) {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, { key: 'engine' })
  })
}

function measure(percent: number) {
  return {
    context: { window: 200000, tokens: percent * 2000, percent },
    rateLimits: [],
    changed: ['context' as const],
  }
}

for (const surface of SURFACES) {
  test(`${surface}: below 70% the band stays empty`, async ($, on) => {
    engine(on)
    await $.session.measure(measure(69))
    const ui = await $.ui.mount({ plugin: 'context-handoff', surface, component: 'AbovePrompt', props: BAND })

    expect(await ui.find({ key: 'handoff' })).toBeUndefined()
  })

  test(`${surface}: at 70% pressing 交接 saves, clears and resubmits`, async ($, on) => {
    engine(on)
    mock.clock(on, { now: new Date(2026, 9, 11, 9, 5, 7).getTime() })
    const writes: { path: string; text: string }[] = []
    const commands: string[] = []
    const prompts: { text: string; asUser?: true }[] = []

    on('model.fork', () => ({ value: { isAnswered: true, text: SUMMARY, usage: USAGE } }))
    on('fs.write', ($, e) => {
      writes.push({ path: e.path, text: e.text })
      return { value: undefined }
    })
    on('command.run', ($, e) => {
      commands.push(e.command)
      return {}
    })
    on('prompt.submit', ($, e) => {
      prompts.push({ text: e.text, asUser: e.origin.kind === 'plugin' ? e.origin.asUser : undefined })
      return { text: e.text }
    })

    await $.session.measure(measure(72))
    const ui = await $.ui.mount({ plugin: 'context-handoff', surface, component: 'AbovePrompt', props: BAND })
    expect((await ui.find({ key: 'handoff' }))?.type).toBe('Button')
    expect(await ui.find({ key: 'engine' })).toBeDefined()

    await ui.press({ key: 'handoff' })

    const path = '.claude/handoffs/handoff-20261011-090507.md'
    expect(writes).toHaveLength(1)
    expect(writes[0].path.replaceAll('\\', '/').endsWith(path)).toBe(true)
    expect(writes[0].text).toBe(`${SUMMARY}\n`)
    expect(commands).toEqual(['clear'])
    expect(prompts).toHaveLength(1)
    expect(prompts[0].text).toContain(path)
    expect(prompts[0].text).toContain('## 還沒做的')
    expect(prompts[0].asUser).toBe(true)
    expect(await ui.find({ key: 'handoff' })).toBeUndefined()
  })

  test(`${surface}: a failed summary keeps the conversation`, async ($, on) => {
    engine(on)
    mock.clock(on)
    const commands: string[] = []

    on('model.fork', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: USAGE } }))
    on('command.run', ($, e) => {
      commands.push(e.command)
      return {}
    })

    await $.session.measure(measure(90))
    const ui = await $.ui.mount({ plugin: 'context-handoff', surface, component: 'AbovePrompt', props: BAND })
    await ui.press({ key: 'handoff' })

    expect(commands).toEqual([])
    expect((await ui.find({ key: 'handoff' }))?.type).toBe('Button')
  })
}
