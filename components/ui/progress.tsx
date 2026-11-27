import {
  Progress as UiProgress,
  ProgressIndicator as UiProgressIndicator,
  ProgressLabel as UiProgressLabel,
  ProgressTrack as UiProgressTrack,
  ProgressValue as UiProgressValue,
} from "@ui-sdk/react/progress"
import type * as React from "react"

import { cn } from "@/lib/utils"

function Progress({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiProgress>, "className"> & {
  className?: string
}) {
  return (
    <UiProgress
      className={cn("flex items-center gap-2", className)}
      {...props}
    />
  )
}

function ProgressTrack({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiProgressTrack>, "className"> & {
  className?: string
}) {
  return (
    <UiProgressTrack
      className={cn(
        "relative h-1.5 w-full overflow-hidden rounded-full bg-muted",
        className
      )}
      {...props}
    />
  )
}

function ProgressIndicator({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiProgressIndicator>, "className"> & {
  className?: string
}) {
  return (
    <UiProgressIndicator
      className={cn(
        "h-full rounded-full bg-echo-live transition-[width] duration-200 ease-out motion-reduce:transition-none",
        className
      )}
      {...props}
    />
  )
}

function ProgressLabel({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiProgressLabel>, "className"> & {
  className?: string
}) {
  return (
    <UiProgressLabel
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function ProgressValue({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiProgressValue>, "className"> & {
  className?: string
}) {
  return (
    <UiProgressValue
      className={cn("text-xs tabular-nums text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Progress,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
  ProgressValue,
}
