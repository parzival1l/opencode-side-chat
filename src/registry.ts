import type { Chat } from "./rpc"

/** The slice of the plugin's key-value storage the registry uses. */
export interface Kv {
  get(key: string): Promise<unknown>
  set(key: string, value: any): Promise<void>
  remove(key: string): Promise<void>
}

const parentKey = (parentID: string) => `parent/${parentID}`
const sideKey = (sessionID: string) => `side/${sessionID}`

function decode(value: unknown): Chat[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) =>
    item &&
    typeof item === "object" &&
    typeof item.sessionID === "string" &&
    typeof item.title === "string" &&
    typeof item.created === "number"
      ? [{ sessionID: item.sessionID, title: item.title, created: item.created }]
      : [],
  )
}

/**
 * Which side chats belong to which chat. Each parent's list is one value, and `side/<id>` points a side chat back at
 * its parent. Writes to one parent run in order, so two quick changes never lose one.
 */
export function createRegistry(kv: Kv) {
  const queues = new Map<string, Promise<unknown>>()

  function serial<T>(parentID: string, run: () => Promise<T>): Promise<T> {
    const next = (queues.get(parentID) ?? Promise.resolve()).then(run, run)
    const settled = next.catch(() => undefined)
    queues.set(parentID, settled)
    void settled.then(() => {
      if (queues.get(parentID) === settled) queues.delete(parentID)
    })
    return next
  }

  async function list(parentID: string): Promise<Chat[]> {
    return decode(await kv.get(parentKey(parentID))).sort((a, b) => a.created - b.created)
  }

  function change(parentID: string, edit: (chats: Chat[]) => Chat[]): Promise<Chat[]> {
    return serial(parentID, async () => {
      const next = edit(await list(parentID))
      if (next.length === 0) await kv.remove(parentKey(parentID))
      else await kv.set(parentKey(parentID), next)
      return next
    })
  }

  return {
    list,
    async parentOf(sessionID: string): Promise<string | undefined> {
      const value = await kv.get(sideKey(sessionID))
      return typeof value === "string" ? value : undefined
    },
    async add(parentID: string, chat: Chat): Promise<Chat[]> {
      const chats = await change(parentID, (chats) => [...chats.filter((item) => item.sessionID !== chat.sessionID), chat])
      await kv.set(sideKey(chat.sessionID), parentID)
      return chats.sort((a, b) => a.created - b.created)
    },
    rename(parentID: string, sessionID: string, title: string): Promise<Chat[]> {
      return change(parentID, (chats) => chats.map((item) => (item.sessionID === sessionID ? { ...item, title } : item)))
    },
    async remove(parentID: string, sessionID: string): Promise<Chat[]> {
      const chats = await change(parentID, (chats) => chats.filter((item) => item.sessionID !== sessionID))
      await kv.remove(sideKey(sessionID))
      return chats
    },
  }
}

export type Registry = ReturnType<typeof createRegistry>
