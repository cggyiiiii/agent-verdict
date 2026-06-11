/* Verdict dashboard — vanilla JS, no build step. */
(() => {
  const state = {
    events: [],
    filter: 'all',
    search: '',
    session: '',     // '' = all sessions
    selected: null,
    replay: { active: false, cursor: 0, playing: false, timer: null },
  };

  const $ = (s) => document.querySelector(s);
  const eventsEl = $('#events');
  const emptyEl = $('#empty');
  const statsEl = $('#stats');
  const detailEl = $('#detail');
  const sessionSel = $('#session-select');
  const liveEl = $('#live');
  const burndownEl = $('#burndown');
  const replayBar = $('#replay-bar');
  const replaySlider = $('#replay-slider');
  const replayPos = $('#replay-pos');
  const replayToggle = $('#replay-toggle');

  const COLORS = ['#58a6ff', '#d2a8ff', '#7ee787', '#ffa657', '#79c0ff'];

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  const fmtTime = (ts) => {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour12: false }) + '.' +
      String(d.getMilliseconds()).padStart(3, '0');
  };

  /** events in scope of the current session selector, time-ordered */
  function sessionEvents() {
    const list = state.session
      ? state.events.filter((e) => e.sessionId === state.session)
      : state.events.slice();
    return list.sort((a, b) => a.ts - b.ts);
  }

  function visible() {
    let list = sessionEvents();
    if (state.replay.active) list = list.slice(0, state.replay.cursor + 1).concat(list.slice(state.replay.cursor + 1));
    return list.filter((e) => {
      if (state.filter !== 'all' && e.decision !== state.filter) return false;
      if (state.search) {
        const hay = `${e.target} ${e.agent ?? ''} ${e.reason?.message ?? ''} ${e.reason?.code ?? ''}`.toLowerCase();
        if (!hay.includes(state.search.toLowerCase())) return false;
      }
      return true;
    });
  }

  function renderStats(list) {
    const a = list.filter((e) => e.decision === 'allow').length;
    const d = list.filter((e) => e.decision === 'deny').length;
    const er = list.filter((e) => e.decision === 'error').length;
    statsEl.innerHTML =
      `<span><b>${list.length}</b> events</span>` +
      `<span class="a"><b>${a}</b> allowed</span>` +
      `<span class="d"><b>${d}</b> denied</span>` +
      `<span class="e"><b>${er}</b> errors</span>`;
  }

  function renderList() {
    const list = visible();
    renderStats(list);
    emptyEl.style.display = state.events.length === 0 ? 'block' : 'none';

    const ordered = sessionEvents();
    const cursorId = state.replay.active ? ordered[state.replay.cursor]?.id : null;
    const futureIds = state.replay.active
      ? new Set(ordered.slice(state.replay.cursor + 1).map((e) => e.id))
      : new Set();

    eventsEl.innerHTML = list.map((e) => {
      const reasonMini = e.decision === 'allow'
        ? ''
        : `<span class="reason-mini"> — ${esc(e.reason?.code ?? '')}: ${esc((e.reason?.message ?? '').slice(0, 80))}</span>`;
      const agent = e.agent ? `<span class="agent">${esc(e.agent)}</span> · ` : '';
      const cls = [
        'event',
        e.id === state.selected ? 'selected' : '',
        futureIds.has(e.id) ? 'future' : '',
        e.id === cursorId ? 'cursor' : '',
      ].join(' ');
      return `<li class="${cls}" data-id="${e.id}">
        <span class="time">${fmtTime(e.ts)}</span>
        <span class="badge ${e.decision}">${e.decision}</span>
        <span class="what ${e.decision}">${agent}<span class="target">${esc(e.target)}</span>${reasonMini}</span>
        <span class="dur">${e.durationMs != null ? e.durationMs + 'ms' : ''}</span>
      </li>`;
    }).join('');
  }

  // ---------- burndown chart ----------

  function renderBurndown() {
    const ordered = sessionEvents();
    const upto = state.replay.active ? ordered.slice(0, state.replay.cursor + 1) : ordered;
    const withBudgets = ordered.filter((e) => e.budgets?.length);
    if (withBudgets.length < 2) {
      burndownEl.classList.add('hidden');
      return;
    }
    burndownEl.classList.remove('hidden');

    // series per budget name: x = index in ordered, y = used/limit
    const names = [...new Set(withBudgets.flatMap((e) => e.budgets.map((b) => b.name)))];
    const W = 800, H = 70, PAD = 4;
    const n = ordered.length;
    const x = (i) => PAD + (i / Math.max(1, n - 1)) * (W - 2 * PAD);
    const y = (frac) => H - PAD - Math.min(1.15, frac) * (H - 2 * PAD) / 1.15;

    let paths = '';
    names.forEach((name, ni) => {
      const pts = [];
      ordered.forEach((e, i) => {
        const b = e.budgets?.find((bb) => bb.name === name);
        if (b && b.limit > 0) pts.push(`${x(i).toFixed(1)},${y(b.used / b.limit).toFixed(1)}`);
      });
      if (pts.length >= 2) {
        paths += `<polyline fill="none" stroke="${COLORS[ni % COLORS.length]}" stroke-width="1.6" points="${pts.join(' ')}" />`;
      }
    });

    // 100% limit line
    const limitY = y(1).toFixed(1);
    paths += `<line x1="0" y1="${limitY}" x2="${W}" y2="${limitY}" stroke="#f85149" stroke-width="1" stroke-dasharray="4 4" opacity="0.6" />`;

    // deny markers
    ordered.forEach((e, i) => {
      if (e.decision === 'deny') {
        paths += `<circle cx="${x(i).toFixed(1)}" cy="${H - PAD}" r="2.5" fill="#f85149" />`;
      }
    });

    // replay cursor line
    if (state.replay.active) {
      const cx = x(state.replay.cursor).toFixed(1);
      paths += `<line x1="${cx}" y1="0" x2="${cx}" y2="${H}" stroke="#58a6ff" stroke-width="1" opacity="0.8" />`;
    }

    const legend = names.map((name, ni) =>
      `<span><i style="background:${COLORS[ni % COLORS.length]}"></i>${esc(name)}</span>`).join('') +
      `<span><i style="background:#f85149"></i>limit / denies</span>`;

    burndownEl.innerHTML = `<h3>Budget burndown${state.replay.active ? ' · replay' : ''}</h3>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${paths}</svg>
      <div class="legend">${legend}</div>`;
    void upto; // cursor already drawn; full series stays visible for context
  }

  // ---------- detail panel ----------

  function budgetBar(b) {
    const pct = b.limit > 0 ? Math.min(100, (b.used / b.limit) * 100) : 0;
    const cls = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : '';
    return `<div class="budget">
      <div class="b-row"><span>${esc(b.name)}</span><span>${esc(String(b.used))} / ${esc(String(b.limit))} ${esc(b.unit ?? '')}</span></div>
      <div class="bar"><i class="${cls}" style="width:${pct}%"></i></div>
    </div>`;
  }

  function hop(h) {
    const scopes = h.scopes?.length ? `<div class="scopes">scopes: ${esc(h.scopes.join(', '))}</div>` : '';
    const limit = h.spendLimit != null ? `<div class="limit">spend limit: ${esc(String(h.spendLimit))}</div>` : '';
    return `<div class="hop"><div>${esc(h.principal)}</div>${scopes}${limit}</div>`;
  }

  function renderDetail() {
    const e = state.events.find((x) => x.id === state.selected);
    if (!e) {
      detailEl.innerHTML = '<div class="placeholder">Select an event to see <b>why</b>.</div>';
      return;
    }
    const whyTitle = e.decision === 'allow' ? 'Why it was allowed'
      : e.decision === 'deny' ? 'Why it was denied' : 'What went wrong';
    const whyMsg = e.decision === 'allow'
      ? 'No policy, scope, mandate or budget objected to this call.'
      : esc(e.reason?.message ?? 'unknown');
    const meta = e.decision === 'allow' ? '' :
      `<div class="w-meta">
        ${e.reason?.source ? `<span class="chip src">${esc(e.reason.source)}</span>` : ''}
        ${e.reason?.code ? `<span class="chip">${esc(e.reason.code)}</span>` : ''}
        ${e.reason?.policy ? `<span class="chip">policy: ${esc(e.reason.policy)}</span>` : ''}
      </div>`;

    detailEl.innerHTML = `
      <div class="d-head">
        <span class="badge ${e.decision}">${e.decision}</span>
        <span class="target">${esc(e.target)}</span>
      </div>
      <div class="d-sub">${esc(e.kind)} · ${e.agent ? 'agent ' + esc(e.agent) + ' · ' : ''}${fmtTime(e.ts)} · session ${esc(e.sessionId)}</div>
      <div class="why ${e.decision}">
        <div class="w-title">${whyTitle}</div>
        <div class="w-msg">${whyMsg}</div>
        ${meta}
      </div>
      ${e.budgets?.length ? `<div class="d-section"><h3>Budgets at decision time</h3>${e.budgets.map(budgetBar).join('')}</div>` : ''}
      ${e.delegation?.length ? `<div class="d-section"><h3>Delegation chain</h3><div class="chain">${e.delegation.map(hop).join('')}</div></div>` : ''}
      ${e.args !== undefined ? `<div class="d-section"><h3>Arguments</h3><pre class="raw">${esc(JSON.stringify(e.args, null, 2))}</pre></div>` : ''}
      ${e.raw ? `<div class="d-section"><h3>Raw</h3><pre class="raw">${esc(e.raw)}</pre></div>` : ''}
    `;
  }

  // ---------- replay ----------

  function setCursor(i) {
    const ordered = sessionEvents();
    state.replay.cursor = Math.max(0, Math.min(ordered.length - 1, i));
    replaySlider.max = String(Math.max(0, ordered.length - 1));
    replaySlider.value = String(state.replay.cursor);
    const cur = ordered[state.replay.cursor];
    replayPos.textContent = cur ? `${state.replay.cursor + 1} / ${ordered.length} · ${fmtTime(cur.ts)}` : '';
    if (cur) state.selected = cur.id;
    renderList();
    renderDetail();
    renderBurndown();
    const el = eventsEl.querySelector('.cursor');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function startReplay() {
    if (sessionEvents().length === 0) return;
    state.replay.active = true;
    replayBar.classList.remove('hidden');
    setCursor(0);
  }

  function stopReplay() {
    state.replay.active = false;
    pause();
    replayBar.classList.add('hidden');
    renderList();
    renderBurndown();
  }

  function play() {
    state.replay.playing = true;
    replayToggle.textContent = '⏸ pause';
    state.replay.timer = setInterval(() => {
      const ordered = sessionEvents();
      if (state.replay.cursor >= ordered.length - 1) { pause(); return; }
      setCursor(state.replay.cursor + 1);
    }, 800);
  }

  function pause() {
    state.replay.playing = false;
    replayToggle.textContent = '▶ play';
    if (state.replay.timer) clearInterval(state.replay.timer);
    state.replay.timer = null;
  }

  // ---------- sessions ----------

  function renderSessions() {
    fetch('/api/sessions').then((r) => r.json()).then(({ sessions }) => {
      const opts = ['<option value="">All sessions</option>']
        .concat(sessions.map((s) =>
          `<option value="${esc(s.id)}" ${s.id === state.session ? 'selected' : ''}>${esc(s.id)} (${s.count}${s.denies ? ', ' + s.denies + ' ⚠' : ''})</option>`));
      sessionSel.innerHTML = opts.join('');
    }).catch(() => {});
  }

  function add(e) {
    state.events.push(e);
    if (!state.replay.active) {
      renderList();
      renderBurndown();
    }
  }

  // ---------- wiring ----------

  eventsEl.addEventListener('click', (ev) => {
    const li = ev.target.closest('.event');
    if (!li) return;
    state.selected = li.dataset.id;
    if (state.replay.active) {
      const ordered = sessionEvents();
      const idx = ordered.findIndex((e) => e.id === li.dataset.id);
      if (idx !== -1) { pause(); setCursor(idx); return; }
    }
    renderList();
    renderDetail();
  });

  $('#filters').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    state.filter = btn.dataset.f;
    document.querySelectorAll('#filters button').forEach((b) => b.classList.toggle('active', b === btn));
    renderList();
  });

  $('#search').addEventListener('input', (ev) => {
    state.search = ev.target.value;
    renderList();
  });

  sessionSel.addEventListener('change', () => {
    state.session = sessionSel.value;
    if (state.replay.active) { pause(); setCursor(0); } else { renderList(); renderBurndown(); }
  });

  $('#replay-open').addEventListener('click', startReplay);
  $('#replay-exit').addEventListener('click', stopReplay);
  replayToggle.addEventListener('click', () => (state.replay.playing ? pause() : play()));
  replaySlider.addEventListener('input', () => { pause(); setCursor(Number(replaySlider.value)); });

  document.addEventListener('keydown', (ev) => {
    if (!state.replay.active) return;
    if (ev.key === 'ArrowRight') { pause(); setCursor(state.replay.cursor + 1); }
    if (ev.key === 'ArrowLeft') { pause(); setCursor(state.replay.cursor - 1); }
    if (ev.key === ' ') { ev.preventDefault(); state.replay.playing ? pause() : play(); }
    if (ev.key === 'Escape') stopReplay();
  });

  // initial load + live stream
  fetch('/api/events').then((r) => r.json()).then(({ events }) => {
    state.events = events;
    renderList();
    renderSessions();
    renderBurndown();
  }).catch(() => {});

  const es = new EventSource('/api/stream');
  let sessionRefresh = null;
  es.onmessage = (msg) => {
    try { add(JSON.parse(msg.data)); } catch {}
    clearTimeout(sessionRefresh);
    sessionRefresh = setTimeout(renderSessions, 500);
  };
  es.onopen = () => { liveEl.textContent = '● live'; liveEl.classList.remove('off'); };
  es.onerror = () => { liveEl.textContent = '○ offline'; liveEl.classList.add('off'); };
})();
