import {
  Toolbar as UiToolbar,
  ToolbarButton as UiToolbarButton,
  ToolbarGroup as UiToolbarGroup,
  ToolbarLink as UiToolbarLink,
  ToolbarSeparator as UiToolbarSeparator,
} from "@ui-sdk/react/toolbar"
import type * as React from "react"

import { cn } from "@/lib/utils"

function Toolbar({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiToolbar>, "className"> & {
  className?: string
}) {
  return (
    <UiToolbar
      className={cn(
        "flex w-fit min-w-0 max-w-full flex-wrap items-center justify-center gap-2",
        className
      )}
      {...props}
    />
  )
}

function ToolbarGroup({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiToolbarGroup>, "className"> & {
  className?: string
}) {
  return (
    <UiToolbarGroup
      className={cn("flex min-w-0 items-center gap-2", className)}
      {...props}
    />
  )
}

function ToolbarButton({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiToolbarButton>, "className"> & {
  className?: string
}) {
  return (
    <UiToolbarButton
      className={cn("outline-none", className)}
      {...props}
    />
  )
}

function ToolbarLink({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiToolbarLink>, "className"> & {
  className?: string
}) {
  return <UiToolbarLink className={cn("outline-none", className)} {...props} />
}

function ToolbarSeparator({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiToolbarSeparator>, "className"> & {
  className?: string
}) {
  return (
    <UiToolbarSeparator
      className={cn(
        "shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch",
        className
      )}
      {...props}
    />
  )
}

export {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarLink,
  ToolbarSeparator,
}
