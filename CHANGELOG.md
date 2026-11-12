# Changelog

## 1.1.0

- **Orca chat tabs:** agents opened in Orca's chat view now get cards, once they have a conversation. Clicking one opens its workspace, since Orca can't switch to a chat tab from a plugin yet. Renaming uses `orca chat rename`. The yellow "not seen yet" mark follows Orca's own unread flag.
- **Status for every chat:** terminal chats that never sent a status event take their status from Orca's own record.
- **Hover preview:** hover a card to see your last message and the agent's last reply. It is read from Orca when you hover, never stored, and fades in and out. You can turn it off in Settings with "Show a preview on hover".
- **Windows and Linux:** the worker runs the CLI launcher that Orca ships (`orca.exe`, `orca-ide`), with no shell.
- **CI:** type-check and the tests that need no Orca host run on Linux, macOS and Windows.

## 1.0.0

First release: a kanban of agent chats across workspaces, with live status icons, the "not seen yet" mark, the open-chat highlight, loop monitoring, renaming tabs, notes, auto-move to In progress, archive, settings, and English and Spanish UI.
