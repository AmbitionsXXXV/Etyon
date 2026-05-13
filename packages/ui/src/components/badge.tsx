import {
  Badge as HeroBadge,
  badgeVariants as heroBadgeVariants
} from "@heroui/react"
import type {
  BadgeProps as HeroBadgeProps,
  BadgeVariants as HeroBadgeVariants
} from "@heroui/react"

type HeroBadgeColor = NonNullable<HeroBadgeVariants["color"]>
type HeroBadgeVariant = NonNullable<HeroBadgeVariants["variant"]>
type LegacyBadgeVariant =
  | "default"
  | "destructive"
  | "ghost"
  | "link"
  | "outline"
  | "secondary"
type BadgeVariant = HeroBadgeVariant | LegacyBadgeVariant

type BadgeProps = Omit<HeroBadgeProps, "color" | "variant"> & {
  color?: HeroBadgeColor
  variant?: BadgeVariant
}
interface ResolvedBadgeVariant {
  color: HeroBadgeColor
  variant: HeroBadgeVariant
}

const badgeVariantMap = {
  default: { color: "accent", variant: "primary" },
  destructive: { color: "danger", variant: "soft" },
  ghost: { color: "default", variant: "soft" },
  link: { color: "accent", variant: "soft" },
  outline: { color: "default", variant: "secondary" },
  secondary: { color: "default", variant: "secondary" }
} satisfies Record<
  LegacyBadgeVariant,
  {
    color: HeroBadgeColor
    variant: HeroBadgeVariant
  }
>

const resolveBadgeVariant = (
  color: HeroBadgeColor | undefined,
  variant: BadgeVariant
): ResolvedBadgeVariant => {
  if (variant in badgeVariantMap) {
    const mappedVariant = badgeVariantMap[variant as LegacyBadgeVariant]
    return {
      color: color ?? mappedVariant.color,
      variant: mappedVariant.variant
    }
  }

  return {
    color: color ?? "default",
    variant: variant as HeroBadgeVariant
  }
}

const badgeVariants = ({
  color,
  variant = "default",
  ...props
}: Omit<HeroBadgeVariants, "color" | "variant"> & {
  color?: HeroBadgeColor
  variant?: BadgeVariant
} = {}) =>
  heroBadgeVariants({ ...props, ...resolveBadgeVariant(color, variant) })

const Badge = ({ color, variant = "default", ...props }: BadgeProps) => {
  const resolvedVariant = resolveBadgeVariant(color, variant)

  return <HeroBadge data-slot="badge" {...resolvedVariant} {...props} />
}

export { Badge, badgeVariants }
export type { BadgeProps }
