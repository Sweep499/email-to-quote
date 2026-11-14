import assert from "node:assert/strict";
import { resolveConfig, stripHtml, unmatchedRequests, formatCatalog } from "../src/resolve.js";

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

// unmatched requests are listed for the quote line
r = resolveConfig(tmpl, [
  { attribute: "Color", value: "Purple", evidence: "in purple" },
  { attribute: "Wheels", value: "yes", evidence: "x" },
]);
const flags = unmatchedRequests(r.config, r.unmatched);
assert.equal(flags.length, 2);
assert.match(flags[0], /Color: customer asked for "Purple" - default used \(Oak\)/);
assert.match(flags[1], /Wheels/);
assert.deepEqual(unmatchedRequests(resolveConfig(tmpl, []).config, []), []);

// generic word matching several catalog values -> lowest id assumed, alternatives listed, flagged
const tmpl2 = {
  id: 2, name: "Work",
  attributes: [
    { id: 20, name: "Exterior Finish", values: [
      { id: 205, name: "Chalk White (RAL 9010)" },
      { id: 203, name: "Charcoal Black (RAL 8022)" },
      { id: 204, name: "Textile Black (Zero ZER33 Climb)" },
    ] },
  ],
};
r = resolveConfig(tmpl2, [{ attribute: "Exterior Finish", value: "black", evidence: "should be black" }]);
assert.equal(r.config[0].value, "Charcoal Black (RAL 8022)");
assert.match(r.config[0].source, /assumed/);
assert.deepEqual(r.config[0].assumed.alternatives, ["Textile Black (Zero ZER33 Climb)"]);
const f2 = unmatchedRequests(r.config, r.unmatched);
assert.equal(f2.length, 1);
assert.match(f2[0], /assumed Charcoal Black \(RAL 8022\), please confirm\. Other options: Textile Black/);
// a word that is only part of another word must not match ("lack" vs "Black"); regex chars are safe
r = resolveConfig(tmpl2, [{ attribute: "Exterior Finish", value: "lack", evidence: "x" }]);
assert.match(r.config[0].source, /unmatched/);
r = resolveConfig(tmpl2, [{ attribute: "Exterior Finish", value: "(", evidence: "x" }]);
assert.match(r.config[0].source, /unmatched/);

// compact catalog keeps ids and exact names
const cat = formatCatalog([{ ...tmpl, attributes: tmpl.attributes }]);
assert.match(cat, /^\[1\] Meet 2\n- Color: Oak \| Black\n- Door: Standard \| Sliding$/);

assert.equal(stripHtml("<p>Hi&nbsp;there</p><div>Need 2</div>"), "Hi there\nNeed 2");
console.log("tests ok");
