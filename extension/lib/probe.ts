// Content-script side of the React probe. See entrypoints/react-probe.content.ts.

import type { ReactInfo } from './react.ts'

export const PROBE_EVENT = 'ui-annotate:probe'
export const PROBE_RESULT_EVENT = 'ui-annotate:probe-result'

/** Ask the MAIN-world helper for the element's React chain. Synchronous: DOM events dispatch in place. */
export function probeReact(el: Element): ReactInfo | null {
  let info: ReactInfo | null = null
  const onResult = (e: Event) => {
    try {
      info = JSON.parse(String((e as CustomEvent).detail)) as ReactInfo | null
    } catch {
      info = null
    }
  }
  el.addEventListener(PROBE_RESULT_EVENT, onResult)
  el.dispatchEvent(new CustomEvent(PROBE_EVENT, { bubbles: true, composed: true }))
  el.removeEventListener(PROBE_RESULT_EVENT, onResult)
  return info
}
