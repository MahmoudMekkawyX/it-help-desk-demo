(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = $('#app'), modal = $('#modal');
  const STATUS = ['Open', 'In Progress', 'Awaiting Vendor', 'Resolved', 'Closed'];
  const PRIORITY = ['Low', 'Medium', 'High', 'Critical'];
  const TYPES = ['Incident', 'Request', 'Hardware', 'Software', 'Access', 'Network'];
  const ICONS = {
    dash: '<path d="M3 12l9-8 9 8M5 10v10h14V10"/>', tix: '<path d="M4 8a2 2 0 002-2h12a2 2 0 002 2v2a2 2 0 000 4v2a2 2 0 00-2 2H6a2 2 0 00-2-2v-2a2 2 0 000-4z"/><path d="M13 6v12" stroke-dasharray="2 3"/>',
    kb: '<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z"/><path d="M4 21V5M9 8h6M9 12h6"/>', box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/>',
    link: '<path d="M10 14a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 10a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1"/>', users: '<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M22 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>', out: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>',
    moon: '<path d="M21 13A9 9 0 1111 3a7 7 0 0010 10z"/>', menu: '<path d="M3 6h18M3 12h18M3 18h18"/>', plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="M5 12l5 5 9-11"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', alert: '<path d="M12 3l10 18H2zM12 10v5M12 18h.01"/>'
  };
  const ic = n => `<svg class="ico" viewBox="0 0 24 24">${ICONS[n]}</svg>`;
  const state = { user: null, tickets: [], kb: [], assets: [], links: [], users: [], filters: { tq: '', ts: '', tp: '', kq: '', kc: '', aq: '', at: '' } };

  // ---------- utils ----------
  const fmt = d => d ? new Date(d.includes('T') || d.includes('Z') ? d : d.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const tno = id => 'T-' + String(id).padStart(4, '0');
  const slug = s => s.toLowerCase().replace(/[^a-z]+/g, '');
  const sBadge = s => `<span class="badge b-${{ 'Open': 'open', 'In Progress': 'progress', 'Awaiting Vendor': 'vendor', 'Resolved': 'resolved', 'Closed': 'closed' }[s]}">${esc(s)}</span>`;
  const pBadge = p => `<span class="badge p-${p.toLowerCase()}">${esc(p)}</span>`;
  const toast = (m, err) => { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = m; $('#toasts').append(t); setTimeout(() => t.remove(), 3800); };
  const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { if (e.status === 401) { state.user = null; render(); } else toast(e.message || 'Something went wrong', true); } };
  const isAdmin = () => state.user && state.user.role === 'admin';
  const words = s => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
  const STOP = new Set(['the', 'and', 'for', 'not', 'with', 'from', 'that', 'this', 'has', 'was', 'are', 'cannot', 'can', 'but', 'after', 'when']);
  function suggestKb(text) {
    const q = new Set(words(text).filter(w => !STOP.has(w)));
    if (!q.size) return [];
    return state.kb.map(k => {
      const hay = words(k.title + ' ' + k.tags.join(' ') + ' ' + k.symptoms);
      let sc = 0; q.forEach(w => { if (hay.includes(w)) sc += k.tags.includes(w) || words(k.title).includes(w) ? 3 : 1; });
      return [sc, k];
    }).filter(x => x[0] >= 3).sort((a, b) => b[0] - a[0]).slice(0, 3).map(x => x[1]);
  }
  function csv(rows, cols) {
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    return [cols.map(c => q(c[0])).join(','), ...rows.map(r => cols.map(c => q(r[c[1]])).join(','))].join('\r\n');
  }
  function download(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + text], { type: 'text/csv' })); a.download = name; a.click(); URL.revokeObjectURL(a.href); }

  // ---------- modal ----------
  function openModal(title, body, foot) {
    modal.innerHTML = `<div class="mhead"><h2>${esc(title)}</h2><button class="btn ghost sm" data-close aria-label="Close">✕</button></div><div class="mbody">${body}</div>${foot ? `<div class="mfoot">${foot}</div>` : ''}`;
    if (!modal.open) modal.showModal();
  }
  const closeModal = () => { if (modal.open) modal.close(); };
  modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('[data-close]')) closeModal(); });

  // ---------- data ----------
  async function load() {
    const [t, k, a, l] = await Promise.all(['tickets', 'kb', 'assets', 'links'].map(n => Store.list(n)));
    Object.assign(state, { tickets: t, kb: k, assets: a, links: l });
    if (isAdmin()) state.users = await Store.listUsers();
  }

  // ---------- shell ----------
  const NAV = [['dashboard', 'Dashboard', 'dash'], ['tickets', 'Tickets', 'tix'], ['kb', 'Knowledge Base', 'kb'], ['assets', 'Asset Log', 'box'], ['links', 'Resources', 'link']];
  function shell(route, inner, title, sub, actions = '') {
    const nav = [...NAV, ...(isAdmin() ? [['users', 'Users', 'users']] : []), ['account', 'Password', 'key']];
    const initials = state.user.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    app.innerHTML = `<div class="shell"><aside class="side" id="side"><div class="logo"><i>${ic('check')}</i>HelpDesk Hub</div>
      <nav class="nav">${nav.map(n => `<a href="#/${n[0]}" class="${route === n[0] ? 'on' : ''}">${ic(n[2])}${n[1]}</a>`).join('')}</nav><div class="grow"></div>
      <div class="me"><div class="avatar">${esc(initials)}</div><div><b>${esc(state.user.name)}</b><small>${esc(state.user.role)}</small></div></div>
      <div class="row"><button class="btn sm" data-act="theme">${ic('moon')} Theme</button><button class="btn sm" data-act="logout">${ic('out')} Sign out</button></div></aside>
      <main class="main">${Store.mode === 'local' ? `<div class="banner"><span><b>Demo mode.</b> All data is fictional and stored only in your browser.</span><button class="btn sm" data-act="resetdemo">Reset demo data</button></div>` : ''}
      <div class="top"><div class="row"><button class="btn burger" data-act="menu" aria-label="Menu">${ic('menu')}</button><div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div></div><div class="row">${actions}</div></div>${inner}</main></div>`;
  }

  // ---------- views ----------
  function viewLogin() {
    const demo = Store.mode === 'local';
    app.innerHTML = `<div class="loginwrap"><section class="hero"><div class="logo" style="padding:0"><i>${ic('check')}</i>HelpDesk Hub</div>
      <h1>Fix it faster. Never solve the same problem twice.</h1><p>Track tickets, look up proven fixes in the knowledge base, and keep a clean log of every device handed out or returned.</p>
      <ul><li><span>${ic('tix')}</span>Tickets with priority and status</li><li><span>${ic('kb')}</span>Problem → cause → fix guides</li><li><span>${ic('box')}</span>Asset receiving and return log</li></ul></section>
      <section class="loginform"><form id="lf" novalidate><h2>Sign in</h2>
      <label class="f">Username<input class="input" name="u" autocomplete="username" autofocus required></label>
      <label class="f">Password<input class="input" type="password" name="p" autocomplete="current-password" required></label>
      <div class="errmsg" id="lerr" role="alert"></div><button class="btn primary" style="justify-content:center">Sign in</button>
      ${demo ? `<div class="hint"><b>Demo accounts</b><br>Admin: <code>admin</code> / <code>admin123</code><br>Agent: <code>sara</code> / <code>agent123</code></div>` : ''}</form></section></div>`;
    $('#lf').addEventListener('submit', async e => {
      e.preventDefault(); const f = e.target, err = $('#lerr'); err.textContent = '';
      if (!f.u.value.trim() || !f.p.value) { err.textContent = 'Enter your username and password.'; return; }
      try { state.user = await Store.login(f.u.value, f.p.value); await load(); location.hash = state.user.mustChange ? '#/account' : '#/dashboard'; render(); }
      catch (x) { err.textContent = x.message; }
    });
  }

  function viewDashboard() {
    const T = state.tickets, open = T.filter(t => !['Resolved', 'Closed'].includes(t.status));
    const urgent = open.filter(t => ['High', 'Critical'].includes(t.priority));
    const weekAgo = Date.now() - 7 * 864e5, resolved = T.filter(t => ['Resolved', 'Closed'].includes(t.status) && new Date(t.updatedAt) > weekAgo);
    const max = Math.max(1, ...STATUS.map(s => T.filter(t => t.status === s).length));
    const stat = (i, n, l) => `<div class="card stat"><div class="bubble">${ic(i)}</div><div><b>${n}</b><span>${l}</span></div></div>`;
    shell('dashboard', `<div class="stats">${stat('tix', open.length, 'Open tickets')}${stat('alert', urgent.length, 'High priority open')}${stat('check', resolved.length, 'Resolved this week')}${stat('kb', state.kb.length, 'Knowledge articles')}</div>
      <div class="cols"><div class="card pad"><div class="row" style="justify-content:space-between"><h3>Recent tickets</h3><a href="#/tickets">View all</a></div>
      ${T.length ? `<div class="tablewrap"><table class="stack"><tbody>${T.slice(0, 6).map(t => `<tr class="click" data-ticket="${t.id}"><td data-l="Ticket" class="title-cell"><b>${esc(t.title)}</b><small>${tno(t.id)} · ${esc(t.requester)}</small></td><td data-l="Priority">${pBadge(t.priority)}</td><td data-l="Status">${sBadge(t.status)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No tickets yet.</div>'}</div>
      <div style="display:grid;gap:18px;align-content:start"><div class="card pad"><h3>Tickets by status</h3><div class="bars">${STATUS.map(s => { const n = T.filter(t => t.status === s).length; return `<div class="bar"><span>${s}</span><div class="track"><div class="fill" style="width:${n / max * 100}%"></div></div><b>${n}</b></div>`; }).join('')}</div></div>
      <div class="card pad"><h3>Find a fix</h3><form id="quick" class="search" style="display:block"><svg viewBox="0 0 24 24">${ICONS.search}</svg><input class="input" name="q" placeholder="Describe the problem, e.g. printer offline" aria-label="Search knowledge base"></form>
      <p style="color:var(--muted);margin:10px 0 0;font-size:13px">Searches the knowledge base: problem, cause and fix.</p></div></div></div>`,
      `Welcome back, ${state.user.name.split(' ')[0]}`, 'Here is what needs attention today.', `<a class="btn primary" href="#/tickets/new">${ic('plus')} New ticket</a>`);
    $('#quick').addEventListener('submit', e => { e.preventDefault(); state.filters.kq = e.target.q.value; state.filters.kc = ''; location.hash = '#/kb'; });
  }

  function ticketRows() {
    const f = state.filters, q = f.tq.toLowerCase();
    return state.tickets.filter(t => (!f.ts || t.status === f.ts) && (!f.tp || t.priority === f.tp) && (!q || [t.title, t.requester, t.department, t.assignee, t.description, tno(t.id)].join(' ').toLowerCase().includes(q)));
  }
  function ticketTable() {
    const rows = ticketRows();
    return rows.length ? `<div class="tablewrap"><table class="stack"><thead><tr><th>Ticket</th><th>Requester</th><th>Priority</th><th>Status</th><th>Assignee</th><th>Created</th><th></th></tr></thead><tbody>${rows.map(t => `<tr class="click" data-ticket="${t.id}">
      <td data-l="Ticket" class="title-cell"><b>${esc(t.title)}</b><small>${tno(t.id)} · ${esc(t.type)}</small></td><td data-l="Requester">${esc(t.requester)}<br><small style="color:var(--muted)">${esc(t.department)}</small></td>
      <td data-l="Priority">${pBadge(t.priority)}</td><td data-l="Status">${sBadge(t.status)}</td><td data-l="Assignee">${esc(t.assignee || '-')}</td><td data-l="Created">${fmt(t.createdAt)}</td>
      <td class="actions"><button class="btn sm" data-edit-ticket="${t.id}">Edit</button>${isAdmin() ? ` <button class="btn sm danger" data-del="tickets:${t.id}">Delete</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No tickets match these filters.</div>';
  }
  function viewTickets() {
    const f = state.filters;
    shell('tickets', `<div class="card pad" style="margin-bottom:16px"><div class="row"><div class="search"><svg viewBox="0 0 24 24">${ICONS.search}</svg><input class="input" id="tq" placeholder="Search tickets" value="${esc(f.tq)}"></div>
      <select class="input" id="ts" style="width:auto"><option value="">All statuses</option>${STATUS.map(s => `<option ${f.ts === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select class="input" id="tp" style="width:auto"><option value="">All priorities</option>${PRIORITY.map(s => `<option ${f.tp === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div></div>
      <div class="card" id="tbl">${ticketTable()}</div>`, 'Tickets', `${state.tickets.length} total`,
      `<button class="btn" data-act="export-tickets">Export CSV</button><button class="btn primary" data-act="new-ticket">${ic('plus')} New ticket</button>`);
    const refresh = () => { f.tq = $('#tq').value; f.ts = $('#ts').value; f.tp = $('#tp').value; $('#tbl').innerHTML = ticketTable(); };
    ['tq', 'ts', 'tp'].forEach(i => $('#' + i).addEventListener('input', refresh));
  }

  function ticketForm(t = {}) {
    const o = (arr, v) => arr.map(x => `<option ${x === v ? 'selected' : ''}>${x}</option>`).join('');
    const agents = state.users.length ? state.users : [state.user];
    openModal(t.id ? `Edit ${tno(t.id)}` : 'New ticket', `<form id="tf" novalidate style="display:contents">
      <label class="f">Title *<input class="input" name="title" value="${esc(t.title || '')}" maxlength="140"></label>
      <div id="sug"></div>
      <div class="grid3"><label class="f">Type<select class="input" name="type">${o(TYPES, t.type || 'Incident')}</select></label><label class="f">Priority<select class="input" name="priority">${o(PRIORITY, t.priority || 'Medium')}</select></label><label class="f">Status<select class="input" name="status">${o(STATUS, t.status || 'Open')}</select></label></div>
      <div class="grid2"><label class="f">Requester name *<input class="input" name="requester" value="${esc(t.requester || '')}"></label><label class="f">Contact (email or phone)<input class="input" name="contact" value="${esc(t.contact || '')}"></label></div>
      <div class="grid2"><label class="f">Department<input class="input" name="department" value="${esc(t.department || '')}"></label><label class="f">Assignee<input class="input" name="assignee" list="agents" value="${esc(t.assignee || (t.id ? '' : state.user.username))}"><datalist id="agents">${agents.map(a => `<option value="${esc(a.username)}">${esc(a.name)}</option>`).join('')}</datalist></label></div>
      <label class="f">Description<textarea class="input" name="description">${esc(t.description || '')}</textarea></label>
      <label class="f">Resolution (what fixed it)<textarea class="input" name="resolution">${esc(t.resolution || '')}</textarea></label>
      <div class="errmsg" id="terr" role="alert"></div></form>`,
      `<button class="btn" data-close>Cancel</button><button class="btn primary" id="tsave">${t.id ? 'Save changes' : 'Create ticket'}</button>`);
    const f = $('#tf');
    const upd = () => { const s = suggestKb(f.title.value + ' ' + f.description.value); $('#sug').innerHTML = s.length ? `<div class="suggest"><b>Possible fixes in the knowledge base</b>${s.map(k => `<a href="#/kb/${k.id}" data-close>${esc(k.title)}</a>`).join('')}</div>` : ''; };
    f.title.addEventListener('input', upd); f.description.addEventListener('input', upd); upd();
    $('#tsave').addEventListener('click', guard(async () => {
      const item = { ...t, ...Object.fromEntries(new FormData(f)) };
      for (const k of Object.keys(item)) if (typeof item[k] === 'string') item[k] = item[k].trim();
      if (!item.title) return $('#terr').textContent = 'Title is required.';
      if (!item.requester) return $('#terr').textContent = 'Requester name is required.';
      if (['Resolved', 'Closed'].includes(item.status) && !item.resolution) return $('#terr').textContent = 'Add a short resolution before resolving or closing.';
      await Store.save('tickets', item); closeModal(); await load(); toast(t.id ? 'Ticket updated' : 'Ticket created'); render();
    }));
  }

  function ticketDetail(t) {
    const sug = t.resolution ? [] : suggestKb(t.title + ' ' + t.description);
    openModal(`${tno(t.id)} · ${t.title}`, `<div class="detail"><div class="row" style="margin-bottom:14px">${sBadge(t.status)} ${pBadge(t.priority)} <span class="badge">${esc(t.type)}</span></div>
      <dl><dt>Requester</dt><dd>${esc(t.requester)} ${t.department ? '· ' + esc(t.department) : ''}</dd><dt>Contact</dt><dd>${esc(t.contact || '-')}</dd><dt>Assignee</dt><dd>${esc(t.assignee || '-')}</dd>
      <dt>Created</dt><dd>${fmt(t.createdAt)}</dd><dt>Updated</dt><dd>${fmt(t.updatedAt)}</dd><dt>Description</dt><dd><pre>${esc(t.description || '-')}</pre></dd><dt>Resolution</dt><dd><pre>${esc(t.resolution || 'Not resolved yet')}</pre></dd></dl>
      ${sug.length ? `<div class="suggest"><b>Try these fixes</b>${sug.map(k => `<a href="#/kb/${k.id}" data-close>${esc(k.title)}</a>`).join('')}</div>` : ''}</div>`,
      `${t.resolution ? `<button class="btn" data-act="ticket-to-kb" data-id="${t.id}">Save fix to knowledge base</button>` : ''}<button class="btn" data-close>Close</button><button class="btn primary" data-edit-ticket="${t.id}">Edit</button>`);
  }

  function kbList() {
    const f = state.filters, q = f.kq.toLowerCase().trim();
    const rows = state.kb.filter(k => (!f.kc || k.category === f.kc) && (!q || q.split(/\s+/).every(w => [k.title, k.symptoms, k.cause, k.tags.join(' '), k.steps.join(' ')].join(' ').toLowerCase().includes(w))));
    return rows.length ? `<div class="kbgrid">${rows.map(k => `<article class="card kbcard" data-kb="${k.id}" tabindex="0" role="link"><div class="row" style="justify-content:space-between"><span class="badge plain">${esc(k.category)}</span><span class="badge sev-${esc(k.severity)}">${esc(k.severity)}</span></div>
      <h3>${esc(k.title)}</h3><p>${esc(k.symptoms)}</p><div class="tags">${k.tags.slice(0, 4).map(t => `<span class="tag">#${esc(t)}</span>`).join('')}</div></article>`).join('')}</div>` : '<div class="card empty">No articles match. Try different words, or add this problem as a new article.</div>';
  }
  function viewKb() {
    const f = state.filters, cats = [...new Set(state.kb.map(k => k.category))].sort();
    shell('kb', `<div class="search"><svg viewBox="0 0 24 24">${ICONS.search}</svg><input class="input" id="kq" placeholder="Search problems, symptoms, fixes, tags" value="${esc(f.kq)}" autofocus></div>
      <div class="chips"><button class="chip ${f.kc ? '' : 'on'}" data-cat="">All (${state.kb.length})</button>${cats.map(c => `<button class="chip ${f.kc === c ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div><div id="kbl">${kbList()}</div>`,
      'Knowledge Base', 'When this problem happens, do this. Written fixes that anyone on the team can follow.', `<button class="btn primary" data-act="new-kb">${ic('plus')} New article</button>`);
    $('#kq').addEventListener('input', e => { f.kq = e.target.value; $('#kbl').innerHTML = kbList(); });
  }
  function viewArticle(id) {
    const k = state.kb.find(x => x.id === id);
    if (!k) { location.hash = '#/kb'; return; }
    shell('kb', `<article class="card pad article"><a href="#/kb">← All articles</a><div class="row" style="margin-top:12px"><span class="badge plain">${esc(k.category)}</span><span class="badge sev-${esc(k.severity)}">${esc(k.severity)} impact</span></div>
      <h2>${esc(k.title)}</h2><div class="blk symp"><h4>When this happens</h4>${esc(k.symptoms)}</div><div class="blk cause"><h4>Likely cause</h4>${esc(k.cause)}</div>
      <div class="blk"><h4>Fix, step by step</h4><ol class="steps">${k.steps.map(s => `<li><span>${esc(s)}</span></li>`).join('')}</ol></div>
      ${k.prevention ? `<div class="blk"><h4>How to prevent it</h4>${esc(k.prevention)}</div>` : ''}
      <div class="tags">${k.tags.map(t => `<span class="tag">#${esc(t)}</span>`).join('')}</div>
      <div class="row" style="margin-top:20px"><button class="btn" data-act="helpful" data-id="${k.id}">👍 This worked (${k.helpful})</button><button class="btn" data-act="new-ticket-kb" data-id="${k.id}">Create ticket</button><button class="btn" data-act="print">Print</button>
      <button class="btn" data-edit-kb="${k.id}">Edit</button>${isAdmin() ? `<button class="btn danger" data-del="kb:${k.id}">Delete</button>` : ''}</div><p style="color:var(--muted);font-size:13px">Updated ${fmt(k.updatedAt)}</p></article>`,
      'Knowledge Base', '');
  }
  function kbForm(k = {}) {
    openModal(k.id ? 'Edit article' : 'New article', `<form id="kf" novalidate style="display:contents"><label class="f">Problem title *<input class="input" name="title" value="${esc(k.title || '')}" placeholder="e.g. Printer shows offline"></label>
      <div class="grid3"><label class="f">Category<input class="input" name="category" list="cats" value="${esc(k.category || '')}"><datalist id="cats">${[...new Set(state.kb.map(x => x.category))].map(c => `<option>${esc(c)}</option>`).join('')}</datalist></label>
      <label class="f">Impact<select class="input" name="severity">${['Low', 'Medium', 'High'].map(s => `<option ${s === (k.severity || 'Medium') ? 'selected' : ''}>${s}</option>`).join('')}</select></label><label class="f">Tags (comma separated)<input class="input" name="tags" value="${esc((k.tags || []).join(', '))}"></label></div>
      <label class="f">When this happens (symptoms)<textarea class="input" name="symptoms">${esc(k.symptoms || '')}</textarea></label><label class="f">Likely cause<textarea class="input" name="cause">${esc(k.cause || '')}</textarea></label>
      <label class="f">Fix steps (one step per line)<textarea class="input" name="steps" style="min-height:140px">${esc((k.steps || []).join('\n'))}</textarea></label><label class="f">Prevention<textarea class="input" name="prevention">${esc(k.prevention || '')}</textarea></label>
      <div class="errmsg" id="kerr" role="alert"></div></form>`, `<button class="btn" data-close>Cancel</button><button class="btn primary" id="ksave">Save article</button>`);
    $('#ksave').addEventListener('click', guard(async () => {
      const d = Object.fromEntries(new FormData($('#kf')));
      if (!d.title.trim()) return $('#kerr').textContent = 'Title is required.';
      const steps = d.steps.split('\n').map(s => s.trim()).filter(Boolean);
      if (!steps.length) return $('#kerr').textContent = 'Add at least one fix step.';
      const item = { ...k, title: d.title.trim(), category: d.category.trim() || 'General', severity: d.severity, symptoms: d.symptoms.trim(), cause: d.cause.trim(), prevention: d.prevention.trim(), steps, tags: d.tags.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) };
      const r = await Store.save('kb', item); closeModal(); await load(); toast('Article saved'); location.hash = '#/kb/' + (item.id || r.id); render();
    }));
  }

  function assetRows() {
    const f = state.filters, q = f.aq.toLowerCase();
    return state.assets.filter(a => (!f.at || a.transactionType === f.at) && (!q || [a.employeeName, a.employeeId, a.department, a.computerSerial, a.monitorSerial, a.deviceModel].join(' ').toLowerCase().includes(q)));
  }
  function assetTable() {
    const rows = assetRows();
    return rows.length ? `<div class="tablewrap"><table class="stack"><thead><tr><th>Employee</th><th>Type</th><th>Device</th><th>Condition</th><th>Date</th><th></th></tr></thead><tbody>${rows.map(a => `<tr class="click" data-asset="${a.id}">
      <td data-l="Employee" class="title-cell"><b>${esc(a.employeeName)}</b><small>${esc(a.employeeId)} · ${esc(a.department)}</small></td><td data-l="Type"><span class="badge">${a.transactionType === 'Receiving' ? '📥 Receiving' : '📤 Return'}</span></td>
      <td data-l="Device">${esc(a.deviceModel || '-')}<br><small style="color:var(--muted)">${esc(a.computerSerial)}</small></td><td data-l="Condition"><span class="badge ${a.condition === 'Matched' ? 'b-ok' : 'b-bad'}">${esc(a.condition)}</span></td><td data-l="Date">${fmt(a.createdAt)}</td>
      <td class="actions"><button class="btn sm danger" data-del="assets:${a.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No records match.</div>';
  }
  function viewAssets() {
    const f = state.filters;
    shell('assets', `<div class="card pad" style="margin-bottom:16px"><div class="row"><div class="search"><svg viewBox="0 0 24 24">${ICONS.search}</svg><input class="input" id="aq" placeholder="Search employee, serial or model" value="${esc(f.aq)}"></div>
      <select class="input" id="at" style="width:auto"><option value="">All</option><option value="Receiving" ${f.at === 'Receiving' ? 'selected' : ''}>Receiving</option><option value="Return" ${f.at === 'Return' ? 'selected' : ''}>Return</option></select></div></div><div class="card" id="atbl">${assetTable()}</div>`,
      'Asset Log', 'Devices handed to employees and returned by them.', `<button class="btn" data-act="export-assets">Export CSV</button><button class="btn primary" data-act="new-asset">${ic('plus')} New record</button>`);
    const r = () => { f.aq = $('#aq').value; f.at = $('#at').value; $('#atbl').innerHTML = assetTable(); };
    $('#aq').addEventListener('input', r); $('#at').addEventListener('input', r);
  }
  function assetForm() {
    const i = (n, l, ph = '') => `<label class="f">${l}<input class="input" name="${n}" placeholder="${ph}"></label>`;
    openModal('New asset record', `<form id="af" novalidate style="display:contents"><div class="grid2">${i('employeeName', 'Employee name *')}${i('employeeId', 'Employee ID')}</div><div class="grid2">${i('department', 'Department')}<label class="f">Transaction *<select class="input" name="transactionType"><option value="Receiving">📥 Receiving (hand device to employee)</option><option value="Return">📤 Return (device back from employee)</option></select></label></div>
      <div class="grid3">${i('computerSerial', 'Computer serial')}${i('monitorSerial', 'Monitor serial')}${i('accessorySerial', 'Mouse/keyboard serial')}</div><div class="grid2">${i('deviceModel', 'Device model')}${i('warranty', 'Warranty status')}</div>
      <div class="grid2"><label class="f">Condition<select class="input" name="condition"><option>Matched</option><option>Mismatched</option></select></label>${i('itSupportName', 'IT support name')}</div>
      <label class="f">Mismatch details<textarea class="input" name="mismatchDetails" placeholder="Fill in only if the condition does not match"></textarea></label><label class="f">Notes<textarea class="input" name="notes"></textarea></label><div class="errmsg" id="aerr" role="alert"></div></form>`,
      `<button class="btn" data-close>Cancel</button><button class="btn primary" id="asave">Save record</button>`);
    $('#af').itSupportName.value = state.user.name;
    $('#asave').addEventListener('click', guard(async () => {
      const d = Object.fromEntries(new FormData($('#af')));
      if (!d.employeeName.trim()) return $('#aerr').textContent = 'Employee name is required.';
      if (d.condition === 'Mismatched' && !d.mismatchDetails.trim()) return $('#aerr').textContent = 'Describe the mismatch.';
      await Store.save('assets', d); closeModal(); await load(); toast('Record saved'); render();
    }));
  }
  function assetDetail(a) {
    const rows = [['Employee', `${a.employeeName} (${a.employeeId || 'no ID'})`], ['Department', a.department], ['Transaction', a.transactionType], ['Computer serial', a.computerSerial], ['Monitor serial', a.monitorSerial], ['Accessory serial', a.accessorySerial], ['Model', a.deviceModel], ['Warranty', a.warranty], ['Condition', a.condition], ['Mismatch details', a.mismatchDetails], ['IT support', a.itSupportName], ['Notes', a.notes], ['Date', fmt(a.createdAt)]];
    openModal('Asset record', `<div class="detail"><dl>${rows.filter(r => r[1]).map(r => `<dt>${r[0]}</dt><dd>${esc(r[1])}</dd>`).join('')}</dl></div>`, `<button class="btn" data-act="print">Print</button><button class="btn primary" data-close>Close</button>`);
  }

  function viewLinks() {
    const cats = [...new Set(state.links.map(l => l.category))];
    shell('links', cats.map(c => `<h3 class="cat">${esc(c)}</h3><div class="linkgrid">${state.links.filter(l => l.category === c).map(l => `<a class="card linkcard" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"><b>${esc(l.title)}</b><small>${esc(l.note)}</small></a>`).join('')}</div>`).join('') || '<div class="card empty">No links yet.</div>',
      'Resources', 'Useful tools and vendor sites.');
  }

  function viewUsers() {
    if (!isAdmin()) { location.hash = '#/dashboard'; return; }
    shell('users', `<div class="card"><div class="tablewrap"><table class="stack"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th></th></tr></thead><tbody>${state.users.map(u => `<tr><td data-l="Name"><b>${esc(u.name)}</b></td><td data-l="Username">${esc(u.username)}</td><td data-l="Role"><span class="badge">${esc(u.role)}</span></td>
      <td class="actions"><button class="btn sm" data-reset="${u.id}">Reset password</button>${u.id !== state.user.id ? ` <button class="btn sm danger" data-deluser="${u.id}">Delete</button>` : ''}</td></tr>`).join('')}</tbody></table></div></div>`,
      'Users', 'Who can sign in. New and reset passwords must be changed at first sign in.', `<button class="btn primary" data-act="new-user">${ic('plus')} New user</button>`);
  }
  function viewAccount() {
    shell('account', `<div class="card pad" style="max-width:480px">${state.user.mustChange ? '<div class="banner" style="margin-bottom:14px">You must set a new password before continuing.</div>' : ''}<form id="pf" style="display:grid;gap:14px" novalidate>
      <label class="f">Current password<input class="input" type="password" name="c" autocomplete="current-password"></label><label class="f">New password (8+ characters)<input class="input" type="password" name="n" autocomplete="new-password"></label>
      <label class="f">Repeat new password<input class="input" type="password" name="r" autocomplete="new-password"></label><div class="errmsg" id="perr" role="alert"></div><button class="btn primary" style="justify-content:center">Change password</button></form></div>`, 'Change password', state.user.name);
    $('#pf').addEventListener('submit', guard(async e => {
      e.preventDefault(); const f = e.target, err = $('#perr'); err.textContent = '';
      if (!f.c.value) return err.textContent = 'Enter your current password.';
      if (f.n.value.length < 8) return err.textContent = 'New password must be at least 8 characters.';
      if (f.n.value !== f.r.value) return err.textContent = 'The two new passwords do not match.';
      if (f.n.value === f.c.value) return err.textContent = 'Choose a password different from the current one.';
      try { await Store.changePassword(f.c.value, f.n.value); } catch (x) { return err.textContent = x.message; }
      state.user = await Store.me(); toast('Password changed'); f.reset(); render();
    }));
  }

  // ---------- events ----------
  document.addEventListener('click', guard(async e => {
    const el = e.target.closest('[data-act],[data-ticket],[data-edit-ticket],[data-kb],[data-edit-kb],[data-asset],[data-del],[data-cat],[data-reset],[data-deluser]');
    if (!el) return;
    const d = el.dataset;
    if (d.editTicket) { e.stopPropagation(); return ticketForm(state.tickets.find(t => t.id == d.editTicket)); }
    if (d.ticket) return ticketDetail(state.tickets.find(t => t.id == d.ticket));
    if (d.editKb) return kbForm(state.kb.find(k => k.id == d.editKb));
    if (d.kb) { location.hash = '#/kb/' + d.kb; return; }
    if (d.asset) return assetDetail(state.assets.find(a => a.id == d.asset));
    if (d.cat !== undefined) { state.filters.kc = d.cat; return render(); }
    if (d.del) {
      const [n, id] = d.del.split(':'); if (!confirm('Delete this item? This cannot be undone.')) return;
      await Store.remove(n, Number(id)); await load(); toast('Deleted'); if (n === 'kb') location.hash = '#/kb'; return render();
    }
    if (d.reset) {
      const pw = prompt('New temporary password (8+ characters). The user must change it at next sign in.'); if (pw === null) return;
      await Store.resetUser(Number(d.reset), pw); return toast('Password reset');
    }
    if (d.deluser) { if (!confirm('Delete this user?')) return; await Store.deleteUser(Number(d.deluser)); await load(); return render(); }
    switch (d.act) {
      case 'logout': await Store.logout(); state.user = null; location.hash = ''; return render();
      case 'theme': { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; try { localStorage.setItem('hdTheme', t); } catch { } return; }
      case 'menu': return $('#side').classList.toggle('open');
      case 'resetdemo': if (confirm('Reset all demo data to the starting set?')) { await Store.resetDemo(); state.user = null; location.hash = ''; await Store.init(); render(); toast('Demo data reset'); } return;
      case 'new-ticket': return ticketForm();
      case 'new-ticket-kb': { const k = state.kb.find(x => x.id == d.id); return ticketForm({ title: k.title, type: 'Incident' }); }
      case 'new-kb': return kbForm();
      case 'new-asset': return assetForm();
      case 'new-user': return userForm();
      case 'helpful': await Store.helpful(Number(d.id)); await load(); return render();
      case 'print': return window.print();
      case 'export-tickets': return download('tickets.csv', csv(ticketRows(), [['ID', 'id'], ['Title', 'title'], ['Type', 'type'], ['Priority', 'priority'], ['Status', 'status'], ['Requester', 'requester'], ['Department', 'department'], ['Assignee', 'assignee'], ['Description', 'description'], ['Resolution', 'resolution'], ['Created', 'createdAt']]));
      case 'export-assets': return download('assets.csv', csv(assetRows(), [['ID', 'id'], ['Employee', 'employeeName'], ['Employee ID', 'employeeId'], ['Department', 'department'], ['Type', 'transactionType'], ['Computer serial', 'computerSerial'], ['Monitor serial', 'monitorSerial'], ['Model', 'deviceModel'], ['Condition', 'condition'], ['Details', 'mismatchDetails'], ['Date', 'createdAt']]));
      case 'ticket-to-kb': { const t = state.tickets.find(x => x.id == d.id); closeModal(); return kbForm({ title: t.title, category: t.type, symptoms: t.description, steps: t.resolution.split(/(?<=\.)\s+/).filter(Boolean), tags: [] }); }
    }
  }));
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.kbcard')) location.hash = '#/kb/' + e.target.dataset.kb; });
  function userForm() {
    openModal('New user', `<form id="uf" novalidate style="display:contents"><div class="grid2"><label class="f">Full name<input class="input" name="name"></label><label class="f">Username<input class="input" name="username" placeholder="lowercase, no spaces"></label></div>
      <div class="grid2"><label class="f">Role<select class="input" name="role"><option value="agent">Agent</option><option value="admin">Admin</option></select></label><label class="f">Temporary password (8+)<input class="input" name="password"></label></div><div class="errmsg" id="uerr" role="alert"></div></form>`,
      `<button class="btn" data-close>Cancel</button><button class="btn primary" id="usave">Create user</button>`);
    $('#usave').addEventListener('click', async () => {
      try { await Store.createUser(Object.fromEntries(new FormData($('#uf')))); closeModal(); await load(); toast('User created'); render(); } catch (x) { $('#uerr').textContent = x.message; }
    });
  }

  // ---------- router ----------
  function render() {
    closeModal();
    if (!state.user) return viewLogin();
    const [r, id] = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/');
    if (state.user.mustChange && r !== 'account') { location.hash = '#/account'; return; }
    ({ dashboard: viewDashboard, tickets: viewTickets, kb: () => id ? viewArticle(Number(id)) : viewKb(), assets: viewAssets, links: viewLinks, users: viewUsers, account: viewAccount }[r] || viewDashboard)();
    if (r === 'tickets' && id === 'new') { history.replaceState(null, '', '#/tickets'); ticketForm(); }
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', () => { if (state.user) render(); });

  (async function start() {
    try {
      await Store.init();
      state.user = await Store.me();
      if (state.user) await load();
      render();
    } catch (e) { app.innerHTML = `<div class="boot">Could not start: ${esc(e.message)}</div>`; }
  })();
})();
