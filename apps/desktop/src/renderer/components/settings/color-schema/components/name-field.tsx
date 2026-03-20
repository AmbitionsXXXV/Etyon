import {
  Field,
  FieldContent,
  FieldError,
  FieldLabel
} from "@etyon/ui/components/field"
import { Input } from "@etyon/ui/components/input"
import type { AnyFieldApi } from "@tanstack/react-form"
import { useCallback } from "react"

import { toFieldErrors } from "../utils/form"

export const NameField = ({
  field,
  label,
  placeholder
}: {
  field: AnyFieldApi
  label: string
  placeholder: string
}) => {
  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      field.handleChange(event.target.value)
    },
    [field]
  )

  return (
    <Field data-invalid={field.state.meta.errors.length > 0}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <FieldContent>
        <Input
          id={field.name}
          onBlur={field.handleBlur}
          onChange={handleChange}
          placeholder={placeholder}
          value={field.state.value}
        />
        <FieldError errors={toFieldErrors(field.state.meta.errors)} />
      </FieldContent>
    </Field>
  )
}
