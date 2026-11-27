import {
  createToaster,
  Toast as UiToast,
  ToastAction as UiToastAction,
  ToastClose as UiToastClose,
  ToastDescription as UiToastDescription,
  ToastRegion as UiToastRegion,
  ToastTitle as UiToastTitle,
  toast,
} from "@ui-sdk/react/toast"
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"
import type * as React from "react"

import { cn } from "@/lib/utils"

function Toaster({
  side = "bottom",
  align = "end",
  className,
  ...props
}: Omit<
  React.ComponentProps<typeof UiToastRegion>,
  "children" | "className"
> & {
  className?: string
}) {
  return (
    <UiToastRegion
      side={side}
      align={align}
      className={cn(className)}
      {...props}
    >
      {() => (
        <UiToast className="flex w-full items-center gap-2.5 rounded-xl bg-popover px-3.5 py-3 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 data-[type=error]:ring-destructive/30">
          <span
            data-show="success"
            className="shrink-0 text-foreground"
            aria-hidden="true"
          >
            <CircleCheckIcon className="size-4" />
          </span>
          <span
            data-show="info"
            className="shrink-0 text-muted-foreground"
            aria-hidden="true"
          >
            <InfoIcon className="size-4" />
          </span>
          <span
            data-show="warning"
            className="shrink-0 text-echo-live"
            aria-hidden="true"
          >
            <TriangleAlertIcon className="size-4" />
          </span>
          <span
            data-show="error"
            className="shrink-0 text-destructive"
            aria-hidden="true"
          >
            <OctagonXIcon className="size-4" />
          </span>
          <span
            data-show="loading"
            className="shrink-0 text-muted-foreground"
            aria-hidden="true"
          >
            <Loader2Icon className="size-4 animate-spin" />
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <UiToastTitle className="font-medium leading-snug text-popover-foreground" />
            <UiToastDescription className="text-xs text-muted-foreground" />
          </div>
          <UiToastAction className="shrink-0 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90" />
          <UiToastClose
            aria-label="Dismiss notification"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <XIcon className="size-3.5" aria-hidden="true" />
          </UiToastClose>
        </UiToast>
      )}
    </UiToastRegion>
  )
}

export { createToaster, Toaster, toast }
