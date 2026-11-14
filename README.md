# email-to-quote

Odoo CRM lead (from email alias) -> webhook -> Cloudflare Worker -> Claude extracts requested attributes ->
defaults filled from Odoo -> draft sale.order + chatter review note + activity.

## 1. GitHub secrets (repo Settings -> Secrets -> Actions)
| Secret | Value |
|---|---|
| CLOUDFLARE_API_TOKEN | API token with "Edit Cloudflare Workers" permission |
| CLOUDFLARE_ACCOUNT_ID | from Cloudflare dashboard |
| WEBHOOK_SECRET | any long random string |
| ANTHROPIC_API_KEY | Claude API key |
| ODOO_URL | e.g. https://yourdb.odoo.com |
| ODOO_DB | database name |
| ODOO_LOGIN | login of a dedicated API user |
| ODOO_API_KEY | API key of that user (Preferences -> Account Security) |

Push to `main` -> the Action tests, deploys the Worker and syncs the secrets.

## 2. Odoo automation rule (Settings -> Technical -> Automation Rules)
- Model: Lead/Opportunity, Trigger: On creation, Before update domain/filter: Sales Team = "API TEST"
- Action: Send Webhook Notification
- URL: `https://email-to-quote.<your-subdomain>.workers.dev`
- The Worker only needs the record id (`_id`), it reads everything else over JSON-RPC.
- Add header `x-webhook-secret: <WEBHOOK_SECRET>` if your Odoo version lets you set headers.
  If it does not, tell me and we switch to a secret in the URL query (`?s=...`).

## 3. Defaults
Default value of an attribute = its FIRST value (by sequence) on the product.
Reorder values in Odoo, or later add a "default" flag field.

## 4. Test
Set `DRY_RUN = "true"` in wrangler.toml to only get the chatter note without a quote.
Send an email to the team alias, open the lead, read the chatter. Failures are posted there too.
