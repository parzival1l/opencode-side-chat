import { createKeyed, usePlugin, type MountedSession } from "@opencode/plugin/gui"
import type {
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantTool,
  SessionMessageInfo,
} from "@opencode/client"
import { createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { chatOf, selectedText, type Model } from "./model"
import { ownMessages, toolSummary } from "./transcript"

const OUTPUT_LIMIT = 6000

function clip(text: string) {
  return text.length > OUTPUT_LIMIT ? `${text.slice(0, OUTPUT_LIMIT)}\n…` : text
}

// The app styles these data attributes in every theme, so a bubble here looks like one in the main chat.
function UserBubble(props: { readonly text: string; readonly pending?: boolean }) {
  return (
    <div class="sidechat-user" data-component="user-message" data-pending={props.pending ? "" : undefined}>
      <div data-slot="user-message-body">
        <div data-slot="user-message-text" dir="auto">
          {props.text}
        </div>
      </div>
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

function Message(props: { readonly message: SessionMessageInfo }) {
  const ctx = usePlugin()
  return (
    <Switch>
      <Match when={props.message.type === "user" && props.message}>{(user) => <UserBubble text={user().text} />}</Match>
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

  const messages = createMemo(() => {
    const current = chat()
    return current ? ownMessages(data().session.message.list(current.sessionID), current.created) : []
  })
  const queued = () => {
    const id = sessionID()
    return id ? data().session.pending.list(id).flatMap((item) => (item.type === "user" ? [item.payload.text] : [])) : []
  }
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
    void Promise.all([
      data().session.message.sync(id),
      data().session.pending.sync(id),
      data().session.permission.sync(id),
      data().session.form.sync(id),
    ]).catch(() => undefined)
  })

  let scroller: HTMLDivElement | undefined
  let content: HTMLDivElement | undefined
  let input: HTMLTextAreaElement | undefined
  // Follows new output only while the reader is at the bottom.
  let pinned = true
  const toBottom = () => {
    if (pinned && scroller) scroller.scrollTop = scroller.scrollHeight
  }

  onMount(() => {
    if (!content) return
    const observer = new ResizeObserver(toBottom)
    observer.observe(content)
    onCleanup(() => observer.disconnect())
    toBottom()
    input?.focus()
  })

  const send = () => {
    pinned = true
    model.send(props.session, sessionID(), model.draft(sessionID()))
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return
    event.preventDefault()
    send()
  }

  const quoteSelection = () => {
    const text = selectedText(".sidechat-log")
    if (!text) {
      ctx.toast.show({ title: ctx.t("quote.select") })
      return
    }
    model.toMain(props.session, sessionID(), text)
  }

  return (
    <div class="sidechat">
      <div class="sidechat-scroll" ref={scroller} onScroll={(event) => {
        const el = event.currentTarget
        pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 24
      }}>
        <div class="sidechat-log" ref={content}>
          <Show when={messages().length === 0 && queued().length === 0}>
            <p class="sidechat-hint">{ctx.t("empty.chat")}</p>
          </Show>
          <For each={messages()}>{(message) => <Message message={message} />}</For>
          <For each={queued()}>{(text) => <UserBubble text={text} pending />}</For>
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
            <div class="sidechat-ask sidechat-ask-row">
              <div class="sidechat-ask-detail">{ctx.t("form.title", { title: form.title })}</div>
              <ctx.ui.Button
                size="small"
                onClick={() =>
                  void data().session.form.cancel({ sessionID: sessionID(), formID: form.id }).catch(model.fail)
                }
              >
                {ctx.t("form.skip")}
              </ctx.ui.Button>
            </div>
          )}
        </For>

        <div class="sidechat-composer">
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
                  label: ctx.t("answer.action"),
                  icon: "arrow-left",
                  onSelect: () => model.answerToMain(props.session, sessionID()),
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
              when={running() && !model.draft(sessionID()).trim()}
              fallback={
                <ctx.ui.IconButton
                  icon="arrow-up"
                  label={ctx.t("composer.send")}
                  variant="neutral"
                  size="small"
                  disabled={!model.draft(sessionID()).trim()}
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
