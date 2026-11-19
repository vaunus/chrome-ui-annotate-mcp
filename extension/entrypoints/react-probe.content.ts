// MAIN-world helper. The content script dispatches `ui-annotate:probe` on an
// element. This answers synchronously with `ui-annotate:probe-result`, whose
// detail is a JSON string (only primitives cross between worlds).

import { reactInfo } from '../lib/react.ts'
import { PROBE_EVENT, PROBE_RESULT_EVENT } from '../lib/probe.ts'

export default defineContentScript({
  matches: ['http://localhost/*', 'http://127.0.0.1/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    document.addEventListener(
      PROBE_EVENT,
      (e) => {
        const el = e.target
        if (!(el instanceof Element)) return
        let info = null
        try {
          info = reactInfo(el)
        } catch {
          // React internals changed. Hints are optional, so carry on without them.
        }
        el.dispatchEvent(new CustomEvent(PROBE_RESULT_EVENT, { detail: JSON.stringify(info) }))
      },
      true,
    )
  },
})
