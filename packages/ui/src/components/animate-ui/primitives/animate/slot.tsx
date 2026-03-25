"use client"

import { cn } from "@etyon/ui/lib/utils"
import { isMotionComponent, motion } from "motion/react"
import type { HTMLMotionProps } from "motion/react"
import * as React from "react"

type AnyProps = Record<string, unknown>

type DOMMotionProps<T extends HTMLElement = HTMLElement> = Omit<
  HTMLMotionProps<keyof HTMLElementTagNameMap>,
  "ref"
> & { ref?: React.Ref<T> }

type WithAsChild<Base extends object> =
  | (Base & { asChild: true; children: React.ReactElement })
  | (Base & { asChild?: false | undefined })

type SlotProps<T extends HTMLElement = HTMLElement> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  children?: any
} & DOMMotionProps<T>

function mergeRefs<T>(
  ...refs: (React.Ref<T> | undefined)[]
): React.RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (!ref) {
        continue
      }
      if (typeof ref === "function") {
        ref(node)
      } else {
        ;(ref as React.RefObject<T | null>).current = node
      }
    }
  }
}

function mergeProps<T extends HTMLElement>(
  childProps: AnyProps,
  slotProps: DOMMotionProps<T>
): AnyProps {
  const merged: AnyProps = { ...childProps, ...slotProps }

  if (childProps.className || slotProps.className) {
    merged.className = cn(
      childProps.className as string,
      slotProps.className as string
    )
  }

  if (childProps.style || slotProps.style) {
    merged.style = {
      ...(childProps.style as React.CSSProperties),
      ...(slotProps.style as React.CSSProperties)
    }
  }

  return merged
}

function Slot<T extends HTMLElement = HTMLElement>({
  children,
  ref,
  ...props
}: SlotProps<T>) {
  const childType = React.isValidElement(children) ? children.type : null
  const isAlreadyMotion =
    typeof childType === "object" &&
    childType !== null &&
    isMotionComponent(childType)

  const Base = React.useMemo(() => {
    if (!childType) {
      return null
    }

    return isAlreadyMotion
      ? (childType as React.ElementType)
      : motion.create(childType as React.ElementType)
  }, [childType, isAlreadyMotion])

  if (!React.isValidElement(children) || !Base) {
    return null
  }

  const { ref: childRef, ...childProps } = children.props as AnyProps

  const mergedProps = mergeProps(childProps, props)

  return (
    <Base {...mergedProps} ref={mergeRefs(childRef as React.Ref<T>, ref)} />
  )
}

export {
  Slot,
  type AnyProps,
  type DOMMotionProps,
  type SlotProps,
  type WithAsChild
}
