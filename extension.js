const vscode = require('vscode');
const path = require('path');
const os = require('os');

// =====================================================================
// Command Layer
//
// Resolve arguments from context, and dispatch a command. Nothing here
// runs processes, manages terminals, or writes files — the commands
// come from VS Code and from the extensions you already have.
//
// Every setting is a list of actions, named for what triggers it:
//
//   textActions      a pattern matches in document text   (match required)
//   terminalActions  a pattern matches in terminal output (match required)
//   fileActions      a file is the target                 (match optional)
//   selectionActions there is a selection                 (match optional)
//   globalActions    invoked by name, anchored to nothing (no match)
//   statusBarActions a button is clicked                  (no match)
//   eventActions     an editor event fires                (no match)
//
// `match` narrows an entry to a pattern and binds capture groups.
// `when`  scopes an entry to a language, path, env or setting.
// =====================================================================

// ---------------------------------------------------------------- log

let outputChannel;

function getOutputChannel() {
  if (!outputChannel) outputChannel = vscode.window.createOutputChannel('Command Layer');
  return outputChannel;
}

function log(level, message) {
  const stamp = new Date().toLocaleTimeString();
  getOutputChannel().appendLine(`[${stamp}] ${`[${level}]`.padEnd(7)} ${String(message)}`);
}

function looksLikeUri(value) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value);
}

// =====================================================================
// RESOLVE — placeholders in an action's arguments
// =====================================================================

// Async because ${input}/${pick} prompt and ${command:} runs a command.
async function resolvePlaceholder(groups, ctx) {
  if (groups.idx !== undefined) {
    return ctx.match?.[Number(groups.idx)] ?? '';
  }

  const raw = groups.varName;
  if (typeof raw !== 'string') return '';

  const sep = raw.indexOf(':');
  const name = (sep === -1 ? raw : raw.slice(0, sep)).trim();
  const arg = sep === -1 ? '' : raw.slice(sep + 1).trim();

  switch (name) {
    case 'env':
      return process.env[arg] ?? '';
    case 'config':
      return String(vscode.workspace.getConfiguration().get(arg) ?? '');
    case 'clipboard':
      return await vscode.env.clipboard.readText();
    case 'input': {
      // arg, if given, is the default used when the box is submitted empty.
      const entered = await vscode.window.showInputBox({
        placeHolder: arg ? `default: "${arg}"` : undefined,
        prompt: 'Command Layer',
      });
      return entered || arg;
    }
    case 'pick': {
      const choices = arg.split(',').map((c) => c.trim()).filter(Boolean);
      if (choices.length === 0) return '';
      const picked = await vscode.window.showQuickPick(choices, {
        placeHolder: 'Command Layer: choose a value',
      });
      return picked ?? '';
    }
    case 'command':
      return arg ? String((await vscode.commands.executeCommand(arg)) ?? '') : '';
    default:
      return ctx.vars?.[name] ?? '';
  }
}

// `escape`, when given, is applied to each resolved value — never to the
// literal template text.
async function substituteGroups(template, ctx, escape) {
  const regex = /\\\$|\$(?:(?<idx>\d+)|\{(?<varName>[^}]+)\})/g;
  let out = '';
  let idx = 0;
  let m;

  while ((m = regex.exec(template)) !== null) {
    out += template.slice(idx, m.index);
    if (m[0] === '\\$') {
      out += '$';
    } else {
      const value = await resolvePlaceholder(m.groups, ctx);
      out += escape ? escape(value) : value;
    }
    idx = m.index + m[0].length;
  }

  return out + template.slice(idx);
}

// Escapes a value for embedding in a regular expression, so captured
// text matches literally instead of altering the pattern.
function regexEscape(value) {
  return String(value).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

// Escapes a value for embedding in a quoted string in a serialised
// structure. Only needed for the string form of an object template; a
// structure template is never parsed.
function jsonStringEscape(value) {
  return JSON.stringify(String(value)).slice(1, -1);
}

const ARG_TYPES = ['string', 'uri', 'object', 'number', 'boolean', 'regex'];

// A two-element array whose first element names a type is a typed arg,
// so typed args compose inside object templates:
//   ["object", { "query": ["regex", "$1"] }]
function isTypedArg(node) {
  return Array.isArray(node) && node.length === 2 && ARG_TYPES.includes(node[0]);
}

// Substitutes into a structure, leaving it intact. Preferred over the
// string form: nothing is parsed, so nothing needs escaping.
async function deepSubstitute(node, ctx) {
  if (typeof node === 'string') return substituteGroups(node, ctx);
  if (isTypedArg(node)) return resolveArg(node, ctx);
  if (Array.isArray(node)) return Promise.all(node.map((n) => deepSubstitute(n, ctx)));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = await deepSubstitute(v, ctx);
    return out;
  }
  return node;
}

async function resolveArg(argSpec, ctx) {
  if (Array.isArray(argSpec)) {
    const [type, template] = argSpec;

    if (type === 'object' && template !== null && typeof template === 'object') {
      return deepSubstitute(template, ctx);
    }

    const escape =
      type === 'object' ? jsonStringEscape : type === 'regex' ? regexEscape : undefined;
    const value = await substituteGroups(template, ctx, escape);

    switch (type) {
      case 'uri':
        return looksLikeUri(value) ? vscode.Uri.parse(value) : vscode.Uri.file(value);
      case 'object':
        try {
          return JSON.parse(value);
        } catch (err) {
          throw new Error(
            `invalid structure after substitution: ${err.message}. ` +
              `Write it as a structure instead: ["object", { "key": "$1" }]. Result was: ${value}`
          );
        }
      case 'number':
        return Number(value);
      case 'boolean':
        return value === 'true';
      default:
        return value;
    }
  }
  if (typeof argSpec === 'string') return substituteGroups(argSpec, ctx);
  return argSpec;
}

// =====================================================================
// ACTIONS
// =====================================================================

// A bare command id is shorthand for { "command": "..." }.
function normalizeAction(a) {
  return typeof a === 'string' ? { command: a } : a;
}

function isRunnableAction(a) {
  const x = normalizeAction(a);
  return !!x && typeof x.command === 'string';
}

function actionLabel(a) {
  const x = normalizeAction(a);
  return x.title || x.command || 'Command Layer';
}

// ctx = { match, vars }. `match` holds capture groups from a pattern;
// `vars` holds file/selection variables.
async function runAction(rawAction, ctx) {
  const action = normalizeAction(rawAction);
  recordUse(action);
  const args = await Promise.all((action.args || []).map((x) => resolveArg(x, ctx)));
  return vscode.commands.executeCommand(action.command, ...args);
}

// =====================================================================
// SCOPING — `when`
// =====================================================================

function matchesGlob(globs, uri) {
  const list = Array.isArray(globs) ? globs : [globs];
  return list.some((g) => {
    if (typeof g !== 'string') return false;
    try {
      return vscode.languages.match({ pattern: g }, { uri, languageId: '', version: 0 }) > 0;
    } catch {
      return false;
    }
  });
}

function evaluateWhen(entry, document, uri) {
  const when = entry?.when;
  if (!when) return true;

  if (Array.isArray(when.language) && when.language.length > 0) {
    if (!document || !when.language.includes(document.languageId)) return false;
  }

  const target = uri || document?.uri;
  if (when.include && (!target || !matchesGlob(when.include, target))) return false;
  if (when.exclude && target && matchesGlob(when.exclude, target)) return false;

  if (when.env) {
    for (const [key, expected] of Object.entries(when.env)) {
      if (process.env[key] !== expected) return false;
    }
  }
  if (when.config) {
    for (const [key, expected] of Object.entries(when.config)) {
      if (vscode.workspace.getConfiguration().get(key) !== expected) return false;
    }
  }
  return true;
}

// =====================================================================
// THE LISTS
// =====================================================================

function readList(key) {
  const value = vscode.workspace.getConfiguration('commandLayer').get(key);
  return Array.isArray(value) ? value : [];
}

// textActions and terminalActions require a pattern; without one they
// could never fire.
function getTextActions() {
  return readList('textActions').filter(
    (e) => e && typeof e.match === 'string' && Array.isArray(e.actions) && e.actions.some(isRunnableAction)
  );
}

function getTerminalActions() {
  return readList('terminalActions').filter(
    (e) => e && typeof e.match === 'string' && Array.isArray(e.actions) && e.actions.some(isRunnableAction)
  );
}

// fileActions and selectionActions are always offered; `match` narrows
// them to a pattern and binds capture groups when present.
function getFileActions(uri) {
  return readList('fileActions').filter(
    (a) => isRunnableAction(a) && evaluateWhen(normalizeAction(a), undefined, uri)
  );
}

function getSelectionActions(document) {
  return readList('selectionActions').filter(
    (a) => isRunnableAction(a) && evaluateWhen(normalizeAction(a), document)
  );
}

function getGlobalActions(document) {
  return readList('globalActions').filter(
    (a) => isRunnableAction(a) && evaluateWhen(normalizeAction(a), document)
  );
}

function getStatusBarActions() {
  return readList('statusBarActions');
}

function getEventActions() {
  return readList('eventActions').filter((a) => isRunnableAction(a));
}

// An entry with a `match` only applies when the pattern hits its
// subject; the capture groups then become $1, $2, ... Without a match
// the entry always applies and has no capture groups.
function narrowByMatch(entry, subject) {
  const e = normalizeAction(entry);
  if (typeof e.match !== 'string') return { applies: true, match: undefined };
  let regex;
  try {
    regex = buildRegex(e);
  } catch {
    return { applies: false };
  }
  regex.lastIndex = 0;
  const m = regex.exec(subject);
  return m ? { applies: true, match: [...m] } : { applies: false };
}

// =====================================================================
// SURFACES — five renderings of a textActions match
// =====================================================================

const TEXT_SURFACES = ['link', 'codeLens', 'codeAction', 'hover', 'decoration'];

function defaultSurfaces() {
  const value = vscode.workspace
    .getConfiguration('commandLayer')
    .get('defaults.surfaces', ['link', 'codeLens', 'codeAction', 'hover']);
  return Array.isArray(value) ? value : [];
}

function showsOn(entry, surface) {
  if (Array.isArray(entry.show)) return entry.show.includes(surface);
  return defaultSurfaces().includes(surface);
}

function buildRegex(entry) {
  let flags = entry.flags || 'g';
  if (!flags.includes('g')) flags += 'g';
  return new RegExp(entry.match, flags);
}

// Bumped when settings change, so cached matches from old entries are
// discarded.
let configGeneration = 0;
const matchCache = new Map();

// updateCursorContext runs on every cursor move, so matches are cached
// rather than recomputed. Keyed by document version, so an edit
// invalidates them automatically.
function findAllMatches(document) {
  const key = `${document.uri.toString()}:${document.version}:${configGeneration}`;
  const hit = matchCache.get(key);
  if (hit) return hit;

  const result = computeAllMatches(document);
  if (matchCache.size > 16) matchCache.clear();
  matchCache.set(key, result);
  return result;
}

function computeAllMatches(document) {
  const text = document.getText();
  const results = [];

  getTextActions().forEach((entry, entryIndex) => {
    if (!evaluateWhen(entry, document)) return;

    let regex;
    try {
      regex = buildRegex(entry);
    } catch {
      return;
    }

    let m;
    while ((m = regex.exec(text)) !== null) {
      const range = new vscode.Range(
        document.positionAt(m.index),
        document.positionAt(m.index + m[0].length)
      );
      results.push({ entryIndex, entry, match: [...m], range });
      if (m[0].length === 0) regex.lastIndex++;
    }
  });

  return results;
}

// Clicking a link opens a picker rather than going somewhere, unlike
// every other link in VS Code — so the tooltip says so, in the same
// wording as the lightbulb.
const LINK_TOOLTIP = 'Command Layer: Show Actions';

class LinkProvider {
  provideDocumentLinks(document) {
    return findAllMatches(document)
      .filter(({ entry }) => showsOn(entry, 'link'))
      .map(({ entryIndex, match, range }) => {
        const args = encodeURIComponent(JSON.stringify([entryIndex, match]));
        const link = new vscode.DocumentLink(
          range,
          vscode.Uri.parse(`command:commandLayer.runTextActions?${args}`)
        );
        link.tooltip = LINK_TOOLTIP;
        return link;
      });
  }
}

class ActionCodeLensProvider {
  provideCodeLenses(document) {
    const lenses = [];
    findAllMatches(document).forEach(({ entryIndex, entry, match, range }) => {
      if (!showsOn(entry, 'codeLens')) return;
      entry.actions.forEach((action, actionIndex) => {
        lenses.push(
          new vscode.CodeLens(range, {
            title: actionLabel(action),
            command: 'commandLayer.triggerAction',
            arguments: [entryIndex, actionIndex, match],
          })
        );
      });
    });
    return lenses;
  }
}

class ActionCodeActionProvider {
  provideCodeActions(document, range) {
    const codeActions = [];
    findAllMatches(document).forEach(({ entryIndex, entry, match, range: matchRange }) => {
      if (!showsOn(entry, 'codeAction')) return;
      if (!matchRange.intersection(range)) return;
      entry.actions.forEach((action, actionIndex) => {
        const codeAction = new vscode.CodeAction(actionLabel(action), vscode.CodeActionKind.Empty);
        codeAction.command = {
          title: actionLabel(action),
          command: 'commandLayer.triggerAction',
          arguments: [entryIndex, actionIndex, match],
        };
        codeActions.push(codeAction);
      });
    });
    return codeActions;
  }
}

class ActionHoverProvider {
  provideHover(document, position) {
    const lines = [];
    let hoverRange;
    findAllMatches(document).forEach(({ entryIndex, entry, match, range }) => {
      if (!showsOn(entry, 'hover')) return;
      if (!range.contains(position)) return;
      hoverRange = range;
      entry.actions.forEach((action, actionIndex) => {
        const args = encodeURIComponent(JSON.stringify([entryIndex, actionIndex, match]));
        lines.push(`[${actionLabel(action)}](command:commandLayer.triggerAction?${args})`);
      });
    });

    if (lines.length === 0) return undefined;
    const md = new vscode.MarkdownString(lines.join(' &nbsp;|&nbsp; '));
    md.isTrusted = true; // required for command: links in a hover
    return new vscode.Hover(md, hoverRange);
  }
}

// Terminal output is its own list — a different subject, not a surface.
class ActionTerminalLinkProvider {
  provideTerminalLinks(context) {
    const links = [];

    getTerminalActions().forEach((entry, entryIndex) => {
      if (!evaluateWhen(entry, undefined)) return;

      let regex;
      try {
        regex = buildRegex(entry);
      } catch {
        return;
      }
      let m;
      while ((m = regex.exec(context.line)) !== null) {
        links.push({
          startIndex: m.index,
          length: m[0].length,
          tooltip: LINK_TOOLTIP,
          data: { entryIndex, match: [...m] },
        });
        if (m[0].length === 0) regex.lastIndex++;
      }
    });

    return links;
  }

  handleTerminalLink(link) {
    const entry = getTerminalActions()[link.data.entryIndex];
    if (entry) runEntry(entry, link.data.match);
  }
}

// =====================================================================
// DISPATCH
// =====================================================================

// One action runs directly; several show a picker.
// Two ways to offer a set of actions.
//
// runOne: the caller already named a specific thing — a link, a
// CodeLens, a status bar button with its own label. One action runs
// straight away.
//
// alwaysPick: the caller is a generic menu entry. It always shows the
// picker, even with a single action, because a button labelled
// "File Actions..." that silently does something is worse than one that
// shows you what it will do.
async function runOne(entries, emptyMessage) {
  if (entries.length === 0) {
    if (emptyMessage) vscode.window.showInformationMessage(emptyMessage);
    return;
  }
  if (entries.length === 1) {
    await entries[0].run();
    return;
  }
  await showPicker(entries);
}

async function alwaysPick(entries, emptyMessage) {
  if (entries.length === 0) {
    if (emptyMessage) vscode.window.showInformationMessage(emptyMessage);
    return;
  }
  await showPicker(entries);
}

async function showPicker(entries) {
  const picked = await vscode.window.showQuickPick(entries, {
    placeHolder: 'Command Layer: choose an action',
  });
  if (picked) await picked.run();
}

// A link — in a document or in terminal output — shows the matched
// text, not which action will run, so it always offers the picker. A
// CodeLens, hover or lightbulb entry names its action, and those go
// through triggerAction instead.
async function runEntry(entry, match) {
  await alwaysPick(
    entry.actions.map((action) => ({
      label: actionLabel(action),
      run: () => runAction(action, { match }),
    })),
    'Command Layer: this entry has no actions configured.'
  );
}

let cursorMatch = null;

function updateCursorContext(editor) {
  if (!editor) {
    cursorMatch = null;
    vscode.commands.executeCommand('setContext', 'commandLayer.hasMatch', false);
    return;
  }
  const pos = editor.selection.active;
  const hit = findAllMatches(editor.document).find((m) => m.range.contains(pos));
  cursorMatch = hit || null;
  vscode.commands.executeCommand('setContext', 'commandLayer.hasMatch', !!hit);
}

function editorTitleAction() {
  const cfg = vscode.workspace.getConfiguration('commandLayer').get('editorTitleAction');
  return cfg && typeof cfg.command === 'string' ? cfg : undefined;
}

// The tab-bar button appears only once an action is configured for it,
// so an empty config adds no chrome.
function updateEditorTitleContext() {
  const cfg = editorTitleAction();
  const shows = !!cfg && evaluateWhen(cfg, vscode.window.activeTextEditor?.document);
  vscode.commands.executeCommand('setContext', 'commandLayer.hasEditorTitleAction', shows);
}

async function runEditorTitleAction() {
  const cfg = editorTitleAction();
  if (!cfg) {
    vscode.window.showInformationMessage(
      'Command Layer: set "commandLayer.editorTitleAction" to give this button something to do.'
    );
    return;
  }
  const editor = vscode.window.activeTextEditor;
  await runAction(cfg, { vars: editor ? buildVariableContext(editor) : {} });
}

async function runTextActions(entryIndex, match) {
  // With arguments: a link click.
  if (entryIndex !== undefined && match !== undefined) {
    const entry = getTextActions()[entryIndex];
    if (!entry) {
      vscode.window.showErrorMessage('Command Layer: settings changed since this file was opened — reopen it.');
      return;
    }
    await runEntry(entry, match);
    return;
  }
  // Without: the right-click entry, using the tracked cursor match.
  if (cursorMatch) await runEntry(cursorMatch.entry, cursorMatch.match);
}

// CodeLens, hover and code action clicks already name one action.
async function triggerAction(entryIndex, actionIndex, match) {
  const entry = getTextActions()[entryIndex];
  const action = entry && entry.actions[actionIndex];
  if (!action) {
    vscode.window.showErrorMessage('Command Layer: settings changed since this file was opened — reopen it.');
    return;
  }
  await runAction(action, { match });
}

// =====================================================================
// VARIABLES
// =====================================================================

function buildVariableContext(editor) {
  const document = editor.document;
  const filePath = document.uri.fsPath;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const workspacePath = workspaceFolder ? workspaceFolder.uri.fsPath : '';
  const selections = [...editor.selections].sort((a, b) => a.active.line - b.active.line);
  const nonEmpty = selections.filter((sl) => !sl.isEmpty);

  return {
    file: filePath,
    fileBasename: path.basename(filePath),
    fileBasenameNoExtension: path.basename(filePath, path.extname(filePath)),
    fileDirname: path.dirname(filePath),
    fileExtname: path.extname(filePath),
    relativeFile: workspacePath ? path.relative(workspacePath, filePath) : filePath,
    relativeFileDirname: workspacePath
      ? path.dirname(path.relative(workspacePath, filePath))
      : path.dirname(filePath),
    workspaceFolder: workspacePath,
    workspaceFolderBasename: workspacePath ? path.basename(workspacePath) : '',
    selectedText: nonEmpty.length ? document.getText(nonEmpty[0]) : '',
    lineNumber: String(selections[0].active.line + 1),
    columnNumber: String(selections[0].active.character),
    selectedTextList: nonEmpty.map((sl) => document.getText(sl)).join(' '),
    selectedTextSection: nonEmpty.map((sl) => document.getText(sl)).join('\n').trim(),
    lineNumbers: selections.map((sl) => sl.active.line + 1).join(),
    columnNumbers: selections.map((sl) => sl.active.character).join(),
    homedir: os.homedir(),
    tmpdir: os.tmpdir(),
    platform: os.platform(),
  };
}

// Menus pass different shapes: Explorer and editor/title give a Uri,
// scm/resourceState gives an object whose Uri is on .resourceUri.
function toUri(arg) {
  if (!arg) return undefined;
  if (arg.fsPath) return arg;
  if (arg.resourceUri?.fsPath) return arg.resourceUri;
  return undefined;
}

function buildResourceVariableContext(uri, allUris) {
  const filePath = uri.fsPath;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  const workspacePath = workspaceFolder ? workspaceFolder.uri.fsPath : '';

  return {
    file: filePath,
    fileBasename: path.basename(filePath),
    fileBasenameNoExtension: path.basename(filePath, path.extname(filePath)),
    fileDirname: path.dirname(filePath),
    fileExtname: path.extname(filePath),
    relativeFile: workspacePath ? path.relative(workspacePath, filePath) : filePath,
    relativeFileDirname: workspacePath
      ? path.dirname(path.relative(workspacePath, filePath))
      : path.dirname(filePath),
    workspaceFolder: workspacePath,
    workspaceFolderBasename: workspacePath ? path.basename(workspacePath) : '',
    homedir: os.homedir(),
    tmpdir: os.tmpdir(),
    platform: os.platform(),
    selectedFile: JSON.stringify(filePath),
    selectedFiles: (Array.isArray(allUris) ? allUris : [uri])
      .map(toUri)
      .filter(Boolean)
      .map((u) => JSON.stringify(u.fsPath))
      .join(' '),
  };
}

// =====================================================================
// SELECTION AND FILE
// =====================================================================

// Entries with a `match` run once per non-empty selection, each with its
// own capture groups; entries without one run once, with
// ${selectedText} and friends already covering multiple cursors.
// Each source builds its entries without showing a picker, so a single
// merged picker can offer all four together.

function selectionEntries() {
  const editor = vscode.window.activeTextEditor;
  const selections = (editor?.selections || [])
    .filter((sl) => !sl.isEmpty)
    .sort((x, y) => x.start.line - y.start.line);
  if (selections.length === 0) return [];

  const texts = selections.map((sl) => editor.document.getText(sl));
  const vars = buildVariableContext(editor);

  const entries = [];
  for (const raw of getSelectionActions(editor.document)) {
    const action = normalizeAction(raw);
    if (!narrowByMatch(action, texts[0]).applies) continue;

    entries.push({
      label: actionLabel(action),
      run: async () => {
        // An entry with a pattern runs once per selection, each with
        // its own capture groups; one without runs once.
        if (typeof action.match !== 'string') {
          await runAction(action, { vars });
          return;
        }
        for (const text of texts) {
          const each = narrowByMatch(action, text);
          if (each.applies) await runAction(action, { match: each.match, vars });
        }
      },
    });
  }
  return entries;
}

function fileEntries(rawUri, rawAll) {
  const allUris = Array.isArray(rawAll) ? rawAll : undefined;
  const targetUri = toUri(rawUri) || vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) return [];

  const vars = buildResourceVariableContext(targetUri, allUris);

  const entries = [];
  for (const raw of getFileActions(targetUri)) {
    const action = normalizeAction(raw);
    const narrowed = narrowByMatch(action, targetUri.fsPath);
    if (!narrowed.applies) continue;
    entries.push({
      label: actionLabel(action),
      run: () => runAction(action, { match: narrowed.match, vars }),
    });
  }
  return entries;
}

function globalEntries() {
  const editor = vscode.window.activeTextEditor;
  const vars = editor ? buildVariableContext(editor) : {};
  return getGlobalActions(editor?.document).map((raw) => {
    const action = normalizeAction(raw);
    return {
      label: actionLabel(action),
      description: action.title ? action.command : undefined,
      run: () => runAction(action, { vars }),
    };
  });
}

// The actions of whichever textActions match the cursor sits inside.
function textEntries() {
  if (!cursorMatch) return [];
  const { entry, match } = cursorMatch;
  return entry.actions.map((action) => ({
    label: actionLabel(action),
    run: () => runAction(action, { match }),
  }));
}

async function runSelectionActions() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selections.every((sl) => sl.isEmpty)) {
    vscode.window.showWarningMessage('Command Layer: no text selected.');
    return;
  }
  await alwaysPick(
    selectionEntries(),
    'Command Layer: nothing in "commandLayer.selectionActions" applies to this selection.'
  );
}

async function runFileActions(rawUri, rawAll) {
  const targetUri = toUri(rawUri) || vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) {
    vscode.window.showWarningMessage('Command Layer: no file or folder selected.');
    return;
  }
  await alwaysPick(
    fileEntries(rawUri, rawAll),
    'Command Layer: nothing in "commandLayer.fileActions" applies to this file.'
  );
}

// Everything applicable, grouped, narrowest first: what the cursor is
// on, then the selection, then the file, then what is always available.
async function runAllActions(rawUri, rawAll) {
  const groups = [
    ['Text', textEntries()],
    ['Selection', selectionEntries()],
    ['File', fileEntries(rawUri, rawAll)],
    ['Global', globalEntries()],
  ];

  const items = [];
  for (const [title, entries] of groups) {
    if (entries.length === 0) continue;
    items.push({ label: title, kind: vscode.QuickPickItemKind.Separator });
    items.push(...entries);
  }

  if (items.length === 0) {
    vscode.window.showInformationMessage('Command Layer: nothing applies here.');
    return;
  }

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Command Layer: choose an action',
  });
  if (picked && picked.run) await picked.run();
}

// =====================================================================
// GLOBAL ACTIONS
// =====================================================================

let globalActionDisposables = [];

// The ids currently registered as commandLayer.action.<id>. This set is
// the allow-list the URI handler checks against: an action you named in
// your own settings is one you meant to be reachable.
const globalActionIds = new Set();
let extensionContext;

async function runGlobalAction(action) {
  const editor = vscode.window.activeTextEditor;
  await runAction(action, { vars: editor ? buildVariableContext(editor) : {} });
}

async function runGlobalActionPicker() {
  const entries = globalEntries();
  if (entries.length === 0) {
    vscode.window.showInformationMessage(
      'Command Layer: nothing configured in "commandLayer.globalActions".'
    );
    return;
  }

  // Most-recently-used first, so what you reach for stops being buried.
  const recent = extensionContext?.workspaceState.get(MRU_KEY, []) || [];
  entries.sort((a, b) => {
    const ia = recent.indexOf(a.label);
    const ib = recent.indexOf(b.label);
    return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
  });

  const picked = await vscode.window.showQuickPick(entries, {
    placeHolder: 'Command Layer: choose an action',
  });
  if (!picked) return;

  if (extensionContext) {
    const next = [picked.label, ...recent.filter((l) => l !== picked.label)].slice(0, 20);
    extensionContext.workspaceState.update(MRU_KEY, next);
  }

  await picked.run();
}

// An entry with an `id` is registered as commandLayer.action.<id>, so a
// keybinding can target it directly.
function registerGlobalActionIds() {
  globalActionDisposables.forEach((d) => d.dispose());
  globalActionDisposables = [];
  globalActionIds.clear();

  const seen = new Set();
  readList('globalActions').forEach((raw) => {
    const a = normalizeAction(raw);
    if (!a || typeof a.id !== 'string' || !a.id || !isRunnableAction(a)) return;
    if (seen.has(a.id)) return;
    seen.add(a.id);
    try {
      globalActionDisposables.push(
        vscode.commands.registerCommand(`commandLayer.action.${a.id}`, () => runGlobalAction(a))
      );
      globalActionIds.add(a.id);
    } catch {
      // id already taken; validateConfig reports it
    }
  });
}

// =====================================================================
// USAGE — backs commandLayer.fetchFrequentActions
// =====================================================================

const MRU_KEY = 'commandLayer.recentActions';
const USAGE_KEY = 'commandLayer.actionUsage';

// Stores the whole action, not just its id — a frequent entry has to
// replay exactly what was run, arguments included. Argument templates
// are stored unresolved, so ${file} re-resolves against wherever you
// are next time.
function recordUse(action) {
  if (!extensionContext || typeof action?.command !== 'string') return;
  const usage = extensionContext.workspaceState.get(USAGE_KEY, {});
  const key = `${action.title || ''}\u0000${action.command}`;
  const previous = usage[key];
  usage[key] = {
    count: (previous?.count || 0) + 1,
    action: { title: action.title, command: action.command, args: action.args },
  };
  extensionContext.workspaceState.update(USAGE_KEY, usage);
}

function frequentActions() {
  if (!extensionContext) return [];
  const usage = extensionContext.workspaceState.get(USAGE_KEY, {});
  return Object.values(usage)
    .filter((e) => e && e.action && typeof e.action.command === 'string')
    .sort((a, b) => (b.count || 0) - (a.count || 0))
    .map((e) => e.action);
}

// =====================================================================
// FETCHERS — list providers, addressed by command id from a view's
// `from`. Any command returning an array of actions works here; these
// are the ones we ship.
// =====================================================================

async function fetchVSCodeCommands() {
  const all = await vscode.commands.getCommands(true);
  return all.filter((c) => !c.startsWith('_')).sort();
}

async function fetchVSCodeTasks() {
  try {
    const tasks = await vscode.tasks.fetchTasks();
    return tasks.map((t) => ({
      title: t.name,
      command: 'workbench.action.tasks.runTask',
      args: [t.name],
    }));
  } catch (err) {
    log('Warn', `could not fetch tasks: ${err}`);
    return [];
  }
}

// =====================================================================
// VIEWS
//
// A node is one of:
//   leaf      has `command` (or is a bare command id string)
//   group     has `title` and `children`  — nests
//   group     has `title` and `from`      — its own level, filled
//   fragment  has `from`, no `title`      — splices into its parent
//
// `filter` (on the visible label), `limit` and `when` apply to any node.
// =====================================================================

function viewNodes(viewKey) {
  return readList(viewKey);
}

function applyFilterAndLimit(node, entries) {
  let out = entries;
  if (typeof node.filter === 'string' && node.filter) {
    const needle = node.filter.toLowerCase();
    out = out.filter((e) => actionLabel(e).toLowerCase().includes(needle));
  }
  if (Number.isInteger(node.limit)) out = out.slice(0, node.limit);
  return out;
}

// Resolves a node's contents: either the actions a `from` provider
// returns, or its explicit `children`.
async function resolveNodeContents(node, document) {
  if (typeof node.from === 'string') {
    let produced;
    try {
      produced = await vscode.commands.executeCommand(node.from);
    } catch (err) {
      log('Warn', `"from": "${node.from}" failed — ${err}`);
      return [];
    }
    if (!Array.isArray(produced)) {
      log('Warn', `"from": "${node.from}" did not return a list`);
      return [];
    }
    return applyFilterAndLimit(node, produced);
  }

  if (Array.isArray(node.children)) {
    const out = [];
    for (const child of node.children) {
      const c = normalizeAction(child);
      if (!evaluateWhen(c, document)) continue;
      // A child with `from` and no title splices its entries in here.
      if (typeof c.from === 'string' && !c.title) {
        out.push(...(await resolveNodeContents(c, document)));
      } else {
        out.push(c);
      }
    }
    return applyFilterAndLimit(node, out);
  }

  return [];
}

function isGroup(node) {
  const n = normalizeAction(node);
  return !!n && (Array.isArray(n.children) || typeof n.from === 'string');
}

class CommandLayerTreeProvider {
  constructor(viewKey) {
    this.viewKey = viewKey;
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChange.event;
  }

  refresh() {
    this._onDidChange.fire();
  }

  getTreeItem(element) {
    return element;
  }

  async getChildren(element) {
    const document = vscode.window.activeTextEditor?.document;
    const nodes = element ? await resolveNodeContents(element.node, document) : viewNodes(this.viewKey);

    const items = [];
    for (const raw of nodes) {
      const node = normalizeAction(raw);
      if (!node || !evaluateWhen(node, document)) continue;

      // A top-level fragment splices its entries into the root.
      if (!element && typeof node.from === 'string' && !node.title) {
        for (const sub of await resolveNodeContents(node, document)) {
          items.push(this.leaf(normalizeAction(sub)));
        }
        continue;
      }

      items.push(isGroup(node) ? this.group(node) : this.leaf(node));
    }
    return items;
  }

  group(node) {
    const item = new vscode.TreeItem(
      node.title || 'Commands',
      vscode.TreeItemCollapsibleState.Collapsed
    );
    item.node = node;
    item.contextValue = 'commandLayerGroup';
    return item;
  }

  leaf(action) {
    const item = new vscode.TreeItem(actionLabel(action), vscode.TreeItemCollapsibleState.None);
    item.tooltip = action.command;
    item.commandId = action.command;
    item.iconPath = new vscode.ThemeIcon('play');
    item.contextValue = 'commandLayerAction';
    item.command = {
      title: actionLabel(action),
      command: 'commandLayer.runViewItem',
      arguments: [action],
    };
    return item;
  }
}

let treeProviders = [];

function refreshTrees() {
  treeProviders.forEach((p) => p.refresh());
}

async function runViewItem(action) {
  const editor = vscode.window.activeTextEditor;
  await runAction(action, { vars: editor ? buildVariableContext(editor) : {} });
}

function updateViewContexts() {
  vscode.commands.executeCommand(
    'setContext', 'commandLayer.hasExplorerView', viewNodes('explorerView').length > 0
  );
  vscode.commands.executeCommand(
    'setContext', 'commandLayer.hasActivityBarView', viewNodes('activityBarView').length > 0
  );
}

// =====================================================================
// STATUS BAR
// =====================================================================

let statusBarItems = [];

function rebuildStatusBar() {
  statusBarItems.forEach((i) => i.dispose());
  statusBarItems = [];

  getStatusBarActions().forEach((cfg, index) => {
    if (!cfg || typeof cfg.text !== 'string') return;
    const isMenu = Array.isArray(cfg.actions) && cfg.actions.length > 0;
    if (!isMenu && !isRunnableAction(cfg)) return;
    if (!evaluateWhen(cfg, vscode.window.activeTextEditor?.document)) return;

    const item = vscode.window.createStatusBarItem(
      cfg.alignment === 'left' ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right,
      typeof cfg.priority === 'number' ? cfg.priority : 0
    );
    item.text = cfg.text;
    item.tooltip = cfg.tooltip || cfg.title || 'Command Layer';
    item.command = {
      title: item.tooltip,
      command: 'commandLayer.runStatusBarAction',
      arguments: [index],
    };
    item.show();
    statusBarItems.push(item);
  });
}

async function runStatusBarAction(index) {
  const cfg = getStatusBarActions()[index];
  if (!cfg) return;

  const editor = vscode.window.activeTextEditor;
  const vars = editor ? buildVariableContext(editor) : {};

  if (Array.isArray(cfg.actions) && cfg.actions.length > 0) {
    const choices = cfg.actions
      .map(normalizeAction)
      .filter((a) => isRunnableAction(a) && evaluateWhen(a, editor?.document));
    await runOne(
      choices.map((a) => ({ label: actionLabel(a), description: a.detail, run: () => runAction(a, { vars }) })),
      'Command Layer: nothing available here.'
    );
    return;
  }

  await runAction(cfg, { vars });
}

// =====================================================================
// EVENTS
//
// The only actions that run without you initiating them. `confirm`
// asks first; every firing is logged either way.
// =====================================================================

const EVENTS = ['workspaceOpen', 'fileSave'];

function eventActionsFor(on, document) {
  return getEventActions().filter(
    (a) => a.on === on && evaluateWhen(normalizeAction(a), document)
  );
}

async function fireEvent(on, document) {
  const actions = eventActionsFor(on, document);
  if (actions.length === 0) return;

  const editor = vscode.window.activeTextEditor;
  const vars = document
    ? { file: document.uri.fsPath, fileBasename: path.basename(document.uri.fsPath) }
    : editor
      ? buildVariableContext(editor)
      : {};

  for (const raw of actions) {
    const action = normalizeAction(raw);
    if (action.confirm) {
      const choice = await vscode.window.showInformationMessage(
        `Command Layer: run "${actionLabel(action)}" on ${on}?`,
        'Run',
        'Skip'
      );
      if (choice !== 'Run') {
        log('Info', `${on}: skipped "${actionLabel(action)}"`);
        continue;
      }
    }
    log('Info', `${on}: running "${actionLabel(action)}"`);
    try {
      await runAction(action, { vars });
    } catch (err) {
      log('Error', `${on}: "${actionLabel(action)}" failed — ${err}`);
    }
  }
}

// =====================================================================
// DECORATIONS — the one purely visual surface
// =====================================================================

const decorationTypes = new Map();

function defaultDecorationStyle() {
  return vscode.workspace
    .getConfiguration('commandLayer')
    .get('defaults.decorationStyle', { textDecoration: 'underline dotted' });
}

function getDecorationType(key, style) {
  let type = decorationTypes.get(key);
  if (!type) {
    type = vscode.window.createTextEditorDecorationType({
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      ...style,
    });
    decorationTypes.set(key, type);
  }
  return type;
}

function updateDecorations(editor) {
  if (!editor) return;

  const byStyle = new Map();
  findAllMatches(editor.document).forEach(({ entry, range }) => {
    if (!showsOn(entry, 'decoration')) return;
    const style = entry.decoration || defaultDecorationStyle();
    const key = JSON.stringify(style);
    if (!byStyle.has(key)) byStyle.set(key, { style, ranges: [] });
    byStyle.get(key).ranges.push(range);
  });

  byStyle.forEach(({ style }, key) => getDecorationType(key, style));
  decorationTypes.forEach((type, key) => {
    editor.setDecorations(type, byStyle.get(key)?.ranges || []);
  });
}

function updateAllDecorations() {
  vscode.window.visibleTextEditors.forEach(updateDecorations);
}

function disposeDecorations() {
  decorationTypes.forEach((t) => t.dispose());
  decorationTypes.clear();
}

// =====================================================================
// VALIDATION
// =====================================================================

function validateAction(raw, label, problems) {
  const action = normalizeAction(raw);
  if (!action || typeof action.command !== 'string') {
    problems.push(`${label}: needs a "command"`);
  }
}

function validatePattern(entry, label, problems) {
  if (typeof entry.match !== 'string') return;
  try {
    buildRegex(entry);
  } catch (err) {
    problems.push(`${label}: invalid regex "${entry.match}" — ${err.message}`);
  }
}

function validateConfig(knownCommands) {
  const problems = [];

  ['textActions', 'terminalActions'].forEach((key) => {
    readList(key).forEach((entry, i) => {
      const label = `${key}[${i}]`;
      if (!entry || typeof entry.match !== 'string') {
        problems.push(`${label}: needs a "match" — without one it can never fire`);
      } else {
        validatePattern(entry, label, problems);
      }
      if (!Array.isArray(entry?.actions) || entry.actions.length === 0) {
        problems.push(`${label}: no actions configured`);
      } else {
        entry.actions.forEach((a, j) => validateAction(a, `${label}.actions[${j}]`, problems));
      }
      if (key === 'terminalActions' && Array.isArray(entry?.show)) {
        problems.push(`${label}: "show" only applies to textActions`);
      }
      if (key === 'textActions' && Array.isArray(entry?.show)) {
        entry.show
          .filter((v) => !TEXT_SURFACES.includes(v))
          .forEach((v) =>
            problems.push(`${label}: unknown surface "${v}" (valid: ${TEXT_SURFACES.join(', ')})`)
          );
      }
    });
  });

  ['fileActions', 'selectionActions'].forEach((key) => {
    readList(key).forEach((raw, i) => {
      const label = `${key}[${i}]`;
      validateAction(raw, label, problems);
      validatePattern(normalizeAction(raw) || {}, label, problems);
    });
  });

  const seenIds = new Set();
  readList('globalActions').forEach((raw, i) => {
    const label = `globalActions[${i}]`;
    validateAction(raw, label, problems);
    const a = normalizeAction(raw);
    if (a && a.id !== undefined) {
      if (typeof a.id !== 'string' || !/^[\w.-]+$/.test(a.id)) {
        problems.push(`${label}: "id" must be letters, digits, dot, dash or underscore`);
      } else if (seenIds.has(a.id)) {
        problems.push(`${label}: duplicate id "${a.id}"`);
      } else {
        seenIds.add(a.id);
      }
    }
  });

  readList('statusBarActions').forEach((cfg, i) => {
    const label = `statusBarActions[${i}]`;
    if (!cfg || typeof cfg.text !== 'string') {
      problems.push(`${label}: needs "text" for the button label`);
      return;
    }
    if (Array.isArray(cfg.actions)) {
      cfg.actions.forEach((a, j) => validateAction(a, `${label}.actions[${j}]`, problems));
    } else {
      validateAction(cfg, label, problems);
    }
  });

  readList('eventActions').forEach((raw, i) => {
    const label = `eventActions[${i}]`;
    validateAction(raw, label, problems);
    const a = normalizeAction(raw) || {};
    if (!EVENTS.includes(a.on)) {
      problems.push(`${label}: "on" must be one of ${EVENTS.join(', ')}`);
    }
  });

  // A view's `from` names a command; warn when it doesn't exist.
  const checkNodes = (nodes, label) => {
    (Array.isArray(nodes) ? nodes : []).forEach((raw, i) => {
      const node = normalizeAction(raw) || {};
      const here = `${label}[${i}]`;
      if (typeof node.from === 'string' && knownCommands && !knownCommands.has(node.from)) {
        problems.push(`${here}: "from": "${node.from}" is not a registered command`);
      }
      if (node.from && node.children) {
        problems.push(`${here}: has both "from" and "children" — a node uses one or the other`);
      }
      if (Array.isArray(node.children)) checkNodes(node.children, `${here}.children`);
    });
  };
  checkNodes(viewNodes('explorerView'), 'explorerView');
  checkNodes(viewNodes('activityBarView'), 'activityBarView');

  if (problems.length === 0) return;

  log('Error', `${problems.length} configuration problem(s):`);
  problems.forEach((p) => log('Error', `  - ${p}`));
  vscode.window
    .showWarningMessage(
      `Command Layer: ${problems.length} configuration problem(s) — invalid entries are skipped.`,
      'Show Details'
    )
    .then((choice) => {
      if (choice === 'Show Details') getOutputChannel().show();
    });
}

// =====================================================================
// ACTIVATION
// =====================================================================

// Entry points are invoked as commands; an exception would otherwise
// become a silently rejected promise.
function guarded(name, fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      log('Error', `${name}: ${err && err.stack ? err.stack : err}`);
      vscode.window
        .showErrorMessage(`Command Layer: ${name} failed — ${err}`, 'Show Details')
        .then((choice) => {
          if (choice === 'Show Details') getOutputChannel().show();
        });
    }
  };
}

// =====================================================================
// URI HANDLER — reaching these commands from outside VS Code
//
//   vscode://saemeon.command-layer/run?action=<id>
//   vscode://saemeon.command-layer/run?command=<id>[&args=<json array>]
//   vscode://saemeon.command-layer/run?task=<label>
//
// The interface is documented in README.md, "From outside VS Code".
//
// Any local application and any web page that can open a URL reaches
// this handler, so nothing runs unless a setting names it, and args are
// passed as data: no ${...} is substituted, since ${command:...} would
// run a command the allowlist never saw.
// =====================================================================

const URI_PATH = '/run';
const URI_KINDS = ['action', 'command', 'task'];
const MAX_URI_ARGS = 64 * 1024;

// Refused whatever the allowlist says. Each takes, as an argument, other
// command ids, a task, or text a shell runs — so allowlisting one would
// reach past the allowlist. commandLayer.* is refused as a prefix for the
// same reason: its dispatchers run actions they are handed.
const NEVER_FROM_URI = new Set([
  'runCommands',
  'workbench.action.tasks.runTask',
  'workbench.action.terminal.sendSequence',
  'workbench.action.terminal.new',
  'workbench.action.terminal.newWithCwd',
  'workbench.action.terminal.newWithProfile',
  'workbench.action.createTerminalEditor',
]);

function uriSettings() {
  const cfg = vscode.workspace.getConfiguration('commandLayer');
  const list = (key) => {
    const value = cfg.get(key, []);
    return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
  };
  return {
    allowedCommands: list('uriHandler.allowedCommands'),
    allowedTasks: list('uriHandler.allowedTasks'),
    allowAnyCommand: cfg.get('uriHandler.allowAnyCommand', false) === true,
  };
}

// VS Code percent-decodes the query once before a handler sees it, so a
// JSON value containing & or + only survives encoded twice. A JSON array
// starts with "[", its encoding with "%5B", so both spellings are read.
function decodeUriArgs(raw) {
  let text = raw.trim();
  if (/^%5b/i.test(text)) {
    try {
      text = decodeURIComponent(text);
    } catch {
      throw new UriRefusal('?args= is not valid percent-encoding');
    }
  }
  if (text.length > MAX_URI_ARGS) throw new UriRefusal('?args= is too long');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new UriRefusal(`?args= is not valid JSON — ${err.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new UriRefusal('?args= must be a JSON array of arguments, in order');
  }
  return parsed.map(literalArg);
}

// The typed forms of settings' `args`, with nothing substituted.
function literalArg(node) {
  if (isTypedArg(node)) {
    const [type, value] = node;
    switch (type) {
      case 'uri':
        if (typeof value !== 'string' || !value) throw new UriRefusal('["uri", ...] needs a string');
        return looksLikeUri(value) ? vscode.Uri.parse(value) : vscode.Uri.file(value);
      case 'object':
        if (typeof value !== 'string') return literalArg(value);
        try {
          return literalArg(JSON.parse(value));
        } catch (err) {
          if (err instanceof UriRefusal) throw err;
          throw new UriRefusal(`["object", ...] is not valid JSON — ${err.message}`);
        }
      case 'number':
        return Number(value);
      case 'boolean':
        return value === true || value === 'true';
      case 'regex':
        return regexEscape(value);
      default:
        return String(value);
    }
  }
  if (Array.isArray(node)) return node.map(literalArg);
  if (node && typeof node === 'object') {
    // fromEntries defines keys, so a "__proto__" key stays a plain key.
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, literalArg(v)]));
  }
  return node;
}

class UriRefusal extends Error {}

function commandRefusal(id, hasArgs, settings) {
  if (id.startsWith('_') || id.startsWith('commandLayer.') || NEVER_FROM_URI.has(id)) {
    return id.startsWith('commandLayer.action.')
      ? `"${id}" is reached as ?action=${id.slice('commandLayer.action.'.length)}`
      : `"${id}" is never run from a URI`;
  }
  if (settings.allowedCommands.includes(id)) return undefined;
  if (settings.allowAnyCommand && !hasArgs) return undefined;
  if (settings.allowAnyCommand) {
    return `"${id}" is not in commandLayer.uriHandler.allowedCommands, which ?args= needs`;
  }
  return `"${id}" is not in commandLayer.uriHandler.allowedCommands`;
}

async function findTask(label) {
  const tasks = await vscode.tasks.fetchTasks();
  const named = tasks.filter((t) => t.name === label || `${t.source}: ${t.name}` === label);
  // tasks.json before a provider's task of the same name, as the Run Task
  // picker lists them.
  const fromFile = named.filter((t) => t.source === 'Workspace');
  const found = fromFile.length > 0 ? fromFile : named;
  if (found.length === 0) throw new UriRefusal(`no task "${label}" in this window`);
  if (found.length > 1) {
    const where = found.map((t) => t.scope?.name || t.source).join(', ');
    throw new UriRefusal(`task "${label}" is ambiguous here (${where})`);
  }
  return found[0];
}

async function dispatchUri(uri) {
  const pathname = (uri.path || '').replace(/\/+$/, '');
  if (pathname !== URI_PATH) {
    throw new UriRefusal(`unknown path "${uri.path}" — the handler answers ${URI_PATH}`);
  }

  const params = new URLSearchParams(uri.query || '');
  const kinds = URI_KINDS.filter((k) => params.has(k));
  if (kinds.length !== 1) {
    throw new UriRefusal('a URI names exactly one of ?action=, ?command= or ?task=');
  }
  const kind = kinds[0];
  for (const key of [kind, 'args']) {
    if (params.getAll(key).length > 1) throw new UriRefusal(`?${key}= is given more than once`);
  }
  const name = (params.get(kind) || '').trim();
  if (!name) throw new UriRefusal(`?${kind}= is empty`);
  const rawArgs = params.get('args');
  if (rawArgs !== null && kind !== 'command') {
    throw new UriRefusal('?args= is only taken with ?command=');
  }

  const settings = uriSettings();

  if (kind === 'action') {
    if (!globalActionIds.has(name)) {
      throw new UriRefusal(`no global action with id "${name}" in commandLayer.globalActions`);
    }
    log('Info', `[uri] action ${name}`);
    await vscode.commands.executeCommand(`commandLayer.action.${name}`);
    return;
  }

  if (kind === 'command') {
    const refusal = commandRefusal(name, rawArgs !== null, settings);
    if (refusal) throw new UriRefusal(refusal);
    const args = rawArgs === null ? [] : decodeUriArgs(rawArgs);
    log('Info', `[uri] command ${name} ${rawArgs === null ? '' : JSON.stringify(args)}`);
    await vscode.commands.executeCommand(name, ...args);
    return;
  }

  if (!settings.allowedTasks.includes(name)) {
    throw new UriRefusal(`task "${name}" is not in commandLayer.uriHandler.allowedTasks`);
  }
  if (vscode.workspace.isTrusted === false) {
    throw new UriRefusal('tasks do not run from a URI in an untrusted workspace');
  }
  const task = await findTask(name);
  log('Info', `[uri] task ${name}`);
  await vscode.tasks.executeTask(task);
}

class ActionUriHandler {
  async handleUri(uri) {
    try {
      await dispatchUri(uri);
    } catch (err) {
      const refused = err instanceof UriRefusal;
      const message = refused
        ? `refused ${uri.path || ''}?${uri.query || ''} — ${err.message}`
        : `URI ${uri.path || ''}?${uri.query || ''} failed — ${err && err.message ? err.message : err}`;
      log('Error', `[uri] ${refused ? message : (err && err.stack) || message}`);
      vscode.window
        .showErrorMessage(`Command Layer: ${message}`, 'Show Details')
        .then((choice) => {
          if (choice === 'Show Details') getOutputChannel().show();
        });
    }
  }
}

function activate(context) {
  extensionContext = context;

  context.subscriptions.push(
    vscode.window.registerUriHandler(new ActionUriHandler())
  );
  const docSelector = [{ scheme: 'file' }, { scheme: 'untitled' }];

  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(docSelector, new LinkProvider()),
    vscode.languages.registerCodeLensProvider(docSelector, new ActionCodeLensProvider()),
    vscode.languages.registerCodeActionsProvider(docSelector, new ActionCodeActionProvider()),
    vscode.languages.registerHoverProvider(docSelector, new ActionHoverProvider()),
    vscode.window.registerTerminalLinkProvider(new ActionTerminalLinkProvider())
  );

  // Views
  treeProviders = [
    new CommandLayerTreeProvider('explorerView'),
    new CommandLayerTreeProvider('activityBarView'),
  ];
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('commandLayer.explorerView', treeProviders[0]),
    vscode.window.registerTreeDataProvider('commandLayer.activityBarView', treeProviders[1])
  );

  // Triggers
  context.subscriptions.push(
    vscode.commands.registerCommand('commandLayer.runTextActions', guarded('Text Actions', runTextActions)),
    // Not declared in package.json: only ever invoked by a CodeLens,
    // hover or code action passing indices.
    vscode.commands.registerCommand('commandLayer.triggerAction', guarded('triggerAction', triggerAction)),
    vscode.commands.registerCommand('commandLayer.runFileActions', guarded('File Actions', runFileActions)),
    vscode.commands.registerCommand('commandLayer.runSelectionActions', guarded('Selection Actions', runSelectionActions)),
    vscode.commands.registerCommand('commandLayer.runGlobalActions', guarded('Global Actions', runGlobalActionPicker)),
    vscode.commands.registerCommand('commandLayer.runAllActions', guarded('All Actions', runAllActions)),
    vscode.commands.registerCommand('commandLayer.runEditorTitleAction', guarded('editor title action', runEditorTitleAction)),
    vscode.commands.registerCommand('commandLayer.runStatusBarAction', guarded('status bar action', runStatusBarAction)),
    vscode.commands.registerCommand('commandLayer.runViewItem', guarded('view item', runViewItem))
  );

  // The two commands with no command equivalent
  context.subscriptions.push(
    vscode.commands.registerCommand('commandLayer.openExternal', async (value) => {
      if (typeof value !== 'string' || !value) {
        throw new Error('openExternal needs a URI or path as its argument');
      }
      await vscode.env.openExternal(looksLikeUri(value) ? vscode.Uri.parse(value) : vscode.Uri.file(value));
    }),
    vscode.commands.registerCommand('commandLayer.copyToClipboard', async (text) => {
      await vscode.env.clipboard.writeText(String(text ?? ''));
      vscode.window.setStatusBarMessage('Command Layer: copied to clipboard', 2000);
    })
  );

  // Fetchers — list providers for a view's `from`
  context.subscriptions.push(
    vscode.commands.registerCommand('commandLayer.fetchGlobalActions', () =>
      getGlobalActions(vscode.window.activeTextEditor?.document)
    ),
    vscode.commands.registerCommand('commandLayer.fetchFileActions', () =>
      getFileActions(vscode.window.activeTextEditor?.document.uri)
    ),
    vscode.commands.registerCommand('commandLayer.fetchSelectionActions', () =>
      getSelectionActions(vscode.window.activeTextEditor?.document)
    ),
    vscode.commands.registerCommand('commandLayer.fetchTextActions', () =>
      getTextActions().flatMap((e) => e.actions)
    ),
    vscode.commands.registerCommand('commandLayer.fetchTerminalActions', () =>
      getTerminalActions().flatMap((e) => e.actions)
    ),
    vscode.commands.registerCommand('commandLayer.fetchVSCodeCommands', fetchVSCodeCommands),
    vscode.commands.registerCommand('commandLayer.fetchVSCodeTasks', fetchVSCodeTasks),
    vscode.commands.registerCommand('commandLayer.fetchFrequentActions', frequentActions)
  );

  // Copy an id, or a ready-made action stub, out of a view
  context.subscriptions.push(
    vscode.commands.registerCommand('commandLayer.copyCommandId', async (item) => {
      const id = item?.commandId;
      if (!id) return;
      await vscode.env.clipboard.writeText(id);
      vscode.window.setStatusBarMessage(`Command Layer: copied ${id}`, 2000);
    }),
    vscode.commands.registerCommand('commandLayer.copyActionStub', async (item) => {
      const id = item?.commandId;
      if (!id) return;
      const stub = JSON.stringify({ title: item.label, command: id, args: [] }, null, 2);
      await vscode.env.clipboard.writeText(stub);
      vscode.window.setStatusBarMessage('Command Layer: copied action stub', 2000);
    }),
    vscode.commands.registerCommand('commandLayer.refreshViews', () => refreshTrees())
  );

  // Events — the only actions that run unprompted
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => fireEvent('fileSave', doc)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => fireEvent('workspaceOpen'))
  );

  // Context tracking
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((e) => updateCursorContext(e.textEditor)),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      updateCursorContext(editor);
      updateDecorations(editor);
      updateEditorTitleContext();
      rebuildStatusBar();
      refreshTrees();
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      vscode.window.visibleTextEditors
        .filter((ed) => ed.document === e.document)
        .forEach(updateDecorations);
    }),
    vscode.window.onDidChangeVisibleTextEditors(updateAllDecorations)
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('commandLayer')) return;
      configGeneration += 1;
      matchCache.clear();
      disposeDecorations();
      updateAllDecorations();
      updateEditorTitleContext();
      updateViewContexts();
      rebuildStatusBar();
      registerGlobalActionIds();
      refreshTrees();
      vscode.commands.getCommands(true).then((cmds) => validateConfig(new Set(cmds)));
    })
  );

  // Optional utilities, loaded only when enabled
  if (vscode.workspace.getConfiguration('commandLayer').get('utils.enabled', false)) {
    try {
      require('./utils').register(context);
    } catch (err) {
      log('Error', `failed to load optional utils: ${err}`);
    }
  }

  updateCursorContext(vscode.window.activeTextEditor);
  updateAllDecorations();
  updateEditorTitleContext();
  updateViewContexts();
  rebuildStatusBar();
  registerGlobalActionIds();

  // Workspace-open hooks fire once the extension is up.
  fireEvent('workspaceOpen');

  vscode.commands.getCommands(true).then((cmds) => validateConfig(new Set(cmds)));
}

function deactivate() {
  disposeDecorations();
  statusBarItems.forEach((i) => i.dispose());
  globalActionDisposables.forEach((d) => d.dispose());
  globalActionDisposables = [];
}

module.exports = { activate, deactivate };
