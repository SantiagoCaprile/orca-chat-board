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
- Talking to a chat that is in Backlog moves its card to In progress. Loops waking up on their own do not count. You can turn this off in Settings, and it does nothing if either of those default columns was deleted.
- A chat you close goes to **Archived** and keeps its column and note. Remove it from there with ✕.
- The UI follows Orca's language: Spanish for `es-*`, English otherwise.

## How it works

- `src/worker.ts` is a Node worker. It lists chats with `orca terminal list --json` and focuses them with `orca terminal switch`. The plugin host API only sees the focused workspace and cannot focus a terminal, so the worker goes through the CLI.
- The board is saved in the plugin's own storage (key `board`), and agent status is saved under key `status`.
- `src/board.ts` holds the pure logic: merging chats, moving cards and editing columns. When a chat comes back with a new tab id (after an Orca restart), it is matched back to its card by pty id, or by title and workspace.
- `panel/index.ts` is the HTML panel and uses native drag & drop. `panel/i18n.ts` holds the strings and `panel/icons.ts` the status icons.

## Permissions

Orca asks you to approve these when you install the plugin. Here is what each one is used for:

| Permission | What the plugin does with it |
|---|---|
| **Runs its own code** (Node worker) | Lists your chats in every workspace, opens a chat and renames its tab. The worker only ever runs three Orca CLI commands: `orca terminal list`, `orca terminal switch` and `orca terminal rename`. The plugin API alone sees only the focused workspace and cannot open or rename tabs. |
| `storage:own` | Saves the board: columns, card positions, notes, agent status and monitors. All of it stays in the plugin's own folder. |
| `agent:read` | Agent status icons, the yellow "not seen yet" mark, and moving a Backlog card when you start a chat. |
| `workspace:read` | Knows which tab you are looking at, for the "not seen yet" mark and the open-chat highlight, and refreshes the board when chats open or close. |
| `settings:own` | The plugin's options in Orca's Settings. |
| Hook `agent.tool.after` (observe only) | Detects loops and watchers. Orca hands this hook every tool call an agent makes. The plugin looks only at `ScheduleWakeup`, `CronCreate`/`CronDelete`, `Monitor` and `TaskStop`, keeping their timing and description, and drops every other call without storing it. The hook never blocks or changes a call. |

The plugin makes no network requests and sends nothing anywhere. It also does not read your terminals' output; the board shows only the titles Orca lists.

## Development

```sh
orca plugin dev watch . --check   # reload on save
orca plugin test .                # worker tests
npx -p typescript tsc -p .        # type-check
orca plugin shot local.chat-board --panel board --width 900
```
