# Chat Board (Orca plugin)

A kanban of your **chats**, meaning terminal tabs running an agent (Claude, Cursor, Codex…), across every Orca workspace. It lives in Orca's right sidebar.

- Your own columns: add, rename (double-click), reorder and delete them. Move cards with drag & drop.
- Each card shows the agent's live status as an icon:
  - working: spinner
  - waiting for you: hourglass
  - done: check
  - interrupted: red cross
  - needs permission: alert
- Each card shows the agent's logo for all 45 agents Orca knows, using the same icons Orca shows. An agent that Orca adds later gets its initial.
- When an agent stops working while you are looking at another chat, its card turns yellow with a dot, like Orca's unread tab. Its column header gets a dot too. The mark clears when you open the chat, from Orca or from the board, or when the agent starts working again.
- Loops and watchers get Orca's "monitoring" pulse icon and their next run ("next 2m"). That covers `/loop` (`ScheduleWakeup`), `CronCreate` schedules and `Monitor` watches. If a loop misses its run by about one interval, the card shows "no signal". Orca does not give plugins its monitoring state, so the plugin recognises these from the agent's tool calls with the `agent.tool.after` hook, which only observes. Only Claude Code's tool names are recognised so far.
- A click (or Enter, or ↗) opens the chat; dragging moves the card. ✎ renames the chat's Orca tab (an empty name brings back the automatic title) and edits the card's note. Enter saves, and Shift+Enter adds a new line to the note.
- A chat you close goes to **Archived** and keeps its column and note. Remove it from there with ✕.
- The UI follows Orca's language: Spanish for `es-*`, English otherwise.

## How it works

- `src/worker.ts` is a Node worker. It lists chats with `orca terminal list --json` and focuses them with `orca terminal switch`. The plugin host API only sees the focused workspace and cannot focus a terminal, so the worker goes through the CLI.
- The board is saved in the plugin's own storage (key `board`), and agent status is saved under key `status`.
- `src/board.ts` holds the pure logic: merging chats, moving cards and editing columns. When a chat comes back with a new tab id (after an Orca restart), it is matched back to its card by pty id, or by title and workspace.
- `panel/index.ts` is the HTML panel and uses native drag & drop. `panel/i18n.ts` holds the strings and `panel/icons.ts` the status icons.

## Development

```sh
orca plugin dev watch . --check   # reload on save
orca plugin test .                # worker tests
npx -p typescript tsc -p .        # type-check
orca plugin shot local.chat-board --panel board --width 900
```
