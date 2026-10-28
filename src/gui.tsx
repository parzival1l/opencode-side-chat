import { createKeyed, Command, ComposerPill, MenuItem, Panel, Plugin, Style, type PanelTab } from "@opencode/plugin/gui"
import { Match, Switch } from "solid-js"
import { chatOf, createModel, DRAFT, LIST, tabOf } from "./model"
import { ChatView, DraftView, ListView } from "./view"
import css from "./gui.css?inline"

export default Plugin.define({
  i18n: {
    en: {
      "command.new": "New side chat",
      "command.newDescription": "Ask follow-up questions in a chat that branches from this one",
      "command.list": "Show side chats",
      "list.title": "Side chats",
      "list.show": "All side chats",
      "list.empty": "No side chats yet. Start one to ask about this conversation without adding to it.",
      "chat.untitled": "Side chat {{number}}",
      "empty.chat": "Ask about this conversation. Nothing here reaches the main chat.",
      "empty.parent": "Send a message in this chat before starting a side chat",
      noChat: "Open a chat first",
      starting: "Starting a side chat…",
      "composer.placeholder": "Ask a follow-up…",
      "composer.send": "Send",
      "composer.stop": "Stop",
      "model.title": "Side chats use the main chat's model",
      menu: "Side chat actions",
      "quote.action": "Quote selection here",
      "selection.main": "Send selection to main chat",
      "quote.select": "Select text in this side chat first",
      "quote.unavailable": "The main chat can't take a quote right now",
      "answer.action": "Send last answer to main chat",
      "answer.none": "This side chat has no answer yet",
      "delete.action": "Delete side chat",
      "delete.title": "Delete “{{title}}”?",
      "delete.description": "This deletes the side chat and its conversation. The main chat stays as it is.",
      "delete.confirm": "Delete",
      thinking: "Thinking",
      thought: "Thought",
      shell: "Shell",
      compacted: "Compacted",
      running: "Running",
      "permission.title": "Allow {{action}}?",
      "permission.once": "Allow once",
      "permission.always": "Always allow",
      "permission.reject": "Reject",
      "form.title": "Waiting for an answer: {{title}}",
      "form.skip": "Skip",
      "pill.one": "{{count}} side chat",
      "pill.other": "{{count}} side chats",
      error: "Side chat: {{message}}",
    },
  },
  setup(ctx) {
    const model = createModel(ctx)

    // One object per tab id, so strip updates and session switches never rebuild a trigger.
    const tabs = new Map<string, PanelTab>()

    const listTab: PanelTab = {
      id: LIST,
      get title() {
        return ctx.t("list.title")
      },
      closable: "compact",
      fallback: true,
    }

    const draftTab: PanelTab = {
      id: DRAFT,
      get title() {
        return ctx.t("command.new")
      },
      closable: "compact",
      fallback: true,
      label: () => (
        <span class="sidechat-tab">
          <ctx.ui.Icon name="plus" size="small" />
          <span>{ctx.t("command.new")}</span>
        </span>
      ),
    }

    function chatTab(parentID: string, sessionID: string): PanelTab {
      const id = tabOf(sessionID)
      const known = tabs.get(id)
      if (known) return known
      const title = () => model.title(parentID, sessionID)
      const tab: PanelTab = {
        id,
        get title() {
          return title()
        },
        // Restored tabs wait, unlisted, until the chat's side chats load.
        get hidden() {
          return !model.list(parentID)
        },
        closable: "compact",
        fallback: true,
        label: () => (
          <span class="sidechat-tab">
            <ctx.ui.Icon name="speech-bubble" size="small" />
            <span>{title()}</span>
          </span>
        ),
      }
      tabs.set(id, tab)
      return tab
    }

    ctx.add(Style, css)

    ctx.add(Panel, {
      id: "main",
      region: "side",
      mobile: {
        get title() {
          return ctx.t("list.title")
        },
        order: 61,
        kind: "menu",
        icon: "speech-bubble",
      },
      list: (input) => {
        const parentID = input.session.id
        model.load(input.session)
        const chats = model.list(parentID)
        return input.open.flatMap((id) => {
          if (id === LIST) return [listTab]
          if (id === DRAFT) return [draftTab]
          const sessionID = chatOf(id)
          if (!sessionID) return []
          if (chats && !chats.some((chat) => chat.sessionID === sessionID)) return []
          return [chatTab(parentID, sessionID)]
        })
      },
      enter: () => document.querySelector<HTMLTextAreaElement>(".sidechat-composer textarea")?.focus(),
      render: (props) => (
        <Switch fallback={<ChatView model={model} session={props.session} tab={props.tab.id} />}>
          <Match when={props.tab.id === LIST}>
            <ListView model={model} session={props.session} />
          </Match>
          <Match when={props.tab.id === DRAFT}>
            <DraftView model={model} session={props.session} />
          </Match>
        </Switch>
      ),
    })

    ctx.add(
      Command,
      (): Command => ({
        id: "new",
        title: ctx.t("command.new"),
        description: ctx.t("command.newDescription"),
        keywords: "side chat btw aside fork branch question follow-up",
        section: "session",
        bind: "mod+alt+b",
        slash: { name: "side", arguments: true },
        enabled: !!ctx.sessions.current(),
        run: (question) => void model.start(ctx.sessions.current(), question),
      }),
    )

    ctx.add(
      Command,
      (): Command => ({
        id: "list",
        title: ctx.t("command.list"),
        keywords: "side chat btw history",
        section: "session",
        enabled: !!ctx.sessions.current(),
        run: () => {
          const session = ctx.sessions.current()
          if (session) model.showList(session)
        },
      }),
    )

    ctx.add(MenuItem, (): MenuItem => {
      const session = ctx.sessions.current()
      const count = session ? (model.list(session.id)?.length ?? 0) : 0
      return {
        menu: "session.panel",
        id: "list",
        title: ctx.t("list.title"),
        icon: "speech-bubble",
        keybind: `${ctx.id}.new`,
        description: count ? String(count) : undefined,
        opened: !!session && ctx.layout.state(model.key(LIST), session) !== "closed",
        run: () => {
          if (session) model.showList(session)
        },
      }
    })

    // Loads the routed chat's side chats so its pill shows without opening the panel.
    createKeyed(
      () => ctx.sessions.current(),
      (session) => model.load(session),
    )

    ctx.add(ComposerPill, {
      id: "chats",
      show: (input) => {
        const chats = model.list(input.session.id) ?? []
        if (chats.length === 0) return undefined
        const parentID = input.session.id
        return {
          icon: "speech-bubble",
          label: ctx.plural("pill", chats.length),
          title: ctx.t("list.title"),
          rows: [
            ...[...chats]
              .reverse()
              .slice(0, 8)
              .map((chat) => ({
                id: chat.sessionID,
                label: model.title(parentID, chat.sessionID),
                icon: "speech-bubble" as const,
                detail: input.session.server.data.session.status(chat.sessionID) === "running" ? ctx.t("running") : undefined,
                run: () => model.open(input.session, chat.sessionID),
              })),
            {
              id: "new",
              label: ctx.t("command.new"),
              icon: "plus" as const,
              run: () => void model.start(input.session),
            },
            {
              id: "all",
              label: ctx.t("list.show"),
              icon: "bullet-list" as const,
              run: () => model.showList(input.session),
            },
          ],
        }
      },
    })
  },
})
