import {
  Dialog as UiDialog,
  DialogBackdrop as UiDialogBackdrop,
  DialogClose as UiDialogClose,
  DialogContent as UiDialogContent,
  DialogDescription as UiDialogDescription,
  DialogTitle as UiDialogTitle,
  DialogTrigger as UiDialogTrigger,
} from "@ui-sdk/react/dialog"
import { XIcon } from "lucide-react"
import type * as React from "react"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function Dialog({ ...props }: React.ComponentProps<typeof UiDialog>) {
  return <UiDialog {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof UiDialogTrigger>) {
  return <UiDialogTrigger {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof UiDialogClose>) {
  return <UiDialogClose {...props} />
}

function DialogBackdrop({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiDialogBackdrop>, "className"> & {
  className?: string
}) {
  return (
    <UiDialogBackdrop
      className={cn(
        "fixed inset-0 z-50 bg-black/15 transition-opacity duration-150 supports-backdrop-filter:backdrop-blur-xs data-starting-style:opacity-0 data-ending-style:opacity-0 motion-reduce:transition-none",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: Omit<React.ComponentProps<typeof UiDialogContent>, "className" | "children"> & {
  className?: string
  children?: React.ReactNode
  showCloseButton?: boolean
}) {
  return (
    <>
      <DialogBackdrop />
      <UiDialogContent
        className={cn(
          "fixed top-1/2 left-1/2 z-50 m-0 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none transition-[opacity,scale] duration-150 sm:max-w-sm data-starting-style:scale-96 data-starting-style:opacity-0 data-ending-style:scale-96 data-ending-style:opacity-0 data-[presentation=sheet]:static data-[presentation=sheet]:max-w-none data-[presentation=sheet]:translate-x-0 data-[presentation=sheet]:translate-y-0 data-[presentation=sheet]:rounded-b-none data-[presentation=sheet]:transition-none motion-reduce:transition-none",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <UiDialogClose
            aria-label="Close"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon-sm" }),
              "absolute top-2 right-2"
            )}
          >
            <XIcon aria-hidden="true" />
            <span className="sr-only">Close</span>
          </UiDialogClose>
        )}
      </UiDialogContent>
    </>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <UiDialogClose className={buttonVariants({ variant: "outline" })}>
          Close
        </UiDialogClose>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiDialogTitle>, "className"> & {
  className?: string
}) {
  return (
    <UiDialogTitle
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiDialogDescription>, "className"> & {
  className?: string
}) {
  return (
    <UiDialogDescription
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
}
