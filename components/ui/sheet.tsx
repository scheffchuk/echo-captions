import {
  Drawer as UiDrawer,
  DrawerBackdrop as UiDrawerBackdrop,
  DrawerClose as UiDrawerClose,
  DrawerContent as UiDrawerContent,
  DrawerDescription as UiDrawerDescription,
  DrawerTitle as UiDrawerTitle,
  DrawerTrigger as UiDrawerTrigger,
} from "@ui-sdk/react/drawer"
import { XIcon } from "lucide-react"
import type * as React from "react"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function Sheet({
  side = "right",
  ...props
}: React.ComponentProps<typeof UiDrawer>) {
  return <UiDrawer side={side} {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof UiDrawerTrigger>) {
  return <UiDrawerTrigger {...props} />
}

function SheetClose({ ...props }: React.ComponentProps<typeof UiDrawerClose>) {
  return <UiDrawerClose {...props} />
}

function SheetBackdrop({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiDrawerBackdrop>, "className"> & {
  className?: string
}) {
  return (
    <UiDrawerBackdrop
      className={cn(
        "fixed inset-0 z-50 bg-black/15 supports-backdrop-filter:backdrop-blur-xs",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: Omit<React.ComponentProps<typeof UiDrawerContent>, "className" | "children"> & {
  className?: string
  children?: React.ReactNode
  showCloseButton?: boolean
}) {
  return (
    <>
      <SheetBackdrop />
      <UiDrawerContent
        className={cn(
          "relative flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg outline-none data-[side=bottom]:h-auto data-[side=bottom]:w-full data-[side=bottom]:border-t data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=left]:sm:max-w-sm data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=right]:sm:max-w-sm data-[side=top]:h-auto data-[side=top]:w-full data-[side=top]:border-b",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <UiDrawerClose
            aria-label="Close"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon-sm" }),
              "absolute top-3 right-3"
            )}
          >
            <XIcon aria-hidden="true" />
            <span className="sr-only">Close</span>
          </UiDrawerClose>
        )}
      </UiDrawerContent>
    </>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiDrawerTitle>, "className"> & {
  className?: string
}) {
  return (
    <UiDrawerTitle
      className={cn(
        "font-heading text-base font-medium text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiDrawerDescription>, "className"> & {
  className?: string
}) {
  return (
    <UiDrawerDescription
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetBackdrop,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
}
