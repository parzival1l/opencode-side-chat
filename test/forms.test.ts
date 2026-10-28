import { expect, test } from "bun:test"
import type { FormField } from "@opencode/client"
import { answerOf, initial, missing, questionAnswer, questionsOf, visible } from "../src/forms"

const pick: FormField = {
  key: "pick",
  type: "string",
  required: true,
  options: [
    { value: "a", label: "A" },
    { value: "b", label: "B" },
  ],
  custom: true,
}
const why: FormField = { key: "why", type: "string", when: [{ key: "pick", op: "eq", value: "b" }] }
const count: FormField = { key: "count", type: "integer", default: 3 }
const tags: FormField = { key: "tags", type: "multiselect", options: [{ value: "x", label: "X" }], required: true }
const ok: FormField = { key: "ok", type: "boolean" }
const fields = [pick, why, count, tags, ok]

test("initial fills defaults and leaves the rest empty", () => {
  expect(initial(fields)).toEqual({ pick: "", why: "", count: "3", tags: [], ok: false })
})

test("a field with `when` shows only while its condition holds", () => {
  expect(visible(why, { pick: "a" })).toBe(false)
  expect(visible(why, { pick: "b" })).toBe(true)
  expect(visible({ ...why, when: [{ key: "pick", op: "neq", value: "b" }] }, { pick: "b" })).toBe(false)
  expect(visible({ key: "h", type: "string", hidden: true }, {})).toBe(false)
})

test("missing lists required visible fields with no answer", () => {
  expect(missing(fields, { pick: "  ", tags: [] }).map((field) => field.key)).toEqual(["pick", "tags"])
  expect(missing(fields, { pick: "a", tags: ["x"] })).toEqual([])
})

test("answerOf sends visible filled fields, numbers as numbers, and booleans even when false", () => {
  expect(answerOf(fields, { pick: " a ", why: "hidden reason", count: "7.9", tags: ["x"], ok: false })).toEqual({
    pick: "a",
    count: 7,
    tags: ["x"],
    ok: false,
  })
  expect(answerOf(fields, { pick: "b", why: "because", count: "", tags: [], ok: true })).toEqual({
    pick: "b",
    why: "because",
    ok: true,
  })
})

// The fields the server makes for a `question` tool call with two questions: one choice, then many.
const questionForm = {
  metadata: { kind: "question", tool: { messageID: "m1", id: "t1" } },
  fields: [
    {
      key: "q0",
      type: "string",
      title: "Where",
      description: "Where did the form show up?",
      options: [
        { value: "Side chat", label: "Side chat" },
        { value: "Main chat", label: "Main chat" },
      ],
      custom: true,
    },
    { key: "q1", type: "multiselect", title: "Tags", options: [{ value: "x", label: "X" }], custom: true },
  ],
} satisfies Parameters<typeof questionsOf>[0]

test("questionsOf reads a question form and leaves other forms alone", () => {
  expect(questionsOf(questionForm)).toEqual([
    {
      key: "q0",
      header: "Where",
      question: "Where did the form show up?",
      options: [
        { value: "Side chat", label: "Side chat" },
        { value: "Main chat", label: "Main chat" },
      ],
      multiple: false,
    },
    { key: "q1", header: "Tags", question: "Tags", options: [{ value: "x", label: "X" }], multiple: true },
  ])
  expect(questionsOf({ ...questionForm, metadata: { kind: "mcp-elicitation" } })).toBeUndefined()
  expect(questionsOf({ ...questionForm, metadata: undefined })).toBeUndefined()
})

test("questionAnswer sends one answer as a string, many as a list, and skips unanswered questions", () => {
  const questions = questionsOf(questionForm)!
  expect(
    questionAnswer(questions, [
      { chosen: ["Main chat"], own: "ignored while off", ownOn: false },
      { chosen: ["x"], own: "  mine  ", ownOn: true },
    ]),
  ).toEqual({ q0: "Main chat", q1: ["x", "mine"] })
  expect(questionAnswer(questions, [{ chosen: [], own: " typed ", ownOn: true }])).toEqual({ q0: "typed" })
  expect(questionAnswer(questions, [{ chosen: [], own: "   ", ownOn: true }, undefined])).toEqual({})
})
