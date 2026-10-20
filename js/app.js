import { Store, LS, parseInvite, DEFAULT_RELAYS, b64u } from './store.js';
import { CATALOG, PACKS, DEFAULT_PACKS, MAIN_PACK, questionById } from './questions.js';
import * as L from './logic.js';

const REPO_URL = 'https://github.com/Portagoras/fragerunde';
const store = new Store();
const app = document.getElementById('app');
const ui = { sel: {}, guess: {}, edit: null, lastRoute: null, today: L.dayKey() };

// ---------- kleine Helfer ----------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const EMOJIS = ['😎', '🦊', '🐸', '🐼', '🦄', '🐙', '🌵', '🍕', '🎸', '🚀', '👾', '🐝', '🦖', '🍉', '⚡', '🌈', '🐧', '🎩', '🐻', '🌻', '🦉', '🍩', '🎮', '🐨'];
const COLORS = ['#f4a63a', '#ef6f6c', '#8b6cf6', '#33b0a6', '#4f9cf0', '#e46fb8', '#7cc35f', '#e8b923'];
const color = (pk) => COLORS[L.hash(pk) % COLORS.length];

const svg = (p) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const I = {
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  history: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  gear: svg('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
  qr: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M18 18h3v3"/>'),
  share: svg('<path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  send: svg('<path d="M4 12l16-8-6 16-2-7-8-1z"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
};

const avatar = (m, cls = '') =>
  `<span class="av ${cls}" style="--c:${color(m.pk)}" title="${esc(m.name)}">${esc(m.emoji || '🙂')}</span>`;
const stack = (members, max = 5) =>
  `<span class="stack">${members.slice(0, max).map((m) => avatar(m, 'sm')).join('')}${
    members.length > max ? `<span class="av sm more">+${members.length - max}</span>` : ''
  }</span>`;

function emojiPicker(current) {
  const pick = current || EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
  return `<div class="emojis" role="radiogroup" aria-label="Dein Emoji">${EMOJIS.map(
    (e) => `<label><input type="radio" name="emoji" value="${e}" ${e === pick ? 'checked' : ''}><span>${e}</span></label>`,
  ).join('')}</div>`;
}

function packPicker(selected) {
  return `<div class="packs">${PACKS.map((p) => {
    const n = CATALOG.filter((q) => q.pack === p.id).length;
    const main = p.id === MAIN_PACK;
    return `<label class="pack"><input type="checkbox" name="pack" value="${p.id}" ${main || selected.includes(p.id) ? 'checked' : ''} ${main ? 'disabled' : ''}>
      <span class="pemoji">${p.emoji}</span><span class="ptext"><b>${esc(p.name)}${main ? ' · immer dabei' : ''}${p.adult ? ' <span class="badge">18+</span>' : ''}</b><small>${esc(p.desc)} · ${n} Fragen</small></span></label>`;
  }).join('')}</div>`;
}

// Das Hauptpaket ist im Formular deaktiviert und fehlt deshalb in FormData.
const packsFrom = (f) => [MAIN_PACK, ...new FormData(f).getAll('pack').filter((p) => p !== MAIN_PACK)];

function qrSvg(text) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.setAttribute('role', 'status');
    document.body.append(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2400);
}

async function shareOrCopy(url, text) {
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Fragerunde', text, url });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  await copy(url);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Link kopiert');
  } catch {
    prompt('Zum Kopieren:', text);
  }
}

const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const inviteUrl = (code) => `${location.origin}${location.pathname}#join=${code}`;

// "morgen" oder "am Freitag, 23. Oktober"
function dateLabel(key) {
  if (L.dayNumber(key) === L.dayNumber(L.dayKey()) + 1) return 'morgen';
  const [y, m, d] = key.split('-').map(Number);
  return 'am ' + new Date(y, m - 1, d).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
}

function dayLabel(key) {
  const t = L.dayNumber(L.dayKey());
  const n = L.dayNumber(key);
  if (n === t) return 'Heute';
  if (n === t - 1) return 'Gestern';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });
}

// ---------- abgeleitete Daten ----------

// Alle, die je in der Gruppe waren – für Namen in alten Runden.
function people(v) {
  const g = store.groups.get(v.id);
  const all = new Map();
  for (const it of g.items.values()) {
    if (it.d === 'm' && it.data.type === 'member') {
      all.set(it.by, { pk: it.by, name: it.data.name || '?', emoji: it.data.emoji, joined: it.data.joined });
    }
  }
  return all;
}

function personOf(v, pk) {
  return (v._people ||= people(v)).get(pk) || { pk, name: 'Unbekannt', emoji: '👤' };
}

function packRound(v, key, pack) {
  if (!v.meta) return null;
  const rid = `d${key}:${pack}`;
  const votes = v.votes.get(rid) || [];
  const r = L.dailyRound(v.meta, v.members, key, CATALOG, pack);
  if (!r) {
    // Ohne passende Fragen gibt es nur dann eine Runde, wenn schon jemand abgestimmt hat.
    return votes.length ? L.frozenDaily({ rid, day: key, daily: true, pack }, votes) : null;
  }
  return L.frozenDaily(r, votes);
}

// Wann welche eigene Frage dran ist (FIFO, eine pro Tag).
const schedule = (v) => (v._schedule ||= L.scheduleCustom(v.rounds));

function customRound(v, r) {
  const slot = schedule(v).get(r.rid);
  return slot ? { ...r, slot } : null;
}

// Alle Fragen eines Tages: Tagesfrage, je eine pro Zusatzpaket, dazu die
// eigene Frage aus der Warteschlange. Abgeschaltete Pakete erscheinen
// an Tagen, an denen schon jemand geantwortet hat, trotzdem.
function dayRounds(v, key) {
  if (!v.meta) return [];
  const packs = PACKS.map((p) => p.id).filter(
    (id) => id === MAIN_PACK || v.meta.packs.includes(id) || v.votes.has(`d${key}:${id}`),
  );
  const custom = v.rounds.map((r) => customRound(v, r)).filter((r) => r && r.slot === key);
  return [...packs.map((p) => packRound(v, key, p)), ...custom].filter(Boolean);
}

function roundById(v, rid) {
  if (rid.startsWith('d')) {
    const [key, pack] = rid.slice(1).split(':');
    return pack ? packRound(v, key, pack) : null;
  }
  const r = v.rounds.find((x) => x.rid === rid);
  const round = r && customRound(v, r);
  // Eigene Fragen bleiben bis zu ihrem Tag eine Überraschung.
  if (!round || (round.slot > L.dayKey() && round.by !== store.pk)) return null;
  return round;
}

const mineIn = (v, rid) => (v.votes.get(rid) || []).find((x) => x.by === store.pk);
const myAnon = (v, rid) => (v.anon.get(rid) || []).find((x) => x.by === store.anonKey(v.id, rid).pk);

function queueOf(v) {
  const today = L.dayKey();
  return v.rounds
    .map((r) => customRound(v, r))
    .filter((r) => r && r.slot > today)
    .sort((a, b) => (a.slot < b.slot ? -1 : 1));
}

const questionOf = (round) => (round.daily ? questionById(round.qid) : round.q);

function fill(text, v, subj = []) {
  return esc(text)
    .replace(/\{A\}/g, `<b>${esc(personOf(v, subj[0]).name)}</b>`)
    .replace(/\{B\}/g, `<b>${esc(personOf(v, subj[1]).name)}</b>`);
}

function optionsOf(v, q, votes) {
  if (q.type !== 'who') return L.optionsFor(q, v.members);
  // Auch Leute anzeigen, die Stimmen bekommen haben und inzwischen weg sind.
  const list = [...v.members];
  for (const x of votes) {
    if (!list.some((m) => m.pk === x.data.choice)) list.push(personOf(v, x.data.choice));
  }
  return L.optionsFor(q, list);
}

// Ein Tag zählt für die Serie, wenn die Tagesfrage beantwortet wurde.
function myStreak(v) {
  const days = new Set();
  const suffix = ':' + MAIN_PACK;
  for (const [rid, list] of v.votes) {
    if (rid.startsWith('d') && rid.endsWith(suffix) && list.some((x) => x.by === store.pk)) {
      days.add(rid.slice(1, -suffix.length));
    }
  }
  return L.streak(days, L.dayKey());
}

// ---------- Bausteine ----------

function pendingBanner() {
  const n = store.pending();
  return n ? `<div class="banner">⏳ ${n} ${n === 1 ? 'Änderung wartet' : 'Änderungen warten'} auf Verbindung …</div>` : '';
}

function topbar(left, title, right = '') {
  return `<header class="top">${left}<div class="ttl">${title}</div><nav>${right}</nav></header>`;
}

function groupBar(v, back = '#/') {
  return topbar(
    `<a class="ibtn" href="${back}" aria-label="Zurück">${I.back}</a>`,
    `<a class="gtitle" href="#/g/${v.id}/gruppe">${stack(v.members)}<span>${esc(v.meta?.name || 'Gruppe')}</span></a>`,
    `<a class="ibtn" href="#/g/${v.id}/verlauf" aria-label="Verlauf">${I.history}</a>
     <a class="ibtn" href="#/g/${v.id}/fragen" aria-label="Eigene Frage stellen">${I.plus}</a>
     <a class="ibtn" href="#/g/${v.id}/gruppe" aria-label="Gruppe & Einladen">${I.gear}</a>`,
  );
}

function roundCard(v, round, { link = false } = {}) {
  const q = questionOf(round);
  if (!q) return '';
  const votes = v.votes.get(round.rid) || [];
  const mine = votes.find((x) => x.by === store.pk);
  const total = v.members.length;
  const pack = PACKS.find((p) => p.id === round.pack);
  const from = !round.daily
    ? `Frage von ${esc(personOf(v, round.by).name)} · ${L.TYPE_LABEL[q.type] || ''}`
    : round.pack === MAIN_PACK
      ? `Frage des Tages · ${L.TYPE_LABEL[q.type] || ''}`
      : `${pack?.emoji || ''} ${esc(pack?.name || '')}`;
  const head = `<div class="qpanel"><span class="qtype">${from}</span><h2>${fill(q.text, v, round.subj)}</h2></div>`;
  const showResults = mine && ui.edit !== round.rid;
  const body = showResults ? results(v, round, q, votes) : answerForm(v, round, q, votes, mine);
  return `<section class="card round">
    ${link ? `<a class="qlink" href="#/g/${v.id}/r/${round.rid}">${head}</a>` : head}
    <div class="cbody"><p class="count">${votes.length} von ${total} ${total === 1 ? 'hat' : 'haben'} geantwortet</p>${body}</div>
    ${link ? (mine ? `<a class="disc-link" href="#/g/${v.id}/r/${round.rid}">💬 Diskussion${(v.comments.get(round.rid) || []).length ? ` (${v.comments.get(round.rid).length})` : ''} →</a>` : '') : discussion(v, round, !!mine)}
  </section>`;
}

function answerForm(v, round, q, votes, mine) {
  const rid = round.rid;
  const cancel = mine ? `<button type="button" class="link" data-action="cancel-edit" data-rid="${rid}">Abbrechen</button>` : '';
  if (q.type === 'text') {
    return `<form class="answer" data-form="answer" data-rid="${rid}">
      <textarea id="ans-${rid}" name="text" rows="3" maxlength="300" required placeholder="Deine Antwort …">${esc(mine?.data.text || '')}</textarea>
      <button class="btn primary">Antworten</button>${cancel}</form>`;
  }
  const opts = optionsOf(v, q, votes);
  const sel = ui.sel[rid] ?? (q.type === 'secret' ? myAnon(v, rid)?.data.choice : mine?.data.choice);
  if (q.type === 'secret') {
    const total = v.members.length;
    const guess = ui.guess[rid] ?? mine?.data.guess ?? Math.round(total / 2);
    return `<p class="hint center">🔒 Anonym: Niemand sieht, was du antwortest.</p>
    <div class="opts">${opts
      .map((o) => `<button type="button" class="opt ${sel === o.value ? 'on' : ''}" data-action="pick" data-rid="${rid}" data-value="${o.value}" aria-pressed="${sel === o.value}"><span>${esc(o.label)}</span></button>`)
      .join('')}</div>
    <div class="guess"><span>Was schätzt du: Wie viele von euch sagen Ja?</span>
      <div class="stepper"><button type="button" class="ibtn" data-action="guess" data-rid="${rid}" data-step="-1" aria-label="weniger" ${guess <= 0 ? 'disabled' : ''}>−</button>
      <output aria-live="polite">${guess}</output>
      <button type="button" class="ibtn" data-action="guess" data-rid="${rid}" data-step="1" aria-label="mehr" ${guess >= total ? 'disabled' : ''}>+</button></div>
      <small>von ${total}</small></div>
    <button class="btn primary" data-action="vote" data-rid="${rid}" ${sel == null ? 'disabled' : ''}>Anonym antworten</button>${cancel}`;
  }
  return `<div class="opts ${q.type === 'who' ? 'grid' : ''}">${opts
    .map(
      (o) => `<button type="button" class="opt ${sel === o.value ? 'on' : ''}" data-action="pick" data-rid="${rid}" data-value="${esc(o.value)}" aria-pressed="${sel === o.value}">
        ${o.member ? avatar(o.member, 'sm') : ''}<span>${esc(o.label)}</span></button>`,
    )
    .join('')}</div>
    <button class="btn primary" data-action="vote" data-rid="${rid}" ${sel == null ? 'disabled' : ''}>${
      q.type === 'who' ? 'Stimme abgeben' : 'Antwort abgeben'
    }</button>${cancel}`;
}

function results(v, round, q, votes) {
  const again = `<button class="link" data-action="edit" data-rid="${round.rid}">Antwort ändern</button>`;
  if (q.type === 'secret') {
    const answers = v.anon.get(round.rid) || [];
    const r = L.secretResult(answers, votes);
    const pct = r.total ? Math.round((r.yes / r.total) * 100) : 0;
    const coming = Math.max(0, votes.length - answers.length);
    return `<div class="secret">
      <div class="big">🌶️ ${r.yes} von ${r.total} ${r.yes === 1 ? 'sagt' : 'sagen'} Ja</div>
      <div class="meter" role="img" aria-label="${pct} Prozent Ja"><span style="width:${pct}%"></span></div>
      ${coming ? `<small class="muted">${coming} anonyme ${coming === 1 ? 'Antwort ist' : 'Antworten sind'} noch unterwegs …</small>` : ''}
    </div>
    <h4 class="sub">Tipps</h4>
    <ul class="guesses">${r.ranked
      .map((g) => {
        const m = personOf(v, g.by);
        return `<li class="${g.best ? 'best' : ''}">${avatar(m, 'sm')}<span>${esc(m.name)}</span><b>${g.guess}</b>${g.best ? '<span aria-label="am nächsten dran">🎯</span>' : ''}</li>`;
      })
      .join('')}</ul>
    <p class="hint center">🔒 In der App sieht niemand, wer was geantwortet hat.</p>${again}`;
  }
  if (q.type === 'text') {
    const list = [...votes].sort((a, b) => a.at - b.at);
    return `<ul class="answers">${list
      .map((x) => {
        const m = personOf(v, x.by);
        return `<li>${avatar(m)}<div><b>${esc(m.name)}</b><p>${esc(x.data.text)}</p></div></li>`;
      })
      .join('')}</ul>${again}`;
  }
  const rows = L.tally(optionsOf(v, q, votes), votes);
  return `<div class="bars">${rows
    .map((r, i) => {
      const pct = Math.round((r.voters.length / votes.length) * 100);
      return `<div class="bar" style="--w:${Math.max(pct, 8)}%;--c:${COLORS[i % COLORS.length]}">
        <div class="track"><div class="fill">${r.member ? avatar(r.member, 'sm') : ''}<span class="lbl">${esc(r.label)}</span><span class="pct">${pct}%</span></div></div>
        ${stack(r.voters.map((x) => personOf(v, x.by)), 3)}</div>`;
    })
    .join('')}</div>${again}`;
}

function discussion(v, round, unlocked) {
  if (!unlocked) return `<div class="disc locked">🔒 Erst antworten – dann siehst du, was die anderen sagen.</div>`;
  const list = v.comments.get(round.rid) || [];
  return `<div class="disc">
    <h3>Diskussion ${list.length ? `<small>${list.length}</small>` : ''}</h3>
    <ul class="comments">${list
      .map((c) => {
        const m = personOf(v, c.by);
        const time = new Date(c.at * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        return `<li class="${c.by === store.pk ? 'mine' : ''}">${avatar(m, 'sm')}<div><b>${esc(m.name)}</b> <time>${time}</time><p>${esc(c.data.text)}</p></div></li>`;
      })
      .join('')}</ul>
    <form class="cform" data-form="comment" data-rid="${round.rid}">
      <input id="cm-${round.rid}" name="text" maxlength="500" autocomplete="off" placeholder="Was meinst du dazu?" required>
      <button class="ibtn solid" aria-label="Senden">${I.send}</button></form></div>`;
}

function profileFields(name, emoji) {
  return `<label for="pname">Dein Name in der Gruppe</label>
    <input id="pname" name="name" required maxlength="30" autocomplete="nickname" value="${esc(name)}" placeholder="z. B. Christian">
    <label>Dein Emoji</label>${emojiPicker(emoji)}`;
}

// ---------- Ansichten ----------

function vHome() {
  if (!store.ready && LS.get('groups', []).length) return '<p class="empty spin">Lädt …</p>';
  const groups = [...store.groups.keys()].map((id) => store.view(id));
  const list = groups
    .map((v) => {
      const open = dayRounds(v, L.dayKey()).filter((x) => !mineIn(v, x.rid)).length;
      const answered = !open;
      const status = !v.meta
        ? v.loading ? 'Lädt …' : 'Keine Daten gefunden'
        : !v.me ? 'Profil anlegen'
        : answered ? '✓ Heute alles beantwortet'
        : `🔥 ${open} ${open === 1 ? 'offene Frage' : 'offene Fragen'}`;
      return `<a class="gcard ${answered ? '' : 'hot'}" href="#/g/${v.id}">
        <div><b>${esc(v.meta?.name || 'Gruppe')}</b><small>${status}</small></div>${stack(v.members)}</a>`;
    })
    .join('');
  return `${topbar('<span class="logo" aria-hidden="true">❓</span>', '<h1>Fragerunde</h1>', `<a class="ibtn" href="#/einstellungen" aria-label="Einstellungen">${I.gear}</a>`)}
  <main>${pendingBanner()}
    ${groups.length ? `<div class="glist">${list}</div>` : `<section class="hero">
      <h2>Jeden Tag eine Frage für eure Gruppe.</h2>
      <p>Wer würde am ehesten …? Stimmt ab, seht danach, wer wen gewählt hat, und diskutiert. Ohne Konto, ohne Werbung, Ende-zu-Ende-verschlüsselt.</p></section>`}
    <div class="actions">
      <a class="btn primary" href="#/neu">${I.plus} Neue Gruppe</a>
      <button class="btn" data-action="scan">${I.qr} Einladung scannen</button>
      <button class="btn ghost" data-action="paste">${I.link} Einladungslink einfügen</button>
    </div></main>`;
}

function vNew() {
  return `${topbar(`<a class="ibtn" href="#/" aria-label="Zurück">${I.back}</a>`, '<h1>Neue Gruppe</h1>')}
  <main><form class="form" data-form="new">
    <label for="gname">Name der Gruppe</label>
    <input id="gname" name="gname" required maxlength="40" placeholder="z. B. Die Chaoten">
    ${profileFields(LS.get('name', ''), null)}
    <label>Fragenpakete</label>
    <p class="hint">Jedes Paket stellt jeden Tag eine eigene Frage.</p>${packPicker(DEFAULT_PACKS)}
    <button class="btn primary">Gruppe erstellen</button>
  </form></main>`;
}

function vJoin(code) {
  const inv = parseInvite(code);
  const back = `<a class="ibtn" href="#/" aria-label="Zurück">${I.back}</a>`;
  if (!inv) return `${topbar(back, '<h1>Einladung</h1>')}<main><p class="empty">Diese Einladung ist ungültig.</p></main>`;
  if (store.groups.has(inv.id)) {
    setTimeout(() => location.replace('#/g/' + inv.id));
    return '';
  }
  const hint =
    isIOS && !standalone
      ? `<div class="note">📱 <b>Tipp fürs iPhone:</b> Tippe erst auf <i>Teilen → Zum Home-Bildschirm</i>, öffne die App dort und scanne den Code dann über „Einladung scannen". Sonst landet die Gruppe nur hier in Safari.</div>`
      : '';
  return `${topbar(back, '<h1>Einladung</h1>')}
  <main><section class="hero"><h2>Du wurdest in eine Gruppe eingeladen 🎉</h2>
    <p>Nach dem Beitritt legst du fest, wie die anderen dich sehen.</p></section>${hint}
    <button class="btn primary" data-action="join" data-code="${esc(inv.id + '.' + inv.key)}">Gruppe beitreten</button></main>`;
}

function vGroup(r) {
  const v = store.view(r.gid);
  if (!v) return vMissing();
  const bar = groupBar(v);
  if (!v.meta) return `${bar}<main>${v.loading ? '<p class="empty spin">Lade Gruppe …</p>' : '<p class="empty">Noch keine Daten gefunden. Sind die Relays erreichbar? (Einstellungen)</p>'}</main>`;
  if (!v.me) {
    return `${bar}<main><section class="hero"><h2>Willkommen bei „${esc(v.meta.name)}"</h2>
      <p>${v.members.length} ${v.members.length === 1 ? 'Person ist' : 'Leute sind'} schon dabei. Wie sollen sie dich sehen?</p></section>
      <form class="form" data-form="profile">${profileFields(LS.get('name', ''), null)}
      <button class="btn primary">Los geht's</button></form></main>`;
  }
  const [main, ...rest] = dayRounds(v, L.dayKey());
  const s = myStreak(v);
  const queued = queueOf(v).length;
  return `${bar}<main>${pendingBanner()}
    <div class="chips"><span class="chip">${s ? `🔥 ${s} ${s === 1 ? 'Tag' : 'Tage'} in Folge` : '🔥 Starte deine Serie'}</span>
      ${queued ? `<a class="chip" href="#/g/${v.id}/fragen">📬 ${queued} in der Warteschlange</a>` : ''}
      ${v.members.length < 3 ? `<a class="chip accent" href="#/g/${v.id}/einladen">Freunde einladen</a>` : ''}</div>
    ${main ? roundCard(v, main) : '<p class="empty">Heute gibt es keine Frage.</p>'}
    ${rest.length ? `<h3 class="sect">Weitere Fragen heute</h3>${rest.map((x) => roundCard(v, x, { link: true })).join('')}` : ''}
    <a class="btn ghost" href="#/g/${v.id}/fragen">${I.plus} Eigene Frage einreichen</a>
  </main>`;
}

function vRound(r) {
  const v = store.view(r.gid);
  if (!v) return vMissing();
  const round = v.meta && roundById(v, r.rid);
  return `${groupBar(v, `#/g/${v.id}`)}<main>${round ? roundCard(v, round) : `<p class="empty">${v.loading ? 'Lädt …' : 'Diese Frage gibt es nicht (mehr).'}</p>`}</main>`;
}

function vHistory(r) {
  const v = store.view(r.gid);
  if (!v) return vMissing();
  if (!v.meta) return `${groupBar(v, `#/g/${v.id}`)}<main><p class="empty">Lädt …</p></main>`;
  const today = L.dayNumber(L.dayKey());
  const start = Math.max(L.dayNumber(v.meta.start), today - 365);
  let html = '';
  for (let n = today; n >= start; n--) {
    const key = L.keyFromNumber(n);
    const rounds = dayRounds(v, key);
    const rows = rounds
      .map((round) => {
        const q = questionOf(round);
        if (!q) return '';
        const votes = v.votes.get(round.rid) || [];
        const mine = votes.some((x) => x.by === store.pk);
        return `<a class="hrow" href="#/g/${v.id}/r/${round.rid}"><span class="htext">${fill(q.text, v, round.subj)}</span>
          <span class="hstat ${mine ? 'done' : ''}">${mine ? '✓' : 'offen'} · ${votes.length}</span></a>`;
      })
      .join('');
    if (rows) html += `<h3 class="sect">${dayLabel(key)}</h3><div class="hlist">${rows}</div>`;
  }
  return `${groupBar(v, `#/g/${v.id}`)}<main><h2 class="ptitle">Verlauf</h2>${html || '<p class="empty">Noch nichts passiert.</p>'}</main>`;
}

function vAsk(r) {
  const v = store.view(r.gid);
  if (!v) return vMissing();
  const types = [
    ['who', 'Wer von uns?', 'Alle stimmen für eine Person'],
    ['yesno', 'Ja / Nein', 'Einfache Entscheidung'],
    ['either', 'Auswahl', 'Eigene Antwortmöglichkeiten'],
    ['text', 'Freitext', 'Alle schreiben eine Antwort'],
    ['secret', 'Anonym 🌶️', '„Hast du schon mal …?“ – niemand sieht, wer was sagt, alle schätzen'],
  ];
  const queue = queueOf(v);
  const mine = queue.filter((r) => r.by === store.pk);
  const last = queue.at(-1)?.slot;
  const next = L.keyFromNumber(Math.max(L.dayNumber(L.dayKey()) + 1, last ? L.dayNumber(last) + 1 : 0));
  const queueHtml = `<h3 class="sect">Warteschlange</h3>
    <p class="hint">${queue.length ? `${queue.length} ${queue.length === 1 ? 'Frage wartet' : 'Fragen warten'}. ` : ''}Eine neue Frage käme <b>${dateLabel(next)}</b> dran.</p>
    ${mine.length ? `<div class="hlist">${mine
      .map((r) => `<div class="hrow"><span class="htext"><small class="muted">${dateLabel(r.slot)}</small><br>${esc(r.q.text)}</span>
        <button class="link" data-action="withdraw" data-rid="${r.rid}">Zurückziehen</button></div>`)
      .join('')}</div>` : ''}`;
  return `${groupBar(v, `#/g/${v.id}`)}<main><h2 class="ptitle">Eigene Frage einreichen</h2>
  <form class="form" data-form="ask">
    <fieldset class="types"><legend>Art der Frage</legend>${types
      .map(
        ([val, name, desc], i) =>
          `<label class="type"><input type="radio" name="type" value="${val}" ${i === 0 ? 'checked' : ''}><span><b>${name}</b><small>${desc}</small></span></label>`,
      )
      .join('')}</fieldset>
    <label for="qtext">Deine Frage</label>
    <textarea id="qtext" name="text" rows="3" required maxlength="200" placeholder="Wer von uns würde am ehesten …?"></textarea>
    <div id="optfield" hidden><label>Antwortmöglichkeiten</label>
      <div id="optlist"><input name="opt" maxlength="60" placeholder="Option 1"><input name="opt" maxlength="60" placeholder="Option 2"></div>
      <button type="button" class="link" data-action="add-opt">+ weitere Option</button></div>
    <p class="hint">Eigene Fragen kommen in eine Warteschlange: ab morgen jeden Tag eine, in der Reihenfolge, in der sie eingereicht wurden – zusätzlich zur Tagesfrage. Bis dahin sehen die anderen sie nicht.</p>
    <button class="btn primary">Einreichen</button>
  </form>${queueHtml}</main>`;
}

function vInvite(r) {
  const v = store.view(r.gid);
  if (!v) return vMissing();
  const url = inviteUrl(store.inviteCode(v.id));
  return `${groupBar(v, `#/g/${v.id}`)}<main><h2 class="ptitle">Freunde einladen</h2>
    <div class="qrbox">${qrSvg(url)}</div>
    <p class="hint center">Mit „Einladung scannen" in der App oder der Handykamera scannen.<br>Der Code enthält den Gruppenschlüssel – nur an Leute geben, die rein sollen.</p>
    <div class="actions">
      <button class="btn primary" data-action="share" data-url="${esc(url)}">${I.share} Link teilen</button>
      <button class="btn" data-action="copy" data-url="${esc(url)}">${I.link} Link kopieren</button>
      <a class="btn ghost" href="#/g/${v.id}">Weiter zur Gruppe</a>
    </div></main>`;
}

function vGroupSettings(r) {
  const v = store.view(r.gid);
  if (!v) return vMissing();
  if (!v.meta) return `${groupBar(v, `#/g/${v.id}`)}<main><p class="empty">Lädt …</p></main>`;
  return `${groupBar(v, `#/g/${v.id}`)}<main><h2 class="ptitle">Gruppe</h2>
    <a class="btn primary" href="#/g/${v.id}/einladen">${I.qr} Freunde einladen (QR-Code)</a>
    <h3 class="sect">Mitglieder (${v.members.length})</h3>
    <ul class="members">${v.members.map((m) => `<li>${avatar(m)}<span>${esc(m.name)}${m.pk === store.pk ? ' <small>(du)</small>' : ''}</span></li>`).join('')}</ul>
    ${v.me ? `<h3 class="sect">Dein Profil</h3><form class="form" data-form="profile">${profileFields(v.me.data.name, v.me.data.emoji)}<button class="btn">Profil speichern</button></form>` : ''}
    <h3 class="sect">Einstellungen der Gruppe</h3>
    <form class="form" data-form="meta">
      <label for="gname">Name der Gruppe</label>
      <input id="gname" name="gname" required maxlength="40" value="${esc(v.meta.name)}">
      <label>Fragenpakete</label>
      <p class="hint">Jedes Paket stellt jeden Tag eine eigene Frage.</p>${packPicker(v.meta.packs)}
      <button class="btn">Speichern</button>
    </form>
    <h3 class="sect">Gruppe verlassen</h3>
    <p class="hint">Du verschwindest aus der Mitgliederliste. Mit dem Einladungslink kannst du wieder beitreten.</p>
    <button class="btn danger" data-action="leave">Gruppe verlassen</button>
  </main>`;
}

function vDevice() {
  const status = store.relayStatus();
  return `${topbar(`<a class="ibtn" href="#/" aria-label="Zurück">${I.back}</a>`, '<h1>Einstellungen</h1>')}
  <main>
    <form class="form" data-form="device">
      <label for="dname">Standardname für neue Gruppen</label>
      <input id="dname" name="name" maxlength="30" value="${esc(LS.get('name', ''))}">
      <label for="relays">Nostr-Relays (eins pro Zeile)</label>
      <textarea id="relays" name="relays" rows="6" spellcheck="false">${esc(store.relays.join('\n'))}</textarea>
      <ul class="relays">${status.map((s) => `<li><span class="dot ${s.ok ? 'ok' : ''}"></span>${esc(s.url)}</li>`).join('')}</ul>
      <div class="row"><button class="btn">Speichern</button><button type="button" class="btn ghost" data-action="reset-relays">Standard</button></div>
    </form>
    <h3 class="sect">Benachrichtigungen</h3>
    <div id="notify"><p class="hint">Prüfe …</p></div>
    <h3 class="sect">Auf neues Gerät umziehen</h3>
    <p class="hint">Überträgt deine Identität und alle Gruppen. Der Code ist wie ein Passwort – niemandem zeigen.</p>
    <button class="btn" data-action="transfer">${I.qr} Umzugs-Code anzeigen</button>
    <div id="transfer"></div>
    <h3 class="sect">Über</h3>
    <p class="hint">Fragerunde ist freie Software (MIT). Die Daten liegen verschlüsselt auf öffentlichen Nostr-Relays – es gibt keinen eigenen Server, kein Konto und kein Tracking.
    <br><a href="${REPO_URL}" target="_blank" rel="noopener">Quellcode</a></p>
  </main>`;
}

function vTransfer(code) {
  return `${topbar(`<a class="ibtn" href="#/" aria-label="Zurück">${I.back}</a>`, '<h1>Umzug</h1>')}
  <main><section class="hero"><h2>Identität übernehmen?</h2>
  <p>Dieses Gerät übernimmt Profil und Gruppen vom anderen Gerät. Was bisher hier gespeichert war, wird ersetzt.</p></section>
  <button class="btn primary" data-action="import" data-code="${esc(code)}">Übernehmen</button></main>`;
}

function vMissing() {
  return `${topbar(`<a class="ibtn" href="#/" aria-label="Zurück">${I.back}</a>`, '<h1>Nicht gefunden</h1>')}<main><p class="empty">Diese Gruppe ist auf diesem Gerät nicht gespeichert.</p></main>`;
}

// ---------- Benachrichtigungen (Android: Periodic Background Sync) ----------

const canPeriodic = 'serviceWorker' in navigator && 'periodicSync' in (self.ServiceWorkerRegistration?.prototype || {});

async function notifyState() {
  if (!canPeriodic || !('Notification' in self)) return 'unsupported';
  const reg = await navigator.serviceWorker.ready;
  const tags = await reg.periodicSync.getTags().catch(() => []);
  return tags.includes('fragerunde-check') && Notification.permission === 'granted' && (await store.notifyEnabled()) ? 'on' : 'off';
}

async function refreshNotify() {
  const box = document.getElementById('notify');
  if (!box) return;
  const state = await notifyState();
  box.innerHTML =
    state === 'unsupported'
      ? `<p class="hint">${
          isIOS
            ? 'Auf dem iPhone dürfen Web-Apps im Hintergrund nichts prüfen. Benachrichtigungen fürs iPhone kommen später per Web Push.'
            : 'Dieser Browser kann nicht im Hintergrund prüfen. Am besten klappt es mit Chrome auf Android, wenn die App installiert ist.'
        }</p>`
      : state === 'on'
        ? `<p class="hint">✓ Aktiv. Die App schaut ab und zu nach neuen Kommentaren und offenen Fragen des Tages (nicht zwischen 22 und 8 Uhr). Wie oft, entscheidet Android.</p>
           <div class="row"><button class="btn" data-action="notify-test">Test</button><button class="btn ghost" data-action="notify-off">Ausschalten</button></div>`
        : `<p class="hint">Lass dich an die Fragen des Tages und neue Kommentare erinnern. Funktioniert nur, wenn die App installiert ist (Menü → „Zum Startbildschirm hinzufügen“).</p>
           <button class="btn" data-action="notify-on">🔔 Benachrichtigungen aktivieren</button>`;
}

// ---------- Routing & Zeichnen ----------

function parseRoute() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith('join=')) return { name: 'join', arg: h.slice(5) };
  if (h.startsWith('transfer=')) return { name: 'transfer', arg: h.slice(9) };
  const p = h.split('/').filter(Boolean);
  if (p[0] === 'neu') return { name: 'new' };
  if (p[0] === 'einstellungen') return { name: 'device' };
  if (p[0] === 'g' && p[1]) return { name: p[2] === 'r' ? 'round' : p[2] || 'group', gid: p[1], rid: p[3] };
  return { name: 'home' };
}

const VIEWS = {
  home: vHome,
  new: vNew,
  device: vDevice,
  join: (r) => vJoin(r.arg),
  transfer: (r) => vTransfer(r.arg),
  group: vGroup,
  round: vRound,
  verlauf: vHistory,
  fragen: vAsk,
  einladen: vInvite,
  gruppe: vGroupSettings,
};

function render() {
  const r = parseRoute();
  const changed = location.hash !== ui.lastRoute;
  // Formulare nicht unter den Fingern neu zeichnen.
  if (!changed && app.querySelector('.form')) return;
  if (changed) {
    ui.sel = {};
    ui.guess = {};
    ui.edit = null;
  }
  const html = (VIEWS[r.name] || vHome)(r);
  paint(html, changed);
  ui.lastRoute = location.hash;
  if (r.name === 'device') refreshNotify();
}

// Neu zeichnen, ohne Eingaben, Fokus und Scrollposition zu verlieren.
function paint(html, changed) {
  const a = document.activeElement;
  const focus = a && a.id && app.contains(a) ? { id: a.id, s: a.selectionStart, e: a.selectionEnd } : null;
  const drafts = {};
  app.querySelectorAll('input[id], textarea[id]').forEach((el) => (drafts[el.id] = el.value));
  const y = scrollY;
  app.innerHTML = html;
  if (changed) {
    scrollTo(0, 0);
    return;
  }
  for (const [id, val] of Object.entries(drafts)) {
    const el = document.getElementById(id);
    if (el && el.type !== 'radio' && el.type !== 'checkbox') el.value = val;
  }
  if (focus) {
    const el = document.getElementById(focus.id);
    el?.focus();
    try {
      el?.setSelectionRange(focus.s, focus.e);
    } catch {}
  }
  scrollTo(0, y);
}

const rerender = () => {
  const keep = ui.lastRoute;
  ui.lastRoute = null;
  render();
  ui.lastRoute = keep ?? location.hash;
};

// ---------- Aktionen ----------

const formData = (f) => Object.fromEntries(new FormData(f));
const gidOf = () => parseRoute().gid;

function dailyFields(round) {
  return round.daily ? { qid: round.qid, subj: round.subj, day: round.day, pack: round.pack } : {};
}

const ACTIONS = {
  pick(el) {
    ui.sel[el.dataset.rid] = el.dataset.value;
    rerenderKeepScroll();
  },
  async vote(el) {
    const rid = el.dataset.rid;
    const v = store.view(gidOf());
    const round = roundById(v, rid);
    const mine = (v.votes.get(rid) || []).find((x) => x.by === store.pk);
    const q = round && questionOf(round);
    if (q?.type === 'secret') {
      const prev = myAnon(v, rid);
      const choice = ui.sel[rid] ?? prev?.data.choice;
      const guess = ui.guess[rid] ?? mine?.data.guess ?? Math.round(v.members.length / 2);
      if (choice == null) return;
      delete ui.sel[rid];
      delete ui.guess[rid];
      ui.edit = null;
      if (prev && mine && prev.data.choice === choice && mine.data.guess === guess) return rerenderKeepScroll();
      const dayStart = L.dayStartSec(round.slot || round.day);
      return store.secretVote(v.id, rid, { choice, guess, dayStart, ...dailyFields(round) });
    }
    const choice = ui.sel[rid] ?? mine?.data.choice;
    if (!round || choice == null) return;
    delete ui.sel[rid];
    ui.edit = null;
    // Gleiche Antwort wie vorher: nur schließen, nichts neu senden.
    if (mine && mine.data.choice === choice) return rerenderKeepScroll();
    await store.vote(v.id, rid, { choice, ...dailyFields(round) });
  },
  guess(el) {
    const rid = el.dataset.rid;
    const v = store.view(gidOf());
    const mine = mineIn(v, rid);
    const cur = ui.guess[rid] ?? mine?.data.guess ?? Math.round(v.members.length / 2);
    ui.guess[rid] = Math.min(v.members.length, Math.max(0, cur + Number(el.dataset.step)));
    rerenderKeepScroll();
  },
  async withdraw(el) {
    if (!confirm('Frage aus der Warteschlange nehmen?')) return;
    await store.withdraw(gidOf(), el.dataset.rid);
    rerender();
  },
  'cancel-edit'(el) {
    delete ui.sel[el.dataset.rid];
    delete ui.guess[el.dataset.rid];
    ui.edit = null;
    rerenderKeepScroll();
  },
  edit(el) {
    ui.edit = el.dataset.rid;
    rerenderKeepScroll();
  },
  async join(el) {
    const inv = parseInvite(el.dataset.code);
    await store.joinGroup(inv.id, inv.key);
    location.replace('#/g/' + inv.id);
  },
  scan: () => openScanner(),
  paste() {
    const s = prompt('Einladungslink einfügen:');
    if (!s) return;
    const inv = parseInvite(s);
    if (inv) location.hash = `#join=${inv.id}.${inv.key}`;
    else toast('Das ist kein gültiger Einladungslink');
  },
  share: (el) => shareOrCopy(el.dataset.url, 'Komm in unsere Fragerunde!'),
  copy: (el) => copy(el.dataset.url),
  async leave() {
    if (!confirm('Gruppe wirklich verlassen?')) return;
    await store.leaveGroup(gidOf());
    location.hash = '#/';
  },
  'add-opt'() {
    const list = document.getElementById('optlist');
    if (list.children.length >= 6) return toast('Maximal 6 Optionen');
    const i = document.createElement('input');
    Object.assign(i, { name: 'opt', maxLength: 60, placeholder: `Option ${list.children.length + 1}`, required: true });
    list.append(i);
    i.focus();
  },
  async 'notify-on'() {
    if ((await Notification.requestPermission()) !== 'granted') return toast('Benachrichtigungen wurden nicht erlaubt');
    const reg = await navigator.serviceWorker.ready;
    try {
      await reg.periodicSync.register('fragerunde-check', { minInterval: 3 * 3600 * 1000 });
    } catch {
      return toast('Geht nur, wenn die App installiert ist');
    }
    await store.setNotify(true);
    refreshNotify();
  },
  async 'notify-off'() {
    const reg = await navigator.serviceWorker.ready;
    await reg.periodicSync.unregister('fragerunde-check').catch(() => {});
    await store.setNotify(false);
    refreshNotify();
  },
  async 'notify-test'() {
    (await navigator.serviceWorker.ready).active?.postMessage({ type: 'test' });
  },
  'reset-relays'() {
    document.getElementById('relays').value = DEFAULT_RELAYS.join('\n');
  },
  transfer() {
    const box = document.getElementById('transfer');
    if (box.innerHTML) return (box.innerHTML = '');
    const payload = b64u.enc(new TextEncoder().encode(JSON.stringify({ sk: LS.get('sk'), groups: LS.get('groups', []) })));
    const url = `${location.origin}${location.pathname}#transfer=${payload}`;
    box.innerHTML = `<div class="qrbox">${qrSvg(url)}</div><button class="btn ghost" data-action="copy" data-url="${esc(url)}">${I.link} Link kopieren</button>`;
  },
  import(el) {
    try {
      const data = JSON.parse(new TextDecoder().decode(b64u.dec(el.dataset.code)));
      if (!/^[0-9a-f]{64}$/.test(data.sk) || !Array.isArray(data.groups)) throw new Error();
      LS.set('sk', data.sk);
      LS.set('groups', data.groups);
      LS.set('outbox', []);
      location.replace(location.pathname + '#/');
      location.reload();
    } catch {
      toast('Ungültiger Umzugs-Code');
    }
  },
};

function rerenderKeepScroll() {
  const r = parseRoute();
  paint((VIEWS[r.name] || vHome)(r), false);
}

const FORMS = {
  async new(f) {
    const d = formData(f);
    const packs = packsFrom(f);
    if (!LS.get('name')) LS.set('name', d.name.trim());
    const id = await store.createGroup({ name: d.gname.trim(), packs, profile: { name: d.name, emoji: d.emoji } });
    location.hash = `#/g/${id}/einladen`;
  },
  async profile(f) {
    const d = formData(f);
    if (!LS.get('name')) LS.set('name', d.name.trim());
    await store.setProfile(gidOf(), { name: d.name, emoji: d.emoji });
    toast('Gespeichert');
    if (parseRoute().name === 'group') rerender();
  },
  async meta(f) {
    const packs = packsFrom(f);
    await store.setMeta(gidOf(), { name: formData(f).gname.trim(), packs });
    toast('Gespeichert');
  },
  async answer(f) {
    const rid = f.dataset.rid;
    const v = store.view(gidOf());
    const round = roundById(v, rid);
    const text = formData(f).text.trim();
    if (!round || !text) return;
    ui.edit = null;
    const mine = (v.votes.get(rid) || []).find((x) => x.by === store.pk);
    if (mine && mine.data.text === text.slice(0, 300)) return rerenderKeepScroll();
    await store.vote(v.id, rid, { text: text.slice(0, 300), ...dailyFields(round) });
  },
  async comment(f) {
    const input = f.querySelector('input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    await store.comment(gidOf(), f.dataset.rid, text);
  },
  async ask(f) {
    const fd = new FormData(f);
    const type = fd.get('type');
    const q = { type, text: fd.get('text').trim() };
    if (type === 'either') {
      q.options = fd.getAll('opt').map((s) => s.trim()).filter(Boolean);
      if (q.options.length < 2) return toast('Bitte mindestens zwei Optionen');
    }
    const gid = gidOf();
    const rid = await store.ask(gid, q);
    const slot = schedule(store.view(gid)).get(rid);
    toast(`Eingereiht – kommt ${dateLabel(slot)} dran`);
    location.hash = `#/g/${gid}`;
  },
  device(f) {
    const d = formData(f);
    LS.set('name', d.name.trim());
    const relays = d.relays
      .split(/\s+/)
      .map((s) => s.trim())
      .filter((s) => /^wss?:\/\/\S+$/.test(s));
    store.setRelays(relays.length ? relays : DEFAULT_RELAYS);
    toast('Gespeichert');
  },
};

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  e.preventDefault();
  ACTIONS[el.dataset.action]?.(el, e);
});

app.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  FORMS[f.dataset.form]?.(f);
});

app.addEventListener('change', (e) => {
  if (e.target.name === 'type') {
    const either = e.target.value === 'either';
    const field = document.getElementById('optfield');
    field.hidden = !either;
    field.querySelectorAll('input').forEach((i) => (i.required = either));
  }
});

// ---------- QR-Scanner ----------

let jsqrLoading;
function loadJsQR() {
  return (jsqrLoading ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/jsQR.js';
    s.onload = res;
    s.onerror = rej;
    document.head.append(s);
  }));
}

async function openScanner() {
  const box = document.createElement('div');
  box.className = 'scanner';
  box.innerHTML = `<video playsinline muted></video><div class="frame"></div>
    <p>Halte die Kamera auf den Einladungscode</p><button class="ibtn solid" aria-label="Schließen">${I.close}</button>`;
  document.body.append(box);
  const video = box.querySelector('video');
  let stream;
  let stop = false;
  const close = () => {
    stop = true;
    stream?.getTracks().forEach((t) => t.stop());
    box.remove();
  };
  box.querySelector('button').onclick = close;
  try {
    [stream] = await Promise.all([
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }),
      loadJsQR(),
    ]);
  } catch {
    close();
    toast('Kamera nicht verfügbar – nutze „Einladungslink einfügen"');
    return;
  }
  if (stop) return stream.getTracks().forEach((t) => t.stop());
  video.srcObject = stream;
  await video.play().catch(() => {});
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tick = () => {
    if (stop) return;
    if (video.readyState >= 2 && video.videoWidth) {
      const scale = Math.min(1, 640 / video.videoWidth);
      canvas.width = video.videoWidth * scale;
      canvas.height = video.videoHeight * scale;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const hit = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (hit?.data) {
        const inv = parseInvite(hit.data);
        const tr = hit.data.match(/#transfer=([A-Za-z0-9_-]+)/);
        if (inv || tr) {
          close();
          location.hash = inv ? `#join=${inv.id}.${inv.key}` : `#transfer=${tr[1]}`;
          return;
        }
      }
    }
    requestAnimationFrame(tick);
  };
  tick();
}

// ---------- Start ----------

addEventListener('hashchange', render);
store.addEventListener('change', render);
setInterval(() => {
  // Tageswechsel um Mitternacht
  if (L.dayKey() !== ui.today) {
    ui.today = L.dayKey();
    rerender();
  }
}, 30000);

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js');
}

const clearBadge = () => navigator.clearAppBadge?.().catch(() => {});
clearBadge();
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && clearBadge());

render();
store.init().then(render);
