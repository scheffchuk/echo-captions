import {
  Field as UiField,
  FieldDescription as UiFieldDescription,
  FieldError as UiFieldError,
  FieldGroup as UiFieldGroup,
  FieldLabel as UiFieldLabel,
  FieldLegend as UiFieldLegend,
  FieldSet as UiFieldSet,
} from "@ui-sdk/react/field"
import { cva, type VariantProps } from "class-variance-authority"
import type * as React from "react"
import { useMemo } from "react"

import { cn } from "@/lib/utils"

const fieldVariants = cva(
  "group/field flex w-full gap-2 data-invalid:text-destructive",
  {
    variants: {
      orientation: {
        vertical: "flex-col *:w-full [&>.sr-only]:w-auto",
        horizontal:
          "flex-row items-center has-[>[data-slot=field-content]]:items-start *:data-[slot=field-label]:flex-auto has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
        responsive:
          "flex-col *:w-full @md/field-group:flex-row @md/field-group:items-center @md/field-group:*:w-auto @md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:*:data-[slot=field-label]:flex-auto [&>.sr-only]:w-auto @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
      },
    },
    defaultVariants: {
      orientation: "vertical",
    },
  }
)

function Field({
  className,
  orientation = "vertical",
  ...props
}: Omit<React.ComponentProps<typeof UiField>, "className"> &
  VariantProps<typeof fieldVariants> & {
    className?: string
  }) {
  return (
    <UiField
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
      {...props}
    />
  )
}

function FieldLabel({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiFieldLabel>, "className"> & {
  className?: string
}) {
  return (
    <UiFieldLabel
      className={cn(
        "group/field-label peer/field-label flex w-fit items-center gap-2 text-sm leading-snug font-medium select-none group-data-disabled/field:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function FieldDescription({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiFieldDescription>, "className"> & {
  className?: string
}) {
  return (
    <UiFieldDescription
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function FieldError({
  className,
  children,
  errors,
  match,
  ...props
}: Omit<React.ComponentProps<typeof UiFieldError>, "className" | "children"> & {
  className?: string
  children?: React.ReactNode
  errors?: Array<{ message?: string } | undefined>
}) {
  const content = useMemo(() => {
    if (children) {
      return children
    }

    if (!errors?.length) {
      return null
    }

    const uniqueErrors = [
      ...new Map(errors.map((error) => [error?.message, error])).values(),
    ]

    if (uniqueErrors.length === 1) {
      return uniqueErrors[0]?.message
    }

    return (
      <ul className="ml-4 flex list-disc flex-col gap-1">
        {uniqueErrors.map(
          (error, index) =>
            error?.message && <li key={index}>{error.message}</li>
        )}
      </ul>
    )
  }, [children, errors])

  if (match !== undefined) {
    return (
      <UiFieldError
        match={match}
        className={cn("text-sm font-normal text-destructive", className)}
        {...props}
      >
        {content}
      </UiFieldError>
    )
  }

  if (!content) {
    return null
  }

  return (
    <UiFieldError
      match
      role="alert"
      className={cn("text-sm font-normal text-destructive", className)}
      {...props}
    >
      {content}
    </UiFieldError>
  )
}

function FieldSet({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiFieldSet>, "className"> & {
  className?: string
}) {
  return (
    <UiFieldSet
      className={cn("m-0 min-w-0 border-0 p-0", className)}
      {...props}
    />
  )
}

function FieldLegend({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiFieldLegend>, "className"> & {
  className?: string
}) {
  return (
    <UiFieldLegend
      className={cn("text-sm font-medium text-foreground", className)}
      {...props}
    />
  )
}

function FieldGroup({
  className,
  ...props
}: Omit<React.ComponentProps<typeof UiFieldGroup>, "className"> & {
  className?: string
}) {
  return (
    <UiFieldGroup
      className={cn("flex flex-col gap-4", className)}
      {...props}
    />
  )
}

export {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
}
