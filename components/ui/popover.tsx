import {
  Popover as UiPopover,
  PopoverClose as UiPopoverClose,
  PopoverContent as UiPopoverContent,
  PopoverDescription as UiPopoverDescription,
  PopoverTitle as UiPopoverTitle,
  PopoverTrigger as UiPopoverTrigger,
} from "@ui-sdk/react/popover"
import type * as React from "react"

import { cn } from "@/lib/utils"

function Popover({ ...props }: React.ComponentProps<typeof UiPopover>) {
  return <UiPopover {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof UiPopoverTrigger>) {
  return <UiPopoverTrigger {...props} />
}

function PopoverClose({
  ...props
}: React.ComponentProps<typeof UiPopoverClose>) {
  return <UiPopoverClose {...props} />
}

function PopoverTitle({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiPopoverTitle>, "className"> & {
  className?: string
}) {
  return (
    <UiPopoverTitle
      className={cn("text-sm font-medium text-foreground", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiPopoverDescription>, "className"> & {
  className?: string
}) {
  return (
    <UiPopoverDescription
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 6,
  ...props
}: Omit<React.ComponentProps<typeof UiPopoverContent>, "className"> & {
  className?: string
}) {
  return (
    <UiPopoverContent
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 m-0 flex w-72 max-h-(--available-height) origin-(--transform-origin) flex-col gap-2.5 overflow-y-auto rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden transition-[opacity,scale] duration-150 data-starting-style:scale-96 data-starting-style:opacity-0 data-ending-style:scale-96 data-ending-style:opacity-0 data-[presentation=sheet]:w-full data-[presentation=sheet]:max-h-[85dvh] data-[presentation=sheet]:rounded-t-2xl data-[presentation=sheet]:rounded-b-none data-[presentation=sheet]:p-4 data-[presentation=sheet]:transition-none motion-reduce:transition-none",
        className
      )}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
}
