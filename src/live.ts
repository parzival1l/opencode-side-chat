import { createData, type Data } from "@opencode/client/solid"
import type { ServerRef } from "@opencode/plugin/gui"
import { createEffect, createMemo } from "solid-js"

const WINDOW = 50

type Listener = Parameters<Data["listen"]>[0]

function aboutSession(event: unknown, sessionID: string) {
  return (event as { data?: { sessionID?: unknown } }).data?.sessionID === sessionID
}

/**
 * One side chat's transcript in a store of its own.
 *
 * The app keeps transcripts only for open tabs and the last three chats viewed. A side chat is neither, so the app
 * drops its messages whenever they change. This store hears the same events but keeps them while the view is open.
 */
export function createTranscript(server: ServerRef, sessionID: string, forked: () => number | undefined) {
  // A restarted server gets a new `data`; follow it.
  const store = createMemo(() => {
    const shared = server.data
    return createData({
      api: () => server.client,
      directory: "",
      initialMessageLimit: () => WINDOW,
      omitToolFileData: true,
      connection: { status: () => (server.connected ? "connected" : "reconnecting") },
      event: {
        on: (type, handler) => shared.on(type, (event) => aboutSession(event, sessionID) && handler(event)),
        listen: (handler: Listener) =>
          shared.listen((event) => {
            if (aboutSession(event.details, sessionID)) handler(event)
          }),
      },
    })
  })

  // Pages back until the fork point, so a long side chat shows from its first question.
  async function fill(data: Data) {
    const since = forked()
    while (since !== undefined && data.session.message.more(sessionID)) {
      const oldest = data.session.message.list(sessionID)[0]
      if (oldest && oldest.time.created < since) return
      await data.session.message.loadMore(sessionID)
    }
  }

  // The store drops what it loaded when the connection drops, so this reloads on every reconnect.
  createEffect(() => {
    const data = store()
    if (!server.connected) return
    void data.session.message
      .sync(sessionID)
      .then(() => fill(data))
      .catch(() => undefined)
    void data.session.pending.sync(sessionID).catch(() => undefined)
  })

  return {
    messages: () => store().session.message.list(sessionID),
    pending: () => store().session.pending.list(sessionID),
    prompt: (text: string) => store().session.prompt({ sessionID, text }),
  }
}

export type Transcript = ReturnType<typeof createTranscript>
