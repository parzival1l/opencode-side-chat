import { Rpc } from "@opencode/plugin/rpc"

const id = { type: "string", minLength: 1 } as const

const chat = {
  type: "object",
  properties: { sessionID: id, title: { type: "string" }, created: { type: "number" } },
  required: ["sessionID", "title", "created"],
  additionalProperties: false,
} as const

const state = {
  type: "object",
  properties: { parentID: id, chats: { type: "array", items: chat } },
  required: ["parentID", "chats"],
  additionalProperties: false,
} as const

function input<P extends Record<string, unknown>>(properties: P) {
  return {
    type: "object",
    properties: { parentID: id, ...properties },
    required: ["parentID", ...Object.keys(properties)],
    additionalProperties: false,
  } as const
}

/** One side chat: a fork of the parent chat. An empty `title` means the user has not asked anything yet. */
export interface Chat {
  readonly sessionID: string
  readonly title: string
  readonly created: number
}

/** Every side chat of one parent chat, oldest first. */
export interface State {
  readonly parentID: string
  readonly chats: readonly Chat[]
}

export const SideChat = Rpc.define({
  id: "sidechat",
  methods: {
    list: { input: input({}), output: state },
    // Registers a fork of the parent as its side chat. The server checks the fork, hides it from Home and primes it.
    link: { input: input({ sessionID: id }), output: state },
    rename: { input: input({ sessionID: id, title: { type: "string" } }), output: state },
    // Deletes the side chat's session.
    remove: { input: input({ sessionID: id }), output: state },
  },
  events: {
    updated: { schema: state },
  },
})
