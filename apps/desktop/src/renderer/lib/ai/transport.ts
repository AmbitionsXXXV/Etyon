import type { UIMessage } from "ai"
import { DefaultChatTransport } from "ai"

import { rpcClient } from "@/renderer/lib/rpc"

let transport: DefaultChatTransport<UIMessage> | undefined

export const getChatTransport = async <
  UI_MESSAGE extends UIMessage = UIMessage
>(): Promise<DefaultChatTransport<UI_MESSAGE>> => {
  if (!transport) {
    const { url } = await rpcClient.server.getUrl()
    transport = new DefaultChatTransport<UIMessage>({
      api: `${url}/api/chat`
    })
  }

  return transport as DefaultChatTransport<UI_MESSAGE>
}

export const resetChatTransport = (): void => {
  transport = undefined
}
