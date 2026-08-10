const RELEASE_NOTES_BASE_URL = "https://github.com/AmbitionsXXXV/Etyon/"

export const resolveReleaseNotesUrl = (href: string): null | string => {
  try {
    const url = new URL(href, RELEASE_NOTES_BASE_URL)

    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null
  } catch {
    return null
  }
}
