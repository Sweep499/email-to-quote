// Minimal Odoo JSON-RPC client (works with Odoo 17/18 via /jsonrpc and an API key).
export class Odoo {
  constructor(env) {
    this.url = env.ODOO_URL.replace(/\/$/, "");
    this.db = env.ODOO_DB;
    this.login = env.ODOO_LOGIN;
    this.key = env.ODOO_API_KEY;
    this.uid = null;
  }
  async rpc(service, method, args) {
    const r = await fetch(`${this.url}/jsonrpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args }, id: Date.now() }),
    });
    const j = await r.json();
    if (j.error) throw new Error(`Odoo ${method}: ${j.error.data?.message || j.error.message}`);
    return j.result;
  }
  async auth() {
    if (this.uid) return this.uid;
    this.uid = await this.rpc("common", "authenticate", [this.db, this.login, this.key, {}]);
    if (!this.uid) throw new Error("Odoo authentication failed");
    return this.uid;
  }
  async call(model, method, args = [], kwargs = {}) {
    await this.auth();
    return this.rpc("object", "execute_kw", [this.db, this.uid, this.key, model, method, args, kwargs]);
  }
  search_read(model, domain, fields, kwargs = {}) {
    return this.call(model, "search_read", [domain], { fields, ...kwargs });
  }
}
