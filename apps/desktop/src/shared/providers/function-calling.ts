import type { StoredProviderModel } from "@etyon/rpc"

/**
 * How a model can be given tools:
 * - `native`: the provider exposes a real function-calling API.
 * - `xml-middleware`: the model has no tool API, so tools are injected into the
 *   system prompt as an XML spec and its XML output is parsed back into tool
 *   calls by the middleware.
 * - `unknown`: no explicit signal — treated as native (tools passed straight
 *   through) since misguessing would silently degrade a real model to XML mode.
 */
export type FunctionCallingSupport = "native" | "unknown" | "xml-middleware"

/**
 * Derives tool-calling support from the stored `functionCalling` capability
 * flag ONLY. There is deliberately no id-based heuristic here: the same helper
 * both activates the XML middleware and lights the settings capability badge,
 * so a wrong guess would silently route a native model through XML mode. The
 * flag must be set explicitly (via provider seed or manual override).
 *
 * Dependency-free (types only) so it is safe in both the main and renderer
 * processes and node-testable.
 */
export const resolveFunctionCallingSupport = (
  model: Pick<StoredProviderModel, "capabilities" | "id">
): FunctionCallingSupport => {
  const flag = model.capabilities?.functionCalling

  if (flag === true) {
    return "native"
  }

  if (flag === false) {
    return "xml-middleware"
  }

  return "unknown"
}
