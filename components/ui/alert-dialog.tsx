import {
  AlertDialog as UiAlertDialog,
  AlertDialogBackdrop as UiAlertDialogBackdrop,
  AlertDialogClose as UiAlertDialogClose,
  AlertDialogContent as UiAlertDialogContent,
  AlertDialogDescription as UiAlertDialogDescription,
  AlertDialogTitle as UiAlertDialogTitle,
  AlertDialogTrigger as UiAlertDialogTrigger,
} from "@ui-sdk/react/alert-dialog"
import type * as React from "react"

import { type Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function AlertDialog({
  ...props
}: React.ComponentProps<typeof UiAlertDialog>) {
  return <UiAlertDialog {...props} />
}

function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof UiAlertDialogTrigger>) {
  return <UiAlertDialogTrigger {...props} />
}

function AlertDialogBackdrop({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiAlertDialogBackdrop>, "className"> & {
  className?: string
}) {
  return (
    <UiAlertDialogBackdrop
      className={cn(
        "fixed inset-0 z-50 bg-black/15 transition-opacity duration-150 supports-backdrop-filter:backdrop-blur-xs data-starting-style:opacity-0 data-ending-style:opacity-0 motion-reduce:transition-none",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogContent({
  className,
  size = "default",
  ...props
}: Omit<React.ComponentProps<typeof UiAlertDialogContent>, "className"> & {
  className?: string
  size?: "default" | "sm"
}) {
  return (
    <>
      <AlertDialogBackdrop />
      <UiAlertDialogContent
        data-size={size}
        className={cn(
          "group/alert-dialog-content fixed top-1/2 left-1/2 z-50 m-0 grid w-full -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-popover-foreground ring-1 ring-foreground/10 outline-none transition-[opacity,scale] duration-150 data-[size=default]:max-w-xs data-[size=sm]:max-w-xs data-[size=default]:sm:max-w-sm data-starting-style:scale-96 data-starting-style:opacity-0 data-ending-style:scale-96 data-ending-style:opacity-0 motion-reduce:transition-none",
          className
        )}
        {...props}
      />
    </>
  )
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn(
        "grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-left",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiAlertDialogTitle>, "className"> & {
  className?: string
}) {
  return (
    <UiAlertDialogTitle
      className={cn("font-heading text-base font-medium", className)}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiAlertDialogDescription>, "className"> & {
  className?: string
}) {
  return (
    <UiAlertDialogDescription
      className={cn(
        "text-sm text-balance text-muted-foreground md:text-pretty *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  variant = "default",
  size = "default",
  value = "confirm",
  ...props
}: Omit<React.ComponentProps<typeof UiAlertDialogClose>, "className"> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size"> & {
    className?: string
  }) {
  return (
    <UiAlertDialogClose
      value={value}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

function AlertDialogCancel({
  className,
  variant = "outline",
  size = "default",
  ...props
}: Omit<React.ComponentProps<typeof UiAlertDialogClose>, "className"> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size"> & {
    className?: string
  }) {
  return (
    <UiAlertDialogClose
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogBackdrop,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
}
