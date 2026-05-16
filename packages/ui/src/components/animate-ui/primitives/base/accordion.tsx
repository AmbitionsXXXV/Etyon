import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion"
import { cn } from "@etyon/ui/lib/utils"
import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

type AccordionProps = AccordionPrimitive.Root.Props
type AccordionItemProps = AccordionPrimitive.Item.Props
type AccordionHeaderProps = AccordionPrimitive.Header.Props
type AccordionTriggerProps = AccordionPrimitive.Trigger.Props
type AccordionPanelProps = AccordionPrimitive.Panel.Props

const Accordion = ({ className, ...props }: AccordionProps) => (
  <AccordionPrimitive.Root
    data-slot="accordion"
    className={cn("flex w-full flex-col", className)}
    {...props}
  />
)

const AccordionItem = ({ className, ...props }: AccordionItemProps) => (
  <AccordionPrimitive.Item
    data-slot="accordion-item"
    className={cn("not-last:border-b", className)}
    {...props}
  />
)

const AccordionHeader = ({ className, ...props }: AccordionHeaderProps) => (
  <AccordionPrimitive.Header className={cn("flex", className)} {...props} />
)

const AccordionTrigger = ({
  className,
  children,
  ...props
}: AccordionTriggerProps) => (
  <AccordionHeader>
    <AccordionPrimitive.Trigger
      data-slot="accordion-trigger"
      className={cn(
        "group/accordion-trigger relative flex flex-1 items-start justify-between rounded-lg border border-transparent py-2.5 text-left text-sm font-medium transition-all outline-none hover:underline focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:after:border-ring aria-disabled:pointer-events-none aria-disabled:opacity-50 **:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-4 **:data-[slot=accordion-trigger-icon]:text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
      <HugeiconsIcon
        data-slot="accordion-trigger-icon"
        icon={ArrowDown01Icon}
        className="pointer-events-none shrink-0 group-aria-expanded/accordion-trigger:hidden"
      />
      <HugeiconsIcon
        data-slot="accordion-trigger-icon"
        icon={ArrowUp01Icon}
        className="pointer-events-none hidden shrink-0 group-aria-expanded/accordion-trigger:inline"
      />
    </AccordionPrimitive.Trigger>
  </AccordionHeader>
)

const AccordionContent = ({
  className,
  children,
  ...props
}: AccordionPanelProps) => (
  <AccordionPrimitive.Panel
    data-slot="accordion-content"
    className="overflow-hidden text-sm data-open:animate-accordion-down data-closed:animate-accordion-up"
    {...props}
  >
    <div
      className={cn(
        "h-(--accordion-panel-height) pt-0 pb-2.5 data-ending-style:h-0 data-starting-style:h-0 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
        className
      )}
    >
      {children}
    </div>
  </AccordionPrimitive.Panel>
)

const AccordionPanel = AccordionContent

export {
  Accordion,
  AccordionContent,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger
}
export type {
  AccordionHeaderProps,
  AccordionItemProps,
  AccordionPanelProps,
  AccordionProps,
  AccordionTriggerProps
}
