# Changelog

## 0.1.1

The URI handler is Command Executor's (`eliostruyf.execcommand`), and the
links change with it:

- No `/run` path: `vscode://saemeon.command-layer?command=<id>`.
- Arguments are `args=<value>`, one, or `args0`, `args1`, …; each is read as
  JSON when it parses and as text otherwise. `?args=<json array>` is gone.
- Nothing is checked any more: the `commandLayer.uriHandler.*` settings, the
  list of commands never run from a URI, and `?action=` and `?task=` are gone.
  Any command runs, and `commandLayer.action.<id>` and
  `workbench.action.tasks.runTask` reach an action and a task. VS Code's own
  prompt for an extension opening a URI is the only guard.

## 0.1.0

First Marketplace release. The extension id is `saemeon.command-layer`
(it was `local.command-layer` when installed from a folder), so the URI
authority is now `vscode://saemeon.command-layer/run?...`.
