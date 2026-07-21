import * as React from "react"
import { cn } from "@/lib/utils"

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "ghost" | "link"
  size?: "default" | "sm" | "lg" | "icon"
}

const variants: Record<string, string> = {
  default: "bg-blue-600 hover:bg-blue-500 text-white",
  destructive: "bg-red-700 hover:bg-red-600 text-white",
  outline: "border border-gray-700 bg-transparent hover:bg-gray-800 text-white",
  ghost: "bg-transparent hover:bg-gray-800 text-white",
  link: "underline-offset-4 hover:underline text-blue-400 bg-transparent",
}
const sizes: Record<string, string> = {
  default: "h-10 px-4 py-2 text-sm",
  sm: "h-8 px-3 text-xs",
  lg: "h-12 px-6 text-base",
  icon: "h-9 w-9",
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center rounded-xl font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  )
)
Button.displayName = "Button"
