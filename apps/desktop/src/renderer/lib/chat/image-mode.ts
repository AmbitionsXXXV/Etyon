/**
 * Pure state helpers for the composer's image mode toggle. The toggle is only
 * usable when the selected chat model can output images; its on/off value is
 * re-derived whenever the selected model changes. State lives in component
 * state (no persistence) — these functions hold the rules so they are testable.
 */

export const getImageModeToggleDisabled = ({
  isCapable,
  isRequestPending
}: {
  isCapable: boolean
  isRequestPending: boolean
}): boolean => !isCapable || isRequestPending

/**
 * On a model change: a newly-selected capable model defaults ON (pure image
 * models can't chat, so defaulting ON avoids a guaranteed-failing plain send);
 * switching to a non-capable model forces OFF; otherwise the user's choice is
 * preserved.
 */
export const resolveImageModeForModelChange = ({
  isCapable,
  previous,
  wasCapable
}: {
  isCapable: boolean
  previous: boolean
  wasCapable: boolean
}): boolean => {
  if (!isCapable) {
    return false
  }

  if (!wasCapable) {
    return true
  }

  return previous
}
