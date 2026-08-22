const readyMessage = "ready\n"
const shutdownMessage = "shutdown\n"

const textDecoder = new TextDecoder()

const stopWhenRequested = (chunk) => {
  if (textDecoder.decode(chunk) === shutdownMessage) {
    Bare.IPC.end()
  }
}

Bare.IPC.on("data", stopWhenRequested)
Bare.IPC.write(readyMessage)
