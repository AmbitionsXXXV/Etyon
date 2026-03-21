import type { UIMessage } from "ai"
import { DefaultChatTransport } from "ai"

import { rpcClient } from "@/renderer/lib/rpc"

let transport: DefaultChatTransport<UIMessage> | undefined

export const getChatTransport = async (): Promise<
  DefaultChatTransport<UIMessage>
> => {
  if (!transport) {
    const { url } = await rpcClient.server.getUrl()
    transport = new DefaultChatTransport<UIMessage>({
      api: `${url}/api/chat`
    })
  }
  return transport
}

export const resetChatTransport = (): void => {
  transport = undefined
}
