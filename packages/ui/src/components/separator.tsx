"use client"

import { Separator as HeroSeparator } from "@heroui/react"
import type { SeparatorProps as HeroSeparatorProps } from "@heroui/react"

type SeparatorProps = HeroSeparatorProps

const Separator = ({
  orientation = "horizontal",
  variant = "default",
  ...props
}: SeparatorProps) => (
  <HeroSeparator
    data-slot="separator"
    orientation={orientation}
    variant={variant}
    {...props}
  />
)

export { Separator }
export type { SeparatorProps }
