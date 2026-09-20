# Changelog

## 0.1.0

First Marketplace release. The extension id is `saemeon.command-layer`
(it was `local.command-layer` when installed from a folder), so the URI
authority is now `vscode://saemeon.command-layer?...`.

The URI handler takes its shape from Command Executor
(`eliostruyf.execcommand`): no `/run` path, and a command's arguments as
`args0`, `args1`, … each read as JSON when it parses. `?args=<json array>` is
gone, and a URI carrying it is refused with a message saying so.
