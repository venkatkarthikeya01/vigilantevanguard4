import * as React from "react"
import { cn } from "@/lib/utils"

interface TabsContextType {
  active: string
  setActive: (v: string) => void
}
const TabsCtx = React.createContext<TabsContextType>({ active: "", setActive: () => {} })

interface TabsProps {
  defaultValue: string
  children: React.ReactNode
  className?: string
}

export function Tabs({ defaultValue, children, className }: TabsProps) {
  const [active, setActive] = React.useState(defaultValue)
  return (
    <TabsCtx.Provider value={{ active, setActive }}>
      <div className={cn("", className)}>{children}</div>
    </TabsCtx.Provider>
  )
}

export function TabsList({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex gap-1 bg-gray-800/60 p-1 rounded-xl", className)}>
      {children}
    </div>
  )
}

export function TabsTrigger({ value, children, className }: { value: string; children: React.ReactNode; className?: string }) {
  const { active, setActive } = React.useContext(TabsCtx)
  return (
    <button
      onClick={() => setActive(value)}
      className={cn(
        "px-4 py-1.5 rounded-lg text-sm font-medium transition-colors",
        active === value ? "bg-gray-900 text-white shadow" : "text-gray-400 hover:text-white"
      , className)}
    >
      {children}
    </button>
  )
}

export function TabsContent({ value, children, className }: { value: string; children: React.ReactNode; className?: string }) {
  const { active } = React.useContext(TabsCtx)
  if (active !== value) return null
  return <div className={cn("mt-4", className)}>{children}</div>
}
