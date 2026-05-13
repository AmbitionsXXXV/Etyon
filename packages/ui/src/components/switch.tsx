import { Switch as HeroSwitch } from "@heroui/react"
import type {
  SwitchProps as HeroSwitchProps,
  SwitchVariants as HeroSwitchVariants
} from "@heroui/react"
import * as React from "react"

type LegacySwitchSize = "default"
type SwitchSize = HeroSwitchVariants["size"] | LegacySwitchSize

type SwitchProps = Omit<
  HeroSwitchProps,
  "defaultSelected" | "isDisabled" | "isSelected" | "onChange" | "size"
> & {
  checked?: boolean
  defaultChecked?: boolean
  disabled?: boolean
  isDisabled?: boolean
  onCheckedChange?: (checked: boolean, eventDetails?: unknown) => void
  size?: SwitchSize
}

const resolveSwitchSize = (size: SwitchSize): HeroSwitchVariants["size"] =>
  size === "default" ? "md" : size

const Switch = ({
  checked,
  defaultChecked,
  disabled,
  isDisabled,
  onCheckedChange,
  size = "default",
  ...props
}: SwitchProps) => {
  const handleChange = React.useCallback(
    (nextChecked: boolean) => {
      onCheckedChange?.(nextChecked)
    },
    [onCheckedChange]
  )

  return (
    <HeroSwitch
      data-slot="switch"
      defaultSelected={defaultChecked}
      isDisabled={isDisabled ?? disabled}
      isSelected={checked}
      onChange={handleChange}
      size={resolveSwitchSize(size)}
      {...props}
    >
      <HeroSwitch.Control>
        <HeroSwitch.Thumb />
      </HeroSwitch.Control>
    </HeroSwitch>
  )
}

export { Switch }
export type { SwitchProps }
