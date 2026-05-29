interface PromiseWithResolvers<TValue> {
  promise: Promise<TValue>
  reject: (reason?: unknown) => void
  resolve: (value: TValue | PromiseLike<TValue>) => void
}

interface PromiseConstructor {
  withResolvers<TValue>(): PromiseWithResolvers<TValue>
}
