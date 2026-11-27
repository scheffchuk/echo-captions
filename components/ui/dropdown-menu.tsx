import {
  Menu as UiMenu,
  MenuCheckboxItem as UiMenuCheckboxItem,
  MenuContent as UiMenuContent,
  MenuGroup as UiMenuGroup,
  MenuGroupLabel as UiMenuGroupLabel,
  MenuItem as UiMenuItem,
  MenuItemIcon as UiMenuItemIcon,
  MenuItemIndicator as UiMenuItemIndicator,
  MenuRadioGroup as UiMenuRadioGroup,
  MenuRadioItem as UiMenuRadioItem,
  MenuSeparator as UiMenuSeparator,
  MenuTrigger as UiMenuTrigger,
} from "@ui-sdk/react/menu"
import { CheckIcon } from "lucide-react"
import type * as React from "react"

import { cn } from "@/lib/utils"

function DropdownMenu({ ...props }: React.ComponentProps<typeof UiMenu>) {
  return <UiMenu {...props} />
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof UiMenuTrigger>) {
  return <UiMenuTrigger {...props} />
}

function DropdownMenuContent({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: Omit<React.ComponentProps<typeof UiMenuContent>, "className"> & {
  className?: string
}) {
  return (
    <UiMenuContent
      sideOffset={sideOffset}
      align={align}
      className={cn(
        "z-50 m-0 max-h-(--available-height) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg border-0 bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none transition-[opacity,scale] duration-150 data-starting-style:scale-96 data-starting-style:opacity-0 data-ending-style:scale-96 data-ending-style:opacity-0 data-[presentation=sheet]:w-full data-[presentation=sheet]:max-h-[85dvh] data-[presentation=sheet]:rounded-t-2xl data-[presentation=sheet]:rounded-b-none data-[presentation=sheet]:p-2 data-[presentation=sheet]:transition-none motion-reduce:transition-none",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: Omit<React.ComponentProps<typeof UiMenuItem>, "className"> & {
  className?: string
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <UiMenuItem
      destructive={variant === "destructive"}
      data-inset={inset || undefined}
      data-variant={variant}
      className={cn(
        "group/dropdown-menu-item relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-inset:pl-7 data-destructive:text-destructive data-destructive:data-highlighted:bg-destructive/10 data-destructive:data-highlighted:text-destructive dark:data-destructive:data-highlighted:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof UiMenuRadioGroup>) {
  return <UiMenuRadioGroup {...props} />
}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: Omit<
  React.ComponentProps<typeof UiMenuRadioItem>,
  "className" | "children"
> & {
  className?: string
  children?: React.ReactNode
}) {
  return (
    <UiMenuRadioItem
      className={cn(
        "relative flex cursor-default items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <UiMenuItemIndicator className="flex size-4 shrink-0 items-center justify-center">
        <CheckIcon className="size-4" aria-hidden="true" />
      </UiMenuItemIndicator>
    </UiMenuRadioItem>
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: Omit<
  React.ComponentProps<typeof UiMenuCheckboxItem>,
  "className" | "children"
> & {
  className?: string
  children?: React.ReactNode
}) {
  return (
    <UiMenuCheckboxItem
      className={cn(
        "relative flex cursor-default items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <UiMenuItemIndicator className="flex size-4 shrink-0 items-center justify-center">
        <CheckIcon className="size-4" aria-hidden="true" />
      </UiMenuItemIndicator>
    </UiMenuCheckboxItem>
  )
}

function DropdownMenuItemIcon({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiMenuItemIcon>, "className"> & {
  className?: string
}) {
  return (
    <UiMenuItemIcon
      className={cn("inline-flex shrink-0 items-center", className)}
      {...props}
    />
  )
}

function DropdownMenuGroup({
  ...props
}: React.ComponentProps<typeof UiMenuGroup>) {
  return <UiMenuGroup {...props} />
}

function DropdownMenuGroupLabel({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiMenuGroupLabel>, "className"> & {
  className?: string
}) {
  return (
    <UiMenuGroupLabel
      className={cn(
        "px-2 py-1.5 text-xs font-medium text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiMenuSeparator>, "className"> & {
  className?: string
}) {
  return (
    <UiMenuSeparator
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuItemIcon,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
}
