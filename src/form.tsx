import type { FormField, FormInfo } from "@opencode/client"
import { usePlugin } from "@opencode/plugin/gui"
import { createSignal, For, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { answerOf, initial, missing, visible, type Answer, type Draft } from "./forms"

/** A form the agent is waiting on, such as a `question` tool call: answer it, or skip it. */
export function FormCard(props: {
  readonly form: FormInfo
  readonly onReply: (answer: Answer) => Promise<unknown>
  readonly onSkip: () => Promise<unknown>
}) {
  const ctx = usePlugin()
  const [draft, setDraft] = createStore<Draft>(initial(props.form.fields))
  const [busy, setBusy] = createSignal(false)
  const fields = () => props.form.fields.filter((field) => visible(field, draft))
  const blocked = () => missing(props.form.fields, draft).length > 0

  const run = (action: () => Promise<unknown>) => {
    setBusy(true)
    void action().finally(() => setBusy(false))
  }

  return (
    <form
      class="sidechat-ask sidechat-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (!blocked() && !busy()) run(() => props.onReply(answerOf(props.form.fields, draft)))
      }}
    >
      <div class="sidechat-ask-title">{props.form.title}</div>
      <For each={fields()}>
        {(field) => <Field field={field} draft={draft} set={(value) => setDraft(field.key, value)} />}
      </For>
      <div class="sidechat-ask-actions">
        <ctx.ui.Button size="small" variant="ghost-muted" disabled={busy()} onClick={() => run(props.onSkip)}>
          {ctx.t("form.skip")}
        </ctx.ui.Button>
        <ctx.ui.Button size="small" variant="contrast" type="submit" disabled={blocked()} busy={busy()}>
          {ctx.t("form.submit")}
        </ctx.ui.Button>
      </div>
    </form>
  )
}

function Field(props: { readonly field: FormField; readonly draft: Draft; readonly set: (value: Draft[string]) => void }) {
  const ctx = usePlugin()
  const value = () => props.draft[props.field.key]
  const text = () => (typeof value() === "string" ? (value() as string) : "")
  const list = () => (Array.isArray(value()) ? (value() as string[]) : [])
  const required = () => "required" in props.field && props.field.required

  return (
    <fieldset class="sidechat-field">
      <Show when={props.field.title}>
        <legend class="sidechat-field-title">
          {props.field.title}
          <Show when={required()}>
            <span aria-hidden="true"> *</span>
          </Show>
        </legend>
      </Show>
      <Show when={props.field.description}>
        <p class="sidechat-field-description">{props.field.description}</p>
      </Show>
      <Switch>
        <Match when={props.field.type === "external" && props.field}>
          {(field) => (
            <a class="sidechat-field-link" href={field().url} target="_blank" rel="noopener noreferrer">
              {ctx.t("form.open")}
            </a>
          )}
        </Match>
        <Match when={props.field.type === "boolean"}>
          <label class="sidechat-option">
            <input type="checkbox" checked={value() === true} onChange={(event) => props.set(event.currentTarget.checked)} />
            <span>{ctx.t("form.yes")}</span>
          </label>
        </Match>
        <Match when={props.field.type === "multiselect" && props.field}>
          {(field) => (
            <Options
              options={field().options}
              chosen={list()}
              multiple
              custom={!!field().custom}
              onChange={(next) => props.set(next)}
            />
          )}
        </Match>
        <Match when={props.field.type === "string" && props.field.options?.length ? props.field : undefined}>
          {(field) => (
            <Options
              options={field().options ?? []}
              chosen={text() ? [text()] : []}
              custom={!!field().custom}
              onChange={(next) => props.set(next[0] ?? "")}
            />
          )}
        </Match>
        <Match when={props.field.type === "number" || props.field.type === "integer"}>
          <input
            class="sidechat-input"
            type="number"
            step={props.field.type === "integer" ? 1 : "any"}
            value={text()}
            onInput={(event) => props.set(event.currentTarget.value)}
          />
        </Match>
        <Match when={props.field.type === "string" && props.field}>
          {(field) => (
            <input
              class="sidechat-input"
              type="text"
              value={text()}
              placeholder={field().placeholder ?? ""}
              onInput={(event) => props.set(event.currentTarget.value)}
            />
          )}
        </Match>
      </Switch>
    </fieldset>
  )
}

/** A list of choices, one or many, with an "Other" answer when the field allows its own. */
function Options(props: {
  readonly options: readonly { value: string; label: string; description?: string }[]
  readonly chosen: readonly string[]
  readonly multiple?: boolean
  readonly custom: boolean
  readonly onChange: (next: string[]) => void
}) {
  const ctx = usePlugin()
  const known = (value: string) => props.options.some((option) => option.value === value)
  const own = () => props.chosen.find((value) => !known(value)) ?? ""

  const toggle = (value: string) => {
    if (!props.multiple) return props.onChange([value])
    props.onChange(props.chosen.includes(value) ? props.chosen.filter((item) => item !== value) : [...props.chosen, value])
  }
  const setOwn = (text: string) => {
    const rest = props.multiple ? props.chosen.filter(known) : []
    props.onChange(text ? [...rest, text] : rest)
  }

  return (
    <div class="sidechat-options">
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            class="sidechat-option"
            aria-pressed={props.chosen.includes(option.value)}
            onClick={() => toggle(option.value)}
          >
            <span class="sidechat-option-label">{option.label}</span>
            <Show when={option.description}>
              <span class="sidechat-option-description">{option.description}</span>
            </Show>
          </button>
        )}
      </For>
      <Show when={props.custom}>
        <input
          class="sidechat-input"
          type="text"
          value={own()}
          placeholder={ctx.t("form.other")}
          onInput={(event) => setOwn(event.currentTarget.value)}
        />
      </Show>
    </div>
  )
}
