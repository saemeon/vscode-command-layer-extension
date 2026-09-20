# Command Layer

Wire any VS Code command to a trigger, entirely in `settings.json`.
No code, no build step, no dependencies.

Command Layer does one thing: **resolve arguments from context and
dispatch a command.** It runs no processes, manages no terminals, and
writes no files. The commands come from VS Code and from the extensions
you already have.

It's useful in two ways.

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

The extension id is **`saemeon.command-layer`**: it is the authority of every
URI below, and the macOS launcher decides whether to offer its VS Code bridge
rows by looking for it in `~/.vscode/extensions`. To install from a `.vsix`
or from a clone of this repository instead, see
[CONTRIBUTING.md](CONTRIBUTING.md).

All configuration starts empty. Nothing happens until you add actions,
and a link from outside VS Code can run any command, see
[From outside VS Code](#from-outside-vs-code).

## How it works

**trigger** → **resolve** → **dispatch**

- **Trigger** — a pattern matching text, a selection, a file, terminal
  output, an editor event, or a direct invocation from the palette, a
  keybinding, the status bar, or a view.
- **Resolve** — placeholders in the action's arguments are filled in:
  capture groups (`$1`), context variables (`${file}`,
  `${selectedText}`), a prompt (`${input:...}`, `${pick:a,b}`), another
  command's return value (`${command:...}`).
- **Dispatch** — the command runs with those arguments.

## Actions

An action is one command plus its arguments.

| Field | Meaning |
|---|---|
| `command` | Any VS Code command id. |
| `args` | Arguments, in order. Strings are templates; `["uri", tpl]` and friends are typed. |
| `title` | Label in pickers, CodeLens, hovers, menus. |
| `when` | Optional conditions — see below. |

An action with no arguments can be written as a bare command id:

```jsonc
"actions": ["editor.action.formatDocument"]
```

### Arguments

`args` maps positionally onto the command's parameters:

```jsonc
{ "command": "vscode.diff", "args": [["uri", "$1"], ["uri", "$2"], "Comparison"] }
```

Placeholders resolve when the command runs. This is the thing
`keybindings.json` can't do — its `args` are static literals, with no
substitution.

| Placeholder | |
|---|---|
| `$0` `$1` `$2` … | capture groups from `match` (`$0` is the whole match) |
| `${file}` `${fileBasename}` `${fileBasenameNoExtension}` | active or clicked file |
| `${fileDirname}` `${fileExtname}` | |
| `${relativeFile}` `${relativeFileDirname}` | relative to the workspace |
| `${workspaceFolder}` `${workspaceFolderBasename}` | |
| `${selectedText}` `${selectedTextList}` `${selectedTextSection}` | first / space-joined / newline-joined |
| `${lineNumber}` `${lineNumbers}` `${columnNumber}` `${columnNumbers}` | |
| `${selectedFile}` `${selectedFiles}` | Explorer selection, quoted |
| `${homedir}` `${tmpdir}` `${platform}` | |
| `${clipboard}` | current clipboard contents |
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

`object` is the important one — many commands take a single options
object rather than positional strings:

```jsonc
{ "command": "workbench.action.findInFiles",
  "args": [["object", { "isRegex": true, "query": ["regex", "$1"] }]] }
```

Its template may be a **structure** (preferred — nothing is parsed, so
nothing needs escaping) or a **string** that gets parsed, in which case
substituted values are escaped for you. Typed arguments **compose**:
`["regex", "$1"]` above escapes that one value while the surrounding
structure stays intact.

### Running several commands

Use VS Code's own `runCommands`. Substitution works inside it:

```jsonc
{
  "title": "Save and format",
  "command": "runCommands",
  "args": [["object", {
    "commands": [
      "workbench.action.files.saveAll",
      "editor.action.formatDocument"
    ]
  }]]
}
```

Command Layer adds no sequencing of its own. `runCommands` runs commands
in order and stops on failure; anything beyond that — waiting, retrying,
branching — belongs in the thing being run.

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
the views.

Each list has a matching menu entry named after it — **Text Actions...**,
**File Actions...**, **Selection Actions...**, **Global Actions...** —
plus **All Actions...**, which shows everything applicable in one
picker, grouped and narrowest first:

```
Text ──────────────
  Reveal in File Explorer
Selection ─────────
  Copy as Markdown block
File ──────────────
  Copy path
Global ────────────
  Open notes
```

All of them always show a picker, even with one action, so a generic
entry never does something unannounced. The same goes for clicking a
**link**, in a document or in terminal output: a link shows the matched
text, not which action will run.

Clicking something that *names* its action runs it directly — a
CodeLens, a hover entry, a lightbulb entry, a status bar button, a view
item.

**`match` narrows, `when` scopes.** `match` is a pattern that also binds
capture groups — required where nothing else anchors an entry, optional
where something already does. `when` is a condition: language, path
glob, environment variable, setting.

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

One matching action runs directly; several show a picker.
Fields: `match`, `flags`, `when`, `show`, `decoration`, `actions`.

### File and selection actions

Always offered; add `match` to narrow an entry.

```jsonc
{
  "commandLayer.fileActions": [
    { "title": "Copy path", "command": "commandLayer.copyToClipboard", "args": ["${file}"] },
    { "title": "Copy all selected", "command": "commandLayer.copyToClipboard", "args": ["${selectedFiles}"] },
    { "title": "Open notebook", "match": "\\.ipynb$",
      "command": "vscode.open", "args": [["uri", "${file}"]] }
  ],

  "commandLayer.selectionActions": [
    { "title": "Copy as Markdown block", "command": "commandLayer.copyToClipboard",
      "args": ["```\n${selectedText}\n```"] },
    { "title": "Open issue", "match": "ISSUE-(\\d+)",
      "command": "commandLayer.openExternal", "args": ["https://example.com/browse/ISSUE-$1"] }
  ]
}
```

A selection entry **with** a `match` runs once per selection, each with
its own capture groups — so multi-cursor works. One **without** runs
once, with `${selectedText}` and `${selectedTextSection}` covering the
rest.

### Global actions

Anchored to nothing — reachable from the palette, a view, or a keybinding. Give one an `id` and it registers as a real command id:

```jsonc
// settings.json
{ "id": "openNotes", "title": "Open notes", "command": "vscode.open",
  "args": [["uri", "${workspaceFolder}/NOTES.md"]] }

// keybindings.json
{ "key": "ctrl+alt+n", "command": "commandLayer.action.openNotes" }
```

### Status bar

```jsonc
{
  "commandLayer.statusBarActions": [
    { "text": "$(rocket) Deploy", "command": "workbench.action.tasks.runTask", "args": ["deploy"] },

    { "text": "$(zap) Py", "alignment": "left", "when": { "language": ["python"] },
      "actions": [
        "editor.action.formatDocument",
        { "title": "Test", "command": "workbench.action.tasks.runTask", "args": ["pytest"] }
      ] }
  ]
}
```

`text` takes codicons. An entry with `actions` opens a picker instead of
running one command. Both the button and each entry accept `when`.

### Event actions

The only actions that run without you initiating them.

```jsonc
{
  "commandLayer.eventActions": [
    { "on": "workspaceOpen", "title": "Pull", "command": "git.pull", "confirm": true },
    { "on": "fileSave", "title": "Organise imports",
      "command": "editor.action.organizeImports", "when": { "language": ["python"] } }
  ]
}
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
| Terminal right-click | **Global Actions...** |
| Command Palette | **Global Actions...** |
| Keybinding | `commandLayer.action.<id>` |
| Status bar | configured buttons |
| Views | any configured node |
| Editor events | `workspaceOpen`, `fileSave` |

File actions are multi-select aware: right-click five files and
`${selectedFiles}` holds all five, quoted and space-joined.

## Surfaces

A `textActions` entry is one subject with several renderings. `show`
picks which:

| Surface | Appearance |
|---|---|
| `link` | Underlined, ctrl-clickable |
| `codeLens` | Clickable line above the match |
| `codeAction` | In the lightbulb / Quick Fix menu |
| `hover` | Clickable links on mouse hover |
| `decoration` | Styled in place — visual only, no click |

```jsonc
{ "match": "TODO\\(([^)]+)\\)", "show": ["codeLens", "decoration"],
  "decoration": { "color": "#e5c07b", "fontWeight": "bold" },
  "actions": [ { "title": "Copy owner", "command": "commandLayer.copyToClipboard", "args": ["$1"] } ] }
```

Without `show`, an entry uses the defaults:

```jsonc
{
  "commandLayer.defaults.surfaces": ["link", "codeLens", "codeAction", "hover"],
  "commandLayer.defaults.decorationStyle": { "textDecoration": "underline dotted" }
}
```

`decoration` is left out because highlighting every match is intrusive.
`show: []` means the entry appears nowhere — useful while testing one in
isolation.

Surfaces apply to `textActions` only. The other lists have one
appearance each: a picker entry, a terminal link, a button.

### The editor tab-bar button

Empty by default, so no button appears. Give it an action and it shows
up at the top-right of the editor:

```jsonc
{
  "commandLayer.editorTitleAction": {
    "command": "commandLayer.runAllActions",
    "tooltip": "Command Layer"
  }
}
```

Any command works, not just the pickers — `when` applies too, so the
button can come and go with context.

## Views

Two containers, each filled by its own setting, each appearing only when
its setting is non-empty:

```jsonc
{
  "commandLayer.explorerView": [ ... ],      // a panel in the Explorer sidebar
  "commandLayer.activityBarView": [ ... ]    // its own Activity Bar icon
}
```

VS Code also lets you drag either view to the secondary sidebar or
anywhere else.

A node is one of four things:

```jsonc
"commandLayer.explorerView": [
  "workbench.action.reloadWindow",                                  // leaf
  { "title": "Deploy", "command": "workbench.action.tasks.runTask", "args": ["deploy"] },

  { "title": "Project", "children": [                               // group — nests
      { "title": "Build", "children": ["workbench.action.tasks.build"] }
  ]},

  { "title": "Tasks", "from": "commandLayer.fetchVSCodeTasks" },    // group — filled

  { "title": "Git", "children": [                                   // two sources, one flat list
      { "from": "commandLayer.fetchVSCodeCommands", "filter": "git" },
      { "from": "commandLayer.fetchGlobalActions", "filter": "git" }
  ]},

  { "from": "commandLayer.fetchFrequentActions", "limit": 5 }       // fragment — splices in
]
```

**A `title` makes a level.** A node with `from` and no `title` is a
fragment: its entries splice into the parent rather than nesting. Same
source, same filter — the `title` alone decides.

`filter` (substring of the visible label, case-insensitive), `limit` and
`when` apply to any node. A node uses `from` **or** `children`, never
both.

### List providers

`from` is a **command id** returning a list of actions. These ship with
Command Layer:

| | |
|---|---|
| `commandLayer.fetchGlobalActions` | your global actions |
| `commandLayer.fetchFileActions` | your file actions |
| `commandLayer.fetchSelectionActions` | your selection actions |
| `commandLayer.fetchTextActions` | actions from your text entries |
| `commandLayer.fetchTerminalActions` | actions from your terminal entries |
| `commandLayer.fetchVSCodeCommands` | every command registered in VS Code |
| `commandLayer.fetchVSCodeTasks` | your `tasks.json` tasks |
| `commandLayer.fetchFrequentActions` | what you run most, in this workspace |

Any command returning an array of actions works — a bare command id
string, or `{ title, command, args }`. So another extension, or a few
lines in `utils.js`, can supply a list without changing anything here.

`fetchVSCodeCommands` answers the hardest problem: you can't bind a
command you've never heard of. Point a filtered group at an extension's
prefix — `git.`, `python.` — to see what it offers, click one to try it,
then right-click to **Copy Command Id** or **Copy Action Stub** and
paste it into your settings.

## Built-in commands

Two, for things VS Code exposes only as an API and not as a command:

| Command | Does |
|---|---|
| `commandLayer.openExternal` | Hands a URI to the **OS's own handler** — registered protocols (`obsidian://`, `slack://`) and a file's default desktop app |
| `commandLayer.copyToClipboard` | Copies a string. VS Code's clipboard commands act on the selection; none takes a value |

### Opening things

Three jobs, easy to confuse:

| Goal | Command |
|---|---|
| Show a file or folder in Explorer / Finder | `revealFileInOS` |
| Open a file in VS Code, or a URL in the browser | `vscode.open` |
| Open a file in its **default desktop app**, or launch a tool by protocol | `commandLayer.openExternal` |

## Running shell commands

Command Layer doesn't run processes. VS Code has two native ways, both
reachable as ordinary commands.

**Tasks**, for anything repeatable — you get `cwd`, environment, problem
matchers, and `dependsOn` for ordering:

```jsonc
// tasks.json
{ "label": "deploy", "dependsOrder": "sequence", "dependsOn": ["build", "test"],
  "type": "shell", "command": "npm run deploy" }

// settings.json
{ "command": "workbench.action.tasks.runTask", "args": ["deploy"] }
```

**`sendSequence`**, for one-offs built from captures:

```jsonc
{ "command": "workbench.action.terminal.sendSequence",
  "args": [["object", { "text": "python plot.py \"$1\"\u000D" }]] }
```

`\u000D` is the carriage return that submits the line. It goes to the
active terminal, so open one first. Ordering belongs in the shell:

```jsonc
{ "command": "workbench.action.terminal.sendSequence",
  "args": [["object", { "text": "python plot.py && code plot.png\u000D" }]] }
```

`&&` guarantees the ordering; `code` opens the result in the running
window. Note `&&` differs across `cmd`, PowerShell and POSIX shells.

## Optional utilities

`utils.js` ships alongside the extension but isn't part of it. It loads
only when enabled, and registers nothing otherwise:

```jsonc
{ "commandLayer.utils.enabled": true }   // requires a reload
```

| Command | Does |
|---|---|
| `commandLayer.util.searchSelection` | Search the workspace for the selection, ignoring spacing |
| `commandLayer.util.searchSelectionExact` | Same, matching literally |
| `commandLayer.util.writeFile` | `[path, content]` |

Conveniences that would otherwise mean installing a separate extension
for a one-liner. What belongs there: pure functions, or thin wrappers
over a `vscode.*` API. Not: anything running a shell command, and
nothing an existing extension already does properly.

## From outside VS Code

A URI handler lets another program — a launcher, a script, `open` on
macOS, a link in a Markdown file — run any VS Code command, with arguments,
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

Your own global actions are commands too: an entry with an `id` in
`commandLayer.globalActions` is `commandLayer.action.<id>`, so
`?command=commandLayer.action.openNotes` runs it. A task is
`?command=workbench.action.tasks.runTask&args0=build`, the label as **Run
Task** shows it.

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

### The macOS launcher's rows

While the extension is installed, the launcher in this repository
(`extensions/vscodebridge.lua`) offers four rows, each opening one of these
URIs:

| Row | Sends |
|---|---|
| VS Code: Find in files for "…" | `?command=workbench.action.findInFiles&args0={"query":"…","triggerSearch":true}` |
| VS Code: Go to file "…" | `?command=workbench.action.quickOpen&args0=…` |
| VS Code: Run task… | `?command=workbench.action.tasks.runTask&args0=<label>` |
| VS Code: Run command… | `?command=<id>` |

### Examples

Open a folder in a new window. The arguments are `["uri", "/Users/me/my
project"]` and `{"forceNewWindow": true}`, each JSON encoded once:

```sh
open 'vscode://saemeon.command-layer?command=vscode.openFolder&args0=%5B%22uri%22%2C%22%2FUsers%2Fme%2Fmy%20project%22%5D&args1=%7B%22forceNewWindow%22%3Atrue%7D'
```

Open Quick Open with `README` typed in:

```sh
open 'vscode://saemeon.command-layer?command=workbench.action.quickOpen&args0=README'
```

Run the `build` task:

```sh
open 'vscode://saemeon.command-layer?command=workbench.action.tasks.runTask&args0=build'
```

As a link in a Markdown file:

```md
[Build](vscode://saemeon.command-layer?command=workbench.action.tasks.runTask&args0=build)
```

## Validation

Configuration is checked on startup and whenever settings change. An
invalid regex, an action with no command, a `textActions` entry with no
`match`, a duplicate id, a `from` naming a command that doesn't exist —
each produces one consolidated warning with a **Show Details** button
opening the **Command Layer** output channel. Invalid entries are
skipped; the rest keep working. Nothing is shown when the configuration
is clean.

Errors from an action surface as a notification with a **Show Details**
button; nothing fails silently.

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
