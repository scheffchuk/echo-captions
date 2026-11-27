import {
  PasswordInput as UiPasswordInput,
  PasswordInputControl as UiPasswordInputControl,
  PasswordInputToggle as UiPasswordInputToggle,
} from "@ui-sdk/react/password-input"
import { EyeIcon, EyeOffIcon } from "lucide-react"
import type * as React from "react"

import { cn } from "@/lib/utils"

function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiPasswordInput>, "className"> & {
  className?: string
}) {
  return (
    <UiPasswordInput
      className={cn(
        "group/password-input relative flex h-8 w-full min-w-0 items-center rounded-lg border border-input bg-transparent transition-colors outline-none has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50 data-disabled:pointer-events-none data-disabled:bg-input/50 data-disabled:opacity-50 has-[input[aria-invalid=true]]:border-destructive has-[input[aria-invalid=true]]:ring-3 has-[input[aria-invalid=true]]:ring-destructive/20 dark:bg-input/30 dark:data-disabled:bg-input/80 dark:has-[input[aria-invalid=true]]:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

function PasswordInputControl({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiPasswordInputControl>, "className"> & {
  className?: string
}) {
  return (
    <UiPasswordInputControl
      className={cn(
        "h-full w-full min-w-0 flex-1 bg-transparent px-2.5 py-1 text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed md:text-sm",
        className
      )}
      {...props}
    />
  )
}

function PasswordInputToggle({
  className,
  ...props
}: Omit<
  React.ComponentProps<typeof UiPasswordInputToggle>,
  "className" | "children"
> & {
  className?: string
}) {
  return (
    <UiPasswordInputToggle
      aria-label="Show password"
      className={cn(
        "mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5",
        className
      )}
      {...props}
    >
      {(state) =>
        state.visible ? (
          <EyeOffIcon aria-hidden="true" />
        ) : (
          <EyeIcon aria-hidden="true" />
        )
      }
    </UiPasswordInputToggle>
  )
}

export { PasswordInput, PasswordInputControl, PasswordInputToggle }
