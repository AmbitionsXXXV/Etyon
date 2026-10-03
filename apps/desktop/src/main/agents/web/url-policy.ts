import { lookup } from "node:dns/promises"
import { once } from "node:events"
import { isIP } from "node:net"

const LOCAL_HOST_SUFFIXES = [
  ".internal",
  ".invalid",
  ".local",
  ".localhost",
  ".onion",
  ".test"
]
const ipv4Number = (address: string): number =>
  address.split(".").reduce((value, part) => value * 256 + Number(part), 0)
const RESERVED_IPV4_NETWORKS = (
  [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 3]
  ] as const
).map(([address, prefix]) => ({
  size: 2 ** (32 - prefix),
  start: ipv4Number(address)
}))

const isPublicIpv4 = (address: string): boolean => {
  const value = ipv4Number(address)
  return !RESERVED_IPV4_NETWORKS.some(
    ({ size, start }) => value >= start && value < start + size
  )
}
const isPublicIpv6 = (normalized: string): boolean => {
  // Only global unicast is eligible. Mapped IPv4, NAT64, unique-local,
  // link-local and multicast addresses never enter this range.
  const parts = normalized.split(":")
  const first = Number.parseInt(parts[0] ?? "0", 16)
  const second = Number.parseInt(parts[1] || "0", 16)
  return (
    first >= 0x2000 &&
    first <= 0x3fff &&
    !(first === 0x2001 && second <= 0x01ff) &&
    !(first === 0x2001 && second === 0x0db8) &&
    first !== 0x2002 &&
    !(first === 0x3fff && second <= 0x0fff)
  )
}
export const isPublicAddress = (address: string): boolean => {
  const normalized = address.toLowerCase().replaceAll(/^\[|\]$/gu, "")
  if (isIP(normalized) === 4) {
    return isPublicIpv4(normalized)
  }
  return (
    isIP(normalized) === 6 &&
    !normalized.includes(".") &&
    isPublicIpv6(normalized)
  )
}

export const parsePublicUrl = (input: string): URL => {
  const url = new URL(input)
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error("Only public HTTP(S) URLs without credentials are allowed")
  }
  const hostname = url.hostname
    .replaceAll(/^\[|\]$/gu, "")
    .replace(/\.$/u, "")
    .toLowerCase()
  if (
    hostname === "localhost" ||
    LOCAL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) ||
    (isIP(hostname) && !isPublicAddress(hostname))
  ) {
    throw new Error("Local, private and reserved URLs are not allowed")
  }
  url.hash = ""
  return url
}

const lookupWithSignal = async (hostname: string, signal?: AbortSignal) => {
  signal?.throwIfAborted()
  const pending = lookup(hostname, { all: true })
  if (!signal) {
    return await pending
  }
  const cleanup = new AbortController()
  const cancelled = async (): Promise<never> => {
    await once(signal, "abort", { signal: cleanup.signal })
    throw signal.reason
  }
  try {
    return await Promise.race([pending, cancelled()])
  } finally {
    cleanup.abort()
  }
}

export const resolvePublicTarget = async (
  input: string,
  signal?: AbortSignal
): Promise<{ address: string; url: URL }> => {
  const url = parsePublicUrl(input)
  const hostname = url.hostname.replaceAll(/^\[|\]$/gu, "")
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookupWithSignal(hostname, signal)
  signal?.throwIfAborted()
  if (
    !addresses.length ||
    addresses.some((entry) => !isPublicAddress(entry.address))
  ) {
    throw new Error("The URL resolves to a private or reserved address")
  }
  const [target] = addresses
  if (!target) {
    throw new Error("No public address was found")
  }
  return { address: target.address, url }
}
