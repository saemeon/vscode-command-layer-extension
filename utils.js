const vscode = require('vscode');

// Optional conveniences, loaded by extension.js only when
// commandLayer.utils.enabled is set. Each is a thin wrapper over a
// vscode.* API or a built-in command.

function selectedText() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return '';
  const selection = editor.selections.find((sl) => !sl.isEmpty);
  return selection ? editor.document.getText(selection) : '';
}

function escapeRegex(value) {
  return String(value).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

async function searchSelection(exact) {
  const text = selectedText();
  if (!text) {
    vscode.window.showWarningMessage('Command Layer: no text selected.');
    return;
  }
  // Whitespace runs become \s+, so a selection wrapped or re-indented
  // differently elsewhere still matches.
  const query = exact
    ? text
    : text.trim().split(/\s+/).map(escapeRegex).join('\\s+');
  await vscode.commands.executeCommand('workbench.action.findInFiles', {
    query,
    isRegex: !exact,
    triggerSearch: true,
  });
}

async function writeFile(target, content) {
  if (typeof target !== 'string' || !target) {
    throw new Error('writeFile needs a path as its first argument');
  }
  const uri = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(target)
    ? vscode.Uri.parse(target)
    : vscode.Uri.file(target);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(String(content ?? ''), 'utf8'));
}

function register(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('commandLayer.util.searchSelection', () => searchSelection(false)),
    vscode.commands.registerCommand('commandLayer.util.searchSelectionExact', () => searchSelection(true)),
    vscode.commands.registerCommand('commandLayer.util.writeFile', writeFile)
  );
}

module.exports = { register };
