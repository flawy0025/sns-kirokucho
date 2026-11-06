/* SNS 記録帳（公開版）— 記録はこのブラウザの中だけに保存されます。 */
(() => {
  /* ---------- definitions ---------- */
  const PLATS = ['x', 'threads', 'note'];
  const NAMES = { x: 'X', threads: 'Threads', note: 'note' };
  const COLOR = { x: 'var(--x)', threads: 'var(--threads)', note: 'var(--note)' };
  const FIELDS = {
    x: [['followers', 'フォロワー'], ['impressions', 'インプレッション'], ['posts', '投稿数'], ['engagement', 'エンゲージメント']],
    threads: [['followers', 'フォロワー'], ['impressions', '閲覧数'], ['posts', '投稿数'], ['engagement', '反応数（インタラクション）']],
    note: [['followers', 'フォロワー'], ['pv', 'PV（ビュー）'], ['impressions', 'インプレッション'], ['likes', 'スキ']],
  };
  const LS = { theme: 'sns-kirokucho.theme', win: 'sns-kirokucho.win', installTip: 'sns-kirokucho.install-tip' };

  const S = {
    records: [], byDate: new Map(), anchor: null, lastDate: null,
    win: 7, media: 'x', loaded: false,
    editing: null, confirmOverwrite: false, confirmDelete: false, opener: null,
    importRows: null, sampleMode: false, lastField: null, confirmWipe: false, installEvt: null,
  };

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const fmtInt = d3.format(',');
  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const fmt = (v) => (num(v) === null ? '—' : fmtInt(Math.round(num(v))));
  const signed = (v) => (num(v) === null ? '—' : (num(v) > 0 ? '+' : '') + fmtInt(num(v)));
  const pct = (v) => (num(v) === null ? '—' : d3.format('.1%')(num(v)));
  const md = (d) => { const p = String(d || '').split('-'); return p.length === 3 ? `${Number(p[1])}/${Number(p[2])}` : '—'; };
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const mdw = (d) => { const t = new Date(d + 'T00:00:00Z'); return Number.isNaN(+t) ? md(d) : `${md(d)}（${WEEK[t.getUTCDay()]}）`; };
  const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const dayRange = (a, b) => { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; };
  const today = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const val = (r, p, f) => num(r && r[p] ? r[p][f] : null);
  const setText = (el, t) => { if (el) el.textContent = t; };
  const signClass = (el, v) => { if (!el) return; el.classList.toggle('up', num(v) !== null && num(v) > 0); el.classList.toggle('down', num(v) !== null && num(v) < 0); };
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* per-viewer convenience only */ } } };

  const parseNum = (raw) => {
    let s = String(raw ?? '').trim().replace(/[,，\s]/g, '');
    if (!s) return null;
    s = s.replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    let mult = 1;
    if (/万$/.test(s)) { mult = 10000; s = s.slice(0, -1); } else if (/[kK]$/.test(s)) { mult = 1000; s = s.slice(0, -1); } else if (/[mM]$/.test(s)) { mult = 1000000; s = s.slice(0, -1); }
    if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
    return Math.round(Number(s) * mult);
  };

  const hasActivity = (r) => ['impressions', 'posts'].some((f) => val(r, 'x', f) !== null || val(r, 'threads', f) !== null) || val(r, 'note', 'pv') !== null || val(r, 'note', 'impressions') !== null;

  let toastTimer = null;
  const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600); };
  const banner = (msg) => { const b = $('#banner'); b.textContent = msg || ''; b.hidden = !msg; };

  
  /* ---------- storage (this browser only) ---------- */
  const DATA_KEY = 'sns-kirokucho.data.v1';
  const blank = () => ({
    version: 1,
    records: {},
    settings: { platforms: { x: true, threads: true, note: true } },
    lastBackupAt: null,
  });
  let DATA = blank();
  let storageOk = true;

  function loadData() {
    try {
      const raw = localStorage.getItem(DATA_KEY);
      if (!raw) { DATA = blank(); return; }
      const d = JSON.parse(raw);
      if (!d || typeof d !== 'object' || !d.records || typeof d.records !== 'object') { DATA = blank(); return; }
      const base = blank();
      DATA = {
        ...base,
        ...d,
        settings: { ...base.settings, ...(d.settings || {}), platforms: { ...base.settings.platforms, ...((d.settings || {}).platforms || {}) } },
      };
    } catch (e) {
      storageOk = false;
    }
  }

  function persist() {
    try {
      localStorage.setItem(DATA_KEY, JSON.stringify(DATA));
      storageOk = true;
      return true;
    } catch (e) {
      storageOk = false;
      return false;
    }
  }

  let persistAsked = false;
  function askPersistent() {
    if (persistAsked) return;
    persistAsked = true;
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* optional */ }
  }

  const on = (p) => DATA.settings.platforms[p] !== false;
  const realCount = () => Object.keys(DATA.records).length;

  /* ---------- sample data (never saved) ---------- */
  function makeSample() {
    const end = addDays(today(), -1);
    let seed = 11;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    let xf = 128; let tf = 96; let nf = 41;
    const out = [];
    for (let i = 29; i >= 0; i -= 1) {
      const date = addDays(end, -i);
      const xp = 2 + Math.floor(rnd() * 4);
      const tp = 1 + Math.floor(rnd() * 3);
      const spike = rnd() < 0.08 ? 4 : 1;
      xf += Math.round(rnd() * 3 - 0.7);
      tf += Math.round(rnd() * 2.4 - 0.4);
      nf += rnd() < 0.3 ? 1 : 0;
      out.push({
        date,
        sample: true,
        x: { followers: xf, impressions: Math.round((300 + rnd() * 900) * (xp / 3) * spike), posts: xp, engagement: Math.round(10 + rnd() * 40) },
        threads: { followers: tf, impressions: Math.round((200 + rnd() * 700) * spike), posts: tp, engagement: Math.round(5 + rnd() * 30) },
        note: { followers: nf, pv: Math.round(10 + rnd() * 60), impressions: Math.round(100 + rnd() * 500), likes: Math.round(rnd() * 8) },
        memo: i === 12 ? 'サンプル：この日の投稿が伸びた' : '',
      });
    }
    return out;
  }

  function enterSample() {
    S.sampleMode = true;
    refresh();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function exitSample() {
    if (!S.sampleMode) return;
    S.sampleMode = false;
    refresh();
  }
  function refresh() {
    setRecords(S.sampleMode ? makeSample() : Object.values(DATA.records));
  }

  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  const fmtDay = (iso) => { const t = new Date(iso); return Number.isNaN(+t) ? '—' : `${t.getMonth() + 1}/${t.getDate()}`; };

  /* ---------- derived numbers ---------- */
  function followerInfo(p) {
    const list = S.records.filter((r) => val(r, p, 'followers') !== null);
    if (!list.length) return null;
    const last = list[list.length - 1];
    const prev = list[list.length - 2];
    return {
      value: val(last, p, 'followers'), date: last.date,
      change: prev ? val(last, p, 'followers') - val(prev, p, 'followers') : null,
      first: val(list[0], p, 'followers'), firstDate: list[0].date,
    };
  }

  function windowStats() {
    const end = S.anchor;
    if (!end) return null;
    const start = addDays(end, -(S.win - 1));
    const rs = S.records.filter((r) => r.date >= start && r.date <= end);
    const sum = (p, f) => { let s = 0; let c = 0; rs.forEach((r) => { const v = val(r, p, f); if (v !== null) { s += v; c += 1; } }); return c ? { s, c } : null; };
    const st = { start, end };
    PLATS.forEach((p) => { st[p] = {}; FIELDS[p].forEach(([f]) => { st[p][f] = sum(p, f); }); });
    return st;
  }

  /* ---------- rendering: numbers ---------- */
  function renderNumbers() {
    setText($('#h-last'), S.lastDate ? md(S.lastDate) : '—');
    const st = windowStats();
    $$('#win-seg button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.win) === S.win)));
    $$('[data-f="win"]').forEach((el) => { el.textContent = `${S.win}日間`; });
    if (!S.loaded) return;
    setText($('#sum-range'), st ? `${md(st.start)} 〜 ${md(st.end)} の${S.win}日間` : 'まだ記録がありません。「記録する」から最初の1日を入れてみましょう。');

    const fol = {};
    PLATS.forEach((p) => { fol[p] = on(p) ? followerInfo(p) : null; });
    const folVals = PLATS.map((p) => fol[p]).filter(Boolean);
    const folChg = folVals.filter((f) => f.change !== null);
    setText($('#s-fol'), folVals.length ? fmt(folVals.reduce((a, f) => a + f.value, 0)) : '—');
    const chgTotal = folChg.length ? folChg.reduce((a, f) => a + f.change, 0) : null;
    setText($('#s-fol-chg'), signed(chgTotal)); signClass($('#s-fol-chg'), chgTotal);

    const g = (p, f) => (on(p) && st && st[p][f] ? st[p][f].s : null);
    const add = (...vs) => { const ok = vs.filter((v) => v !== null); return ok.length ? ok.reduce((a, v) => a + v, 0) : null; };
    setText($('#s-imp'), fmt(add(g('x', 'impressions'), g('threads', 'impressions'), g('note', 'impressions'))));
    const pv = g('note', 'pv');
    const nimp = g('note', 'impressions');
    const ctr = pv !== null && nimp ? pv / nimp : null;
    setText($('#s-pv'), fmt(pv));
    setText($('#s-ctr'), pct(ctr));
    setText($('#s-posts'), fmt(add(g('x', 'posts'), g('threads', 'posts'))));
    setText($('#s-xposts'), fmt(g('x', 'posts')));
    setText($('#s-tposts'), fmt(g('threads', 'posts')));

    ['x', 'threads'].forEach((p) => {
      const card = $(`#card-${p}`);
      const f = fol[p];
      const q = (k) => $$(`[data-f="${k}"]`, card);
      q('fol').forEach((el) => setText(el, f ? fmt(f.value) : '—'));
      q('fol-date').forEach((el) => setText(el, f ? md(f.date) : '—'));
      q('fol-chg').forEach((el) => { setText(el, f ? signed(f.change) : '—'); signClass(el, f && f.change); });
      q('first-date').forEach((el) => setText(el, f ? md(f.firstDate) : '—'));
      const since = f ? f.value - f.first : null;
      q('since').forEach((el) => { setText(el, signed(since)); signClass(el, since); });
      const imp = g(p, 'impressions');
      const posts = g(p, 'posts');
      q('imp').forEach((el) => setText(el, fmt(imp)));
      q('posts').forEach((el) => setText(el, fmt(posts)));
      q('per').forEach((el) => setText(el, imp !== null && posts ? fmt(imp / posts) : '—'));
      const eng = st && st[p].engagement ? st[p].engagement.s / st[p].engagement.c : null;
      q('eng').forEach((el) => setText(el, fmt(eng)));
    });
    const nc = $('#card-note');
    const nq = (k) => $$(`[data-f="${k}"]`, nc);
    nq('pv').forEach((el) => setText(el, fmt(pv)));
    nq('fol').forEach((el) => setText(el, fol.note ? fmt(fol.note.value) : '—'));
    nq('fol-chip').forEach((el) => { el.hidden = !fol.note; });
    nq('imp').forEach((el) => setText(el, fmt(nimp)));
    nq('ctr').forEach((el) => setText(el, pct(ctr)));
    nq('likes').forEach((el) => setText(el, fmt(g('note', 'likes'))));
    nq('pvavg').forEach((el) => setText(el, st && st.note.pv ? fmt(st.note.pv.s / st.note.pv.c) : '—'));
  }

  /* ---------- charts ---------- */
  const emptyMsg = (el, msg) => { const d = document.createElement('div'); d.className = 'empty'; d.textContent = msg; el.replaceChildren(d); };
  const svgIn = (el, h) => {
    const w = Math.max(el.clientWidth, 240);
    el.replaceChildren();
    const svg = d3.select(el).append('svg').attr('class', 'svg').attr('width', '100%').attr('height', h).attr('viewBox', `0 0 ${w} ${h}`);
    return { svg, w, h };
  };
  const measure = (svg, labels, cls) => {
    const g = svg.append('g').attr('class', cls).attr('opacity', 0);
    const w = d3.max(labels, (t) => g.append('text').text(t).node().getComputedTextLength()) || 0;
    g.remove();
    return Math.ceil(w);
  };
  const makeTip = (el) => { const t = document.createElement('div'); t.className = 'tip'; t.hidden = true; el.append(t); return t; };
  const showTip = (el, t, cx, cy, head, lines) => {
    const h = document.createElement('div'); h.className = 'tip-h'; h.textContent = head;
    const rows = lines.map((l) => {
      const r = document.createElement('div'); r.className = 'tip-r';
      if (l.color) { const i = document.createElement('i'); i.style.background = l.color; r.append(i); }
      const a = document.createElement('span'); a.textContent = l.label;
      const b = document.createElement('b'); b.textContent = l.value;
      r.append(a, b); return r;
    });
    t.replaceChildren(h, ...rows); t.hidden = false;
    const W = el.clientWidth; const tw = t.offsetWidth; const th = t.offsetHeight;
    t.style.left = `${Math.max(2, Math.min(W - tw - 2, cx - tw / 2))}px`;
    let top = cy - th - 12; if (top < 0) top = cy + 14;
    t.style.top = `${top}px`;
  };
  const axes = (svg, { y, ticks, ml, mr, w, h, labels, x, step, center }) => {
    svg.append('g').selectAll('line').data(ticks).join('line').attr('class', 'gridline')
      .attr('x1', ml).attr('x2', w - mr).attr('y1', (t) => y(t)).attr('y2', (t) => y(t));
    svg.append('g').attr('class', 'tick').selectAll('text').data(ticks).join('text')
      .attr('x', ml - 8).attr('y', (t) => y(t)).attr('dy', '0.32em').attr('text-anchor', 'end').text(fmtInt);
    const lw = measure(svg, labels.map(md), 'tick') + 10;
    const every = Math.max(1, Math.ceil(lw / step));
    const last = labels.length - 1;
    svg.append('g').attr('class', 'tick').selectAll('text').data(labels.filter((d, i) => (last - i) % every === 0)).join('text')
      .attr('x', (d) => x(d) + center).attr('y', h - 8).attr('text-anchor', 'middle').text(md);
  };

  function drawImp(el) {
    if (!on(S.media)) S.media = PLATS.find(on) || 'x';
    const p = S.media;
    if (!S.anchor) { emptyMsg(el, 'まだ記録がありません'); $('#cap-note').hidden = true; return; }
    const days = dayRange(addDays(S.anchor, -29), S.anchor);
    const rows = days.map((d) => { const r = S.byDate.get(d); return { day: d, v: val(r, p, 'impressions'), posts: val(r, p, 'posts'), pv: val(r, 'note', 'pv') }; });
    const have = rows.filter((r) => r.v !== null);
    if (!have.length) { emptyMsg(el, `直近30日の ${NAMES[p]} の記録はまだありません`); $('#cap-note').hidden = true; return; }
    const { svg, w, h } = svgIn(el, 230);
    const sorted = have.map((r) => r.v).sort(d3.ascending);
    const p75 = d3.quantile(sorted, 0.75) || 0;
    const max = sorted[sorted.length - 1] || 1;
    const capped = have.length >= 5 && p75 > 0 && max > p75 * 4;
    const y = d3.scaleLinear([0, capped ? p75 * 2.4 : max], [h - 28, 12]).nice(4);
    const top = y.domain()[1];
    const ticks = y.ticks(4).filter(Number.isInteger);
    const ml = measure(svg, ticks.map(fmtInt), 'tick') + 10;
    const lw = measure(svg, days.map(md), 'tick') + 10;
    const mr = Math.ceil(lw / 2);
    const x = d3.scaleBand(days, [ml, w - mr]).paddingInner(0.28).paddingOuter(0.1);
    const bw = x.bandwidth();
    axes(svg, { y, ticks, ml, mr, w, h, labels: days, x, step: x.step(), center: bw / 2 });
    const vy = (r) => y(Math.min(r.v, top));
    const bars = svg.append('g').selectAll('rect').data(have).join('rect').attr('class', 'bar')
      .attr('x', (r) => x(r.day)).attr('width', bw).attr('y', vy).attr('height', (r) => Math.max(0, y(0) - vy(r)))
      .attr('rx', Math.min(4, bw / 2)).style('fill', COLOR[p]);
    const over = have.filter((r) => r.v > top);
    svg.append('g').selectAll('path').data(over).join('path').attr('class', 'break')
      .attr('d', (r) => { const a = x(r.day) - 2; const b = x(r.day) + bw + 2; const yy = y(top) + 12; return `M${a},${yy + 3}L${b},${yy - 3}M${a},${yy + 8}L${b},${yy + 2}`; });
    $('#cap-note').hidden = !over.length;
    const t = makeTip(el);
    svg.append('g').selectAll('rect').data(rows).join('rect')
      .attr('x', (r) => x(r.day) - (x.step() - bw) / 2).attr('width', x.step()).attr('y', 0).attr('height', h).attr('fill', 'transparent')
      .on('pointerenter pointermove pointerdown', (ev, r) => {
        bars.classed('dim', (b) => b.day !== r.day);
        const lines = r.v === null ? [{ label: '記録なし', value: '' }] : [{ label: 'インプレッション', value: fmtInt(r.v) }];
        if (r.v !== null && p === 'note') lines.push({ label: 'PV', value: r.pv === null ? '—' : fmtInt(r.pv) });
        if (r.v !== null && p !== 'note') lines.push({ label: '投稿', value: r.posts === null ? '—' : `${fmtInt(r.posts)} 本` });
        showTip(el, t, x(r.day) + bw / 2, r.v === null ? y(0) : vy(r), mdw(r.day), lines);
      })
      .on('pointerleave', () => { bars.classed('dim', false); t.hidden = true; });
  }

  function drawFol(el) {
    if (!S.lastDate) { emptyMsg(el, 'まだ記録がありません'); return; }
    const start = addDays(S.lastDate, -89);
    const pts = S.records.filter((r) => r.date >= start && PLATS.some((p) => val(r, p, 'followers') !== null))
      .map((r) => ({ day: r.date, date: new Date(r.date + 'T00:00:00Z'), x: val(r, 'x', 'followers'), threads: val(r, 'threads', 'followers'), note: val(r, 'note', 'followers') }));
    if (!pts.length) { emptyMsg(el, 'フォロワーの記録はまだありません'); return; }
    const keys = PLATS.filter((k) => on(k) && pts.some((q) => q[k] !== null));
    if (!keys.length) { emptyMsg(el, 'フォロワーの記録はまだありません'); return; }
    const { svg, w, h } = svgIn(el, 210);
    const vals = pts.flatMap((q) => keys.map((k) => q[k])).filter((v) => v !== null);
    const lo = d3.min(vals); const hi = d3.max(vals);
    const pad = Math.max(2, (hi - lo) * 0.15);
    const y = d3.scaleLinear([Math.max(0, lo - pad), hi + pad], [h - 28, 14]).nice(4);
    const ticks = y.ticks(4).filter(Number.isInteger);
    const ml = measure(svg, ticks.map(fmtInt), 'tick') + 10;
    const ends = keys.map((k) => { const q = [...pts].reverse().find((z) => z[k] !== null); return { k, q, text: `${NAMES[k]} ${fmtInt(q[k])}` }; });
    const mr = measure(svg, ends.map((e) => e.text), 'endlabel') + 14;
    let x0 = pts[0].date; let x1 = pts[pts.length - 1].date;
    if (+x0 === +x1) { x0 = d3.utcDay.offset(x0, -1); x1 = d3.utcDay.offset(x1, 1); }
    const x = d3.scaleUtc([x0, x1], [ml + 8, w - mr]);
    const xd = (d) => x(new Date(d + 'T00:00:00Z'));
    const gap = pts.length > 1 ? (xd(pts[pts.length - 1].day) - xd(pts[0].day)) / (pts.length - 1) : w;
    axes(svg, { y, ticks, ml, mr, w, h, labels: pts.map((q) => q.day), x: xd, step: gap, center: 0 });
    keys.forEach((k) => {
      svg.append('path').datum(pts).attr('fill', 'none').style('stroke', COLOR[k]).attr('stroke-width', 2).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round')
        .attr('d', d3.line().defined((q) => q[k] !== null).x((q) => x(q.date)).y((q) => y(q[k])));
      svg.append('g').selectAll('circle').data(pts.filter((q) => q[k] !== null)).join('circle')
        .attr('r', pts.length > 40 ? 2.2 : 3.5).attr('cx', (q) => x(q.date)).attr('cy', (q) => y(q[k])).style('fill', COLOR[k]);
    });
    const placed = ends.map((e) => ({ ...e, y: y(e.q[e.k]) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < placed.length; i += 1) if (placed[i].y - placed[i - 1].y < 15) placed[i].y = placed[i - 1].y + 15;
    svg.append('g').selectAll('text').data(placed).join('text').attr('class', 'endlabel')
      .attr('x', (e) => x(e.q.date) + 9).attr('y', (e) => e.y).attr('dy', '0.32em').style('fill', (e) => COLOR[e.k]).text((e) => e.text);
    const rule = svg.append('line').attr('class', 'rule').attr('y1', 10).attr('y2', h - 28).attr('opacity', 0);
    const t = makeTip(el);
    svg.append('rect').attr('x', ml).attr('width', w - ml).attr('height', h).attr('fill', 'transparent')
      .on('pointermove pointerdown', (ev) => {
        const [mx] = d3.pointer(ev);
        const q = pts.reduce((best, z) => (Math.abs(x(z.date) - mx) < Math.abs(x(best.date) - mx) ? z : best), pts[0]);
        rule.attr('x1', x(q.date)).attr('x2', x(q.date)).attr('opacity', 1);
        const ks = keys.filter((k) => q[k] !== null);
        showTip(el, t, x(q.date), d3.min(ks, (k) => y(q[k])), mdw(q.day), ks.map((k) => ({ color: COLOR[k], label: NAMES[k], value: fmtInt(q[k]) })));
      })
      .on('pointerleave', () => { rule.attr('opacity', 0); t.hidden = true; });
  }

  function drawPosts(el) {
    if (!S.anchor) { emptyMsg(el, 'まだ記録がありません'); return; }
    const keys = ['x', 'threads'].filter(on);
    if (!keys.length) { emptyMsg(el, 'X か Threads を使うと表示されます'); return; }
    const days = dayRange(addDays(S.anchor, -13), S.anchor);
    const rows = days.map((d) => { const r = S.byDate.get(d); return { day: d, x: val(r, 'x', 'posts'), threads: val(r, 'threads', 'posts') }; });
    if (!rows.some((r) => keys.some((k) => r[k] !== null))) { emptyMsg(el, '投稿数の記録はまだありません'); return; }
    const { svg, w, h } = svgIn(el, 210);
    const y = d3.scaleLinear([0, d3.max(rows, (r) => Math.max(r.x ?? 0, r.threads ?? 0)) || 1], [h - 28, 12]).nice(4);
    const ticks = y.ticks(4).filter(Number.isInteger);
    const ml = measure(svg, ticks.map(fmtInt), 'tick') + 10;
    const lw = measure(svg, days.map(md), 'tick') + 10;
    const mr = Math.ceil(lw / 2);
    const x = d3.scaleBand(days, [ml, w - mr]).paddingInner(0.25).paddingOuter(0.1);
    const xi = d3.scaleBand(keys, [0, x.bandwidth()]).padding(0.08);
    axes(svg, { y, ticks, ml, mr, w, h, labels: days, x, step: x.step(), center: x.bandwidth() / 2 });
    const groups = svg.append('g').selectAll('g').data(rows).join('g').attr('class', 'bar').attr('transform', (r) => `translate(${x(r.day)},0)`);
    groups.selectAll('rect').data((r) => keys.filter((k) => r[k] !== null).map((k) => ({ k, v: r[k] }))).join('rect')
      .attr('x', (b) => xi(b.k)).attr('width', xi.bandwidth()).attr('y', (b) => y(b.v)).attr('height', (b) => Math.max(0, y(0) - y(b.v)))
      .attr('rx', Math.min(3, xi.bandwidth() / 2)).style('fill', (b) => COLOR[b.k]);
    const t = makeTip(el);
    svg.append('g').selectAll('rect').data(rows).join('rect')
      .attr('x', (r) => x(r.day) - (x.step() - x.bandwidth()) / 2).attr('width', x.step()).attr('y', 0).attr('height', h).attr('fill', 'transparent')
      .on('pointerenter pointermove pointerdown', (ev, r) => {
        groups.classed('dim', (g) => g.day !== r.day);
        showTip(el, t, x(r.day) + x.bandwidth() / 2, y(Math.max(r.x ?? 0, r.threads ?? 0)), mdw(r.day),
          keys.map((k) => ({ color: COLOR[k], label: NAMES[k], value: r[k] === null ? '—' : `${fmtInt(r[k])} 本` })));
      })
      .on('pointerleave', () => { groups.classed('dim', false); t.hidden = true; });
  }

  function drawSpark(el) {
    const p = el.dataset.spark; const m = el.dataset.metric;
    if (!S.anchor) { emptyMsg(el, 'まだ記録がありません'); return; }
    const days = dayRange(addDays(S.anchor, -13), S.anchor);
    const rows = days.map((d, i) => ({ i, day: d, v: val(S.byDate.get(d), p, m) }));
    const have = rows.filter((r) => r.v !== null);
    if (have.length < 2) { emptyMsg(el, 'グラフには2日分以上の記録が必要です'); return; }
    const { svg, w, h } = svgIn(el, 56);
    const x = d3.scaleLinear([0, days.length - 1], [4, w - 4]);
    const y = d3.scaleLinear([0, d3.max(have, (r) => r.v) || 1], [h - 3, 7]);
    const id = `spg-${p}`;
    const grad = svg.append('defs').append('linearGradient').attr('id', id).attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 1);
    [[0, 0.3], [0.5, 0.1], [1, 0]].forEach(([o, a]) => grad.append('stop').attr('offset', o).style('stop-color', COLOR[p]).style('stop-opacity', a));
    svg.append('path').datum(have).attr('fill', `url(#${id})`).attr('d', d3.area().x((r) => x(r.i)).y0(h - 3).y1((r) => y(r.v)));
    svg.append('path').datum(have).attr('fill', 'none').style('stroke', COLOR[p]).attr('stroke-width', 2).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round')
      .attr('d', d3.line().x((r) => x(r.i)).y((r) => y(r.v)));
    const lastPt = have[have.length - 1];
    const dot = svg.append('circle').attr('r', 3.5).style('fill', COLOR[p]).attr('cx', x(lastPt.i)).attr('cy', y(lastPt.v));
    const t = makeTip(el);
    const unit = m === 'pv' ? 'PV' : 'インプレッション';
    svg.append('rect').attr('width', w).attr('height', h).attr('fill', 'transparent')
      .on('pointermove pointerdown', (ev) => {
        const [mx] = d3.pointer(ev);
        const r = have.reduce((best, z) => (Math.abs(x(z.i) - mx) < Math.abs(x(best.i) - mx) ? z : best), have[0]);
        dot.attr('cx', x(r.i)).attr('cy', y(r.v));
        showTip(el, t, x(r.i), y(r.v), mdw(r.day), [{ label: unit, value: fmtInt(r.v) }]);
      })
      .on('pointerleave', () => { t.hidden = true; dot.attr('cx', x(lastPt.i)).attr('cy', y(lastPt.v)); });
  }

  const charts = () => [
    [$('#imp-chart'), drawImp], [$('#fol-chart'), drawFol], [$('#post-chart'), drawPosts],
    ...$$('.spark').map((el) => [el, drawSpark]),
  ];
  const drawn = new WeakMap();
  function renderCharts() {
    if (!S.loaded) { charts().forEach(([el]) => emptyMsg(el, '記録を読み込んでいます…')); return; }
    charts().forEach(([el, fn]) => { fn(el); drawn.set(el, el.clientWidth); });
  }

  
  /* ---------- record table ---------- */
  function renderTable() {
    const body = $('#rec-body');
    if (!S.loaded) return;
    const table = $('#rec-table');
    PLATS.forEach((p) => table.classList.toggle(`hide-${p}`, !on(p)));
    table.classList.toggle('hide-posts', !on('x') && !on('threads'));
    setText($('#rec-count'), `${S.records.length}件`);
    setText($('#rec-help'), S.sampleMode ? 'サンプルの記録です（編集はできません）。' : '行をタップすると編集できます。空欄は「記録なし」です。');
    if (!S.records.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 8; td.className = 'msg'; td.textContent = 'まだ記録がありません。';
      tr.append(td); body.replaceChildren(tr); return;
    }
    const lastFol = {};
    const delta = new Map();
    S.records.forEach((r) => {
      const d = {};
      PLATS.forEach((p) => { const v = val(r, p, 'followers'); if (v !== null) { d[p] = lastFol[p] === undefined ? null : v - lastFol[p]; lastFol[p] = v; } });
      delta.set(r.date, d);
    });
    const cell = (text, cls) => { const td = document.createElement('td'); if (cls) td.className = cls; td.textContent = text; return td; };
    const folCell = (r, p) => {
      const v = val(r, p, 'followers');
      const td = cell(v === null ? '' : fmtInt(v), `c-${p}`);
      const c = delta.get(r.date)[p];
      if (v !== null && c !== null && c !== undefined) { const s = document.createElement('small'); s.textContent = signed(c); signClass(s, c); td.append(s); }
      return td;
    };
    const numCell = (v, cls) => cell(v === null ? '' : fmt(v), cls);
    body.replaceChildren(...[...S.records].reverse().map((r) => {
      const tr = document.createElement('tr');
      const xp = val(r, 'x', 'posts'); const tp = val(r, 'threads', 'posts');
      const posts = [on('x') ? (xp === null ? '–' : fmtInt(xp)) : null, on('threads') ? (tp === null ? '–' : fmtInt(tp)) : null].filter((v) => v !== null);
      tr.append(
        cell(mdw(r.date), 'date'),
        folCell(r, 'x'), numCell(val(r, 'x', 'impressions'), 'c-x'),
        folCell(r, 'threads'), numCell(val(r, 'threads', 'impressions'), 'c-threads'),
        numCell(val(r, 'note', 'pv'), 'c-note'),
        cell(xp === null && tp === null ? '' : posts.join(' / '), 'c-posts'),
        cell(typeof r.memo === 'string' ? r.memo : '', 'memo'),
      );
      if (!S.sampleMode) {
        tr.className = 'edit'; tr.tabIndex = 0;
        tr.setAttribute('aria-label', `${mdw(r.date)} の記録を編集`);
        tr.addEventListener('click', () => openSheet(r.date, tr));
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSheet(r.date, tr); } });
      }
      return tr;
    }));
  }

  function renderNotices() {
    const real = realCount();
    $('#welcome').hidden = !(S.loaded && !S.sampleMode && real === 0);
    $('#sample-bar').hidden = !S.sampleMode;
    const last = DATA.lastBackupAt ? Date.parse(DATA.lastBackupAt) : null;
    $('#backup-notice').hidden = !(!S.sampleMode && real >= 5 && (!last || Date.now() - last > 14 * 86400000));
    setText($('#backup-last'), DATA.lastBackupAt ? `最後に書き出した日：${fmtDay(DATA.lastBackupAt)}` : 'まだ書き出していません。');
    $('#install-tip').hidden = !(isIOS() && !isStandalone() && store.get(LS.installTip) !== '1');
    $('#install-btn').hidden = !S.installEvt;
    $('#open-image').hidden = !S.records.length;
  }

  function renderSettings() {
    $$('.tgl input[data-p]').forEach((inp) => { inp.checked = on(inp.dataset.p); });
    $$('.pf[data-p]').forEach((card) => { card.hidden = !on(card.dataset.p); });
    $$('#media-seg button').forEach((b) => { b.hidden = !on(b.dataset.media); });
    $$('#ocr-media button[data-m]').forEach((b) => { b.hidden = b.dataset.m !== 'auto' && !on(b.dataset.m); });
    $$('[data-legend]').forEach((el) => { el.hidden = !on(el.dataset.legend); });
    $$('.pset[data-p]').forEach((fs) => { fs.hidden = !on(fs.dataset.p); });
    if (!on(S.media)) S.media = PLATS.find(on) || 'x';
    $$('#media-seg button').forEach((o) => o.setAttribute('aria-pressed', String(o.dataset.media === S.media)));
  }

  function renderAll() {
    renderSettings();
    renderNotices();
    renderNumbers();
    renderCharts();
    renderTable();
  }

  function setRecords(list) {
    S.records = list.filter((r) => r && isDate(r.date)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    S.byDate = new Map(S.records.map((r) => [r.date, r]));
    const act = [...S.records].reverse().find(hasActivity);
    S.anchor = act ? act.date : (S.records.length ? S.records[S.records.length - 1].date : null);
    S.lastDate = S.records.length ? S.records[S.records.length - 1].date : null;
    S.loaded = true;
    renderAll();
  }

  /* ---------- entry sheet ---------- */
  function buildFields() {
    $$('[data-fields]').forEach((box) => {
      const p = box.dataset.fields;
      box.replaceChildren(...FIELDS[p].map(([f, label]) => {
        const wrap = document.createElement('div'); wrap.className = 'field';
        const id = `f-${p}-${f}`;
        const l = document.createElement('label'); l.htmlFor = id; l.textContent = label;
        const inp = document.createElement('input'); inp.id = id; inp.type = 'text'; inp.inputMode = 'numeric'; inp.autocomplete = 'off'; inp.dataset.p = p; inp.dataset.f = f;
        const hint = document.createElement('p'); hint.className = 'hint'; hint.id = `${id}-hint`;
        inp.setAttribute('aria-describedby', hint.id);
        inp.addEventListener('input', () => { inp.classList.remove('filled'); inp.removeAttribute('aria-invalid'); updateHint(inp); });
        wrap.append(l, inp, hint);
        return wrap;
      }));
    });
  }

  function prevValue(p, f, date) {
    for (let i = S.records.length - 1; i >= 0; i -= 1) {
      const r = S.records[i];
      if (r.date < date) { const v = val(r, p, f); if (v !== null) return { v, date: r.date }; }
    }
    return null;
  }

  function updateHint(inp) {
    const hint = $(`#${inp.id}-hint`);
    const date = $('#f-date').value;
    const prev = isDate(date) ? prevValue(inp.dataset.p, inp.dataset.f, date) : null;
    hint.replaceChildren();
    if (!prev) return;
    hint.append(`前回 ${fmtInt(prev.v)}（${md(prev.date)}）`);
    const cur = parseNum(inp.value);
    if (inp.dataset.f === 'followers' && Number.isFinite(cur) && cur !== null) {
      const b = document.createElement('span'); const d = cur - prev.v;
      b.textContent = `　${signed(d)}`; signClass(b, d); hint.append(b);
    }
  }

  function fillForm(r) {
    $$('[data-fields] input').forEach((inp) => {
      const v = r ? val(r, inp.dataset.p, inp.dataset.f) : null;
      inp.value = v === null ? '' : String(v);
      inp.classList.remove('filled'); inp.removeAttribute('aria-invalid');
    });
    $('#f-memo').value = r && typeof r.memo === 'string' ? r.memo : '';
    updateMemoCount();
  }

  function refreshHints() { $$('[data-fields] input').forEach(updateHint); }
  function updateMemoCount() { setText($('#memo-count'), `${$('#f-memo').value.length} / 140`); }

  function setMode(editingDate) {
    S.editing = editingDate;
    S.confirmDelete = false; S.confirmOverwrite = false;
    setText($('#sheet-title'), editingDate ? `${mdw(editingDate)} の記録を編集` : '記録する');
    $('#f-delete').hidden = !editingDate;
    setText($('#f-delete'), '削除');
    setText($('#f-save'), '保存する');
  }


  function openSheet(date, opener, withShot) {
    if (S.sampleMode) exitSample();
    S.opener = opener || document.activeElement;
    const d = date || today();
    $('#f-date').value = d;
    const r = S.byDate.get(d) || null;
    setMode(r ? d : null);
    fillForm(r);
    setText($('#f-date-hint'), !date && r ? 'この日の記録があるので読み込みました。' : '');
    setText($('#form-err'), '');
    resetOcr();
    renderSettings();
    refreshHints();
    $('#sheet').hidden = false;
    document.body.style.overflow = 'hidden';
    const first = withShot ? $('#ocr-file') : $$('.pset:not([hidden]) input')[0];
    if (first) setTimeout(() => first.focus(), 30);
  }

  function closeSheet() {
    cancelOcr(false);
    $('#sheet').hidden = true;
    document.body.style.overflow = '';
    if (S.opener && document.contains(S.opener)) S.opener.focus();
  }

  function onDateChange() {
    const d = $('#f-date').value;
    S.confirmOverwrite = false; setText($('#f-save'), '保存する');
    if (!isDate(d)) { setText($('#f-date-hint'), ''); return; }
    const r = S.byDate.get(d);
    if (!S.editing && r) {
      setMode(d); fillForm(r);
      setText($('#f-date-hint'), 'この日の記録があるので読み込みました。');
    } else if (S.editing && d !== S.editing && r) {
      setText($('#f-date-hint'), 'この日付にはすでに記録があります。保存すると上書きされます。');
    } else if (S.editing && d !== S.editing) {
      setText($('#f-date-hint'), `${md(S.editing)} の記録をこの日付に移します。`);
    } else {
      setText($('#f-date-hint'), '');
    }
    refreshHints();
  }


  function onSave(ev) {
    ev.preventDefault();
    const err = $('#form-err'); setText(err, '');
    const date = $('#f-date').value;
    if (!isDate(date)) { setText(err, '日付を選んでください。'); $('#f-date').focus(); return; }
    const existing = S.byDate.get(date);
    const moving = S.editing && S.editing !== date;
    const base = S.editing ? S.byDate.get(S.editing) : existing;
    const body = { date, x: {}, threads: {}, note: {} };
    let any = false;
    for (const p of PLATS) {
      for (const [f] of FIELDS[p]) {
        // 使っていない媒体の数字は、そのまま残します
        if (!on(p)) { body[p][f] = base ? val(base, p, f) : null; continue; }
        const inp = $(`#f-${p}-${f}`);
        const v = parseNum(inp.value);
        if (Number.isNaN(v)) { inp.setAttribute('aria-invalid', 'true'); setText(err, '数字で入力してください（例: 1,234 / 1.2万）。'); inp.focus(); return; }
        body[p][f] = v;
        if (v !== null) any = true;
      }
    }
    const memo = $('#f-memo').value.trim().slice(0, 140);
    if (!any && !memo) { setText(err, 'どれか1つは入力してください。'); return; }
    body.memo = memo;
    if (moving && existing && !S.confirmOverwrite) {
      S.confirmOverwrite = true; setText($('#f-save'), '上書きして保存');
      setText(err, `${md(date)} にはすでに記録があります。もう一度押すと上書きします。`); return;
    }
    body.updatedAt = new Date().toISOString();
    const before = JSON.stringify(DATA.records);
    if (moving) delete DATA.records[S.editing];
    DATA.records[date] = body;
    if (!persist()) {
      DATA.records = JSON.parse(before);
      setText(err, 'この端末に保存できませんでした。プライベートブラウズを使っていないか、空き容量があるか確かめてください。');
      return;
    }
    askPersistent();
    closeSheet();
    toast('保存しました');
    refresh();
  }

  function onDelete() {
    if (!S.editing) return;
    if (!S.confirmDelete) { S.confirmDelete = true; setText($('#f-delete'), 'もう一度押すと削除'); return; }
    const before = DATA.records[S.editing];
    delete DATA.records[S.editing];
    if (!persist()) { DATA.records[S.editing] = before; setText($('#form-err'), '削除できませんでした。もう一度試してください。'); return; }
    closeSheet();
    toast('削除しました');
    refresh();
  }

  /* ---------- screenshot reading (on this device) ---------- */
  // 画像はこの端末の中で読み取ります。外に送るのは、読み取り用のプログラムとデータの取得だけです。
  const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const OCR = { worker: null, loading: null, busy: false, cancelled: false, onLog: null, files: [], media: 'auto', run: 0 };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve; s.onerror = () => reject(new Error('script'));
      document.head.append(s);
    });
  }

  async function getWorker() {
    if (OCR.worker) return OCR.worker;
    if (!OCR.loading) {
      OCR.loading = (async () => {
        if (!window.Tesseract) await loadScript(TESS_URL);
        const w = await window.Tesseract.createWorker('jpn', 1, { logger: (m) => { if (OCR.onLog) OCR.onLog(m); } });
        OCR.worker = w;
        return w;
      })().catch((e) => { OCR.loading = null; throw e; });
    }
    return OCR.loading;
  }

  async function loadBitmap(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file); } catch (e) { /* fall back */ }
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image'));
      img.src = URL.createObjectURL(file);
    });
  }

  // 白黒にして、暗い画面は明暗を反転し、小さい画像は拡大します（読み取りやすくするため）。
  async function prepImage(file) {
    const src = await loadBitmap(file);
    const w0 = src.width || src.naturalWidth;
    const h0 = src.height || src.naturalHeight;
    let scale = 1;
    if (Math.max(w0, h0) > 2600) scale = 2600 / Math.max(w0, h0);
    else if (w0 < 900) scale = Math.min(3, 900 / w0);
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, w, h);
    if (src.close) src.close();
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = g; sum += g;
    }
    const invert = sum / (d.length / 4) < 110;
    let lo = 255; let hi = 0;
    for (let i = 0; i < d.length; i += 4) { let g = d[i]; if (invert) g = 255 - g; d[i] = g; if (g < lo) lo = g; if (g > hi) hi = g; }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      const g = Math.round(((d[i] - lo) / span) * 255);
      d[i] = g; d[i + 1] = g; d[i + 2] = g; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  const ocrStatus = (msg, isErr) => { const el = $('#ocr-status'); el.textContent = msg; el.classList.toggle('err', !!isErr); };
  const setProgress = (frac) => {
    const bar = $('#ocr-progress');
    bar.hidden = frac === null;
    if (frac !== null) $('i', bar).style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
  };

  function resetOcr() {
    OCR.files = [];
    $('#ocr-file').value = '';
    $$('#ocr-thumbs img').forEach((img) => URL.revokeObjectURL(img.src));
    $('#ocr-thumbs').replaceChildren(); $('#ocr-thumbs').hidden = true;
    $('#ocr-chips-box').hidden = true; $('#ocr-chips').replaceChildren();
    $('#ocr-go').hidden = true;
    ocrStatus('');
    setProgress(null);
    S.lastField = null;
  }

  function cancelOcr(showMsg) {
    if (!OCR.busy) return;
    OCR.cancelled = true;
    OCR.run += 1;
    const w = OCR.worker;
    OCR.worker = null; OCR.loading = null;
    if (w) w.terminate().catch(() => {});
    OCR.busy = false;
    $('#ocr-stop').hidden = true;
    setProgress(null);
    if (showMsg) ocrStatus('読み取りを止めました。');
  }

  function onOcrFiles() {
    const files = [...($('#ocr-file').files || [])].filter((f) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(f.name)).slice(0, 4);
    $$('#ocr-thumbs img').forEach((img) => URL.revokeObjectURL(img.src));
    OCR.files = files;
    $('#ocr-thumbs').replaceChildren(...files.map((f) => { const img = document.createElement('img'); img.alt = '選んだスクショ'; img.src = URL.createObjectURL(f); return img; }));
    $('#ocr-thumbs').hidden = !files.length;
    if (!files.length) { ocrStatus('画像を選んでください。', true); return; }
    runOcr();
  }

  function fillField(p, f, v) {
    const inp = $(`#f-${p}-${f}`);
    if (!inp) return false;
    inp.value = String(v);
    inp.classList.add('filled');
    inp.removeAttribute('aria-invalid');
    updateHint(inp);
    return true;
  }

  function renderChips(numbers) {
    const seen = new Set();
    const list = numbers.filter((n) => { const k = `${n.value}|${n.label}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 30);
    $('#ocr-chips').replaceChildren(...list.map((n) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'nchip';
      const v = document.createElement('b'); v.textContent = fmtInt(n.value);
      b.append(v);
      if (n.label) { const l = document.createElement('span'); l.textContent = n.label; b.append(l); }
      b.addEventListener('click', () => {
        const target = S.lastField && document.contains(S.lastField) && !S.lastField.closest('[hidden]') ? S.lastField : null;
        if (!target) { ocrStatus('先に、数字を入れたい欄をタップしてください。'); return; }
        target.value = String(n.value);
        target.classList.add('filled');
        target.removeAttribute('aria-invalid');
        updateHint(target);
        target.focus();
      });
      return b;
    }));
    $('#ocr-chips-box').hidden = !list.length;
  }

  async function runOcr() {
    if (OCR.busy || !OCR.files.length) return;
    if (!window.SNSParse) { ocrStatus('読み取りの準備ができていません。ページを開き直してください。', true); return; }
    OCR.busy = true; OCR.cancelled = false;
    const run = ++OCR.run;
    const files = OCR.files.slice();
    $('#ocr-stop').hidden = false; $('#ocr-go').hidden = true;
    $('#ocr-chips-box').hidden = true;
    let current = 0;
    OCR.onLog = (m) => {
      if (run !== OCR.run) return;
      if (m.status === 'recognizing text') {
        ocrStatus(`読み取っています… ${current + 1} / ${files.length}`);
        setProgress((current + (m.progress || 0)) / files.length);
      } else if (/loading/.test(m.status || '')) {
        setProgress(typeof m.progress === 'number' ? m.progress : 0);
      }
    };
    try {
      ocrStatus(OCR.worker ? '読み取っています…' : '読み取りの準備をしています（初回だけ 2MB ほど読み込みます）…');
      setProgress(0);
      const worker = await getWorker();
      const hint = OCR.media === 'auto' ? null : OCR.media;
      const filled = [];
      const found = [];
      const numbers = [];
      for (current = 0; current < files.length; current += 1) {
        if (OCR.cancelled || run !== OCR.run) return;
        const canvas = await prepImage(files[current]);
        const { data } = await worker.recognize(canvas);
        if (OCR.cancelled || run !== OCR.run) return;
        const res = window.SNSParse.parse(data.text, hint);
        numbers.push(...res.numbers);
        if (!res.platform) continue;
        found.push(res.platform);
        if (!on(res.platform)) continue;
        for (const [f] of FIELDS[res.platform]) {
          if (typeof res.values[f] === 'number' && fillField(res.platform, f, res.values[f])) filled.push(`${NAMES[res.platform]}の${FIELDS[res.platform].find(([k]) => k === f)[1]}`);
        }
      }
      renderChips(numbers);
      const kinds = [...new Set(found)].map((p) => NAMES[p]).join('・');
      if (filled.length) {
        ocrStatus(`${filled.length}項目を入れました（金色の枠）：${filled.join('、')}。\n数字が合っているか確かめてから保存してください。`);
      } else if (!found.length) {
        ocrStatus('どの SNS の画面か判定できませんでした。上で媒体を選んで「もう一度読み取る」を押すか、下の数字をタップして入れてください。', true);
      } else if (found.every((p) => !on(p))) {
        ocrStatus(`${kinds} の画面のようですが、使う媒体に入っていません。「設定とデータ」で使う媒体に加えてください。`, true);
      } else {
        ocrStatus(`${kinds} の画面のようですが、決まった項目の数字を見つけられませんでした。下の数字をタップして入れてください。`, true);
      }
    } catch (e) {
      if (run === OCR.run) ocrStatus('読み取りを始められませんでした。通信できる状態で、もう一度試してください。数字は手で入力することもできます。', true);
    } finally {
      if (run === OCR.run) {
        OCR.busy = false; OCR.onLog = null;
        $('#ocr-stop').hidden = true;
        $('#ocr-go').hidden = !OCR.files.length;
        setProgress(null);
      }
    }
  }

  const COLS = [['date', null, null]];
  PLATS.forEach((p) => FIELDS[p].forEach(([f]) => COLS.push([`${p}_${f}`, p, f])));
  COLS.push(['memo', null, null], ['origin', null, null]);

  const csvEsc = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function toCSV() {
    const lines = [COLS.map((c) => c[0]).join(',')];
    S.records.forEach((r) => lines.push(COLS.map(([k, p, f]) => csvEsc(p ? val(r, p, f) : r[k])).join(',')));
    return '﻿' + lines.join('\r\n');
  }
  function parseCSV(text) {
    const rows = []; let row = []; let cur = ''; let q = false;
    const s = text.replace(/^﻿/, '');
    for (let i = 0; i < s.length; i += 1) {
      const ch = s[i];
      if (q) { if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i += 1; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i += 1; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    const head = (rows.shift() || []).map((h) => h.trim());
    return rows.filter((r) => r.some((c) => c.trim())).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
  }
  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const date = String(raw.date || '').trim().slice(0, 10);
    if (!isDate(date)) return null;
    const out = { date, x: {}, threads: {}, note: {} };
    PLATS.forEach((p) => FIELDS[p].forEach(([f]) => {
      const v = raw[p] && typeof raw[p] === 'object' ? raw[p][f] : raw[`${p}_${f}`];
      const n = typeof v === 'number' ? v : parseNum(v);
      out[p][f] = Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
    }));
    out.memo = typeof raw.memo === 'string' ? raw.memo.slice(0, 140) : '';
    out.origin = typeof raw.origin === 'string' && raw.origin ? raw.origin.slice(0, 20) : 'import';
    out.updatedAt = new Date().toISOString();
    return out;
  }


  /* ---------- dashboard image ---------- */
  // ダッシュボードのまとめを 1080×1350 の画像に描きます（今のテーマの色を使います）。
  const IMG = { blob: null, url: null, opener: null };
  const cssVar = (name, fallback) => (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);
  const hexA = (hex, a) => {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return hex;
    let h = m[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function starPath(ctx, cx, cy, R, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 ? r : R;
      const px = cx + Math.cos(a) * rad; const py = cy + Math.sin(a) * rad;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
  }

  async function drawDashboardImage() {
    const W = 1080; const H = 1350;
    const F = {
      display: '"Zen Maru Gothic", "Hiragino Maru Gothic ProN", "Noto Sans JP", sans-serif',
      body: '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif',
      num: '"Manrope", "Noto Sans JP", "Hiragino Sans", sans-serif',
    };
    try {
      await Promise.race([
        Promise.all(['700 72px "Zen Maru Gothic"', '800 52px "Manrope"', '500 26px "Noto Sans JP"', '700 30px "Noto Sans JP"']
          .map((f) => document.fonts.load(f, 'SNS記録帳フォロワー0123'))),
        new Promise((resolve) => setTimeout(resolve, 2500)),
      ]);
    } catch (e) { /* fonts are optional */ }
    const c = {};
    ['bg', 'panel', 'panel-2', 'line', 'fg', 'muted', 'faint', 'gold', 'gold-ink', 'up', 'down', 'hero-fg', 'hero-muted', 'sky1', 'sky2', 'sky3', 'glow', 'mt1', 'mt2', 'star', 'orb', 'x', 'threads', 'note']
      .forEach((k) => { c[k] = cssVar(`--${k}`, '#888'); });

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'alphabetic';
    const text = (str, x, y, font, color, align) => { ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.fillText(str, x, y); return ctx.measureText(str).width; };

    // 背景と夜空
    ctx.fillStyle = c.bg; ctx.fillRect(0, 0, W, H);
    const HH = 420;
    const sky = ctx.createLinearGradient(0, 0, 0, HH);
    sky.addColorStop(0, c.sky1); sky.addColorStop(0.62, c.sky2); sky.addColorStop(1, c.sky3);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, HH);
    const glow = ctx.createRadialGradient(W * 0.72, HH * 0.86, 0, W * 0.72, HH * 0.86, W * 0.45);
    glow.addColorStop(0, hexA(c.glow, 0.7)); glow.addColorStop(1, hexA(c.glow, 0));
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, HH);
    if (c.star && c.star !== 'transparent') {
      ctx.fillStyle = c.star;
      [[90, 50, 2.4], [210, 110, 1.6], [330, 40, 2.6], [470, 92, 1.6], [580, 34, 2], [760, 60, 2.4], [980, 46, 2], [1030, 120, 1.6], [40, 160, 1.6], [400, 170, 1.8]]
        .forEach(([x, y, r]) => { ctx.globalAlpha = 0.75; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); });
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = c.orb;
    ctx.globalAlpha = 0.12; ctx.beginPath(); ctx.arc(880, 110, 64, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(880, 110, 36, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.save(); ctx.scale(W / 1200, HH / 300);
    ctx.fillStyle = c.mt1; ctx.fill(new Path2D('M0 214 L110 176 L215 198 L350 140 L470 184 L600 128 L720 170 L850 116 L980 166 L1090 140 L1200 168 L1200 300 L0 300 Z'));
    ctx.fillStyle = c.mt2; ctx.fill(new Path2D('M0 246 L150 206 L270 232 L410 192 L545 228 L690 196 L830 234 L965 202 L1100 226 L1200 210 L1200 300 L0 300 Z'));
    ctx.fillStyle = c.bg; ctx.fill(new Path2D('M0 278 Q200 252 390 270 T780 266 T1200 262 L1200 300 L0 300 Z'));
    ctx.restore();

    // 見出し
    const tw = text('SNS 記録帳', 64, 136, `700 76px ${F.display}`, c['hero-fg']);
    ctx.strokeStyle = c.gold; ctx.lineWidth = 5; ctx.lineJoin = 'round';
    starPath(ctx, 64 + tw + 44, 110, 26, 11); ctx.stroke();
    const st = windowStats();
    text(st ? `${md(st.start)} 〜 ${md(st.end)} の${S.win}日間` : 'まだ記録がありません', 66, 196, `500 30px ${F.body}`, c['hero-muted']);
    if (S.sampleMode) {
      ctx.font = `700 26px ${F.body}`;
      const sw = ctx.measureText('サンプル').width + 40;
      ctx.fillStyle = c.gold; roundRect(ctx, W - 64 - sw, 40, sw, 48, 24); ctx.fill();
      text('サンプル', W - 64 - sw / 2, 73, `700 26px ${F.body}`, c['gold-ink'], 'center');
    }

    // サマリー
    const g = (p, f) => (on(p) && st && st[p][f] ? st[p][f].s : null);
    const add = (...vs) => { const ok = vs.filter((v) => v !== null); return ok.length ? ok.reduce((a, v) => a + v, 0) : null; };
    const fol = {}; PLATS.forEach((p) => { fol[p] = on(p) ? followerInfo(p) : null; });
    const folList = PLATS.map((p) => fol[p]).filter(Boolean);
    const folTotal = folList.length ? folList.reduce((a, f) => a + f.value, 0) : null;
    const folChgList = folList.filter((f) => f.change !== null);
    const folChg = folChgList.length ? folChgList.reduce((a, f) => a + f.change, 0) : null;
    const pv = g('note', 'pv'); const nimp = g('note', 'impressions');
    const stats = [
      ['フォロワー合計', fmt(folTotal), '人', folChg === null ? '' : `前回比 ${signed(folChg)}`, folChg],
      ['インプレッション', fmt(add(g('x', 'impressions'), g('threads', 'impressions'), g('note', 'impressions'))), '', '合計', null],
      ['note PV', on('note') ? fmt(pv) : '—', '', on('note') && pv !== null && nimp ? `閲覧率 ${pct(pv / nimp)}` : '', null],
      ['投稿数', fmt(add(g('x', 'posts'), g('threads', 'posts'))), '本', [on('x') ? `X ${fmt(g('x', 'posts'))}` : '', on('threads') ? `Threads ${fmt(g('threads', 'posts'))}` : ''].filter(Boolean).join('・'), null],
    ];
    const sy = 316;
    ctx.fillStyle = c.panel; roundRect(ctx, 48, sy, W - 96, 220, 30); ctx.fill();
    ctx.strokeStyle = c.line; ctx.lineWidth = 2; ctx.stroke();
    stats.forEach(([label, value, unit, sub, sign], i) => {
      const x = 84 + i * 240;
      if (i) { ctx.fillStyle = c.line; ctx.fillRect(x - 22, sy + 40, 2, 140); }
      text(label, x, sy + 66, `500 24px ${F.body}`, c.muted);
      const vw = text(value, x, sy + 136, `800 54px ${F.num}`, c.fg);
      if (unit && value !== '—') text(unit, x + vw + 6, sy + 136, `500 24px ${F.body}`, c.muted);
      ctx.font = `500 22px ${F.body}`;
      text(fitText(ctx, sub, 210), x, sy + 182, `500 22px ${F.body}`, sign > 0 ? c.up : sign < 0 ? c.down : c.muted);
    });

    // 媒体ごと
    const plats = PLATS.filter(on);
    const top = 572; const bottom = 1196; const gap = 22;
    const rowH = Math.min(230, (bottom - top - gap * (plats.length - 1)) / Math.max(1, plats.length));
    const days = S.anchor ? dayRange(addDays(S.anchor, -13), S.anchor) : [];
    plats.forEach((p, i) => {
      const y = top + i * (rowH + gap);
      const color = c[p];
      ctx.fillStyle = c.panel; roundRect(ctx, 48, y, W - 96, rowH, 28); ctx.fill();
      ctx.strokeStyle = hexA(color, 0.45); ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = color; roundRect(ctx, 80, y + 24, 52, 52, 15); ctx.fill();
      text(p === 'x' ? 'X' : p === 'threads' ? 'Th' : 'n', 106, y + 59, `800 24px ${F.num}`, '#ffffff', 'center');
      text(NAMES[p], 150, y + 61, `700 32px ${F.display}`, c.fg);
      const f = fol[p];
      text('フォロワー', 80, y + rowH - 80, `500 22px ${F.body}`, c.muted);
      const fw = text(f ? fmt(f.value) : '—', 80, y + rowH - 36, `800 52px ${F.num}`, c.fg);
      if (f && f.change !== null) text(signed(f.change), 80 + fw + 14, y + rowH - 38, `700 26px ${F.num}`, f.change > 0 ? c.up : f.change < 0 ? c.down : c.muted);
      const metric = p === 'note' ? 'pv' : 'impressions';
      text(`${p === 'note' ? 'PV' : p === 'threads' ? '閲覧数' : 'インプレッション'}（${S.win}日間）`, 380, y + rowH - 80, `500 22px ${F.body}`, c.muted);
      text(fmt(g(p, metric)), 380, y + rowH - 36, `800 44px ${F.num}`, c.fg);
      // 直近14日の棒グラフ
      const cx0 = 690; const cx1 = W - 84; const cy0 = y + 34; const cy1 = y + rowH - 50;
      const vals = days.map((d) => val(S.byDate.get(d), p, metric));
      const max = Math.max(1, ...vals.filter((v) => v !== null));
      const step = (cx1 - cx0) / Math.max(1, days.length);
      const bw = Math.max(4, step * 0.62);
      ctx.fillStyle = hexA(c.line, 1); ctx.fillRect(cx0, cy1, cx1 - cx0, 2);
      vals.forEach((v, k) => {
        if (v === null) return;
        const h = Math.max(3, ((cy1 - cy0) * v) / max);
        ctx.fillStyle = k === vals.length - 1 ? color : hexA(color, 0.7);
        roundRect(ctx, cx0 + k * step + (step - bw) / 2, cy1 - h, bw, h, Math.min(4, bw / 2)); ctx.fill();
      });
      text('直近14日', cx1, y + rowH - 18, `500 20px ${F.body}`, c.faint, 'right');
    });

    // 下
    ctx.fillStyle = c.line; ctx.fillRect(64, 1232, W - 128, 2);
    text('“ 数字は、続けてきた日々の足あと。', 64, 1286, `500 28px ${F.display}`, c.fg);
    text('small steps, steady light.', W - 64, 1286, `italic 500 26px "Segoe Script", "Snell Roundhand", "Brush Script MT", cursive`, c.gold, 'right');
    text(`SNS 記録帳 · ${location.host || 'sns-kirokucho'}${location.host ? location.pathname.replace(/index\.html$/, '') : ''}`, 64, 1324, `500 20px ${F.body}`, c.faint);
    return canvas;
  }

  function fitText(ctx, str, maxW) {
    if (ctx.measureText(str).width <= maxW) return str;
    let t = str;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
    return `${t}…`;
  }

  async function openImageSheet(opener) {
    if (!S.records.length) return;
    IMG.opener = opener || document.activeElement;
    $('#img-sheet').hidden = false;
    document.body.style.overflow = 'hidden';
    $('#img-preview').hidden = true;
    $('#img-save').disabled = true;
    setText($('#img-msg'), '画像を作っています…');
    try {
      const canvas = await drawDashboardImage();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('blob');
      if (IMG.url) URL.revokeObjectURL(IMG.url);
      IMG.blob = blob;
      IMG.url = URL.createObjectURL(blob);
      $('#img-preview').src = IMG.url;
      $('#img-preview').hidden = false;
      $('#img-save').disabled = false;
      setText($('#img-msg'), isIOS()
        ? '「保存する」を押して「画像を保存」を選ぶと、写真に保存できます。画像を長押ししても保存できます。'
        : '「保存する」を押すと、画像ファイルとしてダウンロードします。');
      setTimeout(() => $('#img-save').focus(), 30);
    } catch (e) {
      setText($('#img-msg'), '画像を作れませんでした。もう一度試してください。');
    }
  }

  function closeImageSheet() {
    $('#img-sheet').hidden = true;
    document.body.style.overflow = '';
    if (IMG.opener && document.contains(IMG.opener)) IMG.opener.focus();
  }

  async function saveImage() {
    if (!IMG.blob) return;
    const name = `sns-kirokucho-${S.anchor || today()}.png`;
    const msg = $('#img-msg');
    try {
      const file = typeof File === 'function' ? new File([IMG.blob], name, { type: 'image/png' }) : null;
      const mobile = isIOS() || /Android/i.test(navigator.userAgent);
      if (mobile && file && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        setText(msg, '共有メニューから保存しました。');
      } else {
        const a = document.createElement('a');
        a.href = IMG.url; a.download = name;
        document.body.append(a); a.click(); a.remove();
        setText(msg, `${name} をダウンロードしました。`);
      }
    } catch (e) {
      setText(msg, e && e.name === 'AbortError' ? '保存をやめました。' : '保存できませんでした。画像を長押しして保存することもできます。');
    }
  }

  /* ---------- export / import / settings ---------- */
  async function saveFile(filename, text, type, msgEl) {
    setText(msgEl, '');
    const blob = new Blob([text], { type });
    try {
      const file = typeof File === 'function' ? new File([blob], filename, { type }) : null;
      if (isIOS() && file && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
      DATA.lastBackupAt = new Date().toISOString();
      persist();
      setText(msgEl, `${filename} を書き出しました。`);
      renderNotices();
    } catch (e) {
      setText(msgEl, e && e.name === 'AbortError' ? '書き出しをやめました。' : '書き出せませんでした。もう一度試してください。');
    }
  }

  const exportJSON = (msgEl) => saveFile(
    `sns-records-${today()}.json`,
    JSON.stringify({ app: 'sns-kirokucho', version: 1, exportedAt: new Date().toISOString(), records: Object.values(DATA.records).sort((a, b) => (a.date < b.date ? -1 : 1)) }, null, 2),
    'application/json',
    msgEl,
  );

  function toCSVReal() {
    const keep = S.records;
    S.records = Object.values(DATA.records).sort((a, b) => (a.date < b.date ? -1 : 1));
    const csv = toCSV();
    S.records = keep;
    return csv;
  }

  function onImportFile(ev) {
    const file = ev.target.files && ev.target.files[0];
    S.importRows = null; $('#imp-actions').hidden = true;
    const msg = $('#imp-msg'); msg.classList.remove('err');
    if (!file) { setText(msg, ''); return; }
    const reader = new FileReader();
    reader.onload = () => {
      let rows = [];
      try {
        const text = String(reader.result || '');
        if (/\.json$/i.test(file.name) || /^\s*[[{]/.test(text)) {
          const j = JSON.parse(text);
          rows = Array.isArray(j) ? j : (Array.isArray(j.records) ? j.records : []);
        } else rows = parseCSV(text);
      } catch (e) { msg.classList.add('err'); setText(msg, 'ファイルを読めませんでした。ここから書き出した JSON か CSV を選んでください。'); return; }
      const clean = rows.map(normalize).filter(Boolean);
      const uniq = [...new Map(clean.map((r) => [r.date, r])).values()].sort((a, b) => (a.date < b.date ? -1 : 1));
      if (!uniq.length) { msg.classList.add('err'); setText(msg, '取り込める記録が見つかりませんでした（date の列が必要です）。'); return; }
      const over = uniq.filter((r) => DATA.records[r.date]).length;
      S.importRows = uniq;
      setText(msg, `${uniq.length}件（${md(uniq[0].date)} 〜 ${md(uniq[uniq.length - 1].date)}）。新しい日付 ${uniq.length - over}件・上書き ${over}件です。`);
      $('#imp-actions').hidden = false;
    };
    reader.onerror = () => { msg.classList.add('err'); setText(msg, 'ファイルを読めませんでした。'); };
    reader.readAsText(file);
  }

  function runImport() {
    const rows = S.importRows;
    if (!rows) return;
    const msg = $('#imp-msg');
    const before = JSON.stringify(DATA.records);
    rows.forEach((r) => { DATA.records[r.date] = r; });
    if (!persist()) {
      DATA.records = JSON.parse(before);
      msg.classList.add('err'); setText(msg, 'この端末に保存できませんでした。空き容量やブラウザの設定を確かめてください。');
      return;
    }
    askPersistent();
    setText(msg, `${rows.length}件を取り込みました。`);
    toast('取り込みました');
    S.importRows = null; $('#imp-actions').hidden = true; $('#imp-file').value = '';
    S.sampleMode = false;
    refresh();
  }

  function onPlatformToggle(ev) {
    const p = ev.target.dataset.p;
    const next = { ...DATA.settings.platforms, [p]: ev.target.checked };
    if (!PLATS.some((k) => next[k] !== false)) {
      ev.target.checked = true;
      setText($('#tgl-msg'), '少なくとも1つは選んでください。');
      return;
    }
    setText($('#tgl-msg'), '');
    DATA.settings.platforms = next;
    persist();
    renderAll();
  }

  function onWipe() {
    const btn = $('#wipe');
    if (!S.confirmWipe) {
      S.confirmWipe = true;
      btn.textContent = 'もう一度押すと、すべて消えます（元に戻せません）';
      setTimeout(() => { S.confirmWipe = false; btn.textContent = 'すべての記録を消す'; }, 6000);
      return;
    }
    S.confirmWipe = false;
    DATA.records = {};
    DATA.lastBackupAt = null;
    persist();
    btn.textContent = 'すべての記録を消す';
    toast('すべての記録を消しました');
    S.sampleMode = false;
    refresh();
  }

  /* ---------- controls ---------- */
  function applyTheme(name) {
    const root = document.documentElement;
    root.classList.remove('theme-warm', 'theme-fresh');
    if (name === 'warm' || name === 'fresh') root.classList.add(`theme-${name}`);
    $$('.theme').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === (name || 'dark'))));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', name === 'warm' ? '#fbf0e8' : name === 'fresh' ? '#edf6f0' : '#0d1626');
  }
  applyTheme(store.get(LS.theme) || 'dark');
  $$('.theme').forEach((b) => b.addEventListener('click', () => { applyTheme(b.dataset.theme); store.set(LS.theme, b.dataset.theme); }));

  const savedWin = Number(store.get(LS.win));
  if (savedWin === 7 || savedWin === 30) S.win = savedWin;
  $$('#win-seg button').forEach((b) => b.addEventListener('click', () => { S.win = Number(b.dataset.win); store.set(LS.win, String(S.win)); renderNumbers(); }));
  $$('#media-seg button').forEach((b) => b.addEventListener('click', () => {
    S.media = b.dataset.media;
    $$('#media-seg button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    if (S.loaded) drawImp($('#imp-chart'));
  }));

  buildFields();
  $$('[data-fields] input').forEach((inp) => inp.addEventListener('focus', () => { S.lastField = inp; }));
  $('#open-entry').addEventListener('click', (e) => openSheet(null, e.currentTarget));
  $('#open-shot').addEventListener('click', (e) => openSheet(null, e.currentTarget, true));
  $('#w-start').addEventListener('click', (e) => openSheet(null, e.currentTarget));
  $('#w-sample').addEventListener('click', enterSample);
  $('#sample-exit').addEventListener('click', exitSample);
  $('#sample-start').addEventListener('click', (e) => openSheet(null, e.currentTarget));
  $('#sheet-close').addEventListener('click', closeSheet);
  $('#f-cancel').addEventListener('click', closeSheet);
  $('#sheet').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeSheet(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#sheet').hidden) closeSheet();
    if (!$('#img-sheet').hidden) closeImageSheet();
  });
  $('#f-date').addEventListener('change', onDateChange);
  $('#f-memo').addEventListener('input', updateMemoCount);
  $('#entry').addEventListener('submit', onSave);
  $('#f-delete').addEventListener('click', onDelete);

  $('#ocr-file').addEventListener('change', onOcrFiles);
  $('#ocr-go').addEventListener('click', runOcr);
  $('#ocr-stop').addEventListener('click', () => cancelOcr(true));
  $$('#ocr-media button').forEach((b) => b.addEventListener('click', () => {
    OCR.media = b.dataset.m;
    $$('#ocr-media button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
  }));

  $('#exp-csv').addEventListener('click', () => saveFile(`sns-records-${today()}.csv`, toCSVReal(), 'text/csv', $('#exp-msg')));
  $('#exp-json').addEventListener('click', () => exportJSON($('#exp-msg')));
  $('#backup-now').addEventListener('click', () => exportJSON($('#exp-msg')));
  $('#imp-file').addEventListener('change', onImportFile);
  $('#imp-go').addEventListener('click', runImport);
  $('#imp-cancel').addEventListener('click', () => { S.importRows = null; $('#imp-actions').hidden = true; $('#imp-file').value = ''; setText($('#imp-msg'), ''); });
  $$('.tgl input[data-p]').forEach((inp) => inp.addEventListener('change', onPlatformToggle));
  $('#wipe').addEventListener('click', onWipe);
  $('#install-close').addEventListener('click', () => { store.set(LS.installTip, '1'); renderNotices(); });
  $('#open-image').addEventListener('click', (e) => openImageSheet(e.currentTarget));
  $('#img-close').addEventListener('click', closeImageSheet);
  $('#img-cancel').addEventListener('click', closeImageSheet);
  $('#img-save').addEventListener('click', saveImage);
  $('#img-sheet').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeImageSheet(); });

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; renderNotices(); });
  $('#install-btn').addEventListener('click', async () => {
    const evt = S.installEvt; if (!evt) return;
    S.installEvt = null; renderNotices();
    try { await evt.prompt(); } catch (e) { /* dismissed */ }
  });

  // 別のタブで記録が変わったとき
  window.addEventListener('storage', (e) => { if (e.key === DATA_KEY) { loadData(); if (!S.sampleMode) refresh(); } });

  let rz = null;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(rz);
    rz = requestAnimationFrame(() => { if (!S.loaded) return; charts().forEach(([el, fn]) => { if (el.offsetParent !== null && drawn.get(el) !== el.clientWidth) { fn(el); drawn.set(el, el.clientWidth); } }); });
  });
  charts().forEach(([el]) => ro.observe(el));

  /* ---------- start ---------- */
  loadData();
  try { localStorage.setItem('sns-kirokucho.test', '1'); localStorage.removeItem('sns-kirokucho.test'); } catch (e) { storageOk = false; }
  if (!storageOk) banner('このブラウザでは記録を保存できません（プライベートブラウズなど）。記録するには、通常のブラウズで開いてください。');
  refresh();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
})();
