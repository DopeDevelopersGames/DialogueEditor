/*
 * Golden tests for translateGoogleDocToUnityScript.
 *
 * Each case is: a name, the text a writer might paste, and the exact script we expect.
 * To pin down a new converter bug, add a case here first and watch it fail.
 *
 * Run with:  npm test
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { translateGoogleDocToUnityScript: convert, convertScript, parseConversation } = require("../dialogue-core.js");

// Every case starts with the implicit "# opening" node when the input has no heading.
const OPEN = "# opening\n";

/** [name, input, expected output] */
const CASES = [
  // ---- basics ------------------------------------------------------------
  ["empty input gives empty output", "", ""],
  ["whitespace-only input gives empty output", "  \n \n", ""],
  ["CRLF line endings are normalised", "A: hi\r\nB: yo", OPEN + "A: hi\nB: yo"],
  ["runs of blank lines collapse to one", "A: hi\n\n\n\nB: yo", OPEN + "A: hi\n\nB: yo"],
  ["smart quotes, dashes and ellipses become plain text",
    "SHERIFF: “Hello” — friend…", OPEN + 'SHERIFF: "Hello" -- friend...'],
  ["comments pass through, and the opening node follows them",
    "// a note\nA: hi", "// a note\n# opening\nA: hi"],

  // ---- headings ----------------------------------------------------------
  ["'Node:' heading becomes a label", "Node: Fight Scene\nA: hi", "# fight_scene\nA: hi"],
  ["bracketed heading becomes a label", "[fight]\nA: hi", "# fight\nA: hi"],
  ["markdown heading becomes a label", "## Act 1\nA: hi", "# act_1\nA: hi"],
  ["'player chooses' heading becomes a label", "Player: Hi\n\nIf the player chooses to run:\nSHERIFF: Coward",
    OPEN + "{PLAYER}: Hi\n\n# run\nSHERIFF: Coward"],
  ["a heading with no usable label is flagged, not dropped", "## !!!\nA: hi",
    "// TODO: Could not interpret heading: ## !!!\n# opening\nA: hi"],

  // ---- speakers ----------------------------------------------------------
  ["speaker names are upper-cased", "sheriff: Howdy", OPEN + "SHERIFF: Howdy"],
  ["player and enemy become the built-in speakers", "player: hi\nEnemy: yo", OPEN + "{PLAYER}: hi\n{ENEMY}: yo"],
  // SpeakerCatalogue matches the key as written, so spaces stay.
  ["multi-word speakers keep their spaces", "Old  Sheriff: Howdy", OPEN + "OLD SHERIFF: Howdy"],
  ["a parenthetical direction is kept as a comment, not lost",
    "SHERIFF (angry): Get out.", OPEN + "// direction: angry\nSHERIFF: Get out."],
  ["'NAME says:' is read as the speaker", "Sheriff says: hello there", OPEN + "SHERIFF: hello there"],
  ["a long sentence before the colon is narration, not a speaker",
    "He walks in and says: hello", OPEN + "// ?? He walks in and says: hello"],
  ["common labels such as 'Note:' are not speakers", "Note: bring water", OPEN + "// ?? Note: bring water"],

  // ---- speech written as prose ------------------------------------------
  ["speech after a verb is extracted", 'The sheriff says, "Ten paces."', OPEN + "SHERIFF: Ten paces."],
  ["an apostrophe inside speech does not cut it short",
    'The sheriff says, "I don\'t know."', OPEN + "SHERIFF: I don't know."],
  ["speech before the speaker is extracted", '"Get out." the sheriff growls.', OPEN + "SHERIFF: Get out."],
  ["a comma inside the closing quote is not part of the speech",
    '"Move," the sheriff says.', OPEN + "SHERIFF: Move"],
  ["single-quoted speech works when the quote closes cleanly",
    "'Howdy.' the sheriff says.", OPEN + "SHERIFF: Howdy."],

  // ---- jumps -------------------------------------------------------------
  ["arrow jump", "A: hi\n-> fight", OPEN + "A: hi\n-> fight"],
  ["'go to' style jumps need an explicit marker", "A: hi\njump to fight", OPEN + "A: hi\n-> fight"],
  ["'goto' jumps", "goto fight", OPEN + "-> fight"],
  ["END is upper-cased", "A: bye\n-> end", OPEN + "A: bye\n-> END"],
  ["ordinary words starting with 'Jump' or 'Exit' are not jumps",
    "Jump up\nExit saloon", OPEN + "// ?? Jump up\n// ?? Exit saloon"],

  // ---- choices -----------------------------------------------------------
  ["numbered choice with target", "1. Fight him -> fight", OPEN + "> Fight him -> fight"],
  ["a choice with no target is flagged as falling through", "2) Run",
    OPEN + "// TODO: Confirm this choice should fall through: Run\n> Run"],
  ["bullet choices", "- Stay -> stay", OPEN + "> Stay -> stay"],
  ["gate in brackets is kept", "- [met_sheriff] We've met -> callback", OPEN + "> [met_sheriff] We've met -> callback"],
  ["gate in parentheses becomes a bracket gate", "- (if cocky) Fine -> x", OPEN + "> [cocky] Fine -> x"],
  ["negated gate is kept", "- [!cocky] Say nothing -> x", OPEN + "> [!cocky] Say nothing -> x"],
  ["an effect tag at the start of a choice is not mistaken for a gate",
    "- [shake]Hi[/shake] -> next", OPEN + "> [shake]Hi[/shake] -> next"],
  ["a decimal number at the start of a line is not a numbered choice",
    "3.5 miles away", OPEN + "// ?? 3.5 miles away"],
  ["a number followed by a word is not a choice", "10 paces and turn", OPEN + "// ?? 10 paces and turn"],

  // ---- directives --------------------------------------------------------
  ["known directives pass through", "@tag met_sheriff\n@timer 4 -> back_down",
    OPEN + "@tag met_sheriff\n@timer 4 -> back_down"],
  ["unknown directives are marked as unrecognised", "@foo bar", OPEN + "// ?? @foo bar"],

  // ---- lines already in script syntax are left alone ----------------------
  ["comments keep their punctuation", "// a — b “q”\nA: hi", "// a — b “q”\n# opening\nA: hi"],
  ["a '#label' without a space is kept as written", "#tutorial\nA: hi", "#tutorial\nA: hi"],
  ["a script choice keeps the writer's spacing", '> "Hi"      -> a', OPEN + '> "Hi"      -> a'],
  ["a script choice with a (tag) suffix is not rewritten", '> "Sorry"(feel sorry) -> a', OPEN + '> "Sorry"(feel sorry) -> a']
];

for (const [name, input, expected] of CASES) {
  test(name, () => assert.equal(convert(input), expected));
}

test("converting twice changes nothing (idempotent)", () => {
  for (const [, input] of CASES) {
    const once = convert(input);
    assert.equal(convert(once), once, `not stable for input: ${JSON.stringify(input)}`);
  }
});

test("everything the converter produces parses without errors", () => {
  for (const [name, input] of CASES) {
    const errors = parseConversation(convert(input)).warns.filter((w) => w.sev === "err");
    assert.deepEqual(errors, [], `parse errors for case: ${name}`);
  }
});

// ---- notes: one per line the converter had to guess about -----------------

const noteLines = (input) => convertScript(input).notes.map((n) => n.line);

test("an unrecognised line is noted with its input line number", () => {
  assert.deepEqual(noteLines("A: hi\n\nrandom words"), [3]);
});

test("a choice with no target is noted", () => {
  assert.deepEqual(noteLines("A: hi\n2) Run"), [2]);
});

test("a direction moved into a comment is noted", () => {
  assert.deepEqual(noteLines("SHERIFF (angry): Get out."), [1]);
});

test("a speaker taken from a sentence is noted", () => {
  assert.deepEqual(noteLines('The sheriff says, "Ten paces."'), [1]);
});

test("a heading with no usable label is noted", () => {
  assert.deepEqual(noteLines("A: hi\n## !!!"), [2]);
});

test("clean input produces no notes", () => {
  assert.deepEqual(convertScript("# a\nSHERIFF: hi\n> Stay -> a\n-> END").notes, []);
});

test("empty input gives an empty result", () => {
  assert.deepEqual(convertScript(""), { text: "", notes: [] });
});

test("the text-only wrapper returns the same script", () => {
  const input = "Sheriff: hi\nrandom";
  assert.equal(convert(input), convertScript(input).text);
});

// Real scripts copied from the game. Valid input must come back unchanged.
for (const name of ["real_tutorial.txt", "real_sheriff_intro.txt"]) {
  test(`${name} converts to itself`, () => {
    const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "fixtures", name), "utf8");
    assert.equal(convert(src), src.replace(/\r\n/g, "\n").trim());
  });
}
