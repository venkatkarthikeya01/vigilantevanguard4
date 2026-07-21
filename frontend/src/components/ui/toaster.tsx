import { useEffect, useState } from "react"

interface Toast {
  id: string
  title?: string
  description?: string
  variant?: "default" | "destructive"
}

let toasts: Toast[] = []
let listeners: Array<(toasts: Toast[]) => void> = []

function notify(listeners: Array<(t: Toast[]) => void>, toasts: Toast[]) {
  listeners.forEach(l => l([...toasts]))
}

export function toast({ title, description, variant = "default" }: Omit<Toast, "id">) {
  const id = Math.random().toString(36).slice(2)
  toasts = [...toasts, { id, title, description, variant }]
  notify(listeners, toasts)
  setTimeout(() => {
    toasts = toasts.filter(t => t.id !== id)
    notify(listeners, toasts)
  }, 4000)
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([])

  useEffect(() => {
    const listener = (t: Toast[]) => setItems(t)
    listeners.push(listener)
    return () => { listeners = listeners.filter(l => l !== listener) }
  }, [])

  if (!items.length) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {items.map(t => (
        <div
          key={t.id}
          className={`rounded-xl px-4 py-3 text-sm shadow-lg border max-w-sm ${
            t.variant === "destructive"
              ? "bg-red-950 border-red-800 text-red-200"
              : "bg-gray-900 border-gray-700 text-white"
          }`}
        >
          {t.title && <p className="font-semibold">{t.title}</p>}
          {t.description && <p className="text-gray-400 text-xs mt-0.5">{t.description}</p>}
        </div>
      ))}
    </div>
  )
}
