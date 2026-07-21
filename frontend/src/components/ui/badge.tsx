import * as React from "react"
import { cn } from "@/lib/utils"

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "destructive" | "outline" | "success" | "warning"
}

const variants: Record<string, string> = {
  default:     "bg-blue-600/20 text-blue-300 border border-blue-700/50",
  destructive: "bg-red-600/20 text-red-300 border border-red-700/50",
  outline:     "bg-transparent text-gray-300 border border-gray-600",
  success:     "bg-green-600/20 text-green-300 border border-green-700/50",
  warning:     "bg-yellow-600/20 text-yellow-300 border border-yellow-700/50",
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variants[variant],
        className
      )}
      {...props}
    />
  )
}
