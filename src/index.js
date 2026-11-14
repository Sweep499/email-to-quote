import { Odoo } from "./odoo.js";
import { extractRequest } from "./claude.js";
import { resolveConfig, esc, stripHtml } from "./resolve.js";

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("email-to-quote ok", { status: 200 });
    // Secret may come as a header or, if Odoo can't set headers, as ?secret=... in the URL.
    const provided = request.headers.get("x-webhook-secret") ?? new URL(request.url).searchParams.get("secret");
    if (!env.WEBHOOK_SECRET || provided !== env.WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("bad json", { status: 400 });
    }
    // Odoo 18 webhook automation sends the record id as `_id` (plus selected fields).
    const leadId = Number(body._id ?? body.id ?? body.lead_id);
    if (!leadId) return new Response("missing lead id", { status: 400 });

    // Respond fast, do the work in the background.
    ctx.waitUntil(
      processLead(env, leadId).catch(async (e) => {
        console.error("processLead failed", e);
        try {
          const odoo = new Odoo(env);
          await odoo.call("crm.lead", "message_post", [[leadId]], {
            body: `<p><b>Auto-quote failed:</b> ${esc(e.message)}</p>`,
            message_type: "comment",
            subtype_xmlid: "mail.mt_note",
          });
        } catch {}
      })
    );
    return new Response("accepted", { status: 202 });
  },
};

async function loadCatalog(odoo) {
  const templates = await odoo.search_read(
    "product.template",
    [["sale_ok", "=", true], ["attribute_line_ids", "!=", false]],
    ["id", "name", "attribute_line_ids"],
    { limit: 100 }
  );
  const lineIds = templates.flatMap((t) => t.attribute_line_ids);
  const lines = lineIds.length
    ? await odoo.call("product.template.attribute.line", "read", [lineIds, ["product_tmpl_id", "attribute_id", "value_ids"]])
    : [];
  const valueIds = [...new Set(lines.flatMap((l) => l.value_ids))];
  const values = valueIds.length
    ? await odoo.call("product.attribute.value", "read", [valueIds, ["name", "sequence"]])
    : [];
  const valueById = Object.fromEntries(values.map((v) => [v.id, v]));

  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    attributes: lines
      .filter((l) => l.product_tmpl_id[0] === t.id)
      .map((l) => ({
        id: l.attribute_id[0],
        name: l.attribute_id[1],
        values: l.value_ids
          .map((id) => valueById[id])
          .filter(Boolean)
          .sort((a, b) => a.sequence - b.sequence || a.id - b.id)
          .map((v) => ({ id: v.id, name: v.name })), // first value = default (see README)
      })),
  }));
}

async function findVariant(odoo, templateId, valueIds) {
  // Map attribute value ids -> product.template.attribute.value ids for this template
  const ptavs = await odoo.search_read(
    "product.template.attribute.value",
    [["product_tmpl_id", "=", templateId], ["product_attribute_value_id", "in", valueIds]],
    ["id", "product_attribute_value_id"]
  );
  const ptavIds = ptavs.map((p) => p.id);
  if (ptavIds.length !== valueIds.length) return null;
  const domain = [["product_tmpl_id", "=", templateId], ...ptavIds.map((id) => ["product_template_attribute_value_ids", "=", id])];
  const found = await odoo.search_read("product.product", domain, ["id"], { limit: 1 });
  return found[0]?.id ?? null;
}

async function processLead(env, leadId) {
  const odoo = new Odoo(env);

  // The webhook may fire before the creating transaction is committed, so the lead
  // can be invisible for a moment. Retry before giving up.
  let lead;
  for (let attempt = 0; attempt < 8 && !lead; attempt++) {
    [lead] = await odoo.search_read(
      "crm.lead",
      [["id", "=", leadId]],
      ["name", "email_from", "contact_name", "partner_name", "partner_id", "team_id", "user_id", "description"]
    );
    if (!lead) await new Promise((r) => setTimeout(r, 2500));
  }
  if (!lead) throw new Error(`Lead ${leadId} not found (check the API user can access the lead's team)`);

  // Idempotency: do nothing if a quote already exists for this opportunity.
  const existing = await odoo.call("sale.order", "search_count", [[["opportunity_id", "=", leadId]]]);
  if (existing) return;

  // Original email = first incoming email message in the chatter (fallback: lead description).
  // The webhook can fire before the mail gateway has posted the email into the chatter,
  // so retry a few times before giving up.
  let msgs = [];
  let emailText = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    msgs = await odoo.search_read(
      "mail.message",
      [["model", "=", "crm.lead"], ["res_id", "=", leadId], ["message_type", "=", "email"]],
      ["body", "subject"],
      { order: "id asc", limit: 1 }
    );
    emailText = stripHtml(msgs[0]?.body || lead.description || "");
    if (emailText) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (!emailText) throw new Error("No email text found on the lead");
  const subject = msgs[0]?.subject || lead.name || "";

  const catalog = await loadCatalog(odoo);
  const { result, usage } = await extractRequest(env, `Subject: ${subject}\n\n${emailText}`, catalog);

  // One group per quotation (customer may ask for several separate offers).
  const groups = new Map(); // label -> { quoteLines, rows, orderName }
  const warnings = [];

  for (const l of result.lines) {
    const tmpl = catalog.find((t) => t.id === l.template_id);
    if (!tmpl) {
      warnings.push(`Unknown product template id ${l.template_id}`);
      continue;
    }
    const label = (l.quote_label || "").trim() || "Quote";
    if (!groups.has(label)) groups.set(label, { quoteLines: [], rows: [], orderName: null });
    const g = groups.get(label);

    const { config, unmatched } = resolveConfig(tmpl, l.stated_attributes);
    for (const u of unmatched) warnings.push(`${tmpl.name}: customer mentioned "${u.attribute}: ${u.value}" - no such attribute`);
    for (const c of config) g.rows.push({ product: tmpl.name, qty: l.quantity, ...c });

    const variantId = await findVariant(odoo, tmpl.id, config.map((c) => c.valueId).filter(Boolean));
    if (variantId) {
      g.quoteLines.push([0, 0, { product_id: variantId, product_uom_qty: l.quantity || 1 }]);
    } else {
      warnings.push(`${tmpl.name}: no matching variant for the configuration (dynamic/excluded combination?) - add manually`);
    }
    if (l.notes) warnings.push(`${tmpl.name}: ${l.notes}`);
  }

  const multi = groups.size > 1;
  const dry = env.DRY_RUN === "true";
  const created = []; // { label, name }
  if (!dry && [...groups.values()].some((g) => g.quoteLines.length)) {
    let partnerId = lead.partner_id?.[0];
    if (!partnerId) {
      partnerId = await odoo.call("res.partner", "create", [{
        name: lead.partner_name || lead.contact_name || lead.email_from || "Unknown customer",
        email: lead.email_from || false,
      }]);
      await odoo.call("crm.lead", "write", [[leadId], { partner_id: partnerId }]);
    }
    for (const [label, g] of groups) {
      if (!g.quoteLines.length) continue;
      const orderId = await odoo.call("sale.order", "create", [{
        partner_id: partnerId,
        opportunity_id: leadId,
        team_id: lead.team_id?.[0] || false,
        ...(multi ? { client_order_ref: label } : {}),
        order_line: g.quoteLines,
      }]);
      const [order] = await odoo.call("sale.order", "read", [[orderId], ["name"]]);
      g.orderName = order.name;
      created.push({ label, name: order.name });
    }
  }

  // Review note in chatter
  const tableFor = (rows) =>
    `<table border="1" cellpadding="4" style="border-collapse:collapse"><tr><th>Product</th><th>Qty</th><th>Attribute</th><th>Value</th><th>Source</th><th>Evidence</th></tr>${rows
      .map((r) => `<tr><td>${esc(r.product)}</td><td>${esc(r.qty)}</td><td>${esc(r.attribute)}</td><td>${esc(r.value)}</td><td>${esc(r.source)}</td><td>${esc(r.evidence)}</td></tr>`)
      .join("")}</table>`;
  const tables = groups.size
    ? [...groups]
        .map(([label, g]) =>
          (multi ? `<p><b>${esc(label)}</b>${g.orderName ? ` - ${esc(g.orderName)}` : ""}</p>` : "") + tableFor(g.rows)
        )
        .join("")
    : "<p>No products could be identified.</p>";
  const list = (title, items) => (items.length ? `<p><b>${title}</b></p><ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "");

  const html =
    `<p><b>🤖 Auto-draft quote${multi ? "s" : ""}${dry ? " (dry run)" : ""}</b> - please review before sending.</p>` +
    `<p>${esc(result.summary)}</p>` +
    (created.length
      ? `<p>Draft quotation${created.length > 1 ? "s" : ""} created: ${created.map((c) => `<b>${esc(c.name)}</b>${multi ? ` (${esc(c.label)})` : ""}`).join(", ")}</p>`
      : "") +
    tables +
    list("Open questions", result.questions) +
    list("Warnings", warnings) +
    `<p style="color:#888">tokens in/out: ${usage?.input_tokens ?? "?"}/${usage?.output_tokens ?? "?"}, cache write: ${usage?.cache_creation_input_tokens ?? 0}, cache read: ${usage?.cache_read_input_tokens ?? 0}</p>`;

  const names = created.map((c) => c.name).join(", ");
  await odoo.call("crm.lead", "message_post", [[leadId]], { body: html, message_type: "comment", subtype_xmlid: "mail.mt_note" });
  await odoo.call("crm.lead", "activity_schedule", [[leadId]], {
    act_type_xmlid: "mail.mail_activity_data_todo",
    summary: names ? `Review auto-drafted quote(s) ${names}` : "Review auto-quote extraction",
    user_id: lead.user_id?.[0] || odoo.uid,
  });
}
