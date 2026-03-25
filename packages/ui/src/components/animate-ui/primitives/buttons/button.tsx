"use client"

import { Slot } from "@etyon/ui/components/animate-ui/primitives/animate/slot"
import type { WithAsChild } from "@etyon/ui/components/animate-ui/primitives/animate/slot"
import { motion } from "motion/react"
import type { HTMLMotionProps } from "motion/react"
import * as React from "react"

type ButtonProps = WithAsChild<
  HTMLMotionProps<"button"> & {
    hoverScale?: number
    tapScale?: number
  }
>

function Button({
  hoverScale = 1.05,
  tapScale = 0.95,
  asChild = false,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : motion.button

  return (
    <Component
      whileTap={{ scale: tapScale }}
      whileHover={{ scale: hoverScale }}
      {...props}
    />
  )
}

export { Button, type ButtonProps }
