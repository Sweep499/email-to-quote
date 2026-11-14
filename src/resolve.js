// Pure logic: turn model-extracted attributes into a full configuration (defaults filled in).
// No network access here, so it can be unit-tested.

const norm = (s) => String(s ?? "").trim().toLowerCase();

/**
 * @param template { id, name, attributes: [{ id, name, values: [{id, name, is_default?}] }] }
 * @param stated   [{ attribute: string, value: string, evidence: string }]
 * @returns { config: [{attribute, attributeId, value, valueId, source, evidence, candidates?}], unmatched: [...] }
 */
export function resolveConfig(template, stated) {
  const config = [];
  const used = new Set();

  for (const attr of template.attributes) {
    const hit = (stated || []).find((s) => norm(s.attribute) === norm(attr.name));
    let chosen = null;
    let source = "default";
    let evidence = "";

    if (hit) {
      used.add(hit);
      const exact = attr.values.find((v) => norm(v.name) === norm(hit.value));
      if (exact) {
        chosen = exact;
        source = "stated";
        evidence = hit.evidence || "";
      } else {
        // Customer mentioned the attribute but value is not one of ours -> keep default, flag it.
        evidence = `Customer asked for "${hit.value}" (not an available value). ${hit.evidence || ""}`.trim();
        source = "default (unmatched request)";
      }
    }
    if (!chosen) chosen = attr.values.find((v) => v.is_default) || attr.values[0] || null;

    config.push({
      attribute: attr.name,
      attributeId: attr.id,
      value: chosen ? chosen.name : null,
      valueId: chosen ? chosen.id : null,
      source,
      evidence,
    });
  }

  const unmatched = (stated || []).filter((s) => !used.has(s));
  return { config, unmatched };
}

/**
 * Customer requests that could not be honoured for one line: values that are not
 * in the catalog (a default was used instead) and attributes the product does not have.
 * @returns string[]  e.g. ['Exterior Finish: customer asked for "Black" - default used (Chalk White)']
 */
export function unmatchedRequests(config, unmatched) {
  const flags = [];
  for (const c of config) {
    if (String(c.source).startsWith("default (unmatched")) {
      const m = /Customer asked for "([^"]*)"/.exec(c.evidence || "");
      flags.push(`${c.attribute}: customer asked for "${m ? m[1] : "?"}" - default used (${c.value})`);
    }
  }
  for (const u of unmatched || []) flags.push(`${u.attribute}: customer asked for "${u.value}" - not an option on this product`);
  return flags;
}

/**
 * Compact text form of the catalog for the prompt (much fewer tokens than JSON).
 * Names must stay exact: the model has to echo them back.
 */
export function formatCatalog(catalog) {
  return catalog
    .map(
      (t) =>
        `[${t.id}] ${t.name}\n` +
        t.attributes.map((a) => `- ${a.name}: ${a.values.map((v) => v.name).join(" | ")}`).join("\n")
    )
    .join("\n\n");
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function stripHtml(html) {
  return String(html ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
