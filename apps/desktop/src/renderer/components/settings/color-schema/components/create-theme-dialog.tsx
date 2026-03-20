import { useI18n } from "@etyon/i18n/react"
import type { CustomTheme, CustomThemeType } from "@etyon/rpc"
import { Button } from "@etyon/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@etyon/ui/components/dialog"
import { FieldGroup, FieldLegend, FieldSet } from "@etyon/ui/components/field"
import { useForm } from "@tanstack/react-form"
import { useCallback, useEffect, useMemo } from "react"

import { CREATE_THEME_DEFAULT_VALUES } from "../constants/defaults"
import { CUSTOM_THEME_PRESETS } from "../constants/presets"
import type { CustomThemePresetRow } from "../constants/presets"
import { buildCustomThemeFormSchema } from "../utils/form"
import {
  buildPresetLabelMap,
  buildTypeFieldOptions
} from "../utils/theme-labels"
import { NameField } from "./name-field"
import { PresetButton } from "./preset-button"
import { ThemeColorField } from "./theme-color-field"
import { ThemePreview } from "./theme-preview"
import { TypeField } from "./type-field"

const selectFormPreset = (state: { values: { preset: string } }) =>
  state.values.preset

const selectFormColorValues = (state: {
  values: {
    accent: string
    background: string
    secondary: string
    text: string
  }
}) => state.values

const selectIsSubmitting = (state: { isSubmitting: boolean }) =>
  state.isSubmitting

export const CreateCustomThemeDialog = ({
  existingThemes,
  onCreateTheme,
  onOpenChange,
  open
}: {
  existingThemes: CustomTheme[]
  onCreateTheme: (theme: CustomTheme) => void
  onOpenChange: (open: boolean) => void
  open: boolean
}) => {
  const { t } = useI18n()
  const formSchema = useMemo(
    () => buildCustomThemeFormSchema(existingThemes),
    [existingThemes]
  )
  const presetLabels = useMemo(() => buildPresetLabelMap(t), [t])
  const typeOptions = useMemo(() => buildTypeFieldOptions(t), [t])

  const form = useForm({
    defaultValues: CREATE_THEME_DEFAULT_VALUES,
    onSubmit: ({ value }) => {
      const timestamp = new Date().toISOString()

      onCreateTheme({
        colors: {
          accent: value.accent,
          background: value.background,
          secondary: value.secondary,
          text: value.text
        },
        createdAt: timestamp,
        id: crypto.randomUUID(),
        name: value.name.trim(),
        preset: value.preset,
        type: value.type,
        updatedAt: timestamp
      })

      onOpenChange(false)
    },
    validators: {
      onChange: formSchema,
      onSubmit: formSchema
    }
  })

  useEffect(() => {
    if (open) {
      form.reset(CREATE_THEME_DEFAULT_VALUES)
    }
  }, [form, open])

  const handleCancel = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const handlePresetSelect = useCallback(
    (preset: CustomThemePresetRow) => {
      const nextColors =
        preset.colors[form.getFieldValue("type") as CustomThemeType]

      form.setFieldValue("accent", nextColors.accent)
      form.setFieldValue("background", nextColors.background)
      form.setFieldValue("preset", preset.key)
      form.setFieldValue("secondary", nextColors.secondary)
      form.setFieldValue("text", nextColors.text)
    },
    [form]
  )

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      await form.handleSubmit()
    },
    [form]
  )

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-h-[calc(100svh-2rem)] max-w-[calc(100vw-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-[min(760px,calc(100vw-2rem))]"
        showCloseButton={false}
      >
        <form
          className="grid items-start gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_260px]"
          onSubmit={handleSubmit}
        >
          <div className="space-y-6">
            <DialogHeader>
              <DialogTitle>
                {t("settings.customThemes.dialog.title")}
              </DialogTitle>
              <DialogDescription>
                {t("settings.customThemes.dialog.description")}
              </DialogDescription>
            </DialogHeader>

            <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_120px]">
              <form.Field name="name">
                {(field) => (
                  <NameField
                    field={field}
                    label={t("settings.customThemes.fields.name.label")}
                    placeholder={t(
                      "settings.customThemes.fields.name.placeholder"
                    )}
                  />
                )}
              </form.Field>

              <form.Field name="type">
                {(field) => (
                  <TypeField
                    field={field}
                    label={t("settings.customThemes.fields.type.label")}
                    options={typeOptions}
                  />
                )}
              </form.Field>
            </FieldGroup>

            <div className="space-y-3">
              <div className="grid grid-cols-2 rounded-lg bg-muted/70 p-1">
                <button
                  className="rounded-md bg-background px-3 py-2 text-sm font-medium text-foreground shadow-xs"
                  type="button"
                >
                  {t("settings.customThemes.editor.simple")}
                </button>
                <button
                  className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground"
                  disabled
                  type="button"
                >
                  {t("settings.customThemes.editor.advanced")}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("settings.customThemes.editor.simpleDescription")}
              </p>
            </div>

            <FieldSet>
              <FieldLegend>
                {t("settings.customThemes.presets.title")}
              </FieldLegend>
              <form.Subscribe selector={selectFormPreset}>
                {(activePreset) => (
                  <div className="flex flex-wrap gap-2">
                    {CUSTOM_THEME_PRESETS.map((preset) => (
                      <PresetButton
                        active={activePreset === preset.key}
                        key={preset.key}
                        label={presetLabels[preset.key]}
                        onSelect={handlePresetSelect}
                        preset={preset}
                      />
                    ))}
                  </div>
                )}
              </form.Subscribe>
            </FieldSet>

            <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <form.Field name="background">
                {(field) => (
                  <ThemeColorField
                    description={t(
                      "settings.customThemes.fields.background.description"
                    )}
                    fallback={CREATE_THEME_DEFAULT_VALUES.background}
                    field={field}
                    form={form}
                    label={t("settings.customThemes.fields.background.label")}
                  />
                )}
              </form.Field>

              <form.Field name="text">
                {(field) => (
                  <ThemeColorField
                    description={t(
                      "settings.customThemes.fields.text.description"
                    )}
                    fallback={CREATE_THEME_DEFAULT_VALUES.text}
                    field={field}
                    form={form}
                    label={t("settings.customThemes.fields.text.label")}
                  />
                )}
              </form.Field>

              <form.Field name="accent">
                {(field) => (
                  <ThemeColorField
                    description={t(
                      "settings.customThemes.fields.accent.description"
                    )}
                    fallback={CREATE_THEME_DEFAULT_VALUES.accent}
                    field={field}
                    form={form}
                    label={t("settings.customThemes.fields.accent.label")}
                  />
                )}
              </form.Field>

              <form.Field name="secondary">
                {(field) => (
                  <ThemeColorField
                    description={t(
                      "settings.customThemes.fields.secondary.description"
                    )}
                    fallback={CREATE_THEME_DEFAULT_VALUES.secondary}
                    field={field}
                    form={form}
                    label={t("settings.customThemes.fields.secondary.label")}
                  />
                )}
              </form.Field>
            </FieldGroup>

            <p className="border-t border-border pt-3 text-xs text-muted-foreground">
              {t("settings.customThemes.editor.advancedHint")}
            </p>
          </div>

          <div className="space-y-3 lg:border-l lg:border-border lg:pl-6">
            <div className="text-sm font-medium">
              {t("settings.customThemes.preview.title")}
            </div>
            <form.Subscribe selector={selectFormColorValues}>
              {(values) => (
                <ThemePreview
                  colors={{
                    accent: values.accent,
                    background: values.background,
                    secondary: values.secondary,
                    text: values.text
                  }}
                />
              )}
            </form.Subscribe>
          </div>

          <DialogFooter className="col-span-full px-0 pt-2 pb-0">
            <Button onClick={handleCancel} type="button" variant="outline">
              {t("settings.common.cancel")}
            </Button>
            <form.Subscribe selector={selectIsSubmitting}>
              {(isSubmitting) => (
                <Button disabled={isSubmitting} type="submit">
                  {isSubmitting
                    ? t("settings.common.saving")
                    : t("settings.common.save")}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
