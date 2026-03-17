#!/usr/bin/env node

const [command] = process.argv.slice(2)

switch (command) {
  case "version":
  case "-v":
  case "--version": {
    console.log("etyon v1.0.0")
    break
  }
  case "help":
  case "-h":
  case "--help": {
    console.log("Usage: etyon <command>")
    console.log("")
    console.log("Commands:")
    console.log("  version    Show version number")
    console.log("  help       Show this help message")
    break
  }
  default: {
    if (command) {
      console.error(`Unknown command: ${command}`)
      process.exitCode = 1
    } else {
      console.log("Etyon CLI - run 'etyon help' for usage")
    }
  }
}
