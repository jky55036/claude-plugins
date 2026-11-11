import type { Register } from 'claude-code'

export const register: Register = on => {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)

    if (e.props.hasSurvey) {
      return below
    }

    const { Box, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {below}
        <Box marginTop={1} gap={1}>
          <Button
            key="git"
            label="同步GitHub"
            onPress={() => {
              void $.prompt.submit({ text: '同步Git' })
            }}
          />
          <Button
            key="cfg"
            label="同步設定"
            onPress={async () => {
              try {
                await $.command.run({ command: 'sync-config' })
              } catch {
                void $.prompt.submit({ text: '請用 Skill 工具執行 sync-config（等同 /sync-config）' })
              }
            }}
          />
        </Box>
      </Box>
    )
  })
}
