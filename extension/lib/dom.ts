// Tiny element builder for the content-script UI.

type Child = Node | string | null | undefined | false
type Props = Record<string, unknown>

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
    } else if (key === 'class') {
      el.className = String(value)
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value)
    } else if (key === 'value' || key === 'disabled' || key === 'title') {
      ;(el as unknown as Record<string, unknown>)[key] = value
    } else {
      el.setAttribute(key, value === true ? '' : String(value))
    }
  }
  for (const c of children) if (c != null && c !== false) el.append(c)
  return el
}

export const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
