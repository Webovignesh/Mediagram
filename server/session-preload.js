'use strict'

// Stable TDLib session bridge. server.js keeps one client reference for the
// lifetime of the process, while TDLib closes a client after logOut(). This
// wrapper keeps the server reference stable and swaps the underlying TDLib
// client after logout so the same process can immediately show a fresh login.

const { EventEmitter } = require('node:events')
const tdl = require('tdl')
const wsModule = require('ws')

const originalCreateClient = tdl.createClient.bind(tdl)
let stableClient = null
let activeClient = null
let createOptions = null
let restarting = null

function waitForAuthorizationClosed (client, timeoutMs = 15000) {
  return new Promise(resolve => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { client.off('update', onUpdate) } catch {}
      resolve()
    }
    const onUpdate = update => {
      if (update && update._ === 'updateAuthorizationState' && update.authorization_state && update.authorization_state._ === 'authorizationStateClosed') finish()
    }
    const timer = setTimeout(finish, timeoutMs)
    try { client.on('update', onUpdate) } catch { finish() }
  })
}

function attachRealClient (real) {
  activeClient = real
  real.on('update', update => {
    try { stableClient.emit('update', update) } catch {}
    // TDLib notifies close via updateAuthorizationState first; the 'close'
    // event follows from _handleClose. Forwarding both lets server.js reset
    // state promptly instead of invoking on a dead client.
    if (update && update._ === 'updateAuthorizationState' && update.authorization_state && update.authorization_state._ === 'authorizationStateClosed') {
      try { stableClient.emit('auth-closed', update) } catch {}
    }
  })
  real.on('error', error => {
    try { stableClient.emit('error', error) } catch {}
  })
  real.on('close', () => {
    if (activeClient === real) activeClient = null
    try { stableClient.emit('close') } catch {}
    // Spontaneous close (crash, logOut from elsewhere, DB eviction) leaves
    // server.js holding a stable wrapper with no live TDLib client. Every
    // invoke would then throw "A closed client cannot be reused". Recreate
    // immediately so the next get-chats works without a process restart.
    // restartAfterLogout() sets `restarting` and manages its own swap, so
    // don't fight it here.
    if (!restarting) {
      try { createRealClient() } catch {}
    }
  })
}

function createRealClient () {
  if (!createOptions) throw new Error('TDLib client options are unavailable')
  const real = originalCreateClient(createOptions)
  attachRealClient(real)
  return real
}

class StableTdClient extends EventEmitter {
  invoke (query) {
    if (!activeClient) {
      // Lazily recover if the real client died and the 'close' handler could
      // not recreate it (e.g. options not yet set is impossible here, but be
      // safe). If recreation fails, report a retryable state instead of the
      // raw tdl "closed client cannot be reused" error.
      if (!restarting && createOptions) {
        try { createRealClient() } catch {}
      }
      if (!activeClient) return Promise.reject(new Error('Telegram client is restarting'))
    }
    // The underlying tdl client may report isClosed() true just before our
    // 'close' listener runs. Recreate once instead of throwing the raw reuse
    // error to the UI.
    try {
      if (typeof activeClient.isClosed === 'function' && activeClient.isClosed()) {
        if (!restarting && createOptions) {
          try { createRealClient() } catch {}
          if (!activeClient || (typeof activeClient.isClosed === 'function' && activeClient.isClosed())) {
            return Promise.reject(new Error('Telegram client is restarting'))
          }
        } else {
          return Promise.reject(new Error('Telegram client is restarting'))
        }
      }
    } catch {}
    return activeClient.invoke(query)
  }

  isClosed () {
    try {
      if (!activeClient) return true
      if (typeof activeClient.isClosed === 'function') return !!activeClient.isClosed()
      return false
    } catch { return true }
  }

  ensureRealClient () {
    try {
      if (activeClient && typeof activeClient.isClosed === 'function' && activeClient.isClosed()) {
        try { activeClient.removeAllListeners && activeClient.removeAllListeners() } catch {}
        activeClient = null
      }
    } catch { activeClient = null }
    if (activeClient) return activeClient
    if (!createOptions) throw new Error('TDLib client options are unavailable')
    return createRealClient()
  }

  close () {
    if (!activeClient) return Promise.resolve()
    const current = activeClient
    activeClient = null
    return current.close()
  }

  async restartAfterLogout () {
    if (restarting) return restarting
    restarting = (async () => {
      const old = activeClient
      if (!old) throw new Error('Telegram session is not ready')

      // logOut destroys the authorization key and eventually closes this TDLib
      // client. Do not let server.js reuse that closed instance.
      await old.invoke({ _: 'logOut' })
      await waitForAuthorizationClosed(old)
      try { await old.close() } catch {}
      if (activeClient === old) activeClient = null

      // Create a brand-new TDLib client with the same persistent database/files
      // paths. Its authorization state will naturally become WaitPhoneNumber.
      createRealClient()
      return true
    })().finally(() => { restarting = null })
    return restarting
  }
}

tdl.createClient = function fileGramCreateStableClient (options) {
  if (stableClient) {
    // server.js guards with `if (client) return` and would otherwise keep
    // using a stable wrapper whose real client is dead. Ensure a live real
    // client before handing the same stable reference back.
    if (options && Object.keys(options).length) createOptions = { ...createOptions, ...options }
    try {
      const dead = !activeClient || (typeof activeClient.isClosed === 'function' && activeClient.isClosed())
      if (dead && !restarting) {
        if (activeClient) {
          try { activeClient.removeAllListeners && activeClient.removeAllListeners() } catch {}
          activeClient = null
        }
        createRealClient()
      }
    } catch {}
    return stableClient
  }
  createOptions = { ...options }
  stableClient = new StableTdClient()
  createRealClient()
  return stableClient
}

// Handle logout before server.js' websocket router. The response is sent only
// after a replacement TDLib client has been created, so subsequent requests
// cannot hit the closed client that logOut() just invalidated.
const OriginalWebSocketServer = wsModule.WebSocketServer
class FileGramSessionWebSocketServer extends OriginalWebSocketServer {
  constructor (options, callback) {
    super(options, callback)
    this.on('connection', socket => {
      const originalOn = socket.on.bind(socket)
      socket.on = function fileGramSocketOn (eventName, listener) {
        if (eventName !== 'message') return originalOn(eventName, listener)
        return originalOn('message', async raw => {
          let message = null
          try { message = JSON.parse(String(raw)) } catch {}
          if (message && message.type === 'logout') return
          return listener(raw)
        })
      }

      socket.prependListener('message', async raw => {
        let message
        try { message = JSON.parse(String(raw)) } catch { return }
        if (!message || message.type !== 'logout') return
        const id = message.id
        try {
          if (!stableClient) throw new Error('Telegram session is not ready')
          await stableClient.restartAfterLogout()
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ type: 'response', id, ok: true, data: { ok: true, restarted: true }, error: null }))
          }
        } catch (error) {
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ type: 'response', id, ok: false, data: null, error: String(error && error.message ? error.message : error) }))
          }
        }
      })
    })
  }
}

wsModule.WebSocketServer = FileGramSessionWebSocketServer
