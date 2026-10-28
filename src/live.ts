import type { SessionPromptInput } from "@opencode/client"
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

  // True while the side chat may have questions older than the loaded page. A fork copies the main chat's history,
  // so a loaded message from before the fork means the side chat's own messages are all here.
  const hasOlder = () => {
    const data = store()
    const since = forked()
    if (since === undefined || !data.session.message.more(sessionID)) return false
    const oldest = data.session.message.list(sessionID)[0]
    return !oldest || oldest.time.created >= since
  }

  let loading: Promise<void> | undefined

  // The store drops what it loaded when the connection drops, so this reloads on every reconnect.
  createEffect(() => {
    const data = store()
    if (!server.connected) return
    void data.session.message.sync(sessionID).catch(() => undefined)
    void data.session.pending.sync(sessionID).catch(() => undefined)
  })

  return {
    messages: () => store().session.message.list(sessionID),
    pending: () => store().session.pending.list(sessionID),
    hasOlder,
    /**
     * Loads the page before the oldest loaded message, as the main chat does when you scroll up. `before` runs just
     * before the page shows, so the view can keep its scroll position.
     */
    older(before?: () => void) {
      if (loading || !hasOlder()) return loading
      loading = store()
        .session.message.loadMore(sessionID, { beforePublish: before })
        .catch(() => undefined)
        .finally(() => {
          loading = undefined
        })
      return loading
    },
    /** Shows the question at once; it goes to the server after `gate` settles. */
    prompt: (text: string, metadata: object | undefined, gate?: Promise<unknown>) =>
      store().session.prompt({ sessionID, text, metadata: metadata as SessionPromptInput["metadata"], gate }),
  }
}

export type Transcript = ReturnType<typeof createTranscript>
