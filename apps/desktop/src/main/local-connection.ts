import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { app } from "electron"

const CONNECTION_FILE_VERSION = 1
const CONNECTION_TRANSPORT = "desktop-http"
const LOCAL_CONNECTION_DIR = ".config/etyon"
const LOCAL_CONNECTION_FILE_NAME = "connection.json"

let localConnectionToken = crypto.randomBytes(32).toString("base64url")

const buildLocalConnectionFilePath = (): string =>
  path.join(
    app.getPath("home"),
    LOCAL_CONNECTION_DIR,
    LOCAL_CONNECTION_FILE_NAME
  )

export const createLocalConnectionToken = (): string => {
  localConnectionToken = crypto.randomBytes(32).toString("base64url")

  return localConnectionToken
}

export const getLocalConnectionToken = (): string => localConnectionToken

export const writeLocalConnectionFile = (url: string): void => {
  const connectionFilePath = buildLocalConnectionFilePath()
  const connectionDir = path.dirname(connectionFilePath)

  fs.mkdirSync(connectionDir, { recursive: true })
  fs.writeFileSync(
    connectionFilePath,
    JSON.stringify(
      {
        pid: process.pid,
        token: getLocalConnectionToken(),
        transport: CONNECTION_TRANSPORT,
        url,
        version: CONNECTION_FILE_VERSION,
        writtenAt: new Date().toISOString()
      },
      null,
      2
    )
  )
}

export const removeLocalConnectionFile = (): void => {
  const connectionFilePath = buildLocalConnectionFilePath()

  if (fs.existsSync(connectionFilePath)) {
    fs.rmSync(connectionFilePath, { force: true })
  }
}

export const isAuthorizedLocalRequest = (request: Request): boolean => {
  const authorization = request.headers.get("authorization")

  return authorization === `Bearer ${getLocalConnectionToken()}`
}
