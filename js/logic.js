// Reine Hilfsfunktionen ohne DOM – werden auch von den Tests genutzt.

export const pad = (n) => String(n).padStart(2, '0');

// Lokales Datum als 'YYYY-MM-DD'.
export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Fortlaufende Tagesnummer, unabhängig von Zeitzone und Sommerzeit.
export function dayNumber(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export function keyFromNumber(n) {
  const d = new Date(n * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// Unix-Sekunden für 00:00 Uhr lokale Zeit an diesem Tag.
export function dayStartSec(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Math.floor(new Date(y, m - 1, d).getTime() / 1000);
}

// FNV-1a, 32 Bit.
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32 – kleiner, deterministischer Zufallsgenerator.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled(arr, seedStr) {
  const out = [...arr];
  const r = rng(hash(seedStr));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const needs = (text) => ({ a: text.includes('{A}'), b: text.includes('{B}') });

// Jedes Paket stellt pro Tag eine Frage. Alle Geräte berechnen sie gleich –
// ohne Server. Jede Gruppe und jedes Paket hat eine eigene, gemischte
// Reihenfolge. Sobald jemand abgestimmt hat, gilt die Frage aus dieser
// Stimme (siehe frozenDaily), damit sich nichts mehr verschiebt, wenn Leute
// beitreten oder neue Fragen in den Katalog kommen.
export function dailyRound(meta, members, key, catalog, pack) {
  const pool = catalog
    .filter((q) => q.pack === pack)
    .sort((x, y) => (x.id < y.id ? -1 : 1));
  if (!pool.length) return null;

  // Für Platzhalter nur Leute, die schon vor diesem Tag dabei waren.
  const start = dayStartSec(key);
  let people = members.filter((m) => m.joined < start);
  if (people.length < 2) people = members;
  people = [...people].sort((x, y) => (x.pk < y.pk ? -1 : 1));

  let n = Math.max(0, dayNumber(key) - dayNumber(meta.start));
  for (let tries = 0; tries < pool.length; tries++, n++) {
    const cycle = Math.floor(n / pool.length);
    const q = shuffled(pool, `${meta.seed}:${pack}:${cycle}`)[n % pool.length];
    const need = needs(q.text);
    if ((need.b && people.length < 2) || (need.a && people.length < 1)) continue;
    const r = rng(hash(`${meta.seed}:${key}:${pack}:subj`));
    const left = [...people];
    const subj = [];
    if (need.a) subj.push(left.splice(Math.floor(r() * left.length), 1)[0].pk);
    if (need.b) subj.push(left.splice(Math.floor(r() * left.length), 1)[0].pk);
    return { rid: `d${key}:${pack}`, day: key, daily: true, pack, qid: q.id, subj };
  }
  return null;
}

// Erste Stimme legt die Tagesfrage fest.
export function frozenDaily(round, votes) {
  const first = [...votes]
    .filter((v) => v.data.qid)
    .sort((x, y) => x.at - y.at || (x.by < y.by ? -1 : 1))[0];
  if (!first) return round;
  return { ...round, qid: first.data.qid, subj: first.data.subj || [] };
}

// Eigene Fragen der Gruppe: Warteschlange nach Einreichungszeit (FIFO).
// Frühestens am Tag nach dem Einreichen, höchstens eine pro Tag.
// Ergebnis: Map rid -> Tag, an dem die Frage gestellt wird.
export function scheduleCustom(rounds) {
  const queue = rounds
    .filter((r) => !r.withdrawn)
    .sort((x, y) => x.at - y.at || (x.rid < y.rid ? -1 : 1));
  const slots = new Map();
  let next = -Infinity;
  for (const r of queue) {
    const n = Math.max(next, dayNumber(r.day) + 1);
    slots.set(r.rid, keyFromNumber(n));
    next = n + 1;
  }
  return slots;
}

export const TYPE_LABEL = {
  who: 'Wer von uns?',
  yesno: 'Ja oder nein?',
  never: 'Ich hab noch nie …',
  either: 'Entweder oder',
  text: 'Erzähl mal',
  secret: 'Anonym',
};

export function optionsFor(q, members) {
  switch (q.type) {
    case 'who':
      return members.map((m) => ({ value: m.pk, label: m.name, member: m }));
    case 'yesno':
      return [{ value: '0', label: 'Ja' }, { value: '1', label: 'Nein' }];
    case 'never':
      return [{ value: '0', label: 'Hab ich schon 🙋' }, { value: '1', label: 'Noch nie 😇' }];
    case 'secret':
      return [{ value: '0', label: 'Ja 🙈' }, { value: '1', label: 'Nein 😇' }];
    case 'either':
      return (q.options || []).map((o, i) => ({ value: String(i), label: o }));
    default:
      return [];
  }
}

// Stimmen pro Option, sortiert nach Anzahl.
export function tally(options, votes) {
  const rows = options.map((o) => ({ ...o, voters: votes.filter((v) => v.data.choice === o.value) }));
  return rows
    .filter((r) => r.voters.length)
    .sort((x, y) => y.voters.length - x.voters.length);
}

// Anonyme Runde: wie viele Ja, und wer lag beim Schätzen am nächsten.
// answers: anonyme Antworten { data: { choice } }, guesses: { by, data: { guess } }
export function secretResult(answers, guesses) {
  const yes = answers.filter((a) => a.data.choice === '0').length;
  const ranked = guesses
    .filter((g) => Number.isInteger(g.data.guess))
    .map((g) => ({ by: g.by, guess: g.data.guess, off: Math.abs(g.data.guess - yes) }))
    .sort((x, y) => x.off - y.off || (x.by < y.by ? -1 : 1));
  const best = ranked.length ? ranked[0].off : null;
  return { yes, total: answers.length, ranked: ranked.map((r) => ({ ...r, best: r.off === best })) };
}

// Tage in Folge, an denen die Tagesfrage beantwortet wurde. Heute zählt
// erst, wenn beantwortet – bis dahin bleibt die Serie von gestern stehen.
export function streak(votedDays, today) {
  let n = dayNumber(today);
  if (!votedDays.has(today)) n--;
  let s = 0;
  while (votedDays.has(keyFromNumber(n))) {
    s++;
    n--;
  }
  return s;
}
