import { createServer } from "node:http"
import { connect } from "node:net"
import type { Duplex } from "node:stream"

import { closeHttpServer, listenHttpServer } from "./http-server"

export const createConnectProxy = async (targetPort: number) => {
  const tunnels: {
    authorization: string | undefined
    target: string | undefined
  }[] = []
  const sockets = new Set<Duplex>()
  const server = createServer((_request, response) => {
    response.writeHead(501).end()
  })
  server.on("connect", (request, socket, head) => {
    sockets.add(socket)
    tunnels.push({
      authorization: request.headers["proxy-authorization"],
      target: request.url
    })
    const upstream = connect(targetPort, "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (head.length) {
        upstream.write(head)
      }
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    sockets.add(upstream)
    socket.on("close", () => {
      sockets.delete(socket)
      upstream.destroy()
    })
    socket.on("end", () => {
      socket.destroy()
    })
    socket.on("error", () => {
      upstream.destroy()
    })
    upstream.on("close", () => {
      sockets.delete(upstream)
      socket.destroy()
    })
    upstream.on("error", () => {
      socket.destroy()
    })
  })
  const port = await listenHttpServer(server)
  return {
    close: async () => {
      for (const socket of sockets) {
        socket.destroy()
      }
      await closeHttpServer(server)
    },
    port,
    tunnels
  }
}
