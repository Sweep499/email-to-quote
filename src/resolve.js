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
    let assumed = null;

    if (hit) {
      used.add(hit);
      const exact = attr.values.find((v) => norm(v.name) === norm(hit.value));
      if (exact) {
        chosen = exact;
        source = "stated";
        evidence = hit.evidence || "";
      } else {
        // Not an exact value. Catalog values that contain the customer's word(s) as whole words
        // (e.g. "black" -> "Charcoal Black (RAL 8022)", "Textile Black (...)") are candidates.
        // Assume the lowest-id one and ask for confirmation. No candidates -> keep default, flag it.
        const word = new RegExp(`(^|[^\\p{L}\\p{N}])${String(hit.value).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu");
        const candidates = norm(hit.value)
          ? attr.values.filter((v) => word.test(v.name)).sort((a, b) => a.id - b.id)
          : [];
        if (candidates.length) {
          chosen = candidates[0];
          source = "assumed - please confirm";
          assumed = { requested: hit.value, alternatives: candidates.slice(1).map((v) => v.name) };
          evidence = `Customer said "${hit.value}". ${hit.evidence || ""}`.trim();
        } else {
          evidence = `Customer asked for "${hit.value}" (not an available value). ${hit.evidence || ""}`.trim();
          source = "default (unmatched request)";
        }
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
      ...(assumed ? { assumed } : {}),
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
    if (c.assumed) {
      const alt = c.assumed.alternatives.length ? ` Other options: ${c.assumed.alternatives.join("; ")}.` : "";
      flags.push(`${c.attribute}: customer said "${c.assumed.requested}" - assumed ${c.value}, please confirm.${alt}`);
    } else if (String(c.source).startsWith("default (unmatched")) {
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
