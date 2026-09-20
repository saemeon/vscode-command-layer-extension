# Command Layer

[![Marketplace version](https://img.shields.io/visual-studio-marketplace/v/saemeon.command-layer)](https://marketplace.visualstudio.com/items?itemName=saemeon.command-layer)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/saemeon.command-layer)](https://marketplace.visualstudio.com/items?itemName=saemeon.command-layer)
[![License: MIT](https://img.shields.io/github/license/saemeon/vscode-command-layer-extension)](LICENSE)

Wire any VS Code command to a trigger, entirely in `settings.json`.
No code, no build step, no dependencies.

Command Layer does one thing: **resolve arguments from context and
dispatch a command.** It runs no processes, manages no terminals, and
writes no files. The commands come from VS Code and from the extensions
you already have.

**Reach.** VS Code lets you bind commands to keystrokes. Command Layer
extends that to everything else — text matching a pattern, the current
selection, a file you right-clicked, terminal output, a status bar
button, a sidebar entry, an editor event.

```jsonc
{
  "commandLayer.textActions": [
    {
      "match": "folderpath:\\s*([^\\r\\n]+)",
      "actions": [
        { "title": "Reveal in File Explorer", "command": "revealFileInOS", "args": [["uri", "$1"]] }
      ]
    }
  ]
}
```

Write `folderpath: C:\Program Files\Some Folder` in any file and click it.

**Curation.** Gather the commands you actually use, from wherever they
come from, into one menu that fits what you're doing — no hunting the
Command Palette, no remembering ids.

```jsonc
{
  "commandLayer.selectionActions": [
    { "title": "Search ignoring whitespace", "command": "search-ignore-whitespace.searchIgnoreWhitespace" },
    { "title": "Format selection",           "command": "editor.action.formatSelection" },
    { "title": "Run in terminal",            "command": "workbench.action.terminal.sendSequence",
      "args": [["object", { "text": "${selectedText}\u000D" }]] }
  ]
}
```

Select something, right-click, **Selection Actions...** — three commands
from three sources in one list.

## Install

Search for **Command Layer** in the Extensions view (`cmd+shift+X`), or run

```sh
code --install-extension saemeon.command-layer
```

To install from a `.vsix` or from a clone of this repository instead, see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Quick start

Everything starts empty, and nothing happens until you add actions. Run
**Command Layer: Open Example Configuration** from the Command Palette: it
opens an untitled document with an example of every list below (event
actions, which run on their own, are left commented out). Copy the entries you want into your `settings.json` (**Preferences: Open User
Settings (JSON)**), and they apply at once. Then try:

- **Text:** type `demo: hello world` in any file and click it, or run
  **Command Layer: Text Actions...**.
- **File:** right-click a file in the Explorer, then **File Actions...**.
- **Selection:** select some text, right-click, then **Selection Actions...**.
- **Status bar:** the **Layer** button opens everything that applies.
- **Views:** a **Command Layer** panel in the Explorer and its own
  Activity Bar icon appear once their settings are not empty.

More recipes are in the [Cookbook](#cookbook) at the end.

## How it works

**trigger** → **resolve** → **dispatch**

- **Trigger** — a pattern matching text, a selection, a file, terminal
  output, an editor event, or a direct invocation from the palette, a
  keybinding, the status bar, or a view.
- **Resolve** — placeholders in the action's arguments are filled in:
  capture groups (`$1`), context variables (`${file}`, `${selectedText}`),
  a prompt (`${input:...}`, `${pick:a,b}`), another command's return value
  (`${command:...}`).
- **Dispatch** — the command runs with those arguments.

## Actions

An action is one command plus its arguments.

| Field | Meaning |
|---|---|
| `command` | Any VS Code command id. |
| `args` | Arguments, in order. Strings are templates; `["uri", tpl]` and friends are typed. |
| `title` | Label in pickers, CodeLens, hovers, menus. |
| `when` | Optional conditions, see [Scoping with `when`](#scoping-with-when). |

An action with no arguments can be a bare command id:
`"actions": ["editor.action.formatDocument"]`.

### Arguments

`args` maps positionally onto the command's parameters. Placeholders
resolve when the command runs, which `keybindings.json` can't do: its
`args` are static.

| Placeholder | |
|---|---|
| `$0` `$1` `$2` … | capture groups from `match` (`$0` is the whole match) |
| `${file}` `${fileBasename}` `${fileBasenameNoExtension}` `${fileDirname}` `${fileExtname}` | active or clicked file |
| `${relativeFile}` `${relativeFileDirname}` | relative to the workspace |
| `${workspaceFolder}` `${workspaceFolderBasename}` | |
| `${selectedText}` `${selectedTextList}` `${selectedTextSection}` | first / space-joined / newline-joined |
| `${lineNumber}` `${lineNumbers}` `${columnNumber}` `${columnNumbers}` | |
| `${selectedFile}` `${selectedFiles}` | Explorer selection, quoted |
| `${homedir}` `${tmpdir}` `${platform}` `${clipboard}` | |
| `${env:NAME}` `${config:some.setting}` | |
| `${input:default}` | prompts you for text |
| `${pick:a,b,c}` | prompts you to choose one |
| `${command:someId}` | runs a command, inlines its return value |
| `\$` | a literal `$` |

### Typed arguments

A plain string produces a string. Wrap it to produce something else:

```jsonc
["uri",     "$1"]                       // a real vscode.Uri
["object",  { "query": "$1" }]          // a structured argument
["regex",   "$1"]                       // metacharacters escaped, matches literally
["number",  "$1"]
["boolean", "$1"]                       // true only if the literal string is "true"
```

`object` is the important one, since many commands take a single options
object. Its template may be a **structure** (preferred: nothing is parsed,
so nothing needs escaping) or a **string** that gets parsed, with
substituted values escaped for you. Typed arguments **compose**:

```jsonc
{ "command": "workbench.action.findInFiles",
  "args": [["object", { "isRegex": true, "query": ["regex", "$1"] }]] }
```

### Running several commands

Use VS Code's own `runCommands`; substitution works inside it. Command
Layer adds no sequencing of its own: `runCommands` runs commands in order
and stops on failure, and anything beyond that belongs in the thing being run.

```jsonc
{ "title": "Save and format", "command": "runCommands",
  "args": [["object", { "commands": ["workbench.action.files.saveAll", "editor.action.formatDocument"] }]] }
```

## Configuration

Seven lists of actions, all empty by default, each named for what
triggers it:

| Setting | Fires when | `match` |
|---|---|---|
| `commandLayer.textActions` | a pattern matches in document text | required |
| `commandLayer.terminalActions` | a pattern matches in terminal output | required |
| `commandLayer.fileActions` | a file or folder is the target | optional |
| `commandLayer.selectionActions` | there's a selection | optional |
| `commandLayer.globalActions` | invoked by name, anchored to nothing | — |
| `commandLayer.statusBarActions` | a button is clicked | — |
| `commandLayer.eventActions` | an editor event fires | — |

Plus `commandLayer.explorerView` and `commandLayer.activityBarView` for
the [views](#views). The example configuration has an entry of each.

Each list has a matching picker — **Text Actions...**, **File Actions...**,
**Selection Actions...**, **Global Actions...** — and **All Actions...**
shows everything applicable in one picker, grouped and narrowest first.
They always show a picker, even with one action, so a generic entry never
does something unannounced; the same goes for clicking a **link**, which
shows the matched text, not which action will run. Clicking something that
*names* its action runs it directly: a CodeLens, a hover entry, a
lightbulb entry, a status bar button, a view item.

**`match` narrows, `when` scopes.** `match` is a pattern that also binds
capture groups: required where nothing else anchors an entry, optional where
something already does. `when` is a condition: language, path glob,
environment variable, setting.

### Text actions

```jsonc
{
  "commandLayer.textActions": [
    {
      "match": "([\\w./\\\\-]+\\.(?:db|sqlite3?))",
      "actions": [
        { "title": "Reveal in Explorer", "command": "revealFileInOS", "args": [["uri", "$1"]] },
        { "title": "Open in VS Code",    "command": "vscode.open",    "args": [["uri", "$1"]] }
      ]
    }
  ]
}
```

One matching action runs directly; several show a picker. Fields:
`match`, `flags`, `when`, `show`, `decoration`, `actions`.

### File and selection actions

Always offered; add `match` to narrow an entry (a path for files, the
selected text for selections). A selection entry **with** a `match` runs once
per selection, each with its own capture groups, so multi-cursor works; one
**without** runs once, with `${selectedText}` and `${selectedTextSection}`
covering the rest. File actions are multi-select aware: right-click five
files and `${selectedFiles}` holds all five, quoted and space-joined.

### Global actions

Anchored to nothing: reachable from the palette, a view, or a keybinding.
Give one an `id` and it registers as the command `commandLayer.action.<id>`:

```jsonc
// settings.json
{ "id": "openNotes", "title": "Open notes", "command": "vscode.open",
  "args": [["uri", "${workspaceFolder}/NOTES.md"]] }

// keybindings.json
{ "key": "ctrl+alt+n", "command": "commandLayer.action.openNotes" }
```

### Status bar

An entry with `text` (which takes codicons) and a `command` is a button; one
with `actions` opens a picker instead. `alignment` is `left` or `right`, and
both the button and each entry accept `when`.

### Event actions

The only actions that run without you initiating them:

```jsonc
{ "on": "workspaceOpen", "title": "Pull", "command": "git.pull", "confirm": true }
```

`on` is `workspaceOpen` or `fileSave`. `confirm` asks before running and
defaults to `false`. **Every firing is logged** to the **Command Layer**
output channel, so an event action is never invisible.

### Scoping with `when`

```jsonc
"when": {
  "language": ["markdown", "plaintext"],
  "include": ["docs/**", "**/*.md"],
  "exclude": "**/node_modules/**",
  "env": { "CI": "true" },
  "config": { "editor.formatOnSave": true }
}
```

All conditions present must pass. Terminal output has no document, so
`when.language` never matches there.

## Triggers

| Where | Reached by |
|---|---|
| Document text | link click, **Text Actions...**, CodeLens, lightbulb, hover |
| Selection | **Selection Actions...** |
| Explorer, editor body, tab right-click, Source Control | **File Actions...** |
| Editor tab-bar button | whatever you set in `commandLayer.editorTitleAction` |
| Terminal output | link click |
| Terminal right-click, Command Palette | **Global Actions...** |
| Keybinding | `commandLayer.action.<id>` |
| Status bar | configured buttons |
| Views | any configured node |
| Editor events | `workspaceOpen`, `fileSave` |

### Surfaces

A `textActions` entry is one subject with several renderings. `show` picks
which of `link` (underlined, ctrl-clickable), `codeLens` (a clickable line
above the match), `codeAction` (the lightbulb menu), `hover` and
`decoration` (styled in place, visual only). Without `show`, an entry uses
`commandLayer.defaults.surfaces`, which is all but `decoration`, since
highlighting every match is intrusive; `commandLayer.defaults.decorationStyle` is
the default style for one. `show: []` means the entry appears
nowhere, useful while testing one in isolation. Surfaces apply to
`textActions` only.

```jsonc
{ "match": "TODO\\(([^)]+)\\)", "show": ["codeLens", "decoration"],
  "decoration": { "color": "#e5c07b", "fontWeight": "bold" },
  "actions": [ { "title": "Copy owner", "command": "commandLayer.copyToClipboard", "args": ["$1"] } ] }
```

### The editor tab-bar button

Empty by default. Give it an action and it shows up at the top-right of the
editor. Any command works, and `when` applies too:

```jsonc
{ "commandLayer.editorTitleAction": { "command": "commandLayer.runAllActions", "tooltip": "Command Layer" } }
```

## Views

Two containers, each filled by its own setting and appearing only when it
is not empty: `commandLayer.explorerView` (a panel in the Explorer
sidebar) and `commandLayer.activityBarView` (its own Activity Bar icon).
VS Code also lets you drag either view anywhere else. A node is one of four
things:

```jsonc
"commandLayer.explorerView": [
  "workbench.action.reloadWindow",                                  // leaf
  { "title": "Deploy", "command": "workbench.action.tasks.runTask", "args": ["deploy"] },

  { "title": "Project", "children": [                               // group — nests
      { "title": "Build", "children": ["workbench.action.tasks.build"] }
  ]},

  { "title": "Tasks", "from": "commandLayer.fetchVSCodeTasks" },    // group — filled

  { "from": "commandLayer.fetchFrequentActions", "limit": 5 }       // fragment — splices in
]
```

**A `title` makes a level.** A node with `from` and no `title` is a
fragment: its entries splice into the parent rather than nesting. `filter`
(substring of the visible label, case-insensitive), `limit` and `when` apply
to any node. A node uses `from` **or** `children`, never both.

`from` is a **command id** returning a list of actions. These ship with
Command Layer:

| | |
|---|---|
| `commandLayer.fetchGlobalActions` `…FileActions` `…SelectionActions` `…TextActions` `…TerminalActions` | your entries of that kind |
| `commandLayer.fetchVSCodeCommands` | every command registered in VS Code |
| `commandLayer.fetchVSCodeTasks` | your `tasks.json` tasks |
| `commandLayer.fetchFrequentActions` | what you run most, in this workspace |

Any command returning an array of actions works: a bare command id
string, or `{ title, command, args }`. `fetchVSCodeCommands` answers the
hardest problem: you can't bind a command you've never heard of. Point a
filtered group at an extension's prefix (`git.`, `python.`), click one to
try it, then right-click to **Copy Command Id** or **Copy Action Stub** and
paste it into your settings.

## Built-in commands

Two, for things VS Code exposes only as an API and not as a command:

| Command | Does |
|---|---|
| `commandLayer.openExternal` | Hands a URI to the **OS's own handler**: registered protocols (`obsidian://`, `slack://`) and a file's default desktop app |
| `commandLayer.copyToClipboard` | Copies a string. VS Code's clipboard commands act on the selection; none takes a value |

Opening things, three jobs that are easy to confuse: `revealFileInOS` shows
a file or folder in Explorer / Finder; `vscode.open` opens a file in VS
Code, or a URL in the browser; `commandLayer.openExternal` opens a file in
its **default desktop app**, or launches a tool by protocol.

## Running shell commands

Command Layer doesn't run processes. VS Code has two native ways, both
reachable as ordinary commands. **Tasks**, for anything repeatable (`cwd`,
environment, problem matchers, `dependsOn` for ordering), run with
`workbench.action.tasks.runTask` and the task's label as its argument.
`workbench.action.terminal.sendSequence`, for one-offs built from captures:

```jsonc
{ "command": "workbench.action.terminal.sendSequence",
  "args": [["object", { "text": "python plot.py \"$1\"\u000D" }]] }
```

`\u000D` is the carriage return that submits the line. It goes to the
active terminal, so open one first. Ordering belongs in the shell, and `&&`
differs across `cmd`, PowerShell and POSIX shells.

## Optional utilities

`utils.js` ships alongside the extension but isn't part of it. It loads
only when `"commandLayer.utils.enabled": true` (requires a reload), and
registers nothing otherwise:

| Command | Does |
|---|---|
| `commandLayer.util.searchSelection` | Search the workspace for the selection, ignoring spacing |
| `commandLayer.util.searchSelectionExact` | Same, matching literally |
| `commandLayer.util.writeFile` | `[path, content]` |

## From outside VS Code

A URI handler lets another program (a launcher, a script, `open` on
macOS, a link in a Markdown file) run any VS Code command, with arguments,
in the window you used last. It is taken from
[Command Executor](https://marketplace.visualstudio.com/items?itemName=eliostruyf.execcommand)
by Elio Struyf: the same URI shape and the same reading of arguments, so
links written for one read the same to the other apart from the id. What is
added is that a value can take the typed forms of an action's `args`.

```
vscode://saemeon.command-layer?command=<id>
vscode://saemeon.command-layer?command=<id>&args=<value>
vscode://saemeon.command-layer?command=<id>&args0=<value>&args1=<value>
```

**Arguments.** `args` is one argument, and `args0`, `args1`, … are the
arguments in order; an index left out is skipped (`undefined`), and indexes
above 63 are ignored. Each value is read as JSON when it parses and is the
text otherwise, so `args0=42` passes the number 42, `args0=true` a boolean,
`args0={"query":"x"}` an object and `args0=hello` the string `hello`. Quote a
string that would parse to keep it one: `args0="42"`. The typed forms of an
action's `args` are JSON too (`["uri", "/path"]`, `["object", {...}]`,
`["regex", ...]`, `["number", ...]`, `["boolean", ...]`), which is how a
command taking a `Uri` is given one. Nothing in a value is substituted: `$1`
and `${file}` arrive as literal text, and `${command:...}` runs nothing. VS
Code decodes a URI's query once before the handler sees it, so a value
containing `&`, `+` or a percent sign has to be percent-encoded **twice**;
anything else needs it once, as in any URL.

Your own global actions are commands too: an entry with an `id` is
`commandLayer.action.<id>`, so `?command=commandLayer.action.openNotes` runs
it. A task is `?command=workbench.action.tasks.runTask&args0=build`, the
label as **Run Task** shows it.

**Nothing is checked.** There is no allowlist: any command runs, with any
arguments, once VS Code's prompt for an extension opening a URI has been
accepted. That prompt is VS Code's only guard, it is once per extension, and
its dialog has a checkbox to stop asking. Any local application and any web
page that can open a URL can reach this handler, and a command taking no
argument can still run code: `workbench.action.tasks.build` runs the default
build task, `workbench.action.debug.start` a launch configuration,
`workbench.action.terminal.runActiveFile` a file. Install this extension
only if you accept that, and keep the prompt on.

A request with no `command`, an argument that is not valid in its typed form
(`["uri", ""]`), or a command that throws shows an error message with **Show
Details**, logged to the **Command Layer** output channel along with every
URI that ran.

Open a folder in a new window (the arguments are `["uri", "/Users/me/my
project"]` and `{"forceNewWindow": true}`, each JSON encoded once), and run
the `build` task:

```sh
open 'vscode://saemeon.command-layer?command=vscode.openFolder&args0=%5B%22uri%22%2C%22%2FUsers%2Fme%2Fmy%20project%22%5D&args1=%7B%22forceNewWindow%22%3Atrue%7D'
open 'vscode://saemeon.command-layer?command=workbench.action.tasks.runTask&args0=build'
```

As a link in a Markdown file:
`[Build](vscode://saemeon.command-layer?command=workbench.action.tasks.runTask&args0=build)`.

## Validation

Configuration is checked on startup and whenever settings change. An
invalid regex, an action with no command, a `textActions` entry with no
`match`, a duplicate id, a `from` naming a command that doesn't exist:
each produces one consolidated warning with a **Show Details** button
opening the **Command Layer** output channel. Invalid entries are
skipped; the rest keep working. Nothing is shown when the configuration
is clean. Errors from an action surface as a notification with a **Show
Details** button; nothing fails silently.

## Cookbook

### Open a Windows folder path in Explorer

```jsonc
"commandLayer.textActions": [
  { "match": "folderpath:\\s*([^\\r\\n]+)",
    "actions": [{ "title": "Reveal", "command": "revealFileInOS", "args": [["uri", "$1"]] }] }
]
```

Spaces work — the match runs to the end of the line.

### Make stack-trace paths clickable in terminal output

```jsonc
"commandLayer.terminalActions": [
  { "match": "([\\w./-]+\\.(?:ts|js|py|md)):(\\d+)",
    "actions": [{ "title": "Open", "command": "vscode.open", "args": [["uri", "$1"]] }] }
]
```

### Plot a CSV

```jsonc
"commandLayer.fileActions": [
  { "title": "Plot", "match": "\\.csv$",
    "command": "workbench.action.terminal.sendSequence",
    "args": [["object", { "text": "python -c \"import pandas as pd, matplotlib.pyplot as plt; pd.read_csv(r'${file}').plot(); plt.show()\"\u000D" }]] }
]
```

Right-click any `.csv` in the Explorer. The entry doesn't appear on
other files.

### Send a selection to the Python Interactive Window

```jsonc
"commandLayer.selectionActions": [
  { "title": "Plot selected key",
    "command": "jupyter.execSelectionInteractive",
    "args": ["SELECTION = \"${selectedText}\"\nimport my_plotter; my_plotter.plot(SELECTION)"] }
]
```

### Pull on opening a workspace

```jsonc
"commandLayer.eventActions": [
  { "on": "workspaceOpen", "title": "Pull", "command": "git.pull", "confirm": true }
]
```

`confirm` asks first — worth keeping on for anything touching a repo.

### A view that gathers everything

```jsonc
"commandLayer.explorerView": [
  { "from": "commandLayer.fetchFrequentActions", "limit": 5 },
  { "title": "Tasks", "from": "commandLayer.fetchVSCodeTasks" },
  { "title": "My actions", "from": "commandLayer.fetchGlobalActions" },
  { "title": "Browse", "children": [
      { "title": "Git",    "from": "commandLayer.fetchVSCodeCommands", "filter": "git" },
      { "title": "Python", "from": "commandLayer.fetchVSCodeCommands", "filter": "python" }
  ]}
]
```
