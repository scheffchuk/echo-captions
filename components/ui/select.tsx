import {
  Select,
  SelectContent as UiSelectContent,
  SelectGroup as UiSelectGroup,
  SelectGroupLabel as UiSelectGroupLabel,
  SelectItem as UiSelectItem,
  SelectItemIndicator as UiSelectItemIndicator,
  SelectSeparator as UiSelectSeparator,
  SelectTrigger as UiSelectTrigger,
  SelectValue as UiSelectValue,
} from "@ui-sdk/react/select"
import { CheckIcon, ChevronDownIcon } from "lucide-react"
import type * as React from "react"

import { cn } from "@/lib/utils"

function SelectValue({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiSelectValue>, "className"> & {
  className?: string
}) {
  return (
    <UiSelectValue
      className={cn(
        "line-clamp-1 flex items-center gap-1.5 data-placeholder:text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: Omit<React.ComponentProps<typeof UiSelectTrigger>, "className" | "children"> & {
  className?: string
  children?: React.ReactNode
  size?: "sm" | "default"
}) {
  return (
    <UiSelectTrigger
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-disabled:cursor-not-allowed data-disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <ChevronDownIcon
        className="pointer-events-none size-4 text-muted-foreground"
        aria-hidden="true"
      />
    </UiSelectTrigger>
  )
}

function SelectContent({
  className,
  align = "start",
  sideOffset = 6,
  children,
  ...props
}: Omit<React.ComponentProps<typeof UiSelectContent>, "className"> & {
  className?: string
}) {
  return (
    <UiSelectContent
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 m-0 max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg border-0 bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none transition-[opacity,scale] duration-150 data-starting-style:scale-96 data-starting-style:opacity-0 data-ending-style:scale-96 data-ending-style:opacity-0 data-[presentation=sheet]:w-full data-[presentation=sheet]:max-h-[85dvh] data-[presentation=sheet]:rounded-t-2xl data-[presentation=sheet]:rounded-b-none data-[presentation=sheet]:p-2 data-[presentation=sheet]:transition-none motion-reduce:transition-none",
        className
      )}
      {...props}
    >
      {children}
    </UiSelectContent>
  )
}

function SelectItem({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof UiSelectItem>, "className" | "children"> & {
  className?: string
  children?: React.ReactNode
}) {
  return (
    <UiSelectItem
      className={cn(
        "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
      <UiSelectItemIndicator className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <CheckIcon className="size-4" aria-hidden="true" />
      </UiSelectItemIndicator>
    </UiSelectItem>
  )
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof UiSelectGroup>) {
  return <UiSelectGroup {...props} />
}

function SelectGroupLabel({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiSelectGroupLabel>, "className"> & {
  className?: string
}) {
  return (
    <UiSelectGroupLabel
      className={cn(
        "px-2 py-1.5 text-xs font-medium text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function SelectSeparator({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiSelectSeparator>, "className"> & {
  className?: string
}) {
  return (
    <UiSelectSeparator
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
