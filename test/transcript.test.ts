import { expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client"
import { lastAnswer, ownMessages, PRIMER, quote, titleFrom, toMarkdown, toolSummary, unused, withQuote } from "../src/transcript"

const user = (id: string, created: number, text: string) =>
  ({ id, type: "user", time: { created }, text }) as unknown as SessionMessageInfo

const assistant = (id: string, created: number, content: unknown[], error?: string) =>
  ({
    id,
    type: "assistant",
    time: { created, completed: created + 1 },
    agent: "build",
    model: { id: "m", providerID: "p" },
    content,
    error: error ? { type: "x", message: error } : undefined,
  }) as unknown as SessionMessageInfo

test("ownMessages keeps what came after the fork and hides the primer", () => {
  const primer = { id: "s", type: "synthetic", time: { created: 1000 }, text: "x", metadata: { [PRIMER]: true } }
  const messages = [user("a", 10, "inherited"), primer, user("b", 1000, "first side question"), user("c", 1500, "next")]
  expect(ownMessages(messages as SessionMessageInfo[], 1000).map((message) => message.id)).toEqual(["b", "c"])
})

test("unused flags only old, untitled side chats with no question after the fork", () => {
  const forked = 1_000_000
  const later = forked + 11 * 60_000
  const inherited = [user("a", 10, "inherited question"), assistant("b", 20, [{ type: "text", text: "old answer" }])]
  const asked = [...inherited, user("c", forked + 5, "side question")]
  expect(unused({ title: "", created: forked }, inherited, later)).toBe(true)
  expect(unused({ title: "", created: forked }, asked, later)).toBe(false)
  expect(unused({ title: "Why?", created: forked }, inherited, later)).toBe(false)
  // A fresh fork may be about to send its first question.
  expect(unused({ title: "", created: forked }, inherited, forked + 60_000)).toBe(false)
})

test("titleFrom uses the first real line and cuts long ones", () => {
  expect(titleFrom("\n> quoted bit\n\nWhy?")).toBe("quoted bit")
  expect(titleFrom("  why   does   this   happen  ")).toBe("why does this happen")
  expect(titleFrom("abcdefghij", 6)).toBe("abcde…")
  expect(titleFrom("   \n  ")).toBe("")
})

test("quote marks every line and keeps blank lines inside the quote", () => {
  expect(quote("one\r\n\r\ntwo")).toBe("> one\n>\n> two")
  expect(quote("   ")).toBe("")
})

test("withQuote adds the quote after the draft and leaves room for the question", () => {
  expect(withQuote("", "one\ntwo")).toBe("> one\n> two\n\n")
  expect(withQuote("Why this?\n", "one")).toBe("Why this?\n\n> one\n\n")
  expect(withQuote("Why this?", "  ")).toBe("Why this?")
})

test("toolSummary names what each tool touched", () => {
  expect(toolSummary("read", { path: "/repo/src/index.ts" })).toEqual({ title: "Read", subtitle: "index.ts" })
  expect(toolSummary("shell", { command: "bun   test\n./test" })).toEqual({ title: "Shell", subtitle: "bun test ./test" })
  expect(toolSummary("grep", { pattern: "fork", path: "src" })).toEqual({ title: "Grep", subtitle: "fork" })
  expect(toolSummary("mystery", { first: 1, second: "value" })).toEqual({ title: "mystery", subtitle: "value" })
  expect(toolSummary("webfetch", "{\"url\": \"partial")).toEqual({ title: "Fetch", subtitle: "" })
})

test("lastAnswer returns the newest assistant text", () => {
  const messages = [
    assistant("a", 1, [{ type: "text", text: "old answer" }]),
    user("b", 2, "again?"),
    assistant("c", 3, [
      { type: "reasoning", text: "hmm" },
      { type: "text", text: "new" },
      { type: "text", text: "answer" },
    ]),
    assistant("d", 4, [{ type: "tool", name: "read", state: { status: "running", input: {}, metadata: {} } }]),
  ]
  expect(lastAnswer(messages)).toBe("new\n\nanswer")
  expect(lastAnswer([user("x", 1, "hi")])).toBe("")
})

test("toMarkdown writes questions, answers, tool lines and errors", () => {
  const messages = [
    user("a", 1, "Where is the fork copied?"),
    assistant(
      "b",
      2,
      [
        { type: "tool", name: "read", state: { status: "completed", input: { path: "a/projector.ts" }, content: [] } },
        { type: "text", text: "In projector.ts." },
      ],
      "rate limited",
    ),
  ]
  expect(toMarkdown(messages)).toBe(
    "**User:**\n\nWhere is the fork copied?\n\n**Assistant:**\n\n_Read projector.ts_\n\nIn projector.ts.\n\n_Error: rate limited_",
  )
})
