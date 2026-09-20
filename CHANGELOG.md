# Changelog

## 0.1.2

The URI handler is Command Executor's (`eliostruyf.execcommand`) in full:

- `args=<value>` is one argument, alongside `args0`, `args1`, …; an index left
  out is skipped, as there.
- Nothing is checked any more: the `commandLayer.uriHandler.*` settings, the
  list of commands never run from a URI, and `?action=` and `?task=` are gone.
  Any command runs, and `commandLayer.action.<id>` and
  `workbench.action.tasks.runTask` reach an action and a task. VS Code's own
  prompt for an extension opening a URI is the only guard.

## 0.1.1

The URI handler takes its shape from Command Executor
(`eliostruyf.execcommand`), and the links change with it:

- No `/run` path: `vscode://saemeon.command-layer?command=<id>`.
- A command's arguments are `args0`, `args1`, …, each read as JSON when it
  parses and as text otherwise. `?args=<json array>` is gone; a URI carrying it
  is refused with a message saying so.
- A parameter the handler does not know is refused instead of ignored.

## 0.1.0

First Marketplace release. The extension id is `saemeon.command-layer`
(it was `local.command-layer` when installed from a folder), so the URI
authority is now `vscode://saemeon.command-layer/run?...`.
