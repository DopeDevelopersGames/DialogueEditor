# Ten Paces Dialogue Desk

A single web page for writing and checking dialogue scripts for the Ten Paces game.
You paste or type a script, the page checks it for mistakes, and you can preview the scene before it goes into Unity.

## Quick start

1. Open `dialogue-editor.html` in a browser (double-click it), or use the hosted copy at https://dopedevelopersgames.github.io/DialogueEditor/. No install needed.
2. Write a script in the left pane, or press **Load example** to see one.
3. Fix anything listed in the **Issues** tab, then press **Play scene** to preview it.
4. Press **Download .txt** and put the file in the game at `Assets/Resources/Dialogue/`.

Your work is saved automatically in the browser. It is only on this computer and this browser.

## What you can do

| I want to... | Use |
|---|---|
| Turn a Google Doc or Word draft into a script | **Import Google Doc**. Paste, review the notes, press **Replace script** |
| Open or save a script file | **Open .txt** / **Download .txt** |
| Undo a mistake, including an import | **Ctrl+Z** |
| Check my script for errors | **Issues** tab (click an issue to jump to its line) |
| See the story shape | **Outline** tab |
| Try the scene as a player | **Play scene** |

### Importing a draft

The importer guesses the script format from plain writing, for example `Sheriff: Get out.` or `1. Fight him -> fight`.
Anything it is unsure about is listed under the preview, with its line number. Click one to find it.
Lines it can't understand are kept as `// ?? text` so nothing is lost. Search for `??` and fix them by hand.
Nothing changes in your script until you press **Replace script**.

## The script format in one minute

```
# opening                       a scene section ("node")
SHERIFF: Hold it right there.   who speaks, then what they say
{PLAYER}: Easy now.             the player's line
> "Back off" -> fight           a choice the player can pick, jumping to "fight"
-> END                          finish the conversation
// a note to yourself           ignored by the game
```

The full rules are in the game project's `Docs/dialogue-system-spec.md`. That document is the authority, and this tool follows it.

## How it works (for developers)

```
dialogue-editor.html   the page: layout, styling, buttons, preview stage, saving to the browser
index.html             forwards GitHub Pages' root URL to dialogue-editor.html
.nojekyll              tells GitHub Pages to serve files as-is
dialogue-core.js       the logic: parser, validator, converter. No page code, so it can be tested
tests/                 automated tests (Node's built-in test runner)
  converter.test.js    "this pasted text must become this script" cases
  parser.test.js       parser and validator checks
  fixtures/            sample scripts; real_*.txt are copies of the game's own scripts
```

- **Parser** reads a script into nodes, lines and choices. It copies the game's C# parser (`DialogueParser.cs`). If the two disagree, the C# one is right.
- **Validator** finds problems such as a jump to a missing node, or an unknown speaker.
- **Converter** is a chain of simple rules, tried in order, for each line. Lines it can't place become `// ?? ...` comments.
- **Why a plain script and not a module?** Browsers block modules when a page is opened as a file, and we want double-click-to-open.

### Running the tests

You need [Node.js](https://nodejs.org) (no other install).

```
npm test
```

### Changing things safely

- **A converter bug:** add a case to `CASES` in `tests/converter.test.js` first, watch it fail, then fix `dialogue-core.js`.
- **A grammar change:** change the game's spec and C# parser first, then mirror it in `dialogue-core.js` and add a parser test.
- **Comments:** keep them short, two lines at most.
- **Don't edit the TenPaces project from here.** This tool only reads from it.
- **One change at a time**, each with passing tests, then a savepoint tag.

### Going back

Each finished piece has a git tag. To return to one (this discards later changes):

```
git reset --hard savepoint-piece2
```

To only look at an old state, use `git checkout savepoint-piece2`, then `git checkout master` to come back.

## Known limits

- Never tested with the real browser file dialogs or the real Unity project import. Check both once.
- The `(tag)` suffix after a choice (e.g. `> "Sorry"(feel sorry) -> a`) is kept as written but the game doesn't support it yet.
- The speaker list and perk names are built into the tool. Loading them from the game is planned.
- The page has no `<!doctype>`, so browsers run it in compatibility mode. Fixing it may shift the layout, so it is deferred.
- Everything lives in one browser's storage: one script at a time, no sync.

## Progress log

Newest first. Add an entry for every change: what changed, and why.

| Date | Tag | Change | Why |
|---|---|---|---|
| 2026-11-04 | | `index.html` redirect and `.nojekyll` | GitHub Pages showed the README instead of the editor |
| 2026-10-27 | `savepoint-piece3` | Open / Download `.txt`; quoted speech no longer keeps a trailing comma | Avoid copy-paste; `"Move," he said.` gave `Move,` |
| 2026-10-27 | `savepoint-piece2` | Import dialog shows a live preview and a notes list | Writers can review guesses before replacing their script |
| 2026-10-27 | `savepoint-piece1` | Converter reports lines it had to guess | Silent guesses hide mistakes |
| 2026-10-27 | (first commit) | Logic split into `dialogue-core.js`; tests added | Make the converter testable |

### Planned

- **Piece 4:** load the speaker list from the game's catalogue file (read-only).
- **Piece 5:** several scripts at once, saved more safely.
- **Open question:** what the `(tag)` choice suffix should mean.
