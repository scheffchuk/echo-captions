import {
  Command as UiCommand,
  CommandEmpty as UiCommandEmpty,
  CommandGroup as UiCommandGroup,
  CommandGroupLabel as UiCommandGroupLabel,
  CommandInput as UiCommandInput,
  CommandItem as UiCommandItem,
  CommandItemText as UiCommandItemText,
  CommandList as UiCommandList,
  CommandSeparator as UiCommandSeparator,
} from "@ui-sdk/react/command"
import { CheckIcon, SearchIcon } from "lucide-react"
import type * as React from "react"

import { cn } from "@/lib/utils"

function Command({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiCommand>, "className"> & {
  className?: string
}) {
  return (
    <UiCommand
      className={cn(
        "flex size-full flex-col overflow-hidden rounded-xl bg-popover p-1 text-popover-foreground",
        className
      )}
      {...props}
    />
  )
}

function CommandInput({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiCommandInput>, "className"> & {
  className?: string
}) {
  return (
    <div data-slot="command-input-wrapper" className="p-1 pb-1.5">
      <div className="flex h-8 w-full items-center gap-2 rounded-lg border border-input/40 bg-input/30 px-2.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
        <SearchIcon
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <UiCommandInput
          className={cn(
            "w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          {...props}
        />
      </div>
    </div>
  )
}

function CommandList({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiCommandList>, "className"> & {
  className?: string
}) {
  return (
    <UiCommandList
      className={cn(
        "no-scrollbar max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto outline-none",
        className
      )}
      {...props}
    />
  )
}

function CommandEmpty({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiCommandEmpty>, "className"> & {
  className?: string
}) {
  return (
    <UiCommandEmpty
      className={cn("py-6 text-center text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiCommandGroup>, "className"> & {
  className?: string
}) {
  return (
    <UiCommandGroup
      className={cn("overflow-hidden p-1 text-foreground", className)}
      {...props}
    />
  )
}

function CommandGroupLabel({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiCommandGroupLabel>, "className"> & {
  className?: string
}) {
  return (
    <UiCommandGroupLabel
      className={cn(
        "px-2 py-1.5 text-xs font-medium text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function CommandItem({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof UiCommandItem>, "className" | "children"> & {
  className?: string
  children?: React.ReactNode
}) {
  return (
    <UiCommandItem
      className={cn(
        "group/command-item relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted data-highlighted:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <CheckIcon className="ml-auto opacity-0 group-data-[checked=true]/command-item:opacity-100" />
    </UiCommandItem>
  )
}

function CommandItemText({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiCommandItemText>, "className"> & {
  className?: string
}) {
  return (
    <UiCommandItemText
      className={cn("[&_mark]:bg-transparent [&_mark]:font-semibold", className)}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiCommandSeparator>, "className"> & {
  className?: string
}) {
  return (
    <UiCommandSeparator
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

export {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandItemText,
  CommandList,
  CommandSeparator,
}
