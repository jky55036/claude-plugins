import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { CacheMark, Usage } from '../types'

const CACHE_TTL_MS = 60 * 60 * 1000
const WARN_BEFORE_MS = 5 * 60 * 1000
const CELL_FILLED = '▰'
const CELL_EMPTY = '▱'
const EMPTY_CELL_COLOR = '#808080'
const RED_AT_PERCENT = 80
const GRADIENT_STOPS: [number, number, number][] = [
  [0x4c, 0xaf, 0x50],
  [0xe6, 0xc2, 0x29],
  [0xe5, 0x39, 0x35],
]

function toHex(channel: number): string {
  return Math.round(channel).toString(16).padStart(2, '0')
}

export function gradientColor(position: number): string {
  const t = Math.min(1, Math.max(0, position)) * (GRADIENT_STOPS.length - 1)
  const index = Math.min(GRADIENT_STOPS.length - 2, Math.floor(t))
  const local = t - index
  const from = GRADIENT_STOPS[index]
  const to = GRADIENT_STOPS[index + 1]
  const mixed = from.map((channel, i) => channel + (to[i] - channel) * local)
  return `#${mixed.map(toHex).join('')}`
}

export function percentColor(percent: number): string {
  return gradientColor(percent / RED_AT_PERCENT)
}

export function cellColor(index: number, cellCount: number): string {
  const redIndex = Math.max(1, Math.round((cellCount * RED_AT_PERCENT) / 100) - 1)
  return gradientColor(index / redIndex)
}

const usageAtom = atom({ plugin: 'usage-band', key: 'usage' } as const, null)
const cacheAtom = atom({ plugin: 'usage-band', key: 'cache' } as const, null)

function toUsage(raw: SessionUsage): Usage {
  const usage: Usage = {}
  if (raw.context.percent !== undefined) {
    usage.context = raw.context.percent
  }
  for (const limit of raw.rateLimits) {
    const window = { percent: limit.percentUsed, resetsAt: limit.resetsAt }
    if (limit.kind === 'five_hour') {
      usage.fiveHour = window
    } else if (limit.kind === 'seven_day') {
      usage.week = window
    }
  }
  return usage
}

async function refreshUsage($: EngineInterface) {
  const raw = await $.session.usage()
  const usage = toUsage(raw)
  await update($, usageAtom, () => usage)
}

export function formatClock(iso: string | undefined): string | undefined {
  if (iso === undefined) {
    return undefined
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return undefined
  }
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

export function formatDate(iso: string | undefined): string | undefined {
  if (iso === undefined) {
    return undefined
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return undefined
  }
  return `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAYS[date.getDay()]}) ${formatClock(iso)}`
}

export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refreshUsage($)

    $.clock.every(1000, async () => {
      const mark = await read($, cacheAtom)
      if (mark === null) {
        return
      }
      const left = mark.sentAt + CACHE_TTL_MS - (await $.clock.now())
      if (left > 0 && left <= WARN_BEFORE_MS && false === mark.isWarned) {
        await update($, cacheAtom, m => (m === null ? m : { ...m, isWarned: true }))
        const text = `快取剩 ${formatCountdown(left)} 就過期，現在送一句可以續命`
        $.ui.toast(text, { timeoutMs: 15000 })
        $.ui.notify(text, { title: '快取快過期了' }).catch(() => undefined)
      }
      if (left > -2000) {
        $.ui.invalidate('ui.render')
      }
    })

    return result
  })

  on('session.end', { reason: 'clear' }, async ($, e, next) => {
    await update($, cacheAtom, () => null)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      return yield* next(e)
    }
    const sentAt = await $.clock.now()
    const result = yield* next(e)
    const mark: CacheMark = { sentAt, isWarned: false }
    await update($, cacheAtom, () => mark)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      await refreshUsage($)
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const usage = (await read($, usageAtom)) ?? {}
    const mark = await read($, cacheAtom)
    const now = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)

    const columns = e.props.bodyColumns
    const barWidth = columns >= 110 ? 10 : columns >= 90 ? 6 : 0

    const meter = (label: string, percent: number | undefined, suffix?: string) => {
      if (percent === undefined) {
        return (
          <Text>
            <Text dimColor>{label} —</Text>
          </Text>
        )
      }
      const filled = Math.min(barWidth, Math.round((percent / 100) * barWidth))
      const cells: string[] = []
      for (let i = 0; i < filled; i++) {
        cells.push(cellColor(i, barWidth))
      }
      const color =
        barWidth === 0 ? percentColor(percent) : cellColor(Math.max(0, filled - 1), barWidth)
      return (
        <Text>
          <Text dimColor>{label} </Text>
          {cells.map((c, i) => (
            <Text key={`cell-${i}`} color={c}>
              {CELL_FILLED}
            </Text>
          ))}
          {0 < barWidth ? <Text color={EMPTY_CELL_COLOR}>{CELL_EMPTY.repeat(barWidth - filled) + ' '}</Text> : ''}
          <Text color={color} bold>
            {Math.round(percent)}%
          </Text>
          {suffix === undefined ? '' : <Text dimColor> {suffix}</Text>}
        </Text>
      )
    }

    const resetAt = formatClock(usage.fiveHour?.resetsAt)
    const weekResetOn = formatDate(usage.week?.resetsAt)

    let cache
    if (mark === null) {
      cache = <Text dimColor>快取 —</Text>
    } else {
      const left = mark.sentAt + CACHE_TTL_MS - now
      if (left <= 0) {
        cache = (
          <Text color="error" bold>
            快取已過期 · 下一句會重新計算
          </Text>
        )
      } else {
        cache = (
          <Text>
            <Text dimColor>快取 </Text>
            <Text color={left <= WARN_BEFORE_MS ? 'warning' : 'text'} bold>
              {formatCountdown(left)}
            </Text>
          </Text>
        )
      }
    }

    const below = await next(e)

    return (
      <Box flexDirection="column">
        <Box
          borderStyle="round"
          borderColor="claude"
          paddingX={1}
          flexDirection="row"
          justifyContent="space-between"
        >
          <Box flexDirection="row" gap={2}>
            {meter('context', usage.context)}
            {meter('5 小時', usage.fiveHour?.percent, resetAt === undefined ? undefined : `${resetAt} 重置`)}
            {meter('本週', usage.week?.percent, weekResetOn === undefined ? undefined : `${weekResetOn} 重置`)}
          </Box>
          {cache}
        </Box>
        {below}
      </Box>
    )
  })
}
