/** Motion easing aligned with doc/settings.md (ease-out-quart variant). */
export const SETTINGS_PAGE_EASE_CURVE = [0.25, 0.1, 0.25, 1] as const

/**
 * Fixed sidebar column width so nav labels (e.g. ja 「ユーザーインターフェース」) do not
 * resize the column when switching locale.
 */
export const SETTINGS_PAGE_SIDEBAR_WIDTH_CLASS = "min-w-[17rem] w-[17rem]"
