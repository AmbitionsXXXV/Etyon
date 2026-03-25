"use client"

import { cn } from "@etyon/ui/lib/utils"
import { AnimatePresence, motion } from "motion/react"
import type { Transition } from "motion/react"
import * as React from "react"

type HighlightMode = "children" | "parent"

interface Bounds {
  top: number
  left: number
  width: number
  height: number
}

const DEFAULT_BOUNDS_OFFSET: Bounds = {
  top: 0,
  left: 0,
  width: 0,
  height: 0
}

interface HighlightDataAttributes {
  "aria-selected": boolean
  "data-active": "true" | "false"
  "data-disabled": boolean | undefined
  "data-highlight": true
  "data-value": string
}

type HighlightEventHandlers = Pick<
  React.HTMLAttributes<HTMLDivElement>,
  "onClick" | "onMouseEnter" | "onMouseLeave"
>

interface HighlightContextType<T extends string> {
  as?: keyof HTMLElementTagNameMap
  mode: HighlightMode
  activeValue: T | null
  setActiveValue: (value: T | null) => void
  setBounds: (bounds: DOMRect) => void
  clearBounds: () => void
  id: string
  hover: boolean
  click: boolean
  className?: string
  style?: React.CSSProperties
  activeClassName?: string
  setActiveClassName: (className: string) => void
  transition?: Transition
  disabled?: boolean
  enabled?: boolean
  exitDelay?: number
  forceUpdateBounds?: boolean
}

const HighlightContext = React.createContext<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HighlightContextType<any> | undefined
>(undefined)

function useHighlight<T extends string>(): HighlightContextType<T> {
  const context = React.useContext(HighlightContext)
  if (!context) {
    throw new Error("useHighlight must be used within a HighlightProvider")
  }
  return context as unknown as HighlightContextType<T>
}

interface BaseHighlightProps<T extends React.ElementType = "div"> {
  as?: T
  ref?: React.Ref<HTMLDivElement>
  mode?: HighlightMode
  value?: string | null
  defaultValue?: string | null
  onValueChange?: (value: string | null) => void
  className?: string
  style?: React.CSSProperties
  transition?: Transition
  hover?: boolean
  click?: boolean
  disabled?: boolean
  enabled?: boolean
  exitDelay?: number
}

interface ParentModeHighlightProps {
  boundsOffset?: Partial<Bounds>
  containerClassName?: string
  forceUpdateBounds?: boolean
}

type ControlledParentModeHighlightProps<T extends React.ElementType = "div"> =
  BaseHighlightProps<T> &
    ParentModeHighlightProps & {
      mode: "parent"
      controlledItems: true
      children: React.ReactNode
    }

type ControlledChildrenModeHighlightProps<T extends React.ElementType = "div"> =
  BaseHighlightProps<T> & {
    mode?: "children" | undefined
    controlledItems: true
    children: React.ReactNode
  }

type UncontrolledParentModeHighlightProps<T extends React.ElementType = "div"> =
  BaseHighlightProps<T> &
    ParentModeHighlightProps & {
      mode: "parent"
      controlledItems?: false
      itemsClassName?: string
      children: React.ReactElement | React.ReactElement[]
    }

type UncontrolledChildrenModeHighlightProps<
  T extends React.ElementType = "div"
> = BaseHighlightProps<T> & {
  mode?: "children"
  controlledItems?: false
  itemsClassName?: string
  children: React.ReactElement | React.ReactElement[]
}

type HighlightProps<T extends React.ElementType = "div"> =
  | ControlledParentModeHighlightProps<T>
  | ControlledChildrenModeHighlightProps<T>
  | UncontrolledParentModeHighlightProps<T>
  | UncontrolledChildrenModeHighlightProps<T>

interface InlineHighlightOverlayProps {
  activeClassName?: string
  contextClassName?: string
  contextExitDelay?: number
  contextId: string
  contextStyle?: React.CSSProperties
  dataAttributes: HighlightDataAttributes
  exitDelay?: number
  isActive: boolean
  isDisabled?: boolean
  itemTransition?: Transition
  style?: React.CSSProperties
}

const getHighlightExitDelay = (
  itemTransition?: Transition,
  exitDelay?: number,
  contextExitDelay?: number
): number =>
  (itemTransition?.delay ?? 0) + (exitDelay ?? contextExitDelay ?? 0) / 1000

const InlineHighlightOverlay = ({
  activeClassName,
  contextClassName,
  contextExitDelay,
  contextId,
  contextStyle,
  dataAttributes,
  exitDelay,
  isActive,
  isDisabled,
  itemTransition,
  style
}: InlineHighlightOverlayProps) => {
  if (!isActive || isDisabled) {
    return null
  }

  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        animate={{ opacity: 1 }}
        className={cn(contextClassName, activeClassName)}
        data-slot="motion-highlight"
        exit={{
          opacity: 0,
          transition: {
            ...itemTransition,
            delay: getHighlightExitDelay(
              itemTransition,
              exitDelay,
              contextExitDelay
            )
          }
        }}
        initial={{ opacity: 0 }}
        layoutId={`transition-background-${contextId}`}
        style={{
          position: "absolute",
          zIndex: 0,
          ...contextStyle,
          ...style
        }}
        transition={itemTransition}
        {...dataAttributes}
      />
    </AnimatePresence>
  )
}

// eslint-disable-next-line complexity -- The provider coordinates controlled and uncontrolled children across multiple highlight modes.
function Highlight<T extends React.ElementType = "div">({
  ref,
  ...props
}: HighlightProps<T>) {
  const {
    as: Component = "div",
    children,
    value,
    defaultValue,
    onValueChange,
    className,
    style,
    transition = { type: "spring", stiffness: 350, damping: 35 },
    hover = false,
    click = true,
    enabled = true,
    controlledItems,
    disabled = false,
    exitDelay = 200,
    mode = "children"
  } = props

  const forceUpdateBounds =
    "forceUpdateBounds" in props ? props.forceUpdateBounds : undefined
  const itemsClassName =
    "itemsClassName" in props ? props.itemsClassName : undefined
  const parentModeProps =
    mode === "parent" ? (props as ParentModeHighlightProps) : undefined
  const localRef = React.useRef<HTMLDivElement>(null)
  React.useImperativeHandle(ref, () => localRef.current as HTMLDivElement)

  const propsBoundsOffset = parentModeProps?.boundsOffset
  const boundsOffset = propsBoundsOffset ?? DEFAULT_BOUNDS_OFFSET
  const boundsOffsetTop = boundsOffset.top ?? 0
  const boundsOffsetLeft = boundsOffset.left ?? 0
  const boundsOffsetWidth = boundsOffset.width ?? 0
  const boundsOffsetHeight = boundsOffset.height ?? 0

  const boundsOffsetRef = React.useRef({
    top: boundsOffsetTop,
    left: boundsOffsetLeft,
    width: boundsOffsetWidth,
    height: boundsOffsetHeight
  })

  React.useEffect(() => {
    boundsOffsetRef.current = {
      top: boundsOffsetTop,
      left: boundsOffsetLeft,
      width: boundsOffsetWidth,
      height: boundsOffsetHeight
    }
  }, [boundsOffsetTop, boundsOffsetLeft, boundsOffsetWidth, boundsOffsetHeight])

  const [activeValue, setActiveValue] = React.useState<string | null>(
    value ?? defaultValue ?? null
  )
  const [boundsState, setBoundsState] = React.useState<Bounds | null>(null)
  const [activeClassNameState, setActiveClassNameState] =
    React.useState<string>("")

  const safeSetActiveValue = React.useCallback(
    (id: string | null) => {
      setActiveValue((prev) => {
        if (prev !== id) {
          onValueChange?.(id)
          return id
        }
        return prev
      })
    },
    [onValueChange]
  )

  const safeSetBoundsRef = React.useRef<((bounds: DOMRect) => void) | null>(
    null
  )

  React.useEffect(() => {
    safeSetBoundsRef.current = (bounds: DOMRect) => {
      if (!localRef.current) {
        return
      }

      const containerRect = localRef.current.getBoundingClientRect()
      const offset = boundsOffsetRef.current
      const newBounds: Bounds = {
        top: bounds.top - containerRect.top + offset.top,
        left: bounds.left - containerRect.left + offset.left,
        width: bounds.width + offset.width,
        height: bounds.height + offset.height
      }

      setBoundsState((prev) => {
        if (
          prev &&
          prev.top === newBounds.top &&
          prev.left === newBounds.left &&
          prev.width === newBounds.width &&
          prev.height === newBounds.height
        ) {
          return prev
        }
        return newBounds
      })
    }
  }, [])

  const safeSetBounds = React.useCallback((bounds: DOMRect) => {
    safeSetBoundsRef.current?.(bounds)
  }, [])

  const clearBounds = React.useCallback(() => {
    setBoundsState((prev) => (prev === null ? prev : null))
  }, [])

  React.useEffect(() => {
    if (value !== undefined) {
      setActiveValue(value)
    } else if (defaultValue !== undefined) {
      setActiveValue(defaultValue)
    }
  }, [value, defaultValue])

  const id = React.useId()

  React.useEffect(() => {
    if (mode !== "parent") {
      return
    }
    const container = localRef.current
    if (!container) {
      return
    }

    const onScroll = () => {
      if (!activeValue) {
        return
      }
      const activeEl = container.querySelector<HTMLElement>(
        `[data-value="${activeValue}"][data-highlight="true"]`
      )
      if (activeEl) {
        safeSetBoundsRef.current?.(activeEl.getBoundingClientRect())
      }
    }

    container.addEventListener("scroll", onScroll, { passive: true })
    return () => container.removeEventListener("scroll", onScroll)
  }, [mode, activeValue])

  const render = (content: React.ReactNode) => {
    if (mode === "parent") {
      return (
        <Component
          ref={localRef}
          data-slot="motion-highlight-container"
          style={{ position: "relative", zIndex: 1 }}
          className={parentModeProps?.containerClassName}
        >
          <AnimatePresence initial={false} mode="wait">
            {boundsState && (
              <motion.div
                data-slot="motion-highlight"
                animate={{
                  top: boundsState.top,
                  left: boundsState.left,
                  width: boundsState.width,
                  height: boundsState.height,
                  opacity: 1
                }}
                initial={{
                  top: boundsState.top,
                  left: boundsState.left,
                  width: boundsState.width,
                  height: boundsState.height,
                  opacity: 0
                }}
                exit={{
                  opacity: 0,
                  transition: {
                    ...transition,
                    delay: getHighlightExitDelay(transition, exitDelay)
                  }
                }}
                transition={transition}
                style={{ position: "absolute", zIndex: 0, ...style }}
                className={cn(className, activeClassNameState)}
              />
            )}
          </AnimatePresence>
          {content}
        </Component>
      )
    }

    return content
  }

  const providerValue = React.useMemo(
    () => ({
      activeClassName: activeClassNameState,
      activeValue,
      className,
      clearBounds,
      click,
      disabled,
      enabled,
      exitDelay,
      forceUpdateBounds,
      hover,
      id,
      mode,
      setActiveClassName: setActiveClassNameState,
      setActiveValue: safeSetActiveValue,
      setBounds: safeSetBounds,
      style,
      transition
    }),
    [
      activeClassNameState,
      activeValue,
      className,
      clearBounds,
      click,
      disabled,
      enabled,
      exitDelay,
      forceUpdateBounds,
      hover,
      id,
      mode,
      safeSetActiveValue,
      safeSetBounds,
      style,
      transition
    ]
  )

  let renderedContent = children
  if (enabled) {
    if (controlledItems) {
      renderedContent = render(children)
    } else {
      const uncontrolledChildren = (
        Array.isArray(children) ? children : [children]
      ) as React.ReactElement[]

      renderedContent = render(
        uncontrolledChildren.map((child) => (
          <HighlightItem
            key={
              child.key ??
              (child.props as { "data-value"?: string; id?: string })[
                "data-value"
              ] ??
              (child.props as { "data-value"?: string; id?: string }).id
            }
            className={itemsClassName}
          >
            {child}
          </HighlightItem>
        ))
      )
    }
  }

  return (
    <HighlightContext.Provider value={providerValue}>
      {renderedContent}
    </HighlightContext.Provider>
  )
}

function getNonOverridingDataAttributes(
  element: React.ReactElement,
  dataAttributes: Record<string, unknown>
): Record<string, unknown> {
  const nextAttributes: Record<string, unknown> = {}

  for (const key of Object.keys(dataAttributes)) {
    if ((element.props as Record<string, unknown>)[key] === undefined) {
      nextAttributes[key] = dataAttributes[key]
    }
  }

  return nextAttributes
}

type ExtendedChildProps = React.ComponentProps<"div"> & {
  id?: string
  ref?: React.Ref<HTMLElement>
  "data-active"?: string
  "data-value"?: string
  "data-disabled"?: boolean
  "data-highlight"?: boolean
  "data-slot"?: string
}

type HighlightItemProps<T extends React.ElementType = "div"> =
  React.ComponentProps<T> & {
    as?: T
    children: React.ReactElement
    id?: string
    value?: string
    className?: string
    style?: React.CSSProperties
    transition?: Transition
    activeClassName?: string
    disabled?: boolean
    exitDelay?: number
    asChild?: boolean
    forceUpdateBounds?: boolean
  }

// eslint-disable-next-line complexity -- The highlight primitive needs to coordinate multiple modes and child composition strategies.
function HighlightItem<T extends React.ElementType>({
  ref,
  as,
  children: child,
  id,
  value,
  className,
  style,
  transition,
  disabled,
  activeClassName,
  exitDelay,
  asChild = false,
  forceUpdateBounds,
  ...props
}: HighlightItemProps<T>) {
  const itemId = React.useId()
  const {
    activeValue,
    setActiveValue,
    mode,
    setBounds,
    clearBounds,
    hover,
    click,
    enabled,
    className: contextClassName,
    style: contextStyle,
    transition: contextTransition,
    id: contextId,
    disabled: contextDisabled,
    exitDelay: contextExitDelay,
    forceUpdateBounds: contextForceUpdateBounds,
    setActiveClassName
  } = useHighlight()

  const Component = as ?? "div"
  const element = child as React.ReactElement<ExtendedChildProps>
  const childValue =
    id ?? value ?? element.props?.["data-value"] ?? element.props?.id ?? itemId
  const isActive = activeValue === childValue
  const isDisabled = disabled === undefined ? contextDisabled : disabled
  const itemTransition = transition ?? contextTransition

  const localRef = React.useRef<HTMLDivElement>(null)
  React.useImperativeHandle(ref, () => localRef.current as HTMLDivElement)

  const refCallback = React.useCallback((node: HTMLElement | null) => {
    localRef.current = node as HTMLDivElement
  }, [])

  React.useEffect(() => {
    if (mode !== "parent") {
      return
    }
    let rafId: number
    let previousBounds: Bounds | null = null
    const shouldUpdateBounds =
      forceUpdateBounds === true ||
      (contextForceUpdateBounds && forceUpdateBounds !== false)

    const updateBounds = () => {
      if (!localRef.current) {
        return
      }

      const bounds = localRef.current.getBoundingClientRect()

      if (shouldUpdateBounds) {
        if (
          previousBounds &&
          previousBounds.top === bounds.top &&
          previousBounds.left === bounds.left &&
          previousBounds.width === bounds.width &&
          previousBounds.height === bounds.height
        ) {
          rafId = requestAnimationFrame(updateBounds)
          return
        }
        previousBounds = bounds
        rafId = requestAnimationFrame(updateBounds)
      }

      setBounds(bounds)
    }

    if (isActive) {
      updateBounds()
      setActiveClassName(activeClassName ?? "")
    } else if (!activeValue) {
      clearBounds()
    }

    if (shouldUpdateBounds) {
      return () => cancelAnimationFrame(rafId)
    }
  }, [
    mode,
    isActive,
    activeValue,
    setBounds,
    clearBounds,
    activeClassName,
    setActiveClassName,
    forceUpdateBounds,
    contextForceUpdateBounds
  ])

  if (!React.isValidElement(child)) {
    return child
  }

  const dataAttributes: HighlightDataAttributes = {
    "aria-selected": isActive,
    "data-active": isActive ? "true" : "false",
    "data-disabled": isDisabled,
    "data-highlight": true,
    "data-value": childValue
  }

  const commonHandlers: HighlightEventHandlers = {}
  if (hover) {
    commonHandlers.onMouseEnter = (event: React.MouseEvent<HTMLDivElement>) => {
      setActiveValue(childValue)
      element.props.onMouseEnter?.(event)
    }
    commonHandlers.onMouseLeave = (event: React.MouseEvent<HTMLDivElement>) => {
      setActiveValue(null)
      element.props.onMouseLeave?.(event)
    }
  } else if (click) {
    commonHandlers.onClick = (event: React.MouseEvent<HTMLDivElement>) => {
      setActiveValue(childValue)
      element.props.onClick?.(event)
    }
  }

  const overlay = (
    <InlineHighlightOverlay
      activeClassName={activeClassName}
      contextClassName={contextClassName}
      contextExitDelay={contextExitDelay}
      contextId={contextId}
      contextStyle={contextStyle}
      dataAttributes={dataAttributes}
      exitDelay={exitDelay}
      isActive={isActive}
      isDisabled={isDisabled}
      itemTransition={itemTransition}
      style={style}
    />
  )

  const renderAsChildElement = () => {
    if (mode === "children") {
      // eslint-disable-next-line react/no-clone-element -- This primitive must merge motion props into the provided child element.
      return React.cloneElement(
        element,
        {
          key: childValue,
          ref: refCallback,
          className: cn("relative", element.props.className),
          ...getNonOverridingDataAttributes(element, {
            ...dataAttributes,
            "data-slot": "motion-highlight-item-container"
          }),
          ...commonHandlers,
          ...props
        },
        <>
          {overlay}

          <Component
            className={className}
            data-slot="motion-highlight-item"
            style={{ position: "relative", zIndex: 1 }}
            {...dataAttributes}
          >
            {child}
          </Component>
        </>
      )
    }

    // eslint-disable-next-line react/no-clone-element -- This primitive must merge interaction props into the provided child element.
    return React.cloneElement(element, {
      ref: refCallback,
      ...getNonOverridingDataAttributes(element, {
        ...dataAttributes,
        "data-slot": "motion-highlight-item"
      }),
      ...commonHandlers
    })
  }

  const renderWrappedElement = () => {
    if (!enabled) {
      return child
    }

    return (
      <Component
        key={childValue}
        ref={localRef}
        className={cn(mode === "children" && "relative", className)}
        data-slot="motion-highlight-item-container"
        {...dataAttributes}
        {...props}
        {...commonHandlers}
      >
        {mode === "children" ? overlay : null}

        {/* eslint-disable-next-line react/no-clone-element -- This primitive must augment an arbitrary child while preserving the child's own element type. */}
        {React.cloneElement(element, {
          className: element.props.className,
          style: { position: "relative", zIndex: 1 },
          ...getNonOverridingDataAttributes(element, {
            ...dataAttributes,
            "data-slot": "motion-highlight-item"
          })
        })}
      </Component>
    )
  }

  if (asChild) {
    return renderAsChildElement()
  }

  return renderWrappedElement()
}

export {
  Highlight,
  HighlightItem,
  useHighlight,
  type HighlightProps,
  type HighlightItemProps
}
