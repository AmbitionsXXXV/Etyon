import type { CustomThemeType } from "@etyon/rpc"
import {
  Field,
  FieldContent,
  FieldError,
  FieldLabel
} from "@etyon/ui/components/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@etyon/ui/components/select"
import type { AnyFieldApi } from "@tanstack/react-form"
import { useCallback } from "react"

import { toFieldErrors } from "../utils/form"

export const TypeField = ({
  field,
  label,
  options
}: {
  field: AnyFieldApi
  label: string
  options: { label: string; value: CustomThemeType }[]
}) => {
  const handleValueChange = useCallback(
    (nextValue: string) => {
      field.handleChange(nextValue as CustomThemeType)
    },
    [field]
  )

  return (
    <Field data-invalid={field.state.meta.errors.length > 0}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <FieldContent>
        <Select onValueChange={handleValueChange} value={field.state.value}>
          <SelectTrigger className="w-full" id={field.name}>
            <SelectValue>
              {(selectedValue) =>
                options.find((option) => option.value === selectedValue)
                  ?.label ?? selectedValue
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldError errors={toFieldErrors(field.state.meta.errors)} />
      </FieldContent>
    </Field>
  )
}
