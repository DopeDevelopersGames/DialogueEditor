/*
 * Tests for the script parser and validator in dialogue-core.js.
 * These pin down behaviour that must stay in step with the Unity C# parsers.
 *
 * Run with:  npm test
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../dialogue-core.js");

const { parseEffects, parseConversation, validate, speakerColon, isEffectTag } = core;

const CAST = [
  { key: "SHERIFF", side: "Right", colour: "#c8643c" },
  { key: "{PLAYER}", side: "Left", colour: "#e8e6e0" }
];

const messages = (issues) => issues.map((i) => i.msg);

// ---- the shipped example --------------------------------------------------

test("the example script has no warnings and no checks to report", () => {
  const src = fs.readFileSync(path.join(__dirname, "fixtures", "sheriff_intro.txt"), "utf8");
  const conv = parseConversation(src);
  assert.deepEqual(conv.warns, []);
  assert.deepEqual(validate(conv, CAST), []);
  assert.equal(conv.nodes.length, 6);
});

// ---- inline effects -------------------------------------------------------

test("effects count visible characters only, not markup", () => {
  const warns = [];
  const r = parseEffects("a<b>b</b>[shake]cd[/shake]", warns, 1);
  assert.equal(r.visible, 4);                                   // a, b, c, d
  assert.deepEqual(r.effects, [{ kind: "shake", amp: 1, first: 2, last: 3 }]);
  assert.deepEqual(warns, []);
});

test("a pause records the character index it sits before", () => {
  const r = parseEffects("ab[pause=0.4]cd", [], 1);
  assert.deepEqual(r.pauses, [{ index: 2, secs: 0.4 }]);
});

test("an escaped bracket is a literal character", () => {
  const r = parseEffects("\\[ok]", [], 1);
  assert.equal(r.text, "[ok]");
  assert.equal(r.visible, 4);
});

test("effect amplitude and speed multiplier are read", () => {
  const r = parseEffects("[wobble=1.4]ab[/wobble][speed=0.5]cd[/speed]", [], 1);
  assert.equal(r.effects[0].amp, 1.4);
  assert.deepEqual(r.speeds, [{ mul: 0.5, first: 2, last: 3 }]);
});

test("impact is a motion effect whose value is its starting intensity", () => {
  const warns = [];
  const r = parseEffects("[impact=3]BANG[/impact]", warns, 1);
  assert.deepEqual(warns, []);
  assert.deepEqual(r.effects, [{ kind: "impact", amp: 3, first: 0, last: 3 }]);
});

test("an unclosed effect is closed at the end of the line, with a warning", () => {
  const warns = [];
  const r = parseEffects("[shake]ab", warns, 7);
  assert.equal(r.effects[0].last, 1);
  assert.match(warns[0].msg, /Unclosed/);
  assert.equal(warns[0].line, 7);
});

test("an unknown effect tag is an error", () => {
  const warns = [];
  parseEffects("[explode]boom[/explode]", warns, 1);
  assert.equal(warns[0].sev, "err");
  assert.match(warns[0].msg, /Unknown effect tag/);
});

test("a closing tag that was never opened is reported", () => {
  const warns = [];
  parseEffects("hi[/shake]", warns, 1);
  assert.match(warns[0].msg, /never opened/);
});

test("speakerColon ignores colons inside rich-text tags", () => {
  assert.equal(speakerColon("SHERIFF: hi"), 7);
  assert.equal(speakerColon("<color=#c81e1e:x>SHERIFF</color>: hi"), 32);
  assert.equal(speakerColon("no speaker here"), -1);
});

test("isEffectTag matches the effect vocabulary, case-insensitively", () => {
  assert.ok(isEffectTag("shake"));
  assert.ok(isEffectTag("/Wave"));
  assert.ok(isEffectTag("pause=0.4"));
  assert.ok(!isEffectTag("met_sheriff"));
});

// ---- structure ------------------------------------------------------------

test("a script with no heading gets an implicit opening node", () => {
  const conv = parseConversation("A: hi");
  assert.equal(conv.nodes.length, 1);
  assert.equal(conv.nodes[0].label, "");
});

test("a line with no speaker is an error", () => {
  const conv = parseConversation("# a\njust words");
  assert.equal(conv.warns[0].sev, "err");
});

test("a duplicate node label is an error", () => {
  const conv = parseConversation("# a\nX: hi\n# A\nX: yo");
  assert.ok(messages(conv.warns).some((m) => /already exists/.test(m)));
});

test("a choice gate is told apart from an effect by vocabulary", () => {
  const conv = parseConversation("# a\n> [shake]hi[/shake]\n> [met] hello");
  const [effectChoice, gatedChoice] = conv.nodes[0].choices;
  assert.equal(effectChoice.gate, null);
  assert.equal(gatedChoice.gate, "met");
});

test("a timer needs a fallback target", () => {
  const conv = parseConversation("# a\n@timer 4\nX: hi");
  assert.equal(conv.warns[0].sev, "err");
});

test("an unknown perk is an error", () => {
  const conv = parseConversation("# a\n@perk Bogus");
  assert.ok(messages(conv.warns).some((m) => /not an EnemyPerk/.test(m)));
});

// ---- cross-node checks ----------------------------------------------------

test("a jump to a missing node is an error", () => {
  const issues = validate(parseConversation("# a\nX: hi\n-> nowhere"), []);
  assert.ok(messages(issues).some((m) => /not a node in this file/.test(m)));
});

test("a node nothing leads to is reported as unreachable", () => {
  const issues = validate(parseConversation("# a\nX: hi\n-> END\n# b\nX: lost"), []);
  assert.ok(messages(issues).some((m) => /cannot be reached/.test(m)));
});

test("a gate that no @tag sets is a warning", () => {
  const issues = validate(parseConversation("# a\nX: hi\n> [never] opt -> END"), []);
  assert.ok(messages(issues).some((m) => /never set by/.test(m)));
});

test("a tag named like a text effect is an error", () => {
  const issues = validate(parseConversation("# a\n@tag shake\nX: hi"), []);
  assert.ok(issues.some((i) => i.sev === "err" && /named after a text effect/.test(i.msg)));
});

test("a speaker missing from the cast is a warning, but {ENEMY} is always fine", () => {
  const conv = parseConversation("# a\nSTRANGER: hi\n{ENEMY}: yo");
  const issues = validate(conv, CAST);
  assert.equal(issues.length, 1);
  assert.match(issues[0].msg, /STRANGER/);
});

test("issues come back sorted by line", () => {
  const issues = validate(parseConversation("# a\nX: hi\n-> nowhere\n# b\nX: lost"), []);
  const lines = issues.map((i) => i.line);
  assert.deepEqual(lines, [...lines].sort((x, y) => x - y));
});
