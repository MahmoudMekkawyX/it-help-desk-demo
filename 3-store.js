// Data layer. Two backends with the same interface:
//  - server: talks to /api (Node + SQLite). Used when the server is running.
//  - local:  keeps a demo database in the browser (localStorage). Used on static hosting (GitHub Pages).
(function () {
  const ENUMS = {
    tickets: { priority: ['Low', 'Medium', 'High', 'Critical'], status: ['Open', 'In Progress', 'Awaiting Vendor', 'Resolved', 'Closed'] },
    assets: { transactionType: ['Receiving', 'Return'], condition: ['Matched', 'Mismatched'] }
  };
  const REQUIRED = { tickets: ['title', 'requester'], kb: ['title'], assets: ['employeeName', 'transactionType'], links: ['category', 'title', 'url'] };

  // ---------- server backend ----------
  const server = {
    mode: 'server',
    async req(method, url, body) {
      const r = await fetch('api/' + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error(data.error || 'Request failed'); e.status = r.status; throw e; }
      return data;
    },
    async me() { try { return (await this.req('GET', 'me')).user; } catch { return null; } },
    async login(u, p) { return (await this.req('POST', 'login', { username: u, password: p })).user; },
    async logout() { await this.req('POST', 'logout'); },
    async changePassword(current, next) { await this.req('POST', 'password', { current, next }); },
    list(n) { return this.req('GET', n); },
    async save(n, item) { return item.id ? this.req('PUT', `${n}/${item.id}`, item) : this.req('POST', n, item); },
    remove(n, id) { return this.req('DELETE', `${n}/${id}`); },
    helpful(id) { return this.req('POST', `kb/${id}/helpful`); },
    listUsers() { return this.req('GET', 'users'); },
    createUser(u) { return this.req('POST', 'users', u); },
    resetUser(id, password) { return this.req('POST', `users/${id}/reset`, { password }); },
    deleteUser(id) { return this.req('DELETE', `users/${id}`); },
    resetDemo() { throw new Error('Not available on the server'); }
  };

  // ---------- local (browser) backend ----------
  const KEY = 'helpdeskDemoDB.v2', SESSION = 'helpdeskDemoSession.v2';
  const enc = new TextEncoder();
  async function sha(s) {
    const b = await crypto.subtle.digest('SHA-256', enc.encode(s));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  const salt = () => [...crypto.getRandomValues(new Uint8Array(8))].map(x => x.toString(16).padStart(2, '0')).join('');
  const iso = d => new Date(Date.now() - d * 86400000).toISOString();
  const fail = (m, status = 400) => { const e = new Error(m); e.status = status; return e; };

  const local = {
    mode: 'local', db: null, seedData: null,
    async init() {
      if (!this.seedData) this.seedData = await (await fetch('seed.json')).json();
      const raw = localStorage.getItem(KEY);
      if (raw) { try { this.db = JSON.parse(raw); return; } catch { /* rebuild */ } }
      await this.build();
    },
    async build() {
      const s = this.seedData; let id;
      const withIds = (arr, f) => arr.map((x, i) => ({ id: i + 1, ...f(x) }));
      const users = [];
      for (const [i, u] of s.users.entries()) { const sl = salt(); users.push({ id: i + 1, username: u.username, name: u.name, role: u.role, salt: sl, hash: await sha(sl + u.password), mustChange: false, createdAt: iso(30) }); }
      this.db = {
        users,
        tickets: withIds(s.tickets, t => ({ title: t.title, type: t.type, priority: t.priority, status: t.status, requester: t.requester, contact: t.contact, department: t.department, assignee: t.assignee, description: t.description, resolution: t.resolution || '', kbId: null, createdAt: iso(t.daysAgo), updatedAt: iso(t.daysAgo) })),
        kb: withIds(s.kb, k => ({ title: k.title, category: k.category, severity: k.severity, symptoms: k.symptoms, cause: k.cause, steps: k.steps, prevention: k.prevention, tags: k.tags, helpful: 0, createdAt: iso(20), updatedAt: iso(20) })),
        assets: withIds(s.assets, a => ({ ...a, createdAt: iso(a.daysAgo), daysAgo: undefined })),
        links: withIds(s.links, l => l)
      };
      this.persist();
    },
    persist() { localStorage.setItem(KEY, JSON.stringify(this.db)); },
    async resetDemo() { localStorage.removeItem(KEY); localStorage.removeItem(SESSION); await this.build(); },
    cur() { try { return JSON.parse(sessionStorage.getItem(SESSION)); } catch { return null; } },
    async me() { const c = this.cur(); if (!c) return null; const u = this.db.users.find(x => x.id === c.id); return u ? this.pub(u) : null; },
    pub(u) { return { id: u.id, username: u.username, name: u.name, role: u.role, mustChange: !!u.mustChange }; },
    async login(username, password) {
      const u = this.db.users.find(x => x.username === String(username || '').trim().toLowerCase());
      if (!u || (await sha(u.salt + String(password || ''))) !== u.hash) throw fail('Wrong username or password', 401);
      sessionStorage.setItem(SESSION, JSON.stringify({ id: u.id }));
      return this.pub(u);
    },
    async logout() { sessionStorage.removeItem(SESSION); },
    need(admin) { const c = this.cur(); if (!c) throw fail('Not signed in', 401); const u = this.db.users.find(x => x.id === c.id); if (admin && u.role !== 'admin') throw fail('Admins only', 403); return u; },
    async changePassword(current, next) {
      const u = this.need();
      if ((await sha(u.salt + current)) !== u.hash) throw fail('Current password is wrong');
      if (String(next).length < 8) throw fail('New password must be at least 8 characters');
      u.salt = salt(); u.hash = await sha(u.salt + next); u.mustChange = false; this.persist();
    },
    async list(n) { this.need(); const rows = this.db[n]; const c = [...rows]; if (n === 'tickets' || n === 'assets') c.sort((a, b) => b.id - a.id); if (n === 'kb') c.sort((a, b) => a.title.localeCompare(b.title)); if (n === 'links') c.sort((a, b) => (a.category + a.title).localeCompare(b.category + b.title)); return c; },
    check(n, item) {
      for (const r of REQUIRED[n]) if (!String(item[r] ?? '').trim()) throw fail(`${r} is required`);
      for (const [f, vals] of Object.entries(ENUMS[n] || {})) if (item[f] !== undefined && !vals.includes(item[f])) throw fail(`${f} must be one of ${vals.join(', ')}`);
      if (n === 'links' && !/^https?:\/\//i.test(item.url)) throw fail('url must start with http:// or https://');
    },
    async save(n, item) {
      const u = this.need(n === 'links'); this.check(n, item);
      const rows = this.db[n]; const t = new Date().toISOString();
      const clean = { ...item }; delete clean.createdAt; delete clean.updatedAt; delete clean.helpful;
      if (item.id) {
        const r = rows.find(x => x.id === item.id); if (!r) throw fail('Not found', 404);
        Object.assign(r, clean); if (n === 'tickets' || n === 'kb') r.updatedAt = t;
        this.persist(); return { ok: true };
      }
      const id = rows.reduce((m, x) => Math.max(m, x.id), 0) + 1;
      const row = { ...clean, id, createdAt: t };
      if (n === 'tickets') { row.updatedAt = t; row.createdBy = u.id; }
      if (n === 'kb') { row.updatedAt = t; row.helpful = 0; row.steps = row.steps || []; row.tags = row.tags || []; }
      rows.push(row); this.persist(); return { id };
    },
    async remove(n, id) {
      const u = this.need(); if (u.role !== 'admin' && n !== 'assets') throw fail('Only admins can delete', 403);
      this.db[n] = this.db[n].filter(x => x.id !== id); this.persist();
    },
    async helpful(id) { this.need(); const k = this.db.kb.find(x => x.id === id); if (k) { k.helpful++; this.persist(); } },
    async listUsers() { this.need(true); return this.db.users.map(u => ({ ...this.pub(u), createdAt: u.createdAt })); },
    async createUser(x) {
      this.need(true);
      if (!/^[a-z0-9._-]{3,30}$/.test(String(x.username || ''))) throw fail('Username: 3-30 chars, lowercase letters, digits, . _ -');
      if (!String(x.name || '').trim()) throw fail('Name is required');
      if (!['admin', 'agent'].includes(x.role)) throw fail('Role must be admin or agent');
      if (String(x.password || '').length < 8) throw fail('Password must be at least 8 characters');
      if (this.db.users.some(u => u.username === x.username)) throw fail('Username already exists', 409);
      const sl = salt();
      this.db.users.push({ id: this.db.users.reduce((m, u) => Math.max(m, u.id), 0) + 1, username: x.username, name: x.name.trim(), role: x.role, salt: sl, hash: await sha(sl + x.password), mustChange: true, createdAt: new Date().toISOString() });
      this.persist();
    },
    async resetUser(id, password) {
      this.need(true); if (String(password || '').length < 8) throw fail('Password must be at least 8 characters');
      const u = this.db.users.find(x => x.id === id); u.salt = salt(); u.hash = await sha(u.salt + password); u.mustChange = true; this.persist();
    },
    async deleteUser(id) { const me = this.need(true); if (me.id === id) throw fail('You cannot delete your own account'); this.db.users = this.db.users.filter(u => u.id !== id); this.persist(); }
  };

  window.Store = {
    impl: null,
    async init() {
      try {
        const r = await fetch('api/health', { cache: 'no-store' });
        if (r.ok && (r.headers.get('content-type') || '').includes('json') && (await r.json()).ok) { this.impl = server; return 'server'; }
      } catch { /* no server */ }
      await local.init(); this.impl = local; return 'local';
    },
    get mode() { return this.impl.mode; }
  };
  ['me', 'login', 'logout', 'changePassword', 'list', 'save', 'remove', 'helpful', 'listUsers', 'createUser', 'resetUser', 'deleteUser', 'resetDemo']
    .forEach(m => { window.Store[m] = (...a) => window.Store.impl[m](...a); });
})();
