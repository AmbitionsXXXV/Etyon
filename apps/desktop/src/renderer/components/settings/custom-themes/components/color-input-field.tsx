import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel
} from "@etyon/ui/components/field"
import { Input } from "@etyon/ui/components/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput
} from "@etyon/ui/components/input-group"
import { useCallback, useId } from "react"

import { getValidHexColor } from "../utils/color"
import { normalizeHexDraft, toFieldErrors } from "../utils/form"

export const ColorInputField = ({
  description,
  errors,
  fallback,
  label,
  onBlur,
  onChange,
  value
}: {
  description: string
  errors: unknown[]
  fallback: string
  label: string
  onBlur: () => void
  onChange: (value: string) => void
  value: string
}) => {
  const colorInputId = useId()
  const safeColorValue = getValidHexColor(value, fallback)

  const handleColorChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange(event.target.value.toLowerCase())
    },
    [onChange]
  )

  const handleTextChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange(normalizeHexDraft(event.target.value))
    },
    [onChange]
  )

  return (
    <Field data-invalid={errors.length > 0}>
      <FieldLabel htmlFor={`${colorInputId}-text`}>{label}</FieldLabel>
      <FieldContent>
        <InputGroup>
          <InputGroupAddon align="inline-start">
            <label
              className="relative flex size-4 cursor-pointer rounded-sm border border-border shadow-xs"
              htmlFor={colorInputId}
              style={{ backgroundColor: safeColorValue }}
            >
              <span className="sr-only">{label}</span>
            </label>
            <Input
              className="sr-only"
              id={colorInputId}
              onChange={handleColorChange}
              type="color"
              value={safeColorValue}
            />
          </InputGroupAddon>
          <InputGroupInput
            id={`${colorInputId}-text`}
            onBlur={onBlur}
            onChange={handleTextChange}
            spellCheck={false}
            value={value}
          />
        </InputGroup>
        <FieldDescription>{description}</FieldDescription>
        <FieldError errors={toFieldErrors(errors)} />
      </FieldContent>
    </Field>
  )
}
