import { useI18n } from "@etyon/i18n/react"
import type { ParsedSkill, SkillsSettings } from "@etyon/rpc"
import { Input, Switch } from "@heroui/react"
import { useQuery } from "@tanstack/react-query"
import { motion } from "motion/react"
import type { ChangeEventHandler } from "react"
import { useCallback } from "react"

import { orpc } from "@/renderer/lib/rpc"
import { settingsPageSectionMotion } from "@/renderer/lib/settings-page/motion"

interface SkillsTabProps {
  onChange: (skills: SkillsSettings) => void
  skills: SkillsSettings
}

interface SkillsSwitchRowProps {
  checked: boolean
  description: string
  label: string
  onChange: (checked: boolean) => void
}

const SKILLS_CONTEXT_MAX = 12
const SKILLS_CONTEXT_MIN = 1

const clampSkillsContext = (value: number): number =>
  Math.min(SKILLS_CONTEXT_MAX, Math.max(SKILLS_CONTEXT_MIN, value))

const getSkillDisplayPath = (skill: ParsedSkill): string => {
  if (!skill.projectPath) {
    return skill.path
  }

  return skill.path.replace(`${skill.projectPath}/`, "")
}

export const getSkillExtensionDisplayPaths = (skill: ParsedSkill): string[] =>
  skill.extensions

export const getSkillCommandDisplayItems = (skill: ParsedSkill): string[] =>
  skill.commands.map((command) =>
    command.flags.length > 0
      ? `${command.name} ${command.flags.join(" ")}`
      : command.name
  )

const SkillsSwitch = ({
  checked,
  label,
  onChange
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) => (
  <Switch aria-label={label} isSelected={checked} onChange={onChange}>
    <Switch.Content>
      <Switch.Control>
        <Switch.Thumb />
      </Switch.Control>
    </Switch.Content>
  </Switch>
)

const SkillsSwitchRow = ({
  checked,
  description,
  label,
  onChange
}: SkillsSwitchRowProps) => (
  <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-background/60 px-3 py-3">
    <div className="min-w-0 space-y-1">
      <div className="text-sm font-medium">{label}</div>
      <p className="text-xs leading-5 text-muted-foreground">{description}</p>
    </div>

    <SkillsSwitch checked={checked} label={label} onChange={onChange} />
  </div>
)

const SkillPreview = ({ skill }: { skill: ParsedSkill }) => {
  const { t } = useI18n()
  const commandDisplayItems = getSkillCommandDisplayItems(skill)
  const description = skill.shortDescription ?? skill.description
  const extensionDisplayPaths = getSkillExtensionDisplayPaths(skill)
  const scopeLabel =
    skill.scope === "project"
      ? t("settings.skills.scope.project")
      : t("settings.skills.scope.global")

  return (
    <div className="space-y-1 rounded-lg border border-border bg-background/60 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 truncate text-xs font-medium">{skill.name}</div>
        <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[0.625rem] font-medium text-muted-foreground">
          {scopeLabel}
        </span>
      </div>
      <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
        {description}
      </p>
      <div className="truncate text-[0.6875rem] text-muted-foreground">
        {getSkillDisplayPath(skill)}
      </div>
      {extensionDisplayPaths.length > 0 ? (
        <div className="space-y-1 rounded-md bg-muted/50 px-2 py-1.5">
          <div className="text-[0.625rem] font-medium text-muted-foreground">
            {t("settings.skills.extensions.summary", {
              count: extensionDisplayPaths.length
            })}
          </div>
          <div className="truncate text-[0.625rem] text-muted-foreground">
            {extensionDisplayPaths.join(" / ")}
          </div>
        </div>
      ) : null}
      {commandDisplayItems.length > 0 ? (
        <div className="space-y-1 rounded-md bg-muted/50 px-2 py-1.5">
          <div className="text-[0.625rem] font-medium text-muted-foreground">
            {t("settings.skills.commands.summary", {
              count: commandDisplayItems.length
            })}
          </div>
          <div className="truncate font-mono text-[0.625rem] text-muted-foreground">
            {commandDisplayItems.join(" / ")}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export const SkillsTab = ({ onChange, skills }: SkillsTabProps) => {
  const { t } = useI18n()
  const skillsQuery = useQuery(orpc.skills.list.queryOptions({}))

  const updateSkills = useCallback(
    (patch: Partial<SkillsSettings>) => {
      onChange({ ...skills, ...patch })
    },
    [onChange, skills]
  )

  const handleEnabledChange = useCallback(
    (checked: boolean) => updateSkills({ enabled: checked }),
    [updateSkills]
  )

  const handleIncludeGlobalChange = useCallback(
    (checked: boolean) => updateSkills({ includeGlobal: checked }),
    [updateSkills]
  )

  const handleIncludeProjectChange = useCallback(
    (checked: boolean) => updateSkills({ includeProject: checked }),
    [updateSkills]
  )

  const handleMaxContextSkillsChange = useCallback<
    ChangeEventHandler<HTMLInputElement>
  >(
    (event) => {
      const parsed = Number.parseInt(event.target.value, 10)

      if (!Number.isNaN(parsed)) {
        updateSkills({
          maxContextSkills: clampSkillsContext(parsed)
        })
      }
    },
    [updateSkills]
  )

  const detectedSkills = skillsQuery.data?.skills ?? []
  const globalSkills = detectedSkills.filter(
    (skill) => skill.scope === "global"
  )
  const projectSkills = detectedSkills.filter(
    (skill) => skill.scope === "project"
  )
  const extensionModuleCount = detectedSkills.reduce(
    (count, skill) => count + skill.extensions.length,
    0
  )
  const commandCount = detectedSkills.reduce(
    (count, skill) => count + skill.commands.length,
    0
  )

  return (
    <div className="space-y-8">
      <motion.section
        {...settingsPageSectionMotion(0.15)}
        className="space-y-5 rounded-lg border border-border bg-card p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">
              {t("settings.skills.title")}
            </h2>
            <p className="text-xs leading-5 text-muted-foreground">
              {t("settings.skills.description")}
            </p>
          </div>

          <SkillsSwitch
            checked={skills.enabled}
            label={t("settings.skills.title")}
            onChange={handleEnabledChange}
          />
        </div>

        <div className="grid gap-3">
          <SkillsSwitchRow
            checked={skills.includeProject}
            description={t("settings.skills.includeProject.description")}
            label={t("settings.skills.includeProject.label")}
            onChange={handleIncludeProjectChange}
          />
          <SkillsSwitchRow
            checked={skills.includeGlobal}
            description={t("settings.skills.includeGlobal.description")}
            label={t("settings.skills.includeGlobal.label")}
            onChange={handleIncludeGlobalChange}
          />
        </div>
      </motion.section>

      <motion.section
        {...settingsPageSectionMotion(0.25)}
        className="space-y-4 rounded-lg border border-border bg-card p-5"
      >
        <h2 className="text-sm font-semibold">
          {t("settings.skills.retrieval.title")}
        </h2>

        <div className="max-w-40 space-y-2">
          <label className="text-xs font-medium text-muted-foreground">
            {t("settings.skills.retrieval.maxContextSkills.label")}
          </label>
          <Input
            max={SKILLS_CONTEXT_MAX}
            min={SKILLS_CONTEXT_MIN}
            onChange={handleMaxContextSkillsChange}
            type="number"
            value={String(skills.maxContextSkills)}
          />
        </div>

        <p className="text-xs leading-5 text-muted-foreground">
          {t("settings.skills.retrieval.maxContextSkills.description")}
        </p>
      </motion.section>

      <motion.section
        {...settingsPageSectionMotion(0.35)}
        className="space-y-4 rounded-lg border border-border bg-card p-5"
      >
        <h2 className="text-sm font-semibold">
          {t("settings.skills.status.title")}
        </h2>

        <div className="grid gap-3 sm:grid-cols-5">
          <div className="rounded-lg border border-border bg-background/60 px-3 py-2">
            <div className="text-[0.6875rem] text-muted-foreground">
              {t("settings.skills.status.total")}
            </div>
            <div className="mt-1 text-lg font-semibold">
              {detectedSkills.length}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-background/60 px-3 py-2">
            <div className="text-[0.6875rem] text-muted-foreground">
              {t("settings.skills.status.project")}
            </div>
            <div className="mt-1 text-lg font-semibold">
              {projectSkills.length}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-background/60 px-3 py-2">
            <div className="text-[0.6875rem] text-muted-foreground">
              {t("settings.skills.status.global")}
            </div>
            <div className="mt-1 text-lg font-semibold">
              {globalSkills.length}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-background/60 px-3 py-2">
            <div className="text-[0.6875rem] text-muted-foreground">
              {t("settings.skills.status.extensions")}
            </div>
            <div className="mt-1 text-lg font-semibold">
              {extensionModuleCount}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-background/60 px-3 py-2">
            <div className="text-[0.6875rem] text-muted-foreground">
              {t("settings.skills.status.commands")}
            </div>
            <div className="mt-1 text-lg font-semibold">{commandCount}</div>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">
            {t("settings.skills.status.detected")}
          </h3>
          {detectedSkills.length > 0 ? (
            <div className="space-y-2">
              {detectedSkills.slice(0, 8).map((skill) => (
                <SkillPreview key={skill.path} skill={skill} />
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
              {t("settings.skills.status.empty")}
            </p>
          )}
        </div>
      </motion.section>
    </div>
  )
}
