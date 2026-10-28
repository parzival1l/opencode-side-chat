import { createKeyed, usePlugin, type MountedSession } from "@opencode/plugin/gui"
import type {
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantTool,
  SessionMessageInfo,
} from "@opencode/client"
import { createEffect, createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { FormCard } from "./form"
import { createTranscript } from "./live"
import { chatOf, draftOf, QUOTE_EVENT, selectedText, type Model } from "./model"
import { ownMessages, shownOf, toolSummary, type Quote } from "./transcript"

const OUTPUT_LIMIT = 6000
// Scrolling within this many pixels of the top loads older messages.
const OLDER_AT = 400

function clip(text: string) {
  return text.length > OUTPUT_LIMIT ? `${text.slice(0, OUTPUT_LIMIT)}\n…` : text
}

const QUOTE_PREVIEW = 200

/** A quote as the main chat draws one: the app's `attachment-card` markup, so its styles apply. */
function QuoteCard(props: {
  readonly quote: Quote
  readonly active?: boolean
  readonly wide?: boolean
  readonly onClick?: () => void
}) {
  const ctx = usePlugin()
  const text = () => props.quote.text.slice(0, QUOTE_PREVIEW)
  return (
    <div
      data-component="attachment-card"
      data-surface="base"
      data-active={props.active ? "true" : undefined}
      data-clickable={props.onClick ? "true" : undefined}
      data-wide={props.wide ? "true" : undefined}
      title={props.quote.comment ? `${props.quote.comment}\n\n${text()}` : text()}
      onClick={() => props.onClick?.()}
    >
      <span data-slot="attachment-card-title">{props.quote.comment || text()}</span>
      <span data-slot="attachment-card-subtitle">
        <span data-slot="comment-card-quote">
          <span data-slot="attachment-card-icon">
            <ctx.ui.Icon name={(props.quote.source?.icon ?? "outline-quote") as "outline-quote"} size="small" />
          </span>
          <span data-slot="attachment-card-label" dir="auto">
            {props.quote.comment ? text() : (props.quote.source?.label ?? ctx.t("quote.label"))}
          </span>
        </span>
        <Show when={props.onClick}>
          <span data-slot="comment-card-action" data-commented={props.quote.comment ? "" : undefined}>
            <span data-slot="attachment-card-icon">
              <ctx.ui.Icon name="comment" size="small" />
            </span>
            <span data-slot="attachment-card-label">
              {props.quote.comment ? ctx.t("quote.editComment") : ctx.t("quote.addComment")}
            </span>
          </span>
        </Show>
      </span>
    </div>
  )
}

const GAP = 8
const EDITOR_WIDTH = 380

/**
 * The comment box of a composer quote, as the main chat draws it: the app's `line-comment-v2` editor, floating
 * above the card in a portal. A click outside closes it while the comment is unchanged.
 */
function QuoteEditor(props: {
  readonly anchor: HTMLElement
  readonly quote: Quote
  readonly onSubmit: (comment: string) => void
  readonly onClose: () => void
}) {
  const ctx = usePlugin()
  const [draft, setDraft] = createSignal(props.quote.comment ?? "")
  const [rect, setRect] = createSignal(props.anchor.getBoundingClientRect())
  const [viewport, setViewport] = createSignal(window.innerWidth)
  const [height, setHeight] = createSignal(0)
  let element: HTMLDivElement | undefined
  let field: HTMLTextAreaElement | undefined

  const measure = () => {
    setRect(props.anchor.getBoundingClientRect())
    setViewport(window.innerWidth)
  }
  const outside = (event: PointerEvent) => {
    const target = event.target
    if (target instanceof Node && (element?.contains(target) || props.anchor.contains(target))) return
    if (draft().trim() === (props.quote.comment ?? "").trim()) props.onClose()
  }

  onMount(() => {
    window.addEventListener("resize", measure)
    document.addEventListener("scroll", measure, { capture: true, passive: true })
    document.addEventListener("pointerdown", outside)
    const observer = new ResizeObserver(() => {
      if (element) setHeight(element.offsetHeight)
      measure()
    })
    if (element) observer.observe(element)
    observer.observe(props.anchor)
    requestAnimationFrame(() => field?.focus())
    onCleanup(() => {
      window.removeEventListener("resize", measure)
      document.removeEventListener("scroll", measure, { capture: true })
      document.removeEventListener("pointerdown", outside)
      observer.disconnect()
    })
  })

  const width = () => Math.min(EDITOR_WIDTH, viewport() - GAP * 2)
  const left = () => Math.min(Math.max(rect().left, GAP), viewport() - width() - GAP)
  const top = () => {
    const above = rect().top - height() - GAP
    return above >= GAP ? above : rect().bottom + GAP
  }
  const submit = () => props.onSubmit(draft().trim())

  return (
    <Portal>
      <div
        ref={element}
        class="sidechat-quote-editor"
        data-prevent-autofocus
        style={{
          top: `${top()}px`,
          left: `${left()}px`,
          width: `${width()}px`,
          // Transparent rather than hidden while unmeasured, so the comment field can take focus as it mounts.
          opacity: height() === 0 ? 0 : undefined,
        }}
      >
        <div data-component="line-comment-v2" data-variant="editor">
          <div data-slot="line-comment-v2-shell">
            <div data-slot="line-comment-v2-field">
              <textarea
                ref={field}
                data-slot="line-comment-v2-textarea"
                aria-label={ctx.t("quote.comment")}
                dir="auto"
                rows={4}
                placeholder={ctx.t("quote.commentPlaceholder")}
                value={draft()}
                onInput={(event) => setDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.isComposing || event.keyCode === 229) return
                  if (event.key === "Escape") {
                    event.preventDefault()
                    event.currentTarget.blur()
                    props.onClose()
                    return
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    submit()
                  }
                }}
              />
            </div>
            <div data-slot="line-comment-v2-footer">
              <div data-slot="line-comment-v2-footer-meta">
                <span class="sidechat-quote-editor-source" dir="auto">
                  <ctx.ui.Icon name={(props.quote.source?.icon ?? "outline-quote") as "outline-quote"} size="small" />
                  <span>{props.quote.text.slice(0, QUOTE_PREVIEW)}</span>
                </span>
              </div>
              <div data-slot="line-comment-v2-footer-actions">
                <ctx.ui.Button size="small" variant="ghost" onClick={() => props.onClose()}>
                  {ctx.t("quote.cancel")}
                </ctx.ui.Button>
                <ctx.ui.Button size="small" variant="contrast" onClick={submit}>
                  {ctx.t("quote.comment")}
                </ctx.ui.Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  )
}

/** A composer's quote cards. Click one to comment on it; the × removes it. */
function QuoteCards(props: { readonly model: Model; readonly composer: string; readonly onDone?: () => void }) {
  const ctx = usePlugin()
  // A quote added with its editor open renders its card in the same update, so the anchors are reactive.
  const [anchors, setAnchors] = createStore<Record<string, HTMLElement | undefined>>({})
  const editing = () => props.model.quotes(props.composer).find((item) => item.key === props.model.editing(props.composer))
  const close = () => {
    props.model.editQuote(props.composer)
    props.onDone?.()
  }

  return (
    <Show when={props.model.quotes(props.composer).length > 0}>
      <div class="sidechat-quotes">
        <For each={props.model.quotes(props.composer)}>
          {(item) => (
            <div
              class="sidechat-quote"
              ref={(element) => {
                setAnchors(item.key, element)
                onCleanup(() => setAnchors(item.key, undefined))
              }}
            >
              <QuoteCard
                quote={item}
                active={props.model.editing(props.composer) === item.key}
                onClick={() =>
                  props.model.editQuote(
                    props.composer,
                    props.model.editing(props.composer) === item.key ? undefined : item.key,
                  )
                }
              />
              <button
                type="button"
                class="sidechat-quote-remove"
                aria-label={ctx.t("quote.remove")}
                onClick={() => props.model.removeQuote(props.composer, item.key)}
              >
                <ctx.ui.Icon name="outline-xmark" size="small" />
              </button>
            </div>
          )}
        </For>
      </div>
      <Show when={editing()} keyed>
        {(current) => (
          <Show when={anchors[current.key]}>
            {(anchor) => (
              <QuoteEditor
                anchor={anchor()}
                quote={current}
                onSubmit={(comment) => {
                  props.model.commentQuote(props.composer, current.key, comment)
                  close()
                }}
                onClose={close}
              />
            )}
          </Show>
        )}
      </Show>
    </Show>
  )
}

// The app styles these data attributes in every theme, so a bubble here looks like one in the main chat.
function UserBubble(props: { readonly message: { text: string; metadata?: Record<string, unknown> }; readonly pending?: boolean }) {
  const shown = () => shownOf(props.message)
  return (
    <div class="sidechat-user" data-component="user-message" data-pending={props.pending ? "" : undefined}>
      <Show
        when={shown().text.trim()}
        fallback={
          <div data-slot="user-message-comments">
            <For each={shown().quotes}>{(item) => <QuoteCard quote={item} wide />}</For>
          </div>
        }
      >
        <div data-slot="user-message-body">
          <div data-slot="user-message-text" dir="auto" data-comments={shown().quotes.length ? "true" : undefined}>
            {shown().text}
            <Show when={shown().quotes.length > 0}>
              <div data-slot="user-message-comments" data-bounded="true">
                <For each={shown().quotes}>{(item) => <QuoteCard quote={item} wide />}</For>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}

function Row(props: {
  readonly icon: "mcp" | "code" | "warning"
  readonly title: string
  readonly subtitle?: string
  readonly running?: boolean
  readonly failed?: boolean
  readonly detail?: () => string
  readonly markdown?: boolean
}) {
  const ctx = usePlugin()
  const [open, setOpen] = createSignal(false)
  const body = () => props.detail?.().trim() ?? ""
  return (
    <div class="sidechat-row" data-failed={props.failed ? "" : undefined}>
      <button
        type="button"
        data-component="tool-trigger"
        data-clickable={body() ? "true" : "false"}
        aria-expanded={open()}
        disabled={!body()}
        onClick={() => setOpen(!open())}
      >
        <div data-slot="basic-tool-tool-trigger-content">
          <span data-slot="basic-tool-tool-indicator">
            <Show when={props.running} fallback={<ctx.ui.Icon name={props.icon} size="small" />}>
              <ctx.ui.Loader size="small" />
            </Show>
          </span>
          <div data-slot="basic-tool-tool-info">
            <div data-slot="basic-tool-tool-info-structured">
              <div data-slot="basic-tool-tool-info-main">
                <span data-slot="basic-tool-tool-title">{props.title}</span>
                <Show when={props.subtitle}>
                  <span data-slot="basic-tool-tool-subtitle">{props.subtitle}</span>
                </Show>
              </div>
            </div>
          </div>
        </div>
      </button>
      <Show when={open() && body()}>
        <Show when={props.markdown} fallback={<pre class="sidechat-output">{clip(body())}</pre>}>
          <div class="sidechat-reasoning">
            <ctx.ui.Markdown text={body()} />
          </div>
        </Show>
      </Show>
    </div>
  )
}

function Tool(props: { readonly part: SessionMessageAssistantTool }) {
  const summary = () => toolSummary(props.part.name, props.part.state.input)
  const detail = () => {
    const state = props.part.state
    if (state.status === "error") return state.error.message
    if (state.status !== "completed") return typeof state.input === "string" ? state.input : JSON.stringify(state.input, null, 2)
    return state.content.map((item) => (item.type === "text" ? item.text : `[${item.name ?? item.mime}]`)).join("\n")
  }
  return (
    <Row
      icon="code"
      title={summary().title}
      subtitle={summary().subtitle}
      running={props.part.state.status === "running" || props.part.state.status === "streaming"}
      failed={props.part.state.status === "error"}
      detail={detail}
    />
  )
}

function Reasoning(props: { readonly part: SessionMessageAssistantReasoning; readonly streaming: boolean }) {
  const ctx = usePlugin()
  return (
    <Row
      icon="mcp"
      title={props.streaming ? ctx.t("thinking") : ctx.t("thought")}
      running={props.streaming}
      detail={() => props.part.text}
      markdown
    />
  )
}

function Assistant(props: { readonly message: SessionMessageAssistant }) {
  const ctx = usePlugin()
  const streaming = () => props.message.time.completed === undefined
  return (
    <div class="sidechat-assistant">
      <For each={props.message.content}>
        {(part, i) => (
          <Switch>
            <Match when={part.type === "text" && part.text.trim() ? part : undefined}>
              {(text) => (
                <div data-component="text-part">
                  <div data-slot="text-part-body">
                    <ctx.ui.Markdown text={text().text} />
                  </div>
                </div>
              )}
            </Match>
            <Match when={part.type === "reasoning" && part.text.trim() ? part : undefined}>
              {(reasoning) => (
                <Reasoning
                  part={reasoning()}
                  streaming={streaming() && i() === props.message.content.length - 1}
                />
              )}
            </Match>
            <Match when={part.type === "tool" && part}>{(tool) => <Tool part={tool()} />}</Match>
          </Switch>
        )}
      </For>
      <Show when={props.message.error}>
        {(error) => <div class="sidechat-error">{error().message}</div>}
      </Show>
    </div>
  )
}

function Message(props: { readonly message: SessionMessageInfo; readonly pending: boolean }) {
  const ctx = usePlugin()
  return (
    <Switch>
      <Match when={props.message.type === "user" && props.message}>
        {(user) => <UserBubble message={user()} pending={props.pending} />}
      </Match>
      <Match when={props.message.type === "assistant" && props.message}>
        {(assistant) => <Assistant message={assistant()} />}
      </Match>
      <Match when={props.message.type === "shell" && props.message}>
        {(shell) => (
          <Row
            icon="code"
            title={ctx.t("shell")}
            subtitle={shell().command}
            running={shell().status === "running"}
            detail={() => shell().output?.output ?? ""}
          />
        )}
      </Match>
      <Match when={props.message.type === "compaction"}>
        <div class="sidechat-divider">{ctx.t("compacted")}</div>
      </Match>
    </Switch>
  )
}

export function ChatView(props: { readonly model: Model; readonly session: MountedSession; readonly tab: string }) {
  const ctx = usePlugin()
  const model = props.model
  const sessionID = () => chatOf(props.tab) ?? ""
  const chat = () => model.find(props.session.id, sessionID())
  const data = () => props.session.server.data

  const transcript = createTranscript(props.session.server, sessionID(), () => chat()?.created)

  const messages = createMemo(() => {
    const current = chat()
    return current ? ownMessages(transcript.messages(), current.created) : []
  })
  // Questions the server has not handed to the model yet.
  const pending = createMemo(() => new Set(transcript.pending().map((item) => item.id)))
  const running = () => !!sessionID() && data().session.status(sessionID()) === "running"
  // Shows "Thinking" until the newest answer has something to show.
  const waiting = () => {
    if (!running()) return false
    const last = messages().at(-1)
    return !last || last.type !== "assistant" || last.content.length === 0
  }
  const permissions = () => (sessionID() && data().session.permission.list(sessionID())) || []
  const forms = () => (sessionID() && data().session.form.list(sessionID())) || []

  createKeyed(sessionID, (id) => {
    // The side chat's own info tells `send` which model it is on.
    void Promise.all([
      data().session.sync(id),
      data().session.permission.sync(id),
      data().session.form.sync(id),
    ]).catch(() => undefined)
  })

  let root: HTMLDivElement | undefined
  let scroller: HTMLDivElement | undefined
  let content: HTMLDivElement | undefined
  let input: HTMLTextAreaElement | undefined
  // Follows new output only while the reader is at the bottom.
  let pinned = true
  const toBottom = () => {
    if (pinned && scroller) scroller.scrollTop = scroller.scrollHeight
  }

  // Like the main chat, the side chat opens on its latest messages and loads older ones as you scroll up.
  const loadOlder = () => {
    let fromBottom: number | undefined
    void transcript
      .older(() => {
        if (scroller) fromBottom = scroller.scrollHeight - scroller.scrollTop
      })
      ?.then(() => {
        if (scroller && fromBottom !== undefined && !pinned) scroller.scrollTop = scroller.scrollHeight - fromBottom
      })
  }
  // A page too short to scroll can't be scrolled up, so it loads the next one itself.
  createEffect(() => {
    transcript.messages().length
    if (transcript.hasOlder() && scroller && scroller.scrollHeight <= scroller.clientHeight) queueMicrotask(loadOlder)
  })

  const send = () => {
    pinned = true
    model.send(props.session, transcript, sessionID())
  }
  const sendable = () => !!model.draft(sessionID()).trim() || model.quotes(sessionID()).length > 0

  const focusEnd = () => {
    if (!input) return
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }

  // As in the main chat, a quote opens its comment box at once; closing the box returns focus to the composer.
  const quoteHere = (text: string) => model.addQuote(sessionID(), text, "side", true)

  // A "Quote" on text selected in this side chat lands in this side chat's composer, not the main chat's.
  const onQuote = (event: Event) => {
    const text = (event as CustomEvent<{ text?: unknown }>).detail?.text
    if (typeof text !== "string" || !text.trim()) return
    event.preventDefault()
    window.getSelection()?.removeAllRanges()
    quoteHere(text)
  }

  onMount(() => {
    root?.addEventListener(QUOTE_EVENT, onQuote)
    onCleanup(() => root?.removeEventListener(QUOTE_EVENT, onQuote))
    if (content) {
      const observer = new ResizeObserver(toBottom)
      observer.observe(content)
      onCleanup(() => observer.disconnect())
    }
    toBottom()
    if (model.takeAutosend(sessionID())) send()
    else focusEnd()
  })

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return
    event.preventDefault()
    send()
  }

  // Reads the selection inside this side chat's transcript, or explains why there is none.
  const selection = () => {
    const text = selectedText(".sidechat-log")
    if (!text) ctx.toast.show({ title: ctx.t("quote.select") })
    return text
  }

  const quoteSelection = () => {
    const text = selection()
    if (!text) return
    window.getSelection()?.removeAllRanges()
    quoteHere(text)
  }

  const selectionToMain = () => {
    const text = selection()
    if (text) model.toMain(props.session, sessionID(), text)
  }

  return (
    <div class="sidechat" ref={root}>
      <div class="sidechat-scroll" ref={scroller} onScroll={(event) => {
        const el = event.currentTarget
        pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        if (el.scrollTop < OLDER_AT) loadOlder()
      }}>
        <div class="sidechat-log" ref={content}>
          <Show when={messages().length === 0}>
            <p class="sidechat-hint">{ctx.t("empty.chat")}</p>
          </Show>
          <For each={messages()}>{(message) => <Message message={message} pending={pending().has(message.id)} />}</For>
          <Show when={waiting()}>
            <div class="sidechat-waiting">
              <ctx.ui.Loader size="small" />
              <span>{ctx.t("thinking")}</span>
            </div>
          </Show>
        </div>
      </div>

      <div class="sidechat-dock">
        <For each={permissions()}>
          {(request) => (
            <div class="sidechat-ask" role="group">
              <div class="sidechat-ask-title">{ctx.t("permission.title", { action: request.action })}</div>
              <div class="sidechat-ask-detail">{request.resources.join(", ")}</div>
              <div class="sidechat-ask-actions">
                <For each={["once", "always", "reject"] as const}>
                  {(decision) => (
                    <ctx.ui.Button
                      size="small"
                      variant={decision === "once" ? "contrast" : decision === "reject" ? "ghost-muted" : "neutral"}
                      onClick={() =>
                        void data()
                          .session.permission.reply({ sessionID: sessionID(), requestID: request.id, decision })
                          .catch(model.fail)
                      }
                    >
                      {ctx.t(`permission.${decision}`)}
                    </ctx.ui.Button>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
        <For each={forms()}>
          {(form) => (
            <FormCard
              form={form}
              onReply={(answer) =>
                data().session.form.reply({ sessionID: sessionID(), formID: form.id, answer }).catch(model.fail)
              }
              onSkip={() => data().session.form.cancel({ sessionID: sessionID(), formID: form.id }).catch(model.fail)}
            />
          )}
        </For>

        <div class="sidechat-composer">
          <QuoteCards model={model} composer={sessionID()} onDone={focusEnd} />
          <textarea
            ref={input}
            rows={1}
            value={model.draft(sessionID())}
            placeholder={ctx.t("composer.placeholder")}
            aria-label={ctx.t("composer.placeholder")}
            onInput={(event) => model.setDraft(sessionID(), event.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
          <div class="sidechat-composer-bar" onMouseDown={(event) => {
            // Keeps a transcript selection alive while a toolbar button takes the press.
            if (event.target instanceof Element && event.target.closest("button")) event.preventDefault()
          }}>
            <ctx.ui.Tooltip value={ctx.t("quote.action")}>
              <ctx.ui.IconButton icon="outline-quote" label={ctx.t("quote.action")} size="small" onClick={quoteSelection} />
            </ctx.ui.Tooltip>
            <ctx.ui.Menu
              label={ctx.t("menu")}
              placement="top-start"
              items={[
                {
                  label: ctx.t("selection.main"),
                  icon: "outline-quote",
                  onSelect: selectionToMain,
                },
                {
                  label: ctx.t("answer.action"),
                  icon: "arrow-left",
                  onSelect: () => model.answerToMain(props.session, transcript, sessionID()),
                },
                {
                  label: ctx.t("list.show"),
                  icon: "bullet-list",
                  onSelect: () => model.showList(props.session),
                },
                { type: "separator" },
                {
                  label: ctx.t("delete.action"),
                  icon: "outline-trash",
                  onSelect: () => void model.remove(props.session, sessionID()),
                },
              ]}
            />
            <span class="sidechat-spacer" />
            <Show
              when={running() && !sendable()}
              fallback={
                <ctx.ui.IconButton
                  icon="arrow-up"
                  label={ctx.t("composer.send")}
                  variant="neutral"
                  size="small"
                  disabled={!sendable()}
                  onClick={send}
                />
              }
            >
              <ctx.ui.IconButton
                icon="stop"
                label={ctx.t("composer.stop")}
                variant="neutral"
                size="small"
                onClick={() => model.stop(props.session, sessionID())}
              />
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The "New side chat" tab. Nothing is forked until its first message goes out. */
export function DraftView(props: { readonly model: Model; readonly session: MountedSession }) {
  const ctx = usePlugin()
  const model = props.model
  const id = () => draftOf(props.session.id)
  const busy = () => model.starting(props.session)
  let input: HTMLTextAreaElement | undefined

  const sendable = () => !!model.draft(id()).trim() || model.quotes(id()).length > 0
  const send = () => {
    if (sendable() && !busy()) void model.fork(props.session)
  }
  const focusEnd = () => {
    if (!input) return
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }

  onMount(focusEnd)

  return (
    <div class="sidechat">
      <div class="sidechat-scroll">
        <div class="sidechat-log">
          <p class="sidechat-hint">{ctx.t("empty.chat")}</p>
        </div>
      </div>
      <div class="sidechat-dock">
        <div class="sidechat-composer">
          <QuoteCards model={model} composer={id()} onDone={focusEnd} />
          <textarea
            ref={input}
            rows={1}
            value={model.draft(id())}
            placeholder={ctx.t("composer.placeholder")}
            aria-label={ctx.t("composer.placeholder")}
            onInput={(event) => model.setDraft(id(), event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return
              event.preventDefault()
              send()
            }}
          />
          <div class="sidechat-composer-bar">
            <span class="sidechat-spacer" />
            <Show
              when={!busy()}
              fallback={<ctx.ui.Loader size="small" />}
            >
              <ctx.ui.IconButton
                icon="arrow-up"
                label={ctx.t("composer.send")}
                variant="neutral"
                size="small"
                disabled={!sendable()}
                onClick={send}
              />
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ListView(props: { readonly model: Model; readonly session: MountedSession }) {
  const ctx = usePlugin()
  const model = props.model
  const chats = () => [...(model.list(props.session.id) ?? [])].reverse()
  const data = () => props.session.server.data
  const when = (time: number) => {
    const minutes = Math.round((time - Date.now()) / 60000)
    const format = new Intl.RelativeTimeFormat(ctx.locale.locale(), { numeric: "auto" })
    if (Math.abs(minutes) < 60) return format.format(minutes, "minute")
    const hours = Math.round(minutes / 60)
    if (Math.abs(hours) < 24) return format.format(hours, "hour")
    return format.format(Math.round(hours / 24), "day")
  }

  return (
    <div class="sidechat-list">
      <div class="sidechat-list-head">
        <ctx.ui.Button size="small" icon="plus" onClick={() => void model.start(props.session)}>
          {ctx.t("command.new")}
        </ctx.ui.Button>
      </div>
      <Show
        when={model.list(props.session.id)}
        fallback={
          <div class="sidechat-hint">
            <ctx.ui.Loader size="small" />
          </div>
        }
      >
        <Show when={chats().length > 0} fallback={<p class="sidechat-hint">{ctx.t("list.empty")}</p>}>
          <ul>
            <For each={chats()}>
              {(chat) => (
                <li class="sidechat-item">
                  <button type="button" class="sidechat-item-main" onClick={() => model.open(props.session, chat.sessionID)}>
                    <ctx.ui.Icon name="speech-bubble" size="small" />
                    <span class="sidechat-item-title">{model.title(props.session.id, chat.sessionID)}</span>
                    <span class="sidechat-item-meta">
                      <Show
                        when={data().session.status(chat.sessionID) === "running"}
                        fallback={when(chat.created)}
                      >
                        {ctx.t("running")}
                      </Show>
                    </span>
                  </button>
                  <ctx.ui.IconButton
                    icon="outline-trash"
                    label={ctx.t("delete.action")}
                    size="small"
                    class="sidechat-item-remove"
                    onClick={() => void model.remove(props.session, chat.sessionID)}
                  />
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </div>
  )
}
