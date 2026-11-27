import { Label as UiLabel } from "@ui-sdk/react/label"
import type * as React from "react"

import { cn } from "@/lib/utils"

function Label({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiLabel>, "className"> & {
  className?: string
}) {
  return (
    <UiLabel
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-disabled:pointer-events-none group-data-disabled:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
