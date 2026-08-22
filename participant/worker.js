const readyMessage = 'ready\n'
const shutdownMessage = 'shutdown'
const startupFailurePrefix = 'startup-failed:'

const textDecoder = new TextDecoder()
let buffered = ''

const stopWhenRequested = (chunk) => {
  buffered += textDecoder.decode(chunk, { stream: true })

  for (let newline = buffered.indexOf('\n'); newline >= 0; newline = buffered.indexOf('\n')) {
    const message = buffered.slice(0, newline)
    buffered = buffered.slice(newline + 1)

    if (message === shutdownMessage) {
      Bare.IPC.end()
    }
  }
}

const start = () => {
  try {
    Bare.IPC.on('data', stopWhenRequested)
    Bare.IPC.write(readyMessage)
  } catch {
    Bare.IPC.write(`${startupFailurePrefix}worker initialization failed\n`)
    Bare.IPC.end()
  }
}

start()
