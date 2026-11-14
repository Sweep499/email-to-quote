import assert from "node:assert/strict";
import { normalizeResult } from "../src/claude.js";

// model omitted questions / stated_attributes / quantity -> safe defaults
let r = normalizeResult({ summary: "x", lines: [{ template_id: "5" }] });
assert.deepEqual(r.questions, []);
assert.equal(r.lines[0].template_id, 5);
assert.equal(r.lines[0].quantity, 1);
assert.deepEqual(r.lines[0].stated_attributes, []);

// garbage in -> empty but valid shape
r = normalizeResult(null);
assert.deepEqual(r, { summary: "", questions: [], lines: [] });
r = normalizeResult({ lines: "nope", questions: [1, "ok"] });
assert.deepEqual(r.lines, []);
assert.deepEqual(r.questions, ["ok"]);
console.log("normalize tests ok");
