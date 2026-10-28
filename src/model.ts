import { createKeyed, type Context, type SessionRef } from "@opencode/plugin/gui"
import { onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { Transcript } from "./live"
import { SideChat, type Chat, type State } from "./rpc"
import { lastAnswer, ownMessages, quote, titleFrom, withQuote } from "./transcript"

export const LIST = "list"

/**
 * A cancelable DOM event a plugin's "Quote" action dispatches on the selected text, with `detail: { text }`. A side
 * chat cancels it and takes the quote into its own composer; otherwise the quote goes to the main chat.
 */
export const QUOTE_EVENT = "opencode:quote"
const CHAT = "chat-"

/** The panel tab id of a side chat, and back. */
export const tabOf = (sessionID: string) => `${CHAT}${sessionID}`
export const chatOf = (tab: string) => (tab.startsWith(CHAT) ? tab.slice(CHAT.length) : undefined)

// Selections inside fields and inside a side chat are not conversation text to start a new side chat with.
const IGNORE = "input, textarea, select, [contenteditable=''], [contenteditable='true'], .sidechat"

/** The selected text outside fields, or "" when there is none worth using. */
export function selectedText(within?: string): string {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return ""
  const node = selection.anchorNode
  const element = node instanceof Element ? node : node?.parentElement
  if (within ? !element?.closest(within) : element?.closest(IGNORE)) return ""
  return selection.toString().trim()
}

/** Side chats by parent chat, the composer drafts, and every action on them. */
export function createModel(ctx: Context) {
  const [chats, setChats] = createStore<Record<string, readonly Chat[]>>({})
  const [drafts, setDrafts] = createStore<Record<string, string>>({})
  const loading = new Set<string>()
  const starting = new Set<string>()
  // Side chats whose draft goes out as soon as their view opens: `/side <question>`.
  const autosend = new Set<string>()

  const rpc = (session: SessionRef) => session.server.client.rpc(SideChat)
  // RPC replies arrive untyped; the server's output schema guarantees a State.
  const put = (value: unknown) => {
    const state = value as State
    setChats(state.parentID, [...state.chats])
  }

  // Archived sessions stay off Home and the session search; the side panel is their only home. The server is the
  // source of truth, so each side chat is archived once per window, which also repairs chats linked before this.
  const archived = new Set<string>()
  function archive(session: SessionRef, chats: readonly Chat[]) {
    for (const chat of chats) {
      if (archived.has(chat.sessionID) || session.server.data.session.get(chat.sessionID)?.time.archived) continue
      archived.add(chat.sessionID)
      session.server.client.session.update({ sessionID: chat.sessionID, archived: true }).catch(() => {
        archived.delete(chat.sessionID)
      })
    }
  }

  function fail(error: unknown) {
    ctx.toast.show({
      title: ctx.t("error", { message: error instanceof Error ? error.message : String(error) }),
      variant: "error",
    })
  }

  // Follows changes other windows and the agent make. Side chats live on the desktop's own server.
  createKeyed(
    () => ctx.servers.get("sidecar")?.client,
    (client) => {
      const api = client.rpc(SideChat)
      for (const parentID of Object.keys(chats)) void api.list({ parentID }).then(put, () => undefined)
      onCleanup(api.events.on("updated", (event) => put(event.data as unknown as State)))
    },
  )

  /** Loads a chat's side chats once; `list` stays undefined until they arrive. */
  function load(session: SessionRef) {
    if (!session.id || session.pending || chats[session.id] || loading.has(session.id)) return
    loading.add(session.id)
    rpc(session)
      .list({ parentID: session.id })
      .then((value) => {
        put(value)
        archive(session, (value as State).chats)
      }, fail)
      .finally(() => loading.delete(session.id))
  }

  const list = (parentID: string): readonly Chat[] | undefined => chats[parentID]
  const find = (parentID: string, sessionID: string) => chats[parentID]?.find((chat) => chat.sessionID === sessionID)
  const number = (parentID: string, sessionID: string) =>
    (chats[parentID]?.findIndex((chat) => chat.sessionID === sessionID) ?? -1) + 1

  function title(parentID: string, sessionID: string) {
    const chat = find(parentID, sessionID)
    return chat?.title || ctx.t("chat.untitled", { number: Math.max(1, number(parentID, sessionID)) })
  }

  const key = (tab: string) => `${ctx.id}:${tab}`

  function open(session: SessionRef, sessionID: string) {
    ctx.layout.open(key(tabOf(sessionID)), session, { tab: "select" })
  }

  function showList(session: SessionRef) {
    ctx.layout.open(key(LIST), session, { tab: "select" })
  }

  /** Sends through the side chat's own transcript, so the question shows the moment it is sent. */
  function send(session: SessionRef, transcript: Transcript, sessionID: string, text: string) {
    const value = text.trim()
    if (!value) return
    setDrafts(sessionID, "")
    transcript.prompt(value).catch((error: unknown) => {
      setDrafts(sessionID, (current) => current || text)
      fail(error)
    })
    if (!find(session.id, sessionID)?.title) {
      void rpc(session)
        .rename({ parentID: session.id, sessionID, title: titleFrom(value) })
        .then(put, () => undefined)
    }
  }

  /** Forks the chat into a new side chat and opens it. A question goes straight in; a selection becomes a quote. */
  async function start(session: SessionRef | undefined, question?: string) {
    if (!session) {
      ctx.toast.show({ title: ctx.t("noChat") })
      return
    }
    if (!session.id || session.pending || starting.has(session.key)) return
    const data = session.server.data
    if (data.session.message.list(session.id).length === 0) {
      ctx.toast.show({ title: ctx.t("empty.parent") })
      return
    }
    const quoted = question?.trim() ? "" : quote(selectedText())
    starting.add(session.key)
    const progress = ctx.toast.show({ title: ctx.t("starting"), variant: "loading", persistent: true })
    const client = session.server.client
    let forked: string | undefined
    try {
      const info = await client.session.fork({ sessionID: session.id })
      forked = info.id
      data.session.remember(info)
      const linked = await rpc(session).link({ parentID: session.id, sessionID: info.id })
      put(linked)
      archive(session, (linked as State).chats)
      if (question?.trim()) {
        setDrafts(info.id, question.trim())
        autosend.add(info.id)
      } else if (quoted) setDrafts(info.id, `${quoted}\n\n`)
      open(session, info.id)
    } catch (error) {
      if (forked && !find(session.id, forked)) void client.session.remove({ sessionID: forked }).catch(() => undefined)
      fail(error)
    } finally {
      starting.delete(session.key)
      progress.dismiss()
    }
  }

  async function remove(session: SessionRef, sessionID: string) {
    const confirmed = await ctx.dialogs.confirm({
      title: ctx.t("delete.title", { title: title(session.id, sessionID) }),
      description: ctx.t("delete.description"),
      confirm: ctx.t("delete.confirm"),
      danger: true,
    })
    if (!confirmed) return
    ctx.layout.close(key(tabOf(sessionID)), session)
    setDrafts(
      produce((draft) => {
        delete draft[sessionID]
      }),
    )
    await rpc(session).remove({ parentID: session.id, sessionID }).then(put, fail)
  }

  /** Attaches text to the main chat's next prompt as a quote and opens its comment box. */
  function toMain(session: SessionRef, sessionID: string, text: string) {
    const composer = ctx.screen.current()?.composer
    const value = text.trim()
    if (!value) return
    if (!composer?.quotable()) {
      ctx.toast.show({ title: ctx.t("quote.unavailable") })
      return
    }
    const commentID = crypto.randomUUID()
    composer.attach({
      type: "quote",
      commentID,
      text: value,
      source: { label: title(session.id, sessionID), icon: "speech-bubble", subject: "a side chat of this conversation" },
    })
    composer.focus(commentID)
  }

  /** Adds a quote to the end of the side chat's own draft. */
  function quoteHere(sessionID: string, text: string) {
    setDrafts(sessionID, (current = "") => withQuote(current, text))
  }

  function answerToMain(session: SessionRef, transcript: Transcript, sessionID: string) {
    const chat = find(session.id, sessionID)
    if (!chat) return
    const answer = lastAnswer(ownMessages(transcript.messages(), chat.created))
    if (!answer) {
      ctx.toast.show({ title: ctx.t("answer.none") })
      return
    }
    toMain(session, sessionID, answer)
  }

  return {
    load,
    list,
    find,
    title,
    key,
    open,
    showList,
    start,
    send,
    remove,
    toMain,
    quoteHere,
    answerToMain,
    fail,
    /** True once for a side chat started with a question: its view sends the draft on open. */
    takeAutosend: (sessionID: string) => autosend.delete(sessionID),
    draft: (sessionID: string) => drafts[sessionID] ?? "",
    setDraft: (sessionID: string, value: string) => setDrafts(sessionID, value),
    stop(session: SessionRef, sessionID: string) {
      void session.server.client.session.interrupt({ sessionID }).catch(() => undefined)
    },
  }
}

export type Model = ReturnType<typeof createModel>
