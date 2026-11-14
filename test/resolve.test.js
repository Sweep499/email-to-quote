import assert from "node:assert/strict";
import { resolveConfig, stripHtml } from "../src/resolve.js";

const tmpl = {
  id: 1, name: "Meet 2",
  attributes: [
    { id: 10, name: "Color", values: [{ id: 100, name: "Oak" }, { id: 101, name: "Black" }] },
    { id: 11, name: "Door", values: [{ id: 110, name: "Standard" }, { id: 111, name: "Sliding" }] },
  ],
};

// stated value matches, other attribute gets default
let r = resolveConfig(tmpl, [{ attribute: "color", value: "black", evidence: "in black" }]);
assert.equal(r.config[0].value, "Black");
assert.equal(r.config[0].source, "stated");
assert.equal(r.config[1].value, "Standard");
assert.equal(r.config[1].source, "default");

// unavailable value -> default + flagged
r = resolveConfig(tmpl, [{ attribute: "Door", value: "Glass pivot", evidence: "glass pivot door" }]);
assert.equal(r.config[1].value, "Standard");
assert.match(r.config[1].source, /unmatched/);

// unknown attribute reported
r = resolveConfig(tmpl, [{ attribute: "Wheels", value: "yes", evidence: "x" }]);
assert.equal(r.unmatched.length, 1);

assert.equal(stripHtml("<p>Hi&nbsp;there</p><div>Need 2</div>"), "Hi there\nNeed 2");
console.log("tests ok");
