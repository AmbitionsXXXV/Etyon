import { Checkbox as HeroCheckbox } from "@heroui/react"
import type { CheckboxProps as HeroCheckboxProps } from "@heroui/react"
import * as React from "react"

type CheckboxProps = Omit<
  HeroCheckboxProps,
  "defaultSelected" | "isDisabled" | "isSelected" | "onChange"
> & {
  checked?: boolean
  defaultChecked?: boolean
  disabled?: boolean
  isDisabled?: boolean
  onCheckedChange?: (checked: boolean, eventDetails?: unknown) => void
}

const Checkbox = ({
  checked,
  defaultChecked,
  disabled,
  isDisabled,
  onCheckedChange,
  variant = "primary",
  ...props
}: CheckboxProps) => {
  const handleChange = React.useCallback(
    (nextChecked: boolean) => {
      onCheckedChange?.(nextChecked)
    },
    [onCheckedChange]
  )

  return (
    <HeroCheckbox
      data-slot="checkbox"
      defaultSelected={defaultChecked}
      isDisabled={isDisabled ?? disabled}
      isSelected={checked}
      onChange={handleChange}
      variant={variant}
      {...props}
    >
      <HeroCheckbox.Content>
        <HeroCheckbox.Control>
          <HeroCheckbox.Indicator />
        </HeroCheckbox.Control>
      </HeroCheckbox.Content>
    </HeroCheckbox>
  )
}

export { Checkbox }
export type { CheckboxProps }
