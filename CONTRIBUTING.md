# Contributing

The extension is `package.json`, `extension.js`, `utils.js` and `icon.png`
-- no build step, no dependencies. Its id is `saemeon.command-layer`; treat
the `publisher` and `name` in `package.json` as fixed, since the id is the
authority of every `vscode://saemeon.command-layer/...` URI.

Have one copy installed at a time. Two with the same id, say a Marketplace
install and a linked folder, are not reliably told apart by VS Code.

## Run from source

```sh
git clone https://github.com/saemeon/vscode-command-layer-extension.git
cd vscode-command-layer-extension
```

**Without installing:** open a window with the folder loaded as an extension,
gone when the window closes. This is the way to try a change.

```sh
code --extensionDevelopmentPath="$PWD"
```

**Installed from the folder:** open the Command Palette (`cmd+shift+P`), run
**Developer: Install Extension from Location...** and choose the clone. VS
Code records the folder where it is, without copying it, so a `git pull`
takes effect on the next **Developer: Reload Window**. Uninstall it from the
Extensions view like any other.

**By a link:** name it `<id>-<version>`, with the `version` of `package.json`,
and quit and reopen VS Code once. Removing the link uninstalls it, and the
link's name changes with the version.

```sh
ln -s "$PWD" ~/.vscode/extensions/saemeon.command-layer-0.1.0
```

Either way `code --list-extensions` lists `saemeon.command-layer`. Editors
with their own extensions folder, such as Cursor (`~/.cursor/extensions`),
take the same link there.

## Package

```sh
npx @vscode/vsce package
code --install-extension command-layer-0.1.0.vsix
```

`vsce ls` lists what goes in the package; `.vscodeignore` decides. VS Code
copies a `.vsix` into `~/.vscode/extensions/`, so a later change in the clone
does not reach it: package and install again. In the Extensions view,
**...** then **Install from VSIX...** does the same.

## Publish

Releases are uploaded by hand; there is no CI and no Azure DevOps token.

1. Bump `version` in `package.json` and add an entry to `CHANGELOG.md`.
2. Package it as above, and try the `.vsix`.
3. On [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage),
   open the `saemeon` publisher and choose **New extension**, then **Visual
   Studio Code** for the first release, or the extension's `...` menu, then
   **Update**, for a later one. Upload the `.vsix`.
4. Tag it: `git tag v<version> && git push --tags`.
