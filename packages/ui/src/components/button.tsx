import { mergeProps } from "@base-ui/react/merge-props"
import {
  Button as HeroButton,
  buttonVariants as heroButtonVariants
} from "@heroui/react"
import type {
  ButtonProps as HeroButtonProps,
  ButtonVariants as HeroButtonVariants
} from "@heroui/react"
import * as React from "react"

type HeroButtonSize = NonNullable<HeroButtonVariants["size"]>
type HeroButtonVariant = NonNullable<HeroButtonVariants["variant"]>
type LegacyButtonSize =
  | "default"
  | "icon"
  | "icon-lg"
  | "icon-sm"
  | "icon-xs"
  | "lg"
  | "sm"
  | "xs"
type LegacyButtonVariant =
  | "default"
  | "destructive"
  | "ghost"
  | "link"
  | "outline"
  | "secondary"
type ButtonSize = HeroButtonSize | LegacyButtonSize
type ButtonVariant = HeroButtonVariant | LegacyButtonVariant

type ButtonProps = Omit<
  HeroButtonProps,
  "isDisabled" | "isIconOnly" | "onClick" | "render" | "size" | "variant"
> & {
  disabled?: boolean
  isDisabled?: boolean
  isIconOnly?: boolean
  onClick?: React.MouseEventHandler<HTMLButtonElement>
  render?: HeroButtonProps["render"] | React.ReactElement
  size?: ButtonSize
  title?: string
  variant?: ButtonVariant
}

const buttonSizeMap = {
  default: "sm",
  icon: "sm",
  "icon-lg": "lg",
  "icon-sm": "sm",
  "icon-xs": "sm",
  lg: "lg",
  sm: "sm",
  xs: "sm"
} satisfies Record<LegacyButtonSize, HeroButtonSize>

const buttonVariantMap = {
  default: "primary",
  destructive: "danger-soft",
  ghost: "ghost",
  link: "ghost",
  outline: "outline",
  secondary: "secondary"
} satisfies Record<LegacyButtonVariant, HeroButtonVariant>

const resolveButtonSize = (size: ButtonSize): HeroButtonSize =>
  (size in buttonSizeMap
    ? buttonSizeMap[size as LegacyButtonSize]
    : size) as HeroButtonSize

const resolveButtonVariant = (variant: ButtonVariant): HeroButtonVariant =>
  (variant in buttonVariantMap
    ? buttonVariantMap[variant as LegacyButtonVariant]
    : variant) as HeroButtonVariant

const resolveButtonRender = (
  render: ButtonProps["render"]
): HeroButtonProps["render"] => {
  if (!React.isValidElement(render)) {
    return render
  }

  return (props) =>
    React.cloneElement(
      render,
      mergeProps<"button">(
        props as React.ComponentProps<"button">,
        render.props as React.ComponentProps<"button">
      )
    )
}

const buttonVariants = ({
  size = "default",
  variant = "default",
  ...props
}: Omit<HeroButtonVariants, "size" | "variant"> & {
  size?: ButtonSize
  variant?: ButtonVariant
} = {}) =>
  heroButtonVariants({
    ...props,
    isIconOnly: props.isIconOnly ?? String(size).startsWith("icon"),
    size: resolveButtonSize(size),
    variant: resolveButtonVariant(variant)
  })

const Button = ({
  disabled,
  isDisabled,
  isIconOnly,
  onClick,
  onPress,
  render,
  size = "default",
  variant = "default",
  ...props
}: ButtonProps) => {
  const handlePress =
    onPress ??
    ((event) => {
      onClick?.(event as unknown as React.MouseEvent<HTMLButtonElement>)
    })

  return (
    <HeroButton
      data-slot="button"
      isDisabled={isDisabled ?? disabled}
      isIconOnly={isIconOnly ?? String(size).startsWith("icon")}
      onPress={handlePress}
      render={resolveButtonRender(render)}
      size={resolveButtonSize(size)}
      variant={resolveButtonVariant(variant)}
      {...props}
    />
  )
}

export { Button, buttonVariants }
export type { ButtonProps }
