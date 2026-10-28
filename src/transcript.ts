import type { SessionMessageInfo } from "@opencode/client"

/** Marks the synthetic message that tells the model it is in a side chat, so the panel can leave it out. */
export const PRIMER = "sidechat.primer"

export const primer = [
  "You are now in a side chat. The user opened it from the conversation above to ask follow-up questions about it.",
  "Answer here. Nothing said in this side chat reaches the main conversation, and the main conversation keeps going",
  "without waiting for it. Keep answers focused on the question. Take actions only when the user asks for them.",
].join(" ")

type Info = Pick<SessionMessageInfo, "type" | "time" | "metadata">

/**
 * The messages a side chat shows: the ones made after its fork. A fork copies the parent's history with the original
 * creation times, so anything older than the fork itself is inherited. The primer stays hidden too.
 */
export function ownMessages<T extends Info>(messages: readonly T[], forked: number): T[] {
  return messages.filter((message) => message.time.created >= forked && message.metadata?.[PRIMER] !== true)
}

/** A side chat's title from its first question: the first line, cut to `max` characters. */
export function titleFrom(text: string, max = 60): string {
  const line = text
    .split("\n")
    .map((part) => part.replace(/^>\s?/, "").trim())
    .find((part) => part.length > 0)
  if (!line) return ""
  const flat = line.replace(/\s+/g, " ")
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}

/** How long a new side chat has to ask its first question before it counts as unused. */
export const UNUSED_AFTER = 10 * 60_000

/**
 * A side chat nobody asked anything in: no title, no question after the fork, and older than `UNUSED_AFTER`.
 * Before forks waited for the first message, opening a side chat and leaving it made one of these.
 */
export function unused(chat: { title: string; created: number }, messages: readonly Info[], now: number): boolean {
  if (chat.title || now - chat.created < UNUSED_AFTER) return false
  return !ownMessages(messages, chat.created).some((message) => message.type === "user")
}

/** Where a quote came from, as the app's composer names it. */
export interface QuoteSource {
  readonly label: string
  readonly icon: string
  readonly subject: string
}

/** Quoted text with an optional comment: the shape the app keeps in a user message's `metadata.comments`. */
export interface Quote {
  readonly type: "quote"
  readonly text: string
  readonly comment?: string
  readonly source?: QuoteSource
}

/** A quote as the model reads it, word for word what the main chat's composer sends. */
export function formatQuote(input: Quote): string {
  const quoted = `The user quoted the following from ${input.source?.subject ?? "earlier in the conversation"}:\n${input.text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}`
  return input.comment ? `${quoted}\n\nThe user made the following comment regarding this quote: ${input.comment}` : quoted
}

/**
 * A prompt from typed text and quotes. The model reads the text and every quote; the timeline shows the typed text
 * and draws each quote as a card, as the main chat does.
 */
export function promptOf(text: string, quotes: readonly Quote[]) {
  const typed = text.trim()
  const comments = quotes.map((item) => {
    const comment = item.comment?.trim()
    return { type: "quote" as const, text: item.text, ...(comment ? { comment } : {}), ...(item.source ? { source: item.source } : {}) }
  })
  return {
    text: [...(typed ? [typed] : []), ...comments.map(formatQuote)].join("\n"),
    metadata: comments.length ? { displayText: typed, comments } : undefined,
  }
}

/** What a user message shows: its typed text and its quotes. Messages from elsewhere show their plain text. */
export function shownOf(message: { text: string; metadata?: Record<string, unknown> }): { text: string; quotes: Quote[] } {
  const meta = message.metadata
  const comments = Array.isArray(meta?.comments) ? meta.comments : []
  const quotes = comments.flatMap((item): Quote[] =>
    item && typeof item === "object" && item.type === "quote" && typeof item.text === "string" ? [item as Quote] : [],
  )
  return { text: typeof meta?.displayText === "string" ? meta.displayText : message.text, quotes }
}

const TITLES: Record<string, string> = {
  read: "Read",
  edit: "Edit",
  write: "Write",
  patch: "Patch",
  shell: "Shell",
  glob: "Glob",
  grep: "Grep",
  list: "List",
  webfetch: "Fetch",
  websearch: "Search",
  skill: "Skill",
  question: "Question",
  subagent: "Agent",
  todowrite: "Todos",
  execute: "Code",
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

/** How a tool call reads in one row: a title and the one input that says what it touched. */
export function toolSummary(name: string, input: unknown): { title: string; subtitle: string } {
  const title = TITLES[name] ?? name
  const args = input && typeof input === "object" ? (input as Record<string, unknown>) : {}
  const text = (key: string) => (typeof args[key] === "string" ? (args[key] as string) : "")
  const subtitle = (() => {
    if (name === "shell") return text("command")
    if (name === "read" || name === "edit" || name === "write") return basename(text("path") || text("filePath"))
    if (name === "glob" || name === "grep") return text("pattern") || text("path")
    if (name === "list") return text("path")
    if (name === "webfetch") return text("url")
    if (name === "websearch") return text("query")
    if (name === "subagent") return text("description")
    const first = Object.values(args).find((value) => typeof value === "string")
    return typeof first === "string" ? first : ""
  })()
  return { title, subtitle: subtitle.replace(/\s+/g, " ").trim() }
}

/** The text of the latest assistant answer, or "" when there is none yet. */
export function lastAnswer(messages: readonly SessionMessageInfo[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!
    if (message.type !== "assistant") continue
    const text = message.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n\n")
      .trim()
    if (text) return text
  }
  return ""
}

/** A side chat as Markdown: the questions, the answers, and one line per tool call. */
export function toMarkdown(messages: readonly SessionMessageInfo[]): string {
  const blocks: string[] = []
  for (const message of messages) {
    if (message.type === "user") {
      blocks.push(`**User:**\n\n${message.text.trim()}`)
      continue
    }
    if (message.type !== "assistant") continue
    const lines: string[] = []
    for (const part of message.content) {
      if (part.type === "text" && part.text.trim()) lines.push(part.text.trim())
      if (part.type === "tool") {
        const summary = toolSummary(part.name, part.state.input)
        lines.push(`_${[summary.title, summary.subtitle].filter(Boolean).join(" ")}_`)
      }
    }
    if (message.error) lines.push(`_Error: ${message.error.message}_`)
    if (lines.length) blocks.push(`**Assistant:**\n\n${lines.join("\n\n")}`)
  }
  return blocks.join("\n\n")
}
