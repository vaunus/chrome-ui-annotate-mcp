// Reads the React component chain for a DOM element (React 18/19, dev builds).
// Runs in the page's MAIN world: fiber keys on DOM nodes are invisible to the
// content script's isolated world.

export type ReactInfo = { component: string; owners: string[] }

type Fiber = { tag: number; type: unknown; _debugOwner?: Owner | null }
/** Server components (React 19) are ReactComponentInfo objects, not fibers. */
type ServerInfo = { name?: string; env?: string; owner?: Owner | null }
type Owner = Fiber | ServerInfo

const MAX_OWNERS = 12

function fiberOf(el: Element): Fiber | null {
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
  return key ? ((el as unknown as Record<string, Fiber>)[key] ?? null) : null
}

function nameOf(type: unknown): string | null {
  if (!type || typeof type === 'string') return null // host element like 'div'
  if (typeof type === 'function') {
    const fn = type as { displayName?: string; name?: string }
    return fn.displayName || fn.name || null
  }
  // memo / forwardRef / lazy wrappers
  const t = type as { displayName?: string; type?: unknown; render?: unknown }
  return t.displayName || nameOf(t.type) || nameOf(t.render) || null
}

const isFiber = (o: Owner): o is Fiber => typeof (o as Fiber).tag === 'number'

/** Owner chain, nearest first, e.g. ['PricingCard (client)', 'Home (server)']. */
export function reactInfo(el: Element): ReactInfo | null {
  const fiber = fiberOf(el)
  if (!fiber) return null
  const owners: string[] = []
  const names: string[] = []
  let o = fiber._debugOwner ?? null
  while (o && owners.length < MAX_OWNERS) {
    if (isFiber(o)) {
      const n = nameOf(o.type)
      if (n) {
        names.push(n)
        owners.push(`${n} (client)`)
      }
      o = o._debugOwner ?? null
    } else {
      // Next 16 labels server components "Server" or "Prerender". Both are server code.
      if (o.name) {
        names.push(o.name)
        owners.push(`${o.name} (server)`)
      }
      o = o.owner ?? null
    }
  }
  if (!names[0]) return null
  return { component: names[0], owners }
}
