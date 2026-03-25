import * as React from "react"

type StrictContextProvider<T> = React.Provider<T | undefined>

function getStrictContext<T>(
  name?: string
): readonly [StrictContextProvider<T>, () => T] {
  const Context = React.createContext<T | undefined>(undefined)

  const useSafeContext = () => {
    const ctx = React.use(Context)
    if (ctx === undefined) {
      throw new Error(`useContext must be used within ${name ?? "a Provider"}`)
    }
    return ctx
  }

  return [Context.Provider, useSafeContext] as const
}

export { getStrictContext }
