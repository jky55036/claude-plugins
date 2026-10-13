export type Window = { percent: number; resetsAt?: string }

export type Usage = {
  context?: number
  fiveHour?: Window
  week?: Window
}

export type CacheMark = { sentAt: number; isWarned: boolean }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { usage: Usage | null; cache: CacheMark | null }
  }
}
