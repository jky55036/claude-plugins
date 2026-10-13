import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionUsage } from 'claude-code'

const MINUTE = 60 * 1000
const START = Date.UTC(2026, 9, 10, 4, 0, 0)

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

const BAND = { plugin: 'usage-band', component: 'AbovePrompt', props: PROPS } as const

function setup(on: On, usage: SessionUsage) {
  const clock = mock.clock(on, { now: START })
  const toasts: string[] = []
  on('session.start', $ => ({ cwd: '/' }))
  on('session.usage', () => ({ value: usage }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', () => ({ value: { isSent: false, reason: 'no-surface' } }) as const)
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="beneath" />
  })
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* ($, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'ok',
      toolUses: [],
      stopReason: 'end_turn',
      usage: null,
    }
  })
  return { clock, toasts }
}

async function step($: Engine, agentId?: string) {
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1, agentId })
  for await (const _ of stream) {
  }
}

const HIGH: SessionUsage = {
  startedAt: START,
  context: { tokens: 620, window: 1000, percent: 62 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 85, resetsAt: '2026-10-10T06:30:00Z' },
    { kind: 'seven_day', percentUsed: 23, resetsAt: '2026-10-14T12:00:00Z' },
  ],
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: meters fill segmented cells shading green to red, percent matching the last cell`, async ($, on) => {
    setup(on, HIGH)
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    const ui = await $.ui.mount({ ...BAND, surface })
    const percents = await ui.findAll({ type: 'Text', text: /%$/ })
    const byText = Object.fromEntries(percents.map(r => [r.text, r.props.color]))
    expect(byText['62%']).toBe('#e6872e')
    expect(byText['85%']).toBe('#e53935')
    expect(byText['23%']).toBe('#78b445')
    const cells = await ui.findAll({ type: 'Text', text: '▰' })
    const colors = cells.map(c => c.props.color).filter(c => c !== undefined)
    expect(colors).toHaveLength(6 + 9 + 2)
    expect(colors[0]).toBe('#4caf50')
    expect(colors[6]).toBe('#4caf50')
    expect(colors[6 + 7]).toBe('#e53935')
    expect(colors[6 + 8]).toBe('#e53935')
    const empties = await ui.findAll({ type: 'Text', text: /^▱+ $/ })
    expect(empties.map(e => e.text.trim().length)).toEqual([4, 1, 8])
    expect(empties.map(e => e.props.color)).toEqual(['#808080', '#808080', '#808080'])
    expect(await ui.find({ type: 'Text', text: /重置/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /10\/14\(三\) \d{1,2}:\d{2} 重置/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '快取 —' })).toBeDefined()
    expect(await ui.find({ key: 'beneath' })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: cache counts down from the main thread's last request, warns, then expires`, async ($, on) => {
    const { clock, toasts } = setup(on, HIGH)
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await step($)
    await clock.advance(10 * MINUTE)
    await step($, 'sub-agent')

    let ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: '50:00' })).toBeDefined()
    await ui.unmount()

    await clock.advance(44 * MINUTE)
    expect(toasts).toHaveLength(0)
    await clock.advance(1 * MINUTE + 1000)
    expect(toasts).toHaveLength(1)
    await clock.advance(1000)
    expect(toasts).toHaveLength(1)

    await clock.advance(5 * MINUTE)
    ui = await $.ui.mount({ ...BAND, surface })
    const expired = await ui.find({ type: 'Text', text: /下一句會重新計算/ })
    expect(expired?.props.color).toBe('error')
    await ui.unmount()

    await step($)
    ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: '60:00' })).toBeDefined()
    await ui.unmount()
  })
}
