import { expect, test } from "bun:test"
import { createRegistry, type Kv } from "../src/registry"

function memory(): Kv & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return {
    data,
    get: async (key) => structuredClone(data.get(key)),
    set: async (key, value) => {
      await Bun.sleep(1)
      data.set(key, structuredClone(value))
    },
    remove: async (key) => {
      data.delete(key)
    },
  }
}

test("a chat without side chats lists none", async () => {
  const registry = createRegistry(memory())
  expect(await registry.list("ses_main")).toEqual([])
  expect(await registry.parentOf("ses_side")).toBeUndefined()
})

test("side chats stay linked to their parent, oldest first", async () => {
  const registry = createRegistry(memory())
  await registry.add("ses_main", { sessionID: "ses_b", title: "", created: 200 })
  await registry.add("ses_main", { sessionID: "ses_a", title: "", created: 100 })
  await registry.add("ses_other", { sessionID: "ses_c", title: "", created: 50 })
  expect((await registry.list("ses_main")).map((chat) => chat.sessionID)).toEqual(["ses_a", "ses_b"])
  expect(await registry.parentOf("ses_b")).toBe("ses_main")
  expect(await registry.parentOf("ses_c")).toBe("ses_other")
})

test("a new registry on the same storage sees earlier side chats", async () => {
  const kv = memory()
  await createRegistry(kv).add("ses_main", { sessionID: "ses_a", title: "Why X?", created: 1 })
  expect(await createRegistry(kv).list("ses_main")).toEqual([{ sessionID: "ses_a", title: "Why X?", created: 1 }])
})

test("rename changes one side chat's title", async () => {
  const registry = createRegistry(memory())
  await registry.add("ses_main", { sessionID: "ses_a", title: "", created: 1 })
  await registry.add("ses_main", { sessionID: "ses_b", title: "", created: 2 })
  expect(await registry.rename("ses_main", "ses_b", "How does fork copy?")).toEqual([
    { sessionID: "ses_a", title: "", created: 1 },
    { sessionID: "ses_b", title: "How does fork copy?", created: 2 },
  ])
})

test("remove unlinks the side chat and drops an empty list", async () => {
  const kv = memory()
  const registry = createRegistry(kv)
  await registry.add("ses_main", { sessionID: "ses_a", title: "", created: 1 })
  expect(await registry.remove("ses_main", "ses_a")).toEqual([])
  expect(await registry.parentOf("ses_a")).toBeUndefined()
  expect(kv.data.size).toBe(0)
})

test("quick changes to one parent never lose a side chat", async () => {
  const registry = createRegistry(memory())
  await Promise.all(
    Array.from({ length: 10 }, (_, i) => registry.add("ses_main", { sessionID: `ses_${i}`, title: "", created: i })),
  )
  expect((await registry.list("ses_main")).length).toBe(10)
})

test("adding the same side chat twice keeps one entry", async () => {
  const registry = createRegistry(memory())
  await registry.add("ses_main", { sessionID: "ses_a", title: "", created: 1 })
  await registry.add("ses_main", { sessionID: "ses_a", title: "", created: 1 })
  expect(await registry.list("ses_main")).toEqual([{ sessionID: "ses_a", title: "", created: 1 }])
})

test("ignores malformed stored entries", async () => {
  const kv = memory()
  kv.data.set("parent/ses_main", [{ sessionID: "ses_a", title: "ok", created: 1 }, { sessionID: 3 }, "junk"])
  expect(await createRegistry(kv).list("ses_main")).toEqual([{ sessionID: "ses_a", title: "ok", created: 1 }])
})
