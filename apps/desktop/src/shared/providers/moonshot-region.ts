import type { MoonshotRegion } from "@etyon/rpc"

const DEFAULT_MOONSHOT_REGION: MoonshotRegion = "china"

const MOONSHOT_BASE_URL_BY_REGION: Readonly<Record<MoonshotRegion, string>> = {
  china: "https://api.moonshot.cn/v1",
  international: "https://api.moonshot.ai/v1"
}

const MOONSHOT_HOSTNAME_BY_REGION: Readonly<Record<MoonshotRegion, string>> = {
  china: "api.moonshot.cn",
  international: "api.moonshot.ai"
}

const MOONSHOT_HOSTNAMES = new Set(Object.values(MOONSHOT_HOSTNAME_BY_REGION))

const replaceMoonshotHostname = (
  baseURL: string,
  region: MoonshotRegion
): string => {
  try {
    const parsedBaseURL = new URL(baseURL)

    if (!MOONSHOT_HOSTNAMES.has(parsedBaseURL.hostname)) {
      return baseURL
    }

    parsedBaseURL.hostname = MOONSHOT_HOSTNAME_BY_REGION[region]

    return parsedBaseURL.toString()
  } catch {
    return baseURL
  }
}

export const getDefaultMoonshotBaseURL = (
  region: MoonshotRegion | undefined = DEFAULT_MOONSHOT_REGION
): string => MOONSHOT_BASE_URL_BY_REGION[region]

export const resolveMoonshotRegion = (
  region: MoonshotRegion | undefined,
  baseURL: string | undefined
): MoonshotRegion => {
  if (region) {
    return region
  }

  const normalizedBaseURL = baseURL?.trim()

  if (!normalizedBaseURL) {
    return DEFAULT_MOONSHOT_REGION
  }

  try {
    const { hostname } = new URL(normalizedBaseURL)

    return hostname === MOONSHOT_HOSTNAME_BY_REGION.international
      ? "international"
      : DEFAULT_MOONSHOT_REGION
  } catch {
    return DEFAULT_MOONSHOT_REGION
  }
}

export const resolveMoonshotBaseURL = (
  baseURL: string | undefined,
  region: MoonshotRegion | undefined
): string => {
  const normalizedBaseURL = baseURL?.trim()
  const resolvedRegion = resolveMoonshotRegion(region, normalizedBaseURL)

  if (!normalizedBaseURL) {
    return getDefaultMoonshotBaseURL(resolvedRegion)
  }

  return replaceMoonshotHostname(normalizedBaseURL, resolvedRegion)
}
