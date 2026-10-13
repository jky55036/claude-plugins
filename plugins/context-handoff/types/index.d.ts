export type HandoffPhase = 'idle' | 'summarizing' | 'clearing'

declare module 'claude-code' {
  interface PluginState {
    'context-handoff': {
      percent: number | null
      phase: HandoffPhase
    }
  }
}
