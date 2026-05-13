import { TextArea as HeroTextArea } from "@heroui/react"
import type { TextAreaProps as HeroTextAreaProps } from "@heroui/react"

type TextareaProps = HeroTextAreaProps & {
  isDisabled?: boolean
}

const Textarea = ({
  disabled,
  fullWidth = true,
  isDisabled,
  variant = "secondary",
  ...props
}: TextareaProps) => (
  <HeroTextArea
    data-slot="textarea"
    disabled={disabled ?? isDisabled}
    fullWidth={fullWidth}
    variant={variant}
    {...props}
  />
)

export { Textarea }
export type { TextareaProps }
