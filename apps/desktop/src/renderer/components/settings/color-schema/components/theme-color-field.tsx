import type { AnyFieldApi, AnyFormApi } from "@tanstack/react-form"
import { useCallback } from "react"

import { ColorInputField } from "./color-input-field"

export const ThemeColorField = ({
  description,
  fallback,
  field,
  form,
  label
}: {
  description: string
  fallback: string
  field: AnyFieldApi
  form: AnyFormApi
  label: string
}) => {
  const handleValueChange = useCallback(
    (nextValue: string) => {
      form.setFieldValue("preset", "custom")
      field.handleChange(nextValue)
    },
    [field, form]
  )

  return (
    <ColorInputField
      description={description}
      errors={field.state.meta.errors}
      fallback={fallback}
      label={label}
      onBlur={field.handleBlur}
      onChange={handleValueChange}
      value={field.state.value}
    />
  )
}
