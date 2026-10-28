import type { FormInfo } from "@opencode/client"
import { usePlugin } from "@opencode/plugin/gui"
import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { answersOf, nothingPicked, questionAnswer, type Answer, type Picked, type Question } from "./forms"

const IS_MAC = /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)

interface State {
  tab: number
  picked: Picked[]
  minimized: boolean
  editing: boolean
}

// Answers in progress outlive the dock, so switching tabs and coming back keeps them, as the main chat does.
const saved = new Map<string, Pick<State, "tab" | "picked">>()

/**
 * A `question` tool form, drawn with the main chat's question dock markup so the app's styles apply: numbered answers,
 * an answer of your own, a minimize chevron, and Dismiss, Back, Next and Submit.
 */
export function QuestionDock(props: {
  readonly form: FormInfo
  readonly questions: readonly Question[]
  readonly onReply: (answer: Answer) => Promise<unknown>
  readonly onDismiss: () => Promise<unknown>
}) {
  const ctx = usePlugin()
  const restored = saved.get(props.form.id)
  const [state, setState] = createStore<State>({
    tab: restored?.tab ?? 0,
    picked: restored?.picked ?? [],
    minimized: false,
    editing: false,
  })
  const [busy, setBusy] = createSignal(false)
  let replied = false
  let root: HTMLDivElement | undefined
  let customRow: HTMLDivElement | undefined
  const optionRefs: HTMLButtonElement[] = []
  let customToggle: HTMLButtonElement | undefined

  const total = () => props.questions.length
  const question = () => props.questions[state.tab]
  const options = () => question()?.options ?? []
  const multi = () => question()?.multiple === true
  const picked = () => state.picked[state.tab] ?? nothingPicked
  const last = () => state.tab >= total() - 1
  const shortcut = () => (IS_MAC ? "⌘⏎" : "Ctrl+⏎")
  const ownLabel = () => ctx.t("question.own")

  onCleanup(() => {
    if (!replied) saved.set(props.form.id, { tab: state.tab, picked: state.picked.map((item) => ({ ...item })) })
  })

  const update = (change: (current: Picked) => Picked) =>
    setState("picked", produce((list) => void (list[state.tab] = change(list[state.tab] ?? nothingPicked))))

  const choose = (value: string) =>
    update((current) => {
      if (!multi()) return { ...current, chosen: [value], ownOn: false }
      const chosen = current.chosen.includes(value)
        ? current.chosen.filter((item) => item !== value)
        : [...current.chosen, value]
      return { ...current, chosen }
    })

  const ownInput = () => customRow?.querySelector("input") ?? undefined

  const startOwn = () => {
    update((current) => ({ ...current, ownOn: true, chosen: multi() ? current.chosen : [] }))
    const input = ownInput()
    input?.focus()
    input?.setSelectionRange(input.value.length, input.value.length)
  }

  const toggleOwn = () => {
    if (busy()) return
    if (!multi() || !picked().ownOn) return startOwn()
    update((current) => ({ ...current, ownOn: false }))
  }

  const typeOwn = (text: string) =>
    update((current) => ({ own: text, ownOn: true, chosen: multi() ? current.chosen : [] }))

  const focusAt = (index: number) => {
    const count = options().length + 1
    const next = Math.max(0, Math.min(count - 1, index))
    ;(next === options().length ? customToggle : optionRefs[next])?.focus()
  }

  const focusPicked = () => {
    const index = picked().ownOn ? options().length : options().findIndex((item) => picked().chosen.includes(item.value))
    focusAt(Math.max(0, index))
  }

  const go = (tab: number) => {
    if (busy() || tab < 0 || tab >= total() || tab === state.tab) return
    setState({ tab, editing: false })
    if (!state.minimized) queueMicrotask(focusPicked)
  }

  const run = (action: () => Promise<unknown>) => {
    if (busy()) return
    setBusy(true)
    void action()
      .then(() => {
        replied = true
        saved.delete(props.form.id)
      })
      .finally(() => setBusy(false))
  }

  const submit = () => run(() => props.onReply(questionAnswer(props.questions, state.picked)))
  const dismiss = () => run(props.onDismiss)
  const next = () => (last() ? submit() : go(state.tab + 1))

  const toggleMinimized = () => {
    if (busy()) return
    setState({ minimized: !state.minimized, editing: false })
    if (!state.minimized) queueMicrotask(focusPicked)
  }

  onMount(focusPicked)

  const focusedIndex = (target: EventTarget | null) => {
    if (target === customToggle) return options().length
    return optionRefs.indexOf(target as HTMLButtonElement)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return
    const typing = state.editing
    if (event.key === "Escape") {
      event.preventDefault()
      if (typing) return customToggle?.focus()
      return dismiss()
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key === "Enter") {
      event.preventDefault()
      if (!event.repeat) next()
      return
    }
    if (typing || event.metaKey || event.ctrlKey || event.altKey || busy()) return

    if (/^[1-9]$/.test(event.key) && !state.minimized) {
      const index = Number(event.key) - 1
      if (index > options().length || event.repeat) return
      event.preventDefault()
      if (index === options().length) return toggleOwn()
      choose(options()[index]!.value)
      return focusAt(index)
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault()
      const step = (event.key === "ArrowRight") !== !!root?.matches(":dir(rtl)") ? 1 : -1
      return go(state.tab + step)
    }
    const index = focusedIndex(event.target)
    if (index < 0) return
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      return focusAt(index + (event.key === "ArrowDown" ? 1 : -1))
    }
    // Enter takes the highlighted answer of a single choice and moves on; an empty own answer opens its field instead.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      if (multi()) return next()
      if (index < options().length) {
        choose(options()[index]!.value)
        return next()
      }
      if (!picked().own.trim()) return startOwn()
      update((current) => ({ ...current, ownOn: true, chosen: [] }))
      return next()
    }
  }

  return (
    <div class="sidechat-question" data-component="session-question-dock" data-animated="false">
      <div
        data-component="dock-prompt"
        data-kind="question"
        data-minimized={state.minimized ? "" : undefined}
        ref={root}
        onKeyDown={onKeyDown}
      >
        <div data-slot="question-body">
          <div data-slot="question-header">
            <div data-slot="question-header-top">
              <div data-slot="question-header-title">
                <bdi>
                  {total() > 1
                    ? ctx.t("question.progress", { current: state.tab + 1, total: total() })
                    : ctx.t("question.title")}
                </bdi>
              </div>
              <div data-slot="question-header-actions">
                <Show when={total() > 1}>
                  <div data-slot="question-progress">
                    <For each={props.questions}>
                      {(_, i) => (
                        <button
                          type="button"
                          data-slot="question-progress-segment"
                          data-active={i() === state.tab}
                          data-answered={answersOf(state.picked[i()]).length > 0}
                          disabled={busy()}
                          aria-label={ctx.t("question.numbered", { number: i() + 1 })}
                          aria-current={i() === state.tab ? "step" : undefined}
                          onClick={() => go(i())}
                        >
                          <span data-slot="question-progress-bar" aria-hidden="true" />
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
                <ctx.ui.IconButton
                  icon="outline-chevron-down"
                  class="sidechat-question-chevron"
                  variant="ghost"
                  size="large"
                  disabled={busy()}
                  label={state.minimized ? ctx.t("question.restore") : ctx.t("question.minimize")}
                  onClick={toggleMinimized}
                />
              </div>
            </div>
            <div data-slot="question-details-frame">
              <div data-slot="question-details">
                <div data-slot="question-text">
                  <bdi>{question()?.question}</bdi>
                </div>
                <Show when={!state.minimized && multi()}>
                  <div data-slot="question-hint">{ctx.t("question.multi")}</div>
                </Show>
              </div>
            </div>
          </div>
          <div data-slot="question-content">
            <Show when={!state.minimized}>
              <div
                data-slot="question-options"
                role={multi() ? "group" : "radiogroup"}
                aria-label={question()?.question}
                // Space already acted on key down; its release must not click the button again.
                onKeyUp={(event) => {
                  if (event.key === " " && focusedIndex(event.target) >= 0) event.preventDefault()
                }}
              >
                <div data-slot="question-options-track">
                  <div data-slot="question-options-list">
                    <For each={options()}>
                      {(option, i) => (
                        <button
                          type="button"
                          ref={(el) => (optionRefs[i()] = el)}
                          data-slot="question-option"
                          data-picked={picked().chosen.includes(option.value)}
                          role={multi() ? "checkbox" : "radio"}
                          aria-checked={picked().chosen.includes(option.value)}
                          aria-keyshortcuts={i() < 9 ? String(i() + 1) : undefined}
                          disabled={busy()}
                          onClick={() => choose(option.value)}
                        >
                          <Mark
                            multi={multi()}
                            picked={picked().chosen.includes(option.value)}
                            shortcut={i() < 9 ? String(i() + 1) : undefined}
                          />
                          <span data-slot="question-option-main">
                            <span data-slot="option-label">
                              <bdi>{option.label}</bdi>
                            </span>
                            <Show when={option.description}>
                              <span data-slot="option-description">
                                <bdi>{option.description}</bdi>
                              </span>
                            </Show>
                          </span>
                        </button>
                      )}
                    </For>
                    <div
                      ref={customRow}
                      data-slot="question-option"
                      data-custom="true"
                      data-picked={picked().ownOn}
                      data-editing={state.editing}
                      data-disabled={busy()}
                      onClick={(event) => {
                        if (event.target === event.currentTarget && !busy()) startOwn()
                      }}
                      onFocusIn={(event) => {
                        if (event.target instanceof HTMLInputElement) setState("editing", true)
                      }}
                      onFocusOut={(event) => {
                        if (event.target instanceof HTMLInputElement) setState("editing", false)
                      }}
                    >
                      <button
                        type="button"
                        ref={customToggle}
                        data-slot="question-custom-toggle"
                        role={multi() ? "checkbox" : "radio"}
                        aria-checked={picked().ownOn}
                        aria-label={ownLabel()}
                        disabled={busy()}
                        onClick={toggleOwn}
                      >
                        <Mark
                          multi={multi()}
                          picked={picked().ownOn}
                          shortcut={options().length < 9 ? String(options().length + 1) : undefined}
                        />
                      </button>
                      <ctx.ui.TextInput
                        class="question-custom-field"
                        label={ownLabel()}
                        placeholder={ownLabel()}
                        value={picked().own}
                        disabled={busy()}
                        onInput={typeOwn}
                        onSubmit={next}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </Show>
          </div>
        </div>
        <div data-slot="question-footer">
          <ctx.ui.Button variant="ghost" size="large" disabled={busy()} onClick={dismiss}>
            {ctx.t("question.dismiss")}
          </ctx.ui.Button>
          <div data-slot="question-footer-actions">
            <Show when={state.tab > 0}>
              <ctx.ui.Button variant="neutral" size="large" disabled={busy()} onClick={() => go(state.tab - 1)}>
                {ctx.t("question.back")}
              </ctx.ui.Button>
            </Show>
            <ctx.ui.Button variant={last() ? "contrast" : "neutral"} size="large" busy={busy()} onClick={next}>
              <span data-slot="question-advance-label">
                {last() ? ctx.t("question.submit") : ctx.t("question.next")}
                <span data-slot="question-submit-shortcut" aria-hidden="true">
                  {shortcut()}
                </span>
              </span>
            </ctx.ui.Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// The key that picks an answer is also its mark: round like a radio for one answer, a square like a checkbox for many.
function Mark(props: { readonly multi: boolean; readonly picked: boolean; readonly shortcut?: string }) {
  return (
    <span data-slot="question-option-check" aria-hidden="true">
      <span data-slot="question-option-key" data-type={props.multi ? "checkbox" : "radio"} data-picked={props.picked}>
        {props.shortcut}
      </span>
    </span>
  )
}
