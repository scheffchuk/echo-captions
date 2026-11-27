import {
  Tooltip as UiTooltip,
  TooltipArrow as UiTooltipArrow,
  TooltipContent as UiTooltipContent,
  TooltipShortcut as UiTooltipShortcut,
  TooltipTrigger as UiTooltipTrigger,
} from "@ui-sdk/react/tooltip"
import type * as React from "react"

import { cn } from "@/lib/utils"

function Tooltip({
  delay = 250,
  ...props
}: React.ComponentProps<typeof UiTooltip>) {
  return <UiTooltip delay={delay} {...props} />
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof UiTooltipTrigger>) {
  return <UiTooltipTrigger {...props} />
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: Omit<
  React.ComponentProps<typeof UiTooltipContent>,
  "className" | "children"
> & {
  className?: string
  children?: React.ReactNode
}) {
  return (
    <UiTooltipContent
      sideOffset={sideOffset}
      className={cn(
        "z-50 m-0 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-sm outline-none transition-[opacity,scale] duration-150 data-instant:transition-none data-starting-style:scale-96 data-starting-style:opacity-0 data-ending-style:scale-96 data-ending-style:opacity-0 motion-reduce:transition-none",
        className
      )}
      {...props}
    >
      {children}
      <UiTooltipArrow className="size-2 rotate-45 rounded-[1px] bg-foreground" />
    </UiTooltipContent>
  )
}

function TooltipShortcut({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiTooltipShortcut>, "className"> & {
  className?: string
}) {
  return (
    <UiTooltipShortcut
      className={cn(
        "rounded-sm bg-background/15 px-1 py-0.5 font-mono text-[10px] leading-none text-background/90",
        className
      )}
      {...props}
    />
  )
}

export { Tooltip, TooltipContent, TooltipShortcut, TooltipTrigger }
