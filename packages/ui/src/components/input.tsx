import { Input as HeroInput } from "@heroui/react"
import type { InputProps as HeroInputProps } from "@heroui/react"

type InputProps = HeroInputProps & {
  isDisabled?: boolean
}

const Input = ({
  disabled,
  fullWidth = true,
  isDisabled,
  variant = "secondary",
  ...props
}: InputProps) => (
  <HeroInput
    data-slot="input"
    disabled={disabled ?? isDisabled}
    fullWidth={fullWidth}
    variant={variant}
    {...props}
  />
)

export { Input }
export type { InputProps }
