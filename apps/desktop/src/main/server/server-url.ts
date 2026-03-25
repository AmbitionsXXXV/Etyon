let serverUrl = ""

export const getServerUrl = (): string => serverUrl

export const setServerUrl = (nextServerUrl: string): void => {
  serverUrl = nextServerUrl
}
