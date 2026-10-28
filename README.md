# opencode-side-chat

An OpenCode Desktop plugin for side chats. A side chat branches off the chat you are in, opens in the side panel, and lets you ask follow-up questions without adding them to the main conversation. Every side chat stays linked to its chat, so you can close it and find it again later.

## How it works

- **Start** a side chat with **New side chat** (`mod+alt+b`), the `/side` slash command, the composer pill, or the side panel's **+** menu. `/side why did you pick this approach?` starts one and asks right away.
- **Context.** The side chat is a fork of the current chat, so it knows everything said so far. Its tab shows only what you say after the fork.
- **Isolation.** Nothing said in a side chat reaches the main chat. The main chat keeps running while you ask.
- **Tools.** A side chat has the same tools and permissions as the main chat. When it asks for a permission, answer it in the side chat's tab.
- **History.** Closing a tab keeps the side chat. The **Side chats** tab and the composer pill list every side chat of the current chat, newest first. Pick one to reopen it. Delete it from its `⋯` menu or the list.

## Quotes

- Select text in a side chat and press the quote button. The selection lands in the side chat's own composer as a quote.
- A plugin's "Quote" action works the same way. Before a quote goes to the main chat, the plugin dispatches a cancelable, bubbling `opencode:quote` event with `detail: { text }` on the selection. A side chat cancels it and takes the quote. [opencode-notepad](https://github.com/parzival1l/opencode-notepad) does this from 0.0.4.

## Bring answers back

- **Send selection to main chat** in the `⋯` menu quotes the selected side chat text in the main chat's composer.
- **Send last answer to main chat** in the `⋯` menu quotes the side chat's latest answer.
- Text you select in the main chat before you start a side chat becomes a quote in the side chat's composer.
- The main chat's agent can read side chats with two tools. Ask "what did we find in the side chat?".

| Tool | What it does |
|------|--------------|
| `sidechat.list` | Lists the chat's side chats with their numbers and titles. |
| `sidechat.read` | Returns one side chat's own conversation, without the history it inherited. |

## Under the hood

- **GUI** (`src/gui.tsx`, built to `dist/gui-experimental.cjs`) forks the chat with `session.fork`, renders the side chat, and sends prompts to the fork.
- **Transcript** (`src/live.ts`). The app keeps transcripts only for open tabs and the last three chats viewed, and drops any other chat's messages when they change. A side chat is neither, so each open side chat keeps its transcript in a store of its own. That store hears the same server events, filtered to the side chat.
- **Server** (`src/index.ts`) owns the links. It stores each chat's side chats in the plugin's key-value storage, so they survive restarts.
- On link, the server archives the fork, which keeps it off Home, the command palette and notifications. It also adds one synthetic message that tells the model it is in a side chat. That message sits after the inherited history, so the parent's prompt cache still applies.
- **RPC** (`src/rpc.ts`) is the contract between the two parts. The server emits `updated` after every change.

## Install

Requires OpenCode Desktop 2.2.0 or later.

1. Add the package to `plugins` in the global `~/.config/opencode/opencode.jsonc`. OpenCode Desktop loads GUI parts only from the global config.

   ```jsonc
   {
     "plugins": ["opencode-side-chat"],
   }
   ```

2. Open a chat that has at least one message, then press `mod+alt+b`.

OpenCode installs the package and reloads plugins when the config changes.

## Develop

1. Clone the repo, then run `bun install` and `bun run build`.
2. In `plugins`, replace `"opencode-side-chat"` with the absolute path of your clone.

- `bun run dev` rebuilds the GUI on every change. Each rebuild reloads the GUI in every window.
- The server reloads when a file in `src/` changes.
- `bun run test` covers the link registry and the transcript helpers. `bun run typecheck` runs `tsc`.

## Limits

- The GUI API is experimental. This plugin pins `@opencode/plugin@2.2.0`, which matches OpenCode Desktop 2.2.0.
- The side panel draws its own transcript with the app's styles. It is close to the main timeline but not identical: no diffs, no model picker, and questions from the `question` tool can only be skipped.
- Side chats work on the desktop's own server. Deleting the main chat leaves its side chats archived but unlisted.
- The fork shows on Home for a moment before the server archives it.
