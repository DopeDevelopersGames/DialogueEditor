// Dialogue Desk logic with no DOM: parser, validator and text converter. Mirrors
// DialogueParser.cs / DialogueEffectParser.cs; the C# side is the authority.
// A plain script, not a module, so the page still opens from file://.
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DialogueCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Escapes text so it is safe to place inside innerHTML. */
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const FX = ["shake", "wave", "wobble", "jump"];
  const TIMING = ["speed", "pause"];
  const KNOWN_FX = FX.concat(TIMING);
  const PERKS = ["Scattershot", "Fly", "NineLives", "Syncopation"];
  const SEEN_PREFIX = "seen:";

  function splitTag(inner) {
    let closing = false;
    let s = (inner || "").trim();
    if (!s) return { closing, name: "", param: null };
    if (s[0] === "/") { closing = true; s = s.slice(1).trim(); }
    const eq = s.indexOf("=");
    if (eq < 0) return { closing, name: s, param: null };
    return { closing, name: s.slice(0, eq).trim(), param: s.slice(eq + 1).trim() };
  }

  const isKnownTag = (n) => KNOWN_FX.some((k) => k.toLowerCase() === (n || "").toLowerCase());
  const isEffectTag = (inner) => isKnownTag(splitTag(inner).name);

  function num(t) {
    if (t === null || t === undefined || String(t).trim() === "") return null;
    const v = parseFloat(t);
    return Number.isFinite(v) ? v : null;
  }

  /* Returns { text, visible, effects, speeds, pauses, styles, warns }.
     `visible` counts characters with BOTH markup systems removed — the same space
     TMP_TextInfo.characterInfo is indexed in. `<...>` is copied through but never
     counted; miss that and every effect lands on the wrong character. */
  function parseEffects(raw, warns, lineNo) {
    const out = [];
    const effects = [], speeds = [], pauses = [], styles = [];
    const open = [];
    const tmp = { color: null, bold: false, italic: false };
    let visible = 0, i = 0;
    raw = raw || "";

    const warn = (m, sev) => warns && warns.push({ line: lineNo, msg: m, sev: sev || "warn" });

    const close = (t, last) => {
      if (last < t.start) { warn(`<code>[${t.name}]</code> covers no characters. Dropped.`); return; }
      if (t.speed) speeds.push({ mul: t.value, first: t.start, last });
      else effects.push({ kind: t.kind, amp: t.value, first: t.start, last });
    };

    while (i < raw.length) {
      const c = raw[i];

      if (c === "\\" && raw[i + 1] === "[") { out.push("["); styles.push({ ...tmp }); visible++; i += 2; continue; }

      if (c === "<") {
        const gt = raw.indexOf(">", i + 1);
        if (gt < 0) {
          warn("<code>&lt;</code> with no closing <code>&gt;</code>. TMP renders it literally.");
          out.push("<"); styles.push({ ...tmp }); visible++; i++; continue;
        }
        const body = raw.slice(i + 1, gt).trim();
        const low = body.toLowerCase();
        if (low === "b") tmp.bold = true;
        else if (low === "/b") tmp.bold = false;
        else if (low === "i") tmp.italic = true;
        else if (low === "/i") tmp.italic = false;
        else if (low.startsWith("color=")) tmp.color = body.slice(6).replace(/["']/g, "");
        else if (low === "/color") tmp.color = null;
        out.push(raw.slice(i, gt + 1));           // through to TMP, uncounted
        i = gt + 1; continue;
      }

      if (c === "[") {
        const rb = raw.indexOf("]", i + 1);
        if (rb < 0) {
          warn("<code>[</code> with no closing <code>]</code>. Write <code>\\[</code> for a literal bracket.");
          out.push("["); styles.push({ ...tmp }); visible++; i++; continue;
        }
        const inner = raw.slice(i + 1, rb);
        const { closing, name, param } = splitTag(inner);
        i = rb + 1;

        if (!name) { warn("Empty tag <code>[]</code>. Dropped."); continue; }

        if (closing) {
          let k = -1;
          for (let j = open.length - 1; j >= 0; j--)
            if (open[j].name.toLowerCase() === name.toLowerCase()) { k = j; break; }
          if (k < 0) { warn(`<code>[/${name}]</code> closes a tag that was never opened.`); continue; }
          close(open[k], visible - 1); open.splice(k, 1); continue;
        }

        if (name.toLowerCase() === "pause") {
          const s = num(param);
          if (s === null) warn(`<code>[${inner}]</code> needs seconds, as <code>[pause=0.4]</code>.`);
          else if (s <= 0) warn(`<code>[${inner}]</code> is not a pause. Dropped.`);
          else pauses.push({ index: visible, secs: s });
          continue;
        }
        if (name.toLowerCase() === "speed") {
          const m = num(param);
          if (m === null) warn(`<code>[${inner}]</code> needs a multiplier, as <code>[speed=0.5]</code>.`);
          else if (m < 0.01) warn(`<code>[${inner}]</code> would stall the reveal. Use <code>[pause=…]</code>.`, "err");
          else open.push({ name, speed: true, value: m, start: visible });
          continue;
        }
        const kind = FX.find((f) => f === name.toLowerCase());
        if (!kind) {
          warn(`Unknown effect tag <code>[${inner}]</code>. Known: ${KNOWN_FX.join(", ")}.`, "err");
          continue;
        }
        let amp = 1;
        if (param !== null) {
          const a = num(param);
          if (a === null) warn(`<code>[${inner}]</code> has an amplitude that isn't a number. Using 1.`);
          else amp = a;
        }
        open.push({ name, kind, value: amp, start: visible });
        continue;
      }

      out.push(c); styles.push({ ...tmp }); visible++; i++;
    }

    for (let k = open.length - 1; k >= 0; k--) {
      warn(`Unclosed <code>[${open[k].name}]</code>. Closed at end of line.`);
      close(open[k], visible - 1);
    }

    return { text: out.join(""), visible, effects, speeds, pauses, styles };
  }

  /* First ':' that is not inside a <...> — so a line opening with rich text does
     not take its speaker to be "<color=#c81e1e>SHERIFF". */
  function speakerColon(t) {
    let inTag = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (c === "<") inTag = true;
      else if (c === ">") inTag = false;
      else if (c === ":" && !inTag) return i;
    }
    return -1;
  }

  function parseConversation(src) {
    const warns = [];
    const nodes = [];
    const labels = new Set();
    let cur = null;

    const warn = (line, msg, sev) => warns.push({ line, msg, sev: sev || "warn" });
    const seal = () => { if (cur) nodes.push(cur); cur = null; };
    const blank = (label, line) => ({
      label: label || "", line, lines: [], choices: [], tags: [], untags: [],
      perks: [], grants: [], jump: null, ends: false, timer: 0, timerTo: null
    });

    (src || "").split("\n").forEach((rawLine, idx) => {
      const n = idx + 1;
      const t = rawLine.replace(/\r$/, "").trim();
      if (!t || t.startsWith("//")) return;

      if (t[0] === "#") {
        seal();
        const label = t.slice(1).trim();
        if (!label) warn(n, "<code>#</code> with no label. Nothing can jump to this node.");
        else if (labels.has(label.toLowerCase()))
          warn(n, `A node labelled <code>${esc(label)}</code> already exists. Jumps reach the first.`, "err");
        else labels.add(label.toLowerCase());
        cur = blank(label, n);
        return;
      }

      if (!cur) cur = blank("", n);   // implicit opening node

      if (t.startsWith("->")) {
        const to = t.slice(2).trim();
        if (!to) { warn(n, "<code>-&gt;</code> with no target. Dropped."); return; }
        if (cur.jump || cur.ends) { warn(n, "A second <code>-&gt;</code> in one node. Only the first is used."); return; }
        if (to.toLowerCase() === "end") cur.ends = true; else cur.jump = to;
        return;
      }

      if (t[0] === ">") {
        let body = t.slice(1).trim();
        let gate = null, neg = false;

        // A gate and an effect both open with '[' — the effect vocabulary is the only
        // thing separating them, exactly as in DialogueParser.ReadChoice.
        if (body[0] === "[") {
          const rb = body.indexOf("]");
          if (rb > 0) {
            const inner = body.slice(1, rb).trim();
            if (!isEffectTag(inner)) {
              neg = inner.startsWith("!");
              gate = (neg ? inner.slice(1) : inner).trim();
              if (!gate) { warn(n, "A choice gate with no tag name. Ignored."); gate = null; }
              body = body.slice(rb + 1).trimStart();
            }
          }
        }

        let target = null;
        const arrow = body.lastIndexOf("->");
        if (arrow >= 0) {
          target = body.slice(arrow + 2).trim();
          body = body.slice(0, arrow).trimEnd();
          if (!target) { warn(n, "A choice's <code>-&gt;</code> has no target. Falls through."); target = null; }
        }
        if (!body) { warn(n, "A choice with no text. Dropped.", "err"); return; }
        cur.choices.push({ line: n, target, gate, neg, t: parseEffects(body, warns, n) });
        return;
      }

      if (t[0] === "@") {
        const rest = t.slice(1).trim();
        const sp = rest.indexOf(" ");
        const name = (sp < 0 ? rest : rest.slice(0, sp)).toLowerCase();
        const arg = sp < 0 ? "" : rest.slice(sp + 1).trim();

        if (name === "tag" || name === "untag") {
          if (!arg) { warn(n, `<code>@${name}</code> with no tag name. Dropped.`); return; }
          if (arg.includes(" ")) warn(n, `<code>@${name} ${esc(arg)}</code> contains a space. Tags are single words.`);
          (name === "tag" ? cur.tags : cur.untags).push(arg);
          return;
        }
        if (name === "perk") {
          if (!arg) { warn(n, "<code>@perk</code> with no perk name. Dropped."); return; }
          arg.split(",").map((p) => p.trim()).filter(Boolean).forEach((p) => {
            if (!PERKS.some((k) => k.toLowerCase() === p.toLowerCase()))
              warn(n, `<code>@perk ${esc(p)}</code> is not an EnemyPerk. Known: ${PERKS.join(", ")}.`, "err");
            else cur.perks.push(p);
          });
          return;
        }
        if (name === "grant") {
          let g = arg;
          if (g.length > 1 && g[0] === '"' && g.endsWith('"')) g = g.slice(1, -1).trim();
          if (!g) { warn(n, "<code>@grant</code> with no upgrade name. Dropped."); return; }
          cur.grants.push(g);
          return;
        }
        if (name === "timer") {
          const arrow = arg.lastIndexOf("->");
          if (arrow < 0) { warn(n, "<code>@timer</code> needs a fallback, as <code>@timer 4 -&gt; back_down</code>.", "err"); return; }
          const secs = num(arg.slice(0, arrow).trim());
          const to = arg.slice(arrow + 2).trim();
          if (secs === null || secs <= 0) { warn(n, "<code>@timer</code> needs a length in seconds. Dropped.", "err"); return; }
          if (!to) { warn(n, "<code>@timer</code> with no fallback target. Dropped.", "err"); return; }
          if (cur.timer > 0) { warn(n, "A second <code>@timer</code> in one node. Only the first is used."); return; }
          cur.timer = secs; cur.timerTo = to;
          return;
        }
        warn(n, `Unknown directive <code>@${esc(name)}</code>. Known: @tag, @untag, @perk, @grant, @timer.`, "err");
        return;
      }

      const colon = speakerColon(t);
      if (colon <= 0) {
        warn(n, "No speaker on this line. Dialogue is <code>SPEAKER: text</code>; a comment needs <code>//</code>.", "err");
        return;
      }
      const who = t.slice(0, colon).trim();
      const body = t.slice(colon + 1).trim();
      if (!body) warn(n, `<code>${esc(who)}</code> has an empty line. It still takes a press.`);
      cur.lines.push({ line: n, who, t: parseEffects(body, warns, n) });
    });

    seal();

    const byLabel = new Map();
    nodes.forEach((nd, i) => { if (nd.label && !byLabel.has(nd.label.toLowerCase())) byLabel.set(nd.label.toLowerCase(), i); });
    return { nodes, byLabel, warns };
  }

  /* ==================================================================
     CHECKS — the cross-cutting ones the line parser cannot see
     ================================================================== */

  function validate(conv, cast) {
    const out = conv.warns.slice();
    const { nodes, byLabel } = conv;
    const has = (l) => l && (l.toLowerCase() === "end" || byLabel.has(l.toLowerCase()));
    const where = (nd, i) => (nd.label ? `node <code>${esc(nd.label)}</code>` : `the opening node (#${i})`);

    const written = new Set();
    nodes.forEach((nd) => nd.tags.forEach((t) => written.add(t.toLowerCase())));

    nodes.forEach((nd, i) => {
      if (nd.jump && !has(nd.jump))
        out.push({ line: nd.line, sev: "err", msg: `${where(nd, i)} jumps to <code>-&gt; ${esc(nd.jump)}</code>, which is not a node in this file.` });
      if (nd.timerTo && !has(nd.timerTo))
        out.push({ line: nd.line, sev: "err", msg: `${where(nd, i)} has a timer falling back to <code>${esc(nd.timerTo)}</code>, which is not a node in this file.` });

      nd.choices.forEach((c) => {
        if (c.target && !has(c.target))
          out.push({ line: c.line, sev: "err", msg: `Choice targets <code>-&gt; ${esc(c.target)}</code>, which is not a node in this file.` });
        if (c.gate) {
          const g = c.gate.toLowerCase();
          if (g.startsWith(SEEN_PREFIX)) return;
          if (!written.has(g))
            out.push({ line: c.line, sev: "warn", msg: `<code>[${esc(c.gate)}]</code> is never set by <code>@tag</code> in this file, so this option can never appear here. Likely a typo — or it is set in another conversation.` });
        }
      });

      nd.tags.forEach((t) => {
        if (isEffectTag(t))
          out.push({ line: nd.line, sev: "err", msg: `<code>@tag ${esc(t)}</code> is named after a text effect. A gate <code>[${esc(t)}]</code> would read as an effect and the option would always show. Rename it.` });
      });

      if (!nd.lines.length && !nd.choices.length && !nd.jump && !nd.ends)
        out.push({ line: nd.line, sev: "warn", msg: `${where(nd, i)} has no lines, no choices and no jump. It falls straight through — delete it, or give it something to do.` });

      if (cast.length) {
        nd.lines.forEach((l) => {
          if (l.who === "{ENEMY}") return;
          if (!cast.some((c) => c.key.toLowerCase() === l.who.toLowerCase()))
            out.push({ line: l.line, sev: "warn", msg: `<code>${esc(l.who)}</code> is not in the Cast list. In Unity they would show under that key with no portrait, on the left.` });
        });
      }
    });

    // Reachability from node 0, counting every exit conservatively.
    if (nodes.length > 1) {
      const seen = new Array(nodes.length).fill(false);
      const q = [0]; seen[0] = true;
      while (q.length) {
        const i = q.shift(), nd = nodes[i];
        const go = (j) => { if (j >= 0 && j < nodes.length && !seen[j]) { seen[j] = true; q.push(j); } };
        if (nd.jump && byLabel.has(nd.jump.toLowerCase())) go(byLabel.get(nd.jump.toLowerCase()));
        if (nd.timerTo && byLabel.has(nd.timerTo.toLowerCase())) go(byLabel.get(nd.timerTo.toLowerCase()));
        nd.choices.forEach((c) => {
          if (!c.target) go(i + 1);
          else if (byLabel.has(c.target.toLowerCase())) go(byLabel.get(c.target.toLowerCase()));
        });
        if (!nd.choices.length && !nd.jump && !nd.ends) go(i + 1);
      }
      nodes.forEach((nd, i) => {
        if (!seen[i]) out.push({ line: nd.line, sev: "err", msg: `${where(nd, i)} cannot be reached from the start of the conversation. Writing the player will never see.` });
      });
    }

    out.sort((a, b) => a.line - b.line);
    return out;
  }

  // ---- converter vocabulary ----------------------------------------------

  // Verbs that introduce speech: 'The sheriff says, "..."' and 'Sheriff says: ...'.
  const SPEECH_VERBS = [
    "says", "replies", "shouts", "whispers", "asks", "yells", "growls", "answers",
    "responds", "mutters", "snaps", "warns", "calls", "adds", "continues", "remarks", "declares"
  ];
  // Verbs that describe an action and only imply speech when a quote follows.
  const ACTION_VERBS = ["narrows", "raises", "lowers", "chuckles", "laughs", "draws", "sighs"];

  // A speaker name longer than this is almost certainly a sentence, not a name.
  const MAX_SPEAKER_WORDS = 3;

  // Labels that look like 'NAME: text' but are notes to the reader, not characters.
  const NON_SPEAKER_LABELS = ["note", "notes", "time", "setting", "location", "action", "aside", "todo", "tip"];

  // A quoted passage (2 capture groups: double- or single-quoted). A single quote inside
  // a word, like the one in "don't", is not a quote mark.
  const QUOTED = `(?:"([^"]+)"|(?<!\\w)'(.+?)'(?!\\w))`;

  const REVERSE_SPEECH = new RegExp(
    `^${QUOTED}[,.]?\\s+(?:the\\s+)?([A-Za-z][A-Za-z0-9_-]*)\\s+(?:${SPEECH_VERBS.join("|")})\\b`, "i");
  const FORWARD_SPEECH = new RegExp(
    `^(?:the\\s+)?([A-Za-z][A-Za-z0-9_-]*)\\s+(?:${SPEECH_VERBS.concat(ACTION_VERBS).join("|")})\\b.*?${QUOTED}`, "i");

  /**
   * Converts loose text (e.g. from a Google Doc) to script format. Lines it cannot place
   * become "// ?? ..." comments, and valid script passes through unchanged.
   * Returns the script plus a note ({line, msg, sev}) for every line it had to guess about.
   */
  function convertScript(rawText) {
    if (!rawText) return { text: "", notes: [] };

    // Smart punctuation from Word/Docs becomes plain text. Comments skip this.
    const plain = (s) => s
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u2026/g, "...")
      .replace(/[\u2013\u2014]/g, "--")
      .replace(/\u00A0/g, " ");

    const lines = String(rawText).replace(/\r\n?/g, "\n").split("\n");
    const output = [];
    const notes = [];
    let lineNo = 0;
    let hasNode = false;

    // Line numbers refer to the pasted text, not the converted output.
    const note = (msg) => notes.push({ line: lineNo, msg, sev: "warn" });

    const normalizeSpeaker = (name) => {
      const s = name.trim().replace(/^the\s+/i, "");

      if (/^\{?player\}?$/i.test(s)) return "{PLAYER}";
      if (/^\{?enemy\}?$/i.test(s)) return "{ENEMY}";

      return s.toUpperCase().replace(/\s+/g, " ");
    };

    // Turns the text before a colon into a speaker key, or null when it is not a name.
    // "Sheriff says" -> SHERIFF. "He walks in and says" and "Note" -> null.
    const speakerFromLabel = (label) => {
      const words = label.trim().split(/\s+/);

      if (words.length > 1 && SPEECH_VERBS.includes(words[words.length - 1].toLowerCase())) words.pop();
      if (words.length > MAX_SPEAKER_WORDS) return null;
      if (NON_SPEAKER_LABELS.includes(words.join(" ").toLowerCase())) return null;

      return normalizeSpeaker(words.join(" "));
    };

    const normalizeNode = (name) => {
      let s = name.trim();

      s = s.replace(/^(?:if|when)\s+/i, "");
      s = s.replace(/^the\s+player\s+(?:chooses|picks|decides\s+to)\s+(?:to\s+)?/i, "");
      s = s.replace(/[.!?:]+$/g, "");

      return s.toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "");
    };

    // Recognise headings such as:
    // # opening
    // Node: Fight
    // Scene: Opening
    // [fight]
    // The player chooses to fight:
    const getHeading = (line) => {
      let m = line.match(/^(?:#+\s*|Node:\s*|Scene:\s*|Section:\s*)(.+)$/i);
      if (m) return m[1].trim();

      m = line.match(/^\[([a-zA-Z0-9_-]+)\]$/);
      if (m) return m[1];

      m = line.match(
        /^(?:(?:if|when)\s+)?(?:the\s+)?player\s+(?:chooses|picks|decides\s+to)\s+(?:to\s+)?(.+?)\s*:?\s*$/i
      );
      if (m) return m[1].trim();

      return null;
    };

    // Lines before any heading belong to an implicit first node.
    const ensureStartNode = () => {
      if (!hasNode) {
        output.push("# opening");
        hasNode = true;
      }
    };

    for (const [i, rawLine] of lines.entries()) {
      lineNo = i + 1;
      const raw = rawLine.trim();

      if (!raw) {
        if (output.length && output[output.length - 1] !== "") output.push("");
        continue;
      }

      if (raw.startsWith("//")) {
        output.push(raw);
        continue;
      }

      const t = plain(raw);

      // Lines already in script syntax ("# node", "> choice") are kept as written.
      if (/^#(?!#)/.test(t) || t[0] === ">") {
        if (t[0] === "#") hasNode = true;
        else ensureStartNode();
        output.push(t);
        continue;
      }

      // Branch or scene heading.
      const heading = getHeading(t);

      if (heading) {
        const label = normalizeNode(heading);

        if (!label) {
          output.push(`// TODO: Could not interpret heading: ${t}`);
          note("Heading has no usable label. Left as a TODO comment.");
          continue;
        }

        output.push(`# ${label}`);
        hasNode = true;
        continue;
      }

      if (/^@(tag|untag|perk|grant|timer)\b/i.test(t)) {
        ensureStartNode();
        output.push(t);
        continue;
      }

      // A jump needs an explicit marker. A bare "Jump up" or "Exit saloon" is prose.
      const jumpMatch = t.match(
        /^(?:->\s*|goto\b\s*:?\s*|(?:jump|exit)\s+to\b\s*:?\s*)([a-zA-Z0-9_-]+)\s*$/i
      );

      if (jumpMatch) {
        ensureStartNode();

        const target = jumpMatch[1];

        output.push(target.toUpperCase() === "END" ? "-> END" : `-> ${target}`);
        continue;
      }

      // Bullets, "1." / "2)" numbering (a space must follow, so "3.5 miles" is not one),
      // and "Option A:" labels.
      const choiceMatch = t.match(
        /^(?:[-*•]\s+|Option\s+\w+\s*:\s*|Choice\s+\w+\s*:\s*|\d+[.)]\s+)(.+)$/i
      );

      if (choiceMatch) {
        ensureStartNode();

        let body = choiceMatch[1].trim();
        let gate = "";

        const gateMatch = body.match(
          /^(?:\(\s*(?:if\s+)?(!?[a-zA-Z0-9_-]+)\s*\)|\[\s*(!?[a-zA-Z0-9_-]+)\s*\])\s*/i
        );
        const gateName = gateMatch && (gateMatch[1] || gateMatch[2]);

        // "[shake]" opens a text effect, not a gate. The script parser tells the two
        // apart by the same vocabulary check.
        if (gateName && !isEffectTag(gateName)) {
          gate = `[${gateName}] `;
          body = body.slice(gateMatch[0].length).trim();
        }

        const arrowMatch = body.match(/\s*->\s*([a-zA-Z0-9_-]+)\s*$/);
        let target = "";

        if (arrowMatch) {
          target = arrowMatch[1];
          body = body.slice(0, arrowMatch.index).trim();
        }

        // Skip the marker if it is already there, so converting twice does not stack them.
        const todo = `// TODO: Confirm this choice should fall through: ${body}`;
        if (!target && output[output.length - 1] !== todo) output.push(todo);
        if (!target) note("Choice has no <code>-&gt;</code> target. It falls through to the next node.");

        output.push(`> ${gate}${body}${target ? ` -> ${target}` : ""}`);
        continue;
      }

      // "SPEAKER: text", optionally "SPEAKER (direction): text". The direction is kept
      // as a comment so the writer's stage note is not lost.
      const dialogueMatch = t.match(
        /^([A-Za-z0-9_{}][A-Za-z0-9_{} -]*?)(?:\s*\(([^)]*)\))?\s*:\s*(.*)$/
      );
      const speaker = dialogueMatch && speakerFromLabel(dialogueMatch[1]);

      if (speaker) {
        ensureStartNode();

        const direction = (dialogueMatch[2] || "").trim();

        if (direction) {
          output.push(`// direction: ${direction}`);
          note(`Direction <code>(${esc(direction)})</code> moved into a comment.`);
        }
        output.push(`${speaker}: ${dialogueMatch[3].trim()}`);
        continue;
      }

      // Speech written as prose: '"Get out." the sheriff growls.'
      const reverseMatch = t.match(REVERSE_SPEECH);

      if (reverseMatch) {
        ensureStartNode();
        const who = normalizeSpeaker(reverseMatch[3]);

        // A comma before the closing quote belongs to the sentence, not the line.
        output.push(`${who}: ${(reverseMatch[1] || reverseMatch[2]).trim().replace(/,$/, "")}`);
        note(`Speaker <code>${esc(who)}</code> was taken from a sentence. Check it.`);
        continue;
      }

      // ...and 'The sheriff says, "Ten paces."'
      const forwardMatch = t.match(FORWARD_SPEECH);

      if (forwardMatch) {
        ensureStartNode();
        const who = normalizeSpeaker(forwardMatch[1]);

        output.push(`${who}: ${(forwardMatch[2] || forwardMatch[3]).trim()}`);
        note(`Speaker <code>${esc(who)}</code> was taken from a sentence. Check it.`);
        continue;
      }

      // Anything else is kept, but as a comment, so nothing is silently lost.
      ensureStartNode();
      output.push(`// ?? ${t}`);
      note("Not recognised. Kept as a <code>// ??</code> comment.");
    }

    return {
      text: output.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
      notes
    };
  }

  // Text-only form, for callers that do not need the notes.
  const translateGoogleDocToUnityScript = (rawText) => convertScript(rawText).text;

  return {
    // vocabulary, grammar aspects
    FX, TIMING, KNOWN_FX, PERKS, SEEN_PREFIX,
    // parsing and validation
    splitTag, isKnownTag, isEffectTag, parseEffects, speakerColon,
    parseConversation, validate,
    // conversion
    convertScript, translateGoogleDocToUnityScript,
    // helpers
    esc
  };
});
