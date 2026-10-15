/**
 * Pure state rule for the composer's Image skill: its on/off value is
 * re-derived whenever the selected chat model changes. State lives in
 * component state (no persistence) — this function holds the rule so it is
 * testable.
 */

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
