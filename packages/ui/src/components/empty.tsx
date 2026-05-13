import { cn } from "@etyon/ui/lib/utils"
import { EmptyState as HeroEmptyState } from "@heroui/react"
import type { EmptyStateProps as HeroEmptyStateProps } from "@heroui/react"
import { cva } from "class-variance-authority"
import type { VariantProps } from "class-variance-authority"
import type * as React from "react"

const Empty = ({ className, ...props }: HeroEmptyStateProps) => (
  <HeroEmptyState data-slot="empty" className={className} {...props} />
)

const EmptyHeader = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="empty-header"
    className={cn("flex max-w-sm flex-col items-center gap-1", className)}
    {...props}
  />
)

const emptyMediaVariants = cva(
  "mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground [&_svg:not([class*='size-'])]:size-4"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
)

const EmptyMedia = ({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) => (
  <div
    data-slot="empty-icon"
    data-variant={variant}
    className={cn(emptyMediaVariants({ variant, className }))}
    {...props}
  />
)

const EmptyTitle = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="empty-title"
    className={cn("text-sm font-medium tracking-tight", className)}
    {...props}
  />
)

const EmptyDescription = ({
  className,
  ...props
}: React.ComponentProps<"p">) => (
  <p
    data-slot="empty-description"
    className={cn(
      "text-xs/relaxed text-muted-foreground [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary",
      className
    )}
    {...props}
  />
)

const EmptyContent = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="empty-content"
    className={cn(
      "flex w-full max-w-sm min-w-0 flex-col items-center gap-2 text-xs/relaxed text-balance",
      className
    )}
    {...props}
  />
)

export {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia
}
