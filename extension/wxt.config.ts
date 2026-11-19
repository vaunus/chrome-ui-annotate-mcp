import { defineConfig } from 'wxt'
import { EXTENSION_PUBLIC_KEY } from '@ui-annotate/shared'

export default defineConfig({
  manifest: {
    name: 'UI Annotate for Claude',
    description: 'Option+click text on your local app, edit it or add a note, and queue it for Claude Code to pull.',
    // Pins the extension ID. The MCP server only accepts this ID's origin.
    key: EXTENSION_PUBLIC_KEY,
    permissions: ['storage', 'alarms'],
    host_permissions: ['http://localhost/*', 'http://127.0.0.1/*'],
    action: { default_title: 'UI Annotate: turn edit mode on or off' },
    commands: {
      'toggle-pick': {
        suggested_key: { default: 'Alt+Shift+E' },
        description: 'Turn edit mode on or off',
      },
    },
  },
})
