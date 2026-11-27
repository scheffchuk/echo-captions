import {
  Calendar as UiCalendar,
  CalendarDay as UiCalendarDay,
  CalendarGrid as UiCalendarGrid,
  CalendarHeading as UiCalendarHeading,
  CalendarNext as UiCalendarNext,
  CalendarPrevious as UiCalendarPrevious,
  CalendarWeekday as UiCalendarWeekday,
  CalendarWeekdays as UiCalendarWeekdays,
  CalendarWeeks as UiCalendarWeeks,
} from "@ui-sdk/react/calendar"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import type * as React from "react"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function dateToIsoDate(date: Date | undefined): string | null {
  if (!date || Number.isNaN(date.getTime())) return null
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")

  return `${year}-${month}-${day}`
}

function isoDateToDate(value: string | null): Date | undefined {
  if (!value) return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)

  if (!match) return undefined

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function Calendar({
  className,
  selected,
  onSelect,
  showOutsideDays = true,
  ...props
}: Omit<
  React.ComponentProps<typeof UiCalendar>,
  "className" | "mode" | "value" | "onValueChange" | "onSelect"
> & {
  className?: string
  selected?: Date
  onSelect?: (date: Date | undefined) => void
}) {
  return (
    <UiCalendar
      mode="single"
      deselectable
      showOutsideDays={showOutsideDays}
      value={dateToIsoDate(selected)}
      onValueChange={(next) => {
        if (!Array.isArray(next)) {
          onSelect?.(isoDateToDate(next))
        } else {
          onSelect?.(undefined)
        }
      }}
      className={cn(
        "w-fit bg-transparent p-2.5 text-popover-foreground [--cell-size:--spacing(8)]",
        className
      )}
      {...props}
    >
      <div className="mb-2 flex items-center justify-between gap-1">
        <UiCalendarPrevious
          aria-label="Previous month"
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon-sm" }),
            "size-(--cell-size) p-0 data-disabled:opacity-40"
          )}
        >
          <ChevronLeftIcon className="size-4" aria-hidden="true" />
        </UiCalendarPrevious>
        <UiCalendarHeading className="text-sm font-medium select-none" />
        <UiCalendarNext
          aria-label="Next month"
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon-sm" }),
            "size-(--cell-size) p-0 data-disabled:opacity-40"
          )}
        >
          <ChevronRightIcon className="size-4" aria-hidden="true" />
        </UiCalendarNext>
      </div>
      <UiCalendarGrid className="w-full border-collapse">
        <UiCalendarWeekdays>
          {(index) => (
            <UiCalendarWeekday
              index={index}
              className="size-(--cell-size) pb-1 text-center text-[0.75rem] font-normal text-muted-foreground select-none"
            />
          )}
        </UiCalendarWeekdays>
        <UiCalendarWeeks>
          {(cell) => (
            <UiCalendarDay
              value={cell.date}
              data-day={cell.date}
              className="size-(--cell-size) cursor-default rounded-md p-0 text-center align-middle text-sm font-normal transition-colors outline-none select-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 data-today:bg-muted data-today:font-medium data-outside:text-muted-foreground/60 data-selected:bg-primary data-selected:text-primary-foreground data-selected:hover:bg-primary/90 data-disabled:pointer-events-none data-disabled:opacity-40 data-unavailable:line-through data-unavailable:opacity-50"
            />
          )}
        </UiCalendarWeeks>
      </UiCalendarGrid>
    </UiCalendar>
  )
}

export { Calendar, dateToIsoDate, isoDateToDate }
