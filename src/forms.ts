import type { FormField, FormInfo } from "@opencode/client"

/** Answers being filled in, by field key. Text fields hold strings, so an emptied number field stays empty. */
export type Draft = Record<string, string | boolean | string[]>

/** The answer the server takes: `SessionFormReplyInput["answer"]`. */
export type Answer = Record<string, string | number | boolean | string[]>

function matches(value: Draft[string] | undefined, expected: unknown) {
  if (Array.isArray(value)) return value.includes(String(expected))
  if (typeof expected === "number") return value !== undefined && value !== "" && Number(value) === expected
  return value === expected
}

/** A field shows unless it is hidden or one of its `when` conditions fails on the answers so far. */
export function visible(field: FormField, draft: Draft): boolean {
  if ("hidden" in field && field.hidden) return false
  const when = "when" in field ? field.when : undefined
  return (when ?? []).every((rule) => matches(draft[rule.key], rule.value) === (rule.op === "eq"))
}

/** Each field's default, as the form opens. */
export function initial(fields: readonly FormField[]): Draft {
  const draft: Draft = {}
  for (const field of fields) {
    if (field.type === "external") continue
    if (field.type === "multiselect") draft[field.key] = [...(field.default ?? [])]
    else if (field.type === "boolean") draft[field.key] = field.default ?? false
    else if (field.type === "string") draft[field.key] = field.default ?? ""
    else draft[field.key] = typeof field.default === "number" ? String(field.default) : ""
  }
  return draft
}

const empty = (value: Draft[string] | undefined) =>
  value === undefined || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && value.length === 0)

/** The visible required fields that still have no answer. */
export function missing(fields: readonly FormField[], draft: Draft): FormField[] {
  return fields.filter(
    (field) => field.type !== "external" && "required" in field && field.required && visible(field, draft) && empty(draft[field.key]),
  )
}

/** The answer to send: visible, filled fields only, with numbers as numbers. */
export function answerOf(fields: readonly FormField[], draft: Draft): Answer {
  const answer: Answer = {}
  for (const field of fields) {
    if (field.type === "external" || !visible(field, draft)) continue
    const value = draft[field.key]
    if (empty(value) && field.type !== "boolean") continue
    if (field.type === "number" || field.type === "integer") {
      const number = Number(value)
      if (Number.isFinite(number)) answer[field.key] = field.type === "integer" ? Math.trunc(number) : number
      continue
    }
    if (field.type === "string" && typeof value === "string") answer[field.key] = value.trim()
    else if (value !== undefined) answer[field.key] = value
  }
  return answer
}

/** One question of a `question` tool form: a choice, of one answer or many, with an answer of the user's own. */
export interface Question {
  readonly key: string
  readonly header: string
  readonly question: string
  readonly options: readonly { value: string; label: string; description?: string }[]
  readonly multiple: boolean
}

/**
 * The questions of a form the `question` tool opened, or undefined for any other form. The server makes one field per
 * question: its header as the title and the question as the description.
 */
export function questionsOf(form: Pick<FormInfo, "metadata" | "fields">): Question[] | undefined {
  if (form.metadata?.kind !== "question") return undefined
  const questions = form.fields.flatMap((field): Question[] => {
    if (field.type !== "string" && field.type !== "multiselect") return []
    return [
      {
        key: field.key,
        header: field.title ?? "",
        question: field.description ?? field.title ?? "",
        options: field.options ?? [],
        multiple: field.type === "multiselect",
      },
    ]
  })
  return questions.length ? questions : undefined
}

/** What the user has picked for one question: options by value, and an answer of their own while `ownOn`. */
export interface Picked {
  readonly chosen: readonly string[]
  readonly own: string
  readonly ownOn: boolean
}

export const nothingPicked: Picked = { chosen: [], own: "", ownOn: false }

/** The answers a question has: its chosen options, then the user's own answer when it is on and not blank. */
export function answersOf(picked: Picked | undefined): string[] {
  if (!picked) return []
  const own = picked.own.trim()
  return [...picked.chosen, ...(picked.ownOn && own ? [own] : [])]
}

/** The reply to a question form: each answered question by key, one answer as a string and many as a list. */
export function questionAnswer(questions: readonly Question[], picked: readonly (Picked | undefined)[]): Answer {
  const answer: Answer = {}
  questions.forEach((question, i) => {
    const answers = answersOf(picked[i])
    if (answers.length === 0) return
    answer[question.key] = question.multiple ? answers : answers[0]!
  })
  return answer
}
