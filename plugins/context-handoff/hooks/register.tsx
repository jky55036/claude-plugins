import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { HandoffPhase } from '../types'

export const THRESHOLD = 70
export const HANDOFF_DIR = '.claude/handoffs'

const percent = atom({ plugin: 'context-handoff', key: 'percent' } as const, null)
const phase = atom({ plugin: 'context-handoff', key: 'phase' } as const, 'idle' as HandoffPhase)

export const SUMMARY_PROMPT = `請為這段對話寫一份交接摘要，讓一個全新、沒有任何先前脈絡的對話能直接接手。只輸出摘要本身，用繁體中文，依序使用以下五個標題：

## 目前的目標
## 做完了什麼
## 還沒做的
## 改過哪些檔案
## 要注意的地方

寫法：
- 「改過哪些檔案」列出完整路徑，每個檔案附一句改了什麼；沒有就寫「無」。
- 「還沒做的」依優先順序排列，寫到下一步可以直接動手的程度。
- 「要注意的地方」寫使用者明確提過的偏好與限制、已否決的做法、尚未驗證的假設、已知的錯誤或風險。
- 只寫對話裡實際發生、確認過的事，不要推測。`

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function stamp(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export function firstMessage(path: string, summary: string): string {
  return `以下是上一段對話的交接摘要（已存成 ${path}）。請先讀完，確認理解後從「還沒做的」第一項繼續。\n\n${summary.trim()}\n`
}

export const register: Register = on => {
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) {
      const value = e.context.percent ?? null
      await update($, percent, () => value)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const used = await read($, percent)
    const current = await read($, phase)
    const isBusy = current !== 'idle'
    const isOver = used !== null && used >= THRESHOLD

    if (e.props.hasSurvey || (!isOver && !isBusy)) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const below = await next(e)

    if (isBusy) {
      return (
        <Box flexDirection="column">
          <Text dimColor>
            {current === 'summarizing' ? '交接中：正在寫交接摘要…' : '交接中：清空對話並送出摘要…'}
          </Text>
          {below}
        </Box>
      )
    }

    const handOff = async () => {
      if (e.props.isWorking) {
        $.ui.toast('這一輪還在執行，等它結束再按交接')
        return
      }

      await update($, phase, () => 'summarizing')

      try {
        const reply = await $.model.fork({ prompt: SUMMARY_PROMPT })

        if (!reply.isAnswered) {
          $.ui.toast(`交接摘要沒有寫成（${reply.reason}），對話未清空`)
          return
        }

        const path = `${HANDOFF_DIR}/handoff-${stamp(await $.clock.now())}.md`
        await $.fs.write(path, `${reply.text.trim()}\n`)

        await update($, phase, () => 'clearing')
        await $.command.run({ command: 'clear' })
        await update($, percent, () => null)
        await $.prompt.submit({ text: firstMessage(path, reply.text), asUser: true })
        $.ui.toast(`交接摘要已存成 ${path}`)
      } catch (err) {
        $.ui.toast(`交接失敗：${err instanceof Error ? err.message : String(err)}`)
      } finally {
        await update($, phase, () => 'idle')
      }
    }

    return (
      <Box flexDirection="column">
        <Box>
          <Text>
            Context 已用 <Text bold>{used}%</Text>{' '}
          </Text>
          <Button key="handoff" variant="primary" label="交接" onPress={handOff} />
        </Box>
        {below}
      </Box>
    )
  })
}
