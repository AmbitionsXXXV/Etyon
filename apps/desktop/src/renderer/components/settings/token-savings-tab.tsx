import type { TranslationKey } from "@etyon/i18n"
import { useI18n } from "@etyon/i18n/react"
import type {
  RtkTokenSavingsCommandEntry,
  RtkTokenSavingsDailyEntry,
  RtkTokenSavingsOutput,
  RtkTokenSavingsRecentCommand
} from "@etyon/rpc"
import { BarChart } from "@heroui-pro/react"
import {
  Button,
  Card,
  Chip,
  ProgressCircle,
  Table,
  Tooltip
} from "@heroui/react"
import {
  ChartLineData02Icon,
  Clock01Icon,
  CommandLineIcon,
  DatabaseLightningIcon,
  Download01Icon,
  FileEditIcon,
  FileSearchIcon,
  RefreshIcon,
  Shield01Icon,
  TerminalIcon,
  Upload01Icon,
  WorkflowSquare01Icon,
  ZapIcon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useQuery } from "@tanstack/react-query"
import { motion } from "motion/react"
import { useMemo } from "react"

import { orpc } from "@/renderer/lib/rpc"
import { settingsPageSectionMotion } from "@/renderer/lib/settings-page/motion"
import {
  buildCommandSavingsChartPoints,
  buildDailySavingsChartPoints,
  formatChartCommandLabel,
  formatCompactTokens,
  formatInteger,
  formatPercent,
  formatRuntime
} from "@/renderer/lib/token-savings/format"

type TokenSavingsIcon = typeof ChartLineData02Icon

interface MetricCardProps {
  icon: TokenSavingsIcon
  label: string
  value: string
}

interface ToolDesignCardConfig {
  descriptionKey: TranslationKey
  icon: TokenSavingsIcon
  statusKey: TranslationKey
  titleKey: TranslationKey
}

const DAILY_CHART_LIMIT = 30
const MAX_COMMAND_ROWS = 8
const MAX_RECENT_ROWS = 10

const TOOL_DESIGN_CARDS = [
  {
    descriptionKey: "settings.tokenSavings.agentTools.cards.rtk.description",
    icon: DatabaseLightningIcon,
    statusKey: "settings.tokenSavings.agentTools.cards.rtk.status",
    titleKey: "settings.tokenSavings.agentTools.cards.rtk.title"
  },
  {
    descriptionKey: "settings.tokenSavings.agentTools.cards.bash.description",
    icon: TerminalIcon,
    statusKey: "settings.tokenSavings.agentTools.cards.bash.status",
    titleKey: "settings.tokenSavings.agentTools.cards.bash.title"
  },
  {
    descriptionKey:
      "settings.tokenSavings.agentTools.cards.fileContext.description",
    icon: FileSearchIcon,
    statusKey: "settings.tokenSavings.agentTools.cards.fileContext.status",
    titleKey: "settings.tokenSavings.agentTools.cards.fileContext.title"
  },
  {
    descriptionKey:
      "settings.tokenSavings.agentTools.cards.fileMutation.description",
    icon: FileEditIcon,
    statusKey: "settings.tokenSavings.agentTools.cards.fileMutation.status",
    titleKey: "settings.tokenSavings.agentTools.cards.fileMutation.title"
  },
  {
    descriptionKey:
      "settings.tokenSavings.agentTools.cards.approval.description",
    icon: Shield01Icon,
    statusKey: "settings.tokenSavings.agentTools.cards.approval.status",
    titleKey: "settings.tokenSavings.agentTools.cards.approval.title"
  },
  {
    descriptionKey:
      "settings.tokenSavings.agentTools.cards.toolLoop.description",
    icon: WorkflowSquare01Icon,
    statusKey: "settings.tokenSavings.agentTools.cards.toolLoop.status",
    titleKey: "settings.tokenSavings.agentTools.cards.toolLoop.title"
  }
] as const satisfies readonly ToolDesignCardConfig[]

const clampPercent = (value: number): number =>
  Math.max(0, Math.min(100, value))

const MetricCard = ({ icon, label, value }: MetricCardProps) => (
  <Card
    className="min-w-0 rounded-lg border border-border bg-background/60 px-3 py-3"
    variant="transparent"
  >
    <Card.Header className="flex-row items-center gap-2 p-0 text-[0.6875rem] font-medium text-muted-foreground">
      <HugeiconsIcon className="text-primary" icon={icon} size={15} />
      <span>{label}</span>
    </Card.Header>
    <Card.Content className="mt-2 p-0">
      <div className="truncate text-lg font-semibold">{value}</div>
    </Card.Content>
  </Card>
)

const TokenSavingsErrorState = ({
  error,
  onRefresh
}: {
  error: string | null
  onRefresh: () => void
}) => {
  const { t } = useI18n()

  return (
    <motion.section
      {...settingsPageSectionMotion(0.15)}
      className="space-y-4 rounded-lg border border-border bg-card p-5"
    >
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">
          {t("settings.tokenSavings.status.unavailable")}
        </h2>
        <p className="text-xs leading-5 text-muted-foreground">
          {error ?? t("settings.tokenSavings.status.error")}
        </p>
      </div>

      <Button onPress={onRefresh} variant="secondary">
        <HugeiconsIcon icon={RefreshIcon} size={15} />
        {t("settings.tokenSavings.actions.refresh")}
      </Button>
    </motion.section>
  )
}

const TokenSavingsOverview = ({
  data,
  isRefreshing,
  onRefresh
}: {
  data: RtkTokenSavingsOutput
  isRefreshing: boolean
  onRefresh: () => void
}) => {
  const { t } = useI18n()
  const compressionRate = clampPercent(data.summary.averageSavingsPercent)

  return (
    <motion.section
      {...settingsPageSectionMotion(0.15)}
      className="space-y-5 rounded-lg border border-border bg-card p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">
            {t("settings.tokenSavings.overview.title")}
          </h2>
          <p className="text-xs leading-5 text-muted-foreground">
            {t("settings.tokenSavings.overview.description")}
          </p>
        </div>

        <Button
          isDisabled={isRefreshing}
          isPending={isRefreshing}
          onPress={onRefresh}
          variant="secondary"
        >
          <HugeiconsIcon icon={RefreshIcon} size={15} />
          {t("settings.tokenSavings.actions.refresh")}
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(10rem,0.7fr)_1.8fr]">
        <div className="flex min-h-44 items-center justify-center">
          <div className="relative grid size-40 place-items-center">
            <ProgressCircle
              aria-label={t("settings.tokenSavings.metrics.compressionRate")}
              color="success"
              value={compressionRate}
            >
              <ProgressCircle.Track
                className="size-40"
                strokeWidth={4}
                viewBox="0 0 36 36"
              >
                <ProgressCircle.TrackCircle
                  cx={18}
                  cy={18}
                  r={15}
                  strokeWidth={4}
                />
                <ProgressCircle.FillCircle
                  cx={18}
                  cy={18}
                  r={15}
                  strokeWidth={4}
                />
              </ProgressCircle.Track>
            </ProgressCircle>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-2 text-center">
              <div className="max-w-23 truncate text-xl leading-none font-semibold text-primary tabular-nums">
                {formatPercent(data.summary.averageSavingsPercent)}
              </div>
              <div className="mt-1 line-clamp-2 max-w-23 text-[0.625rem] leading-tight font-medium text-muted-foreground">
                {t("settings.tokenSavings.metrics.compressionRate")}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            icon={ZapIcon}
            label={t("settings.tokenSavings.metrics.tokensSaved")}
            value={formatCompactTokens(data.summary.totalSavedTokens)}
          />
          <MetricCard
            icon={CommandLineIcon}
            label={t("settings.tokenSavings.metrics.commands")}
            value={formatInteger(data.summary.totalCommands)}
          />
          <MetricCard
            icon={ChartLineData02Icon}
            label={t("settings.tokenSavings.metrics.averageSavings")}
            value={formatPercent(data.summary.averageSavingsPercent)}
          />
          <MetricCard
            icon={Download01Icon}
            label={t("settings.tokenSavings.metrics.inputTokens")}
            value={formatCompactTokens(data.summary.totalInputTokens)}
          />
          <MetricCard
            icon={Upload01Icon}
            label={t("settings.tokenSavings.metrics.outputTokens")}
            value={formatCompactTokens(data.summary.totalOutputTokens)}
          />
          <MetricCard
            icon={Clock01Icon}
            label={t("settings.tokenSavings.metrics.averageTime")}
            value={formatRuntime(data.summary.averageTimeMs)}
          />
        </div>
      </div>
    </motion.section>
  )
}

const DailySavingsChart = ({
  entries
}: {
  entries: RtkTokenSavingsDailyEntry[]
}) => {
  const { t } = useI18n()
  const chartPoints = useMemo(
    () => buildDailySavingsChartPoints(entries, DAILY_CHART_LIMIT),
    [entries]
  )

  return (
    <motion.section
      {...settingsPageSectionMotion(0.25)}
      className="space-y-4 rounded-lg border border-border bg-card p-5"
    >
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">
          {t("settings.tokenSavings.daily.title")}
        </h2>
        <p className="text-xs leading-5 text-muted-foreground">
          {t("settings.tokenSavings.daily.description")}
        </p>
      </div>

      {chartPoints.length > 0 ? (
        <Card
          className="rounded-lg border border-border bg-background/60 p-3"
          variant="transparent"
        >
          <BarChart data={chartPoints} height={220}>
            <BarChart.Grid vertical={false} />
            <BarChart.XAxis
              dataKey="label"
              interval="preserveStartEnd"
              tickMargin={8}
            />
            <BarChart.YAxis
              tickFormatter={(value: number) => formatCompactTokens(value)}
              width={44}
            />
            <BarChart.Bar
              barSize={12}
              dataKey="savedTokens"
              fill="var(--chart-3)"
              name={t("settings.tokenSavings.metrics.tokensSaved")}
              radius={[6, 6, 0, 0]}
            />
            <BarChart.Tooltip
              content={
                <BarChart.TooltipContent
                  indicator="line"
                  valueFormatter={(value) => formatCompactTokens(Number(value))}
                />
              }
            />
          </BarChart>
        </Card>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          {t("settings.tokenSavings.daily.empty")}
        </p>
      )}
    </motion.section>
  )
}

const CommandSavingsList = ({
  commands
}: {
  commands: RtkTokenSavingsCommandEntry[]
}) => {
  const { t } = useI18n()
  const chartPoints = useMemo(
    () => buildCommandSavingsChartPoints(commands, MAX_COMMAND_ROWS),
    [commands]
  )
  const chartHeight = Math.max(220, chartPoints.length * 38)

  return (
    <motion.section
      {...settingsPageSectionMotion(0.35)}
      className="space-y-4 rounded-lg border border-border bg-card p-5"
    >
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">
          {t("settings.tokenSavings.byCommand.title")}
        </h2>
        <p className="text-xs leading-5 text-muted-foreground">
          {t("settings.tokenSavings.byCommand.description")}
        </p>
      </div>

      {chartPoints.length > 0 ? (
        <Card
          className="rounded-lg border border-border bg-background/60 p-3"
          variant="transparent"
        >
          <BarChart data={chartPoints} height={chartHeight} layout="vertical">
            <BarChart.Grid horizontal={false} />
            <BarChart.XAxis
              tickFormatter={(value: number) => formatCompactTokens(value)}
              tickMargin={4}
              type="number"
            />
            <BarChart.YAxis
              dataKey="command"
              tickFormatter={(value: string) => formatChartCommandLabel(value)}
              tickMargin={8}
              type="category"
              width={130}
            />
            <BarChart.Bar
              barSize={14}
              dataKey="savedTokens"
              fill="var(--chart-2)"
              name={t("settings.tokenSavings.metrics.tokensSaved")}
              radius={[0, 16, 16, 0]}
            />
            <BarChart.Tooltip
              content={
                <BarChart.TooltipContent
                  indicator="line"
                  valueFormatter={(value) => formatCompactTokens(Number(value))}
                />
              }
            />
          </BarChart>
        </Card>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          {t("settings.tokenSavings.byCommand.empty")}
        </p>
      )}
    </motion.section>
  )
}

const RecentCommandCell = ({ command }: { command: string }) => (
  <Table.Cell className="min-w-0 text-xs font-medium">
    <Tooltip>
      <Tooltip.Trigger className="block w-full min-w-0 cursor-default truncate text-left">
        {command}
      </Tooltip.Trigger>
      <Tooltip.Content className="max-w-lg break-all">
        {command}
      </Tooltip.Content>
    </Tooltip>
  </Table.Cell>
)

const RecentCommandsTable = ({
  commands
}: {
  commands: RtkTokenSavingsRecentCommand[]
}) => {
  const { t } = useI18n()
  const visibleCommands = commands.slice(0, MAX_RECENT_ROWS)

  return (
    <motion.section
      {...settingsPageSectionMotion(0.45)}
      className="space-y-4 rounded-lg border border-border bg-card p-5"
    >
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">
          {t("settings.tokenSavings.recent.title")}
        </h2>
        <p className="text-xs leading-5 text-muted-foreground">
          {t("settings.tokenSavings.recent.description")}
        </p>
      </div>

      {visibleCommands.length > 0 ? (
        <Table
          className="rounded-lg border border-border bg-background/60"
          variant="secondary"
        >
          <Table.ScrollContainer>
            <Table.Content
              aria-label={t("settings.tokenSavings.recent.title")}
              className="min-w-[820px]"
            >
              <Table.Header className="**:data-[slot=table-column]:text-foreground [&_[data-slot=table-column]:first-child]:rounded-l-none [&_[data-slot=table-column]:last-child]:rounded-r-none">
                <Table.Column isRowHeader minWidth={120}>
                  {t("settings.tokenSavings.recent.time")}
                </Table.Column>
                <Table.Column minWidth={500}>
                  {t("settings.tokenSavings.recent.command")}
                </Table.Column>
                <Table.Column className="text-right" minWidth={96}>
                  {t("settings.tokenSavings.recent.saved")}
                </Table.Column>
                <Table.Column className="text-right" minWidth={104}>
                  {t("settings.tokenSavings.recent.reduction")}
                </Table.Column>
              </Table.Header>
              <Table.Body>
                {visibleCommands.map((command) => (
                  <Table.Row
                    id={`${command.timestampLabel}-${command.command}`}
                    key={`${command.timestampLabel}-${command.command}`}
                  >
                    <Table.Cell className="text-xs text-muted-foreground">
                      {command.timestampLabel}
                    </Table.Cell>
                    <RecentCommandCell command={command.command} />
                    <Table.Cell className="text-right text-xs text-muted-foreground">
                      {formatCompactTokens(command.savedTokens)}
                    </Table.Cell>
                    <Table.Cell className="text-right text-xs text-primary">
                      {formatPercent(command.reductionPercent)}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          {t("settings.tokenSavings.recent.empty")}
        </p>
      )}
    </motion.section>
  )
}

const AgentToolDesign = () => {
  const { t } = useI18n()

  return (
    <motion.section
      {...settingsPageSectionMotion(0.55)}
      className="space-y-4 rounded-lg border border-border bg-card p-5"
    >
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">
          {t("settings.tokenSavings.agentTools.title")}
        </h2>
        <p className="text-xs leading-5 text-muted-foreground">
          {t("settings.tokenSavings.agentTools.description")}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {TOOL_DESIGN_CARDS.map((card) => (
          <Card
            className="space-y-3 rounded-lg border border-border bg-background/60 px-3 py-3"
            key={card.titleKey}
            variant="transparent"
          >
            <Card.Header className="flex-row items-start gap-3 p-0">
              <div className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                <HugeiconsIcon icon={card.icon} size={17} />
              </div>
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium">{t(card.titleKey)}</div>
                <p className="text-xs leading-5 text-muted-foreground">
                  {t(card.descriptionKey)}
                </p>
              </div>
            </Card.Header>
            <Card.Footer className="p-0">
              <Chip size="sm" variant="soft">
                {t(card.statusKey)}
              </Chip>
            </Card.Footer>
          </Card>
        ))}
      </div>
    </motion.section>
  )
}

export const TokenSavingsTab = () => {
  const { t } = useI18n()
  const tokenSavingsQuery = useQuery({
    ...orpc.tokenSavings.get.queryOptions({}),
    refetchOnWindowFocus: false
  })
  const tokenSavings = tokenSavingsQuery.data
  const handleRefresh = () => {
    void tokenSavingsQuery.refetch()
  }

  if (tokenSavingsQuery.isLoading && !tokenSavings) {
    return (
      <div className="rounded-lg border border-border bg-card p-5 text-xs text-muted-foreground">
        {t("settings.tokenSavings.status.loading")}
      </div>
    )
  }

  if (!tokenSavings || !tokenSavings.available) {
    return (
      <TokenSavingsErrorState
        error={tokenSavings?.error ?? null}
        onRefresh={handleRefresh}
      />
    )
  }

  return (
    <div className="space-y-8">
      <TokenSavingsOverview
        data={tokenSavings}
        isRefreshing={tokenSavingsQuery.isFetching}
        onRefresh={handleRefresh}
      />
      <DailySavingsChart entries={tokenSavings.daily} />
      <CommandSavingsList commands={tokenSavings.commands} />
      <RecentCommandsTable commands={tokenSavings.recentCommands} />
      <AgentToolDesign />
    </div>
  )
}
