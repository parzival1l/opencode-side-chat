import { Plugin } from "@opencode/plugin"
import { createRegistry } from "./registry"
import { SideChat, type State } from "./rpc"
import { ownMessages, PRIMER, primer, toMarkdown } from "./transcript"

export default Plugin.define({
  id: "sidechat",
  async setup(ctx) {
    const registry = createRegistry(ctx.storage)
    let emit: (state: State) => void = () => {}

    const state = async (parentID: string, chats?: State["chats"]): Promise<State> => ({
      parentID,
      chats: chats ?? (await registry.list(parentID)),
    })

    const publish = (next: State) => {
      emit(next)
      return next
    }

    const rpc = await ctx.rpc.register(SideChat, {
      list: async (input) => state((input as { parentID: string }).parentID),

      link: async (input) => {
        const { parentID, sessionID } = input as { parentID: string; sessionID: string }
        const info = await ctx.session.get({ sessionID })
        if (info.fork?.sessionID !== parentID) throw new Error(`${sessionID} is not a fork of ${parentID}`)
        // Archived sessions stay off Home, the palette and notifications. The side panel is their only home.
        await ctx.session.update({
          sessionID,
          archived: true,
          metadata: { ...info.metadata, sidechat: { parentID } },
        })
        // A synthetic message after the inherited history keeps the parent's prompt cache usable.
        await ctx.session.synthetic({
          sessionID,
          text: primer,
          description: "Side chat",
          metadata: { [PRIMER]: true },
          resume: false,
        })
        const chats = await registry.add(parentID, { sessionID, title: "", created: info.time.created })
        return publish(await state(parentID, chats))
      },

      rename: async (input) => {
        const { parentID, sessionID, title } = input as { parentID: string; sessionID: string; title: string }
        const chats = await registry.rename(parentID, sessionID, title)
        if (title) await ctx.session.update({ sessionID, title: `Side chat: ${title}` }).catch(() => undefined)
        return publish(await state(parentID, chats))
      },

      remove: async (input) => {
        const { parentID, sessionID } = input as { parentID: string; sessionID: string }
        await ctx.session.remove({ sessionID }).catch(() => undefined)
        return publish(await state(parentID, await registry.remove(parentID, sessionID)))
      },
    })
    emit = (next) => void rpc.events.emit("updated", { ...next, chats: [...next.chats] }).catch(() => undefined)

    // Called from inside a side chat, the tools answer for its parent chat.
    async function owner(sessionID: string) {
      return (await registry.parentOf(sessionID)) ?? sessionID
    }

    function label(index: number, title: string) {
      return title || `Side chat ${index + 1}`
    }

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "sidechat",
        description:
          "Side chats: follow-up conversations the user branched off this chat in the OpenCode Desktop side panel. " +
          'When the user refers to "the side chat" or what they found there, list and read them.',
      })
      editor.add({
        name: "list",
        description: "List this chat's side chats: their number, title and when each started.",
        input: { type: "object", properties: {}, additionalProperties: false },
        options: { namespace: "sidechat", codemode: true },
        async execute(_input, context) {
          const chats = await registry.list(await owner(context.sessionID))
          if (chats.length === 0) return { content: "This chat has no side chats." }
          const rows = chats.map(
            (chat, i) => `${i + 1}. ${label(i, chat.title)} (started ${new Date(chat.created).toISOString()})`,
          )
          return { content: `Side chats of this chat:\n${rows.join("\n")}` }
        },
      })
      editor.add({
        name: "read",
        description:
          "Read one side chat's own conversation, without the history it inherited from this chat. Pass its `number` " +
          "from sidechat.list; omit it for the latest side chat.",
        input: {
          type: "object",
          properties: { number: { type: "integer", minimum: 1 } },
          additionalProperties: false,
        },
        options: { namespace: "sidechat", codemode: true },
        async execute(input, context) {
          const { number } = input as { number?: number }
          const chats = await registry.list(await owner(context.sessionID))
          const index = number === undefined ? chats.length - 1 : number - 1
          const chat = chats[index]
          if (!chat) return { content: chats.length ? `No side chat ${number}. There are ${chats.length}.` : "This chat has no side chats." }
          const messages = ownMessages(await ctx.session.context({ sessionID: chat.sessionID }), chat.created)
          const body = toMarkdown(messages) || "(nothing asked yet)"
          return { content: `# ${label(index, chat.title)}\n\n${body}` }
        },
      })
    })

    return async () => {
      await rpc.dispose()
    }
  },
})
