import { getFonts } from "font-list"

let cachedFonts: string[] | null = null

export const listSystemFonts = async (): Promise<string[]> => {
  if (cachedFonts) {
    return cachedFonts
  }

  try {
    const fonts = await getFonts({ disableQuoting: true })
    cachedFonts = fonts.filter(Boolean).toSorted()
    return cachedFonts
  } catch {
    return []
  }
}
