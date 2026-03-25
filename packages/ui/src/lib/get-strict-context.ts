import * as React from "react"

type StrictContextProvider<T> = React.Provider<T | undefined>

export const getStrictContext = <T>(
  name?: string
): readonly [StrictContextProvider<T>, () => T] => {
  const Context = React.createContext<T | undefined>(undefined)

  const useSafeContext = () => {
    const context = React.use(Context)
    if (context === undefined) {
      throw new Error(`useContext must be used within ${name ?? "a Provider"}`)
    }

    return context
  }

  return [Context, useSafeContext] as const
}
