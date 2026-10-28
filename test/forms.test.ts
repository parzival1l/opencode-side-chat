import { expect, test } from "bun:test"
import type { FormField } from "@opencode/client"
import { answerOf, initial, missing, visible } from "../src/forms"

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
