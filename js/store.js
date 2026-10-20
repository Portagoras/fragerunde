// Datenhaltung über öffentliche Nostr-Relays – kein eigener Server nötig.
//
// Jede Gruppe hat eine zufällige ID und einen AES-Schlüssel. Beides steckt
// nur im Einladungslink (im #-Teil, der nie an einen Server geht). Auf den
// Relays liegen ausschließlich verschlüsselte Events; zum Wiederfinden dient
// ein Hash der Gruppen-ID als Tag.
//
// Alles ist ein "addressable event" (Kind 30078, NIP-78): pro Person und
// d-Tag gilt nur die neueste Version. d-Tags:
//   <tag>:meta        Gruppenname, Pakete, Startdatum
//   <tag>:m           eigenes Profil in der Gruppe
//   <tag>:v:<rid>     eigene Stimme zu einer Runde
//   <tag>:r:<rid>     eigene Frage (Runde)
//   <tag>:c:<cid>     Kommentar

import { dayKey } from './logic.js';

const KIND = 30078;
export const DEFAULT_RELAYS = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.mom',
  'wss://relay.snort.social',
  'wss://offchain.pub',
  'wss://relay.damus.io',
];

export const LS = {
  get(k, d) {
    try {
      const v = localStorage.getItem('fr:' + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('fr:' + k, JSON.stringify(v));
    } catch {}
  },
};

const te = new TextEncoder();
const td = new TextDecoder();
const toHex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
export const randomId = (n = 8) => toHex(randomBytes(n));

export const b64u = {
  enc(bytes) {
    let s = '';
    for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  },
};

async function aesKey(raw) {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptJSON(key, obj) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj)));
  return b64u.enc(iv) + '.' + b64u.enc(ct);
}

async function decryptJSON(key, str) {
  const [iv, ct] = str.split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u.dec(iv) }, key, b64u.dec(ct));
  return JSON.parse(td.decode(pt));
}

async function groupTag(gid) {
  const h = await crypto.subtle.digest('SHA-256', te.encode('fragerunde:' + gid));
  return toHex(new Uint8Array(h)).slice(0, 32);
}

// Einladung: "<gruppen-id>.<schlüssel>"
export function parseInvite(s) {
  const m = String(s).match(/(?:join=)?([0-9a-f]{32})\.([A-Za-z0-9_-]{43})/);
  return m ? { id: m[1], key: m[2] } : null;
}

// Minimaler IndexedDB-Cache. 'groups': pro Gruppe die rohen Events,
// 'kv': was der Service Worker für den Hintergrund-Check braucht.
// Schema muss zu js/bg.js passen.
const idb = {
  _db: null,
  open() {
    if (this._db) return this._db;
    this._db = new Promise((res, rej) => {
      const r = indexedDB.open('fragerunde', 2);
      r.onupgradeneeded = () => {
        for (const name of ['groups', 'kv']) {
          if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name);
        }
      };
      r.onsuccess = () => {
        r.result.onversionchange = () => {
          r.result.close();
          this._db = null;
        };
        res(r.result);
      };
      r.onerror = () => rej(r.error);
    });
    return this._db;
  },
  async tx(store, mode, fn) {
    try {
      const db = await this.open();
      return await new Promise((res, rej) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => res(req?.result);
        t.onerror = () => rej(t.error);
      });
    } catch {
      return undefined;
    }
  },
  get: (id) => idb.tx('groups', 'readonly', (s) => s.get(id)),
  put: (id, v) => idb.tx('groups', 'readwrite', (s) => s.put(v, id)),
  del: (id) => idb.tx('groups', 'readwrite', (s) => s.delete(id)),
};

export const kv = {
  get: (k) => idb.tx('kv', 'readonly', (s) => s.get(k)),
  set: (k, v) => idb.tx('kv', 'readwrite', (s) => s.put(v, k)),
};

export class Store extends EventTarget {
  constructor() {
    super();
    const { SimplePool, generateSecretKey, getPublicKey } = window.NostrTools;
    let sk = LS.get('sk');
    if (!sk) {
      sk = toHex(generateSecretKey());
      LS.set('sk', sk);
    }
    this.sk = fromHex(sk);
    this.pk = getPublicKey(this.sk);
    this.relays = LS.get('relays', DEFAULT_RELAYS);
    this.pool = new SimplePool({ enableReconnect: true });
    this.groups = new Map();
    this.outbox = LS.get('outbox', []);
    this._timers = {};
  }

  async init() {
    navigator.storage?.persist?.();
    kv.set('pk', this.pk);
    kv.set('relays', this.relays);
    kv.set('groups', LS.get('groups', []));
    for (const g of LS.get('groups', [])) await this._open(g.id, g.key);
    this.ready = true;
    this.flush();
    setInterval(() => this.flush(), 30000);
    addEventListener('online', () => this.resync());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.resync();
    });
  }

  _changed() {
    clearTimeout(this._timers.change);
    this._timers.change = setTimeout(() => {
      this.dispatchEvent(new Event('change'));
      // Was hier offen sichtbar war, muss der Hintergrund-Check nicht melden.
      if (document.visibilityState === 'visible') {
        for (const g of this.groups.values()) if (g.latest) kv.set('seen:' + g.id, g.latest);
      }
    }, 40);
  }

  _saveList() {
    const list = [...this.groups.values()].map((g) => ({ id: g.id, key: g.keyB64 }));
    LS.set('groups', list);
    kv.set('groups', list);
  }

  async setNotify(on) {
    if (on) for (const g of this.groups.values()) await kv.set('seen:' + g.id, g.latest || Math.floor(Date.now() / 1000));
    await kv.set('notify', on);
  }

  notifyEnabled() {
    return kv.get('notify').then(Boolean);
  }

  async _open(id, keyB64) {
    if (this.groups.has(id)) return this.groups.get(id);
    const g = {
      id,
      keyB64,
      key: await aesKey(b64u.dec(keyB64)),
      tag: await groupTag(id),
      items: new Map(),
      latest: 0,
      loading: true,
      sub: null,
    };
    this.groups.set(id, g);
    for (const ev of (await idb.get(id)) || []) await this._ingest(g, ev, false);
    if (g.items.size) g.loading = false;
    this._sync(g);
    return g;
  }

  // Holt alles seit dem letzten bekannten Stand (beim ersten Mal: alles)
  // seitenweise ab und hört danach live mit.
  async _sync(g) {
    if (g.syncing) return;
    g.syncing = true;
    try {
      const since = g.latest ? g.latest - 3 * 86400 : undefined;
      let until;
      for (let page = 0; page < 50; page++) {
        const f = { kinds: [KIND], '#t': [g.tag], limit: 500 };
        if (since) f.since = since;
        if (until) f.until = until;
        const evs = await this.pool.querySync(this.relays, f, { maxWait: 6000 });
        for (const ev of evs) await this._ingest(g, ev, true);
        if (evs.length < 90) break;
        const oldest = Math.min(...evs.map((e) => e.created_at));
        if (oldest === until) break;
        until = oldest;
      }
    } catch (e) {
      console.warn('sync', e);
    } finally {
      g.syncing = false;
      g.loading = false;
      this._changed();
    }
    if (!this.groups.has(g.id)) return;
    g.sub?.close();
    g.sub = this.pool.subscribeMany(
      this.relays,
      { kinds: [KIND], '#t': [g.tag], since: Math.floor(Date.now() / 1000) - 120 },
      { onevent: (ev) => this._ingest(g, ev, true) },
    );
  }

  resync() {
    for (const g of this.groups.values()) this._sync(g);
    this.flush();
  }

  async _ingest(g, ev, persist) {
    if (ev.kind !== KIND) return;
    const d = ev.tags.find((t) => t[0] === 'd')?.[1];
    if (!d || !d.startsWith(g.tag + ':')) return;
    const k = ev.pubkey + '|' + d;
    const newer = (p) => p && (p.ev.created_at > ev.created_at || p.ev.id === ev.id);
    if (newer(g.items.get(k))) return;
    let data;
    try {
      data = await decryptJSON(g.key, ev.content);
    } catch {
      return; // fremdes oder kaputtes Event
    }
    if (newer(g.items.get(k))) return;
    g.items.set(k, { ev, data, by: ev.pubkey, at: ev.created_at, d: d.slice(g.tag.length + 1) });
    g.latest = Math.max(g.latest, ev.created_at);
    if (persist) {
      clearTimeout(this._timers['p' + g.id]);
      this._timers['p' + g.id] = setTimeout(() => idb.put(g.id, [...g.items.values()].map((i) => i.ev)), 500);
    }
    this._changed();
  }

  async _publish(gid, d, data) {
    const g = this.groups.get(gid);
    const full = g.tag + ':' + d;
    const prev = g.items.get(this.pk + '|' + full);
    const now = Math.floor(Date.now() / 1000);
    const ev = window.NostrTools.finalizeEvent(
      {
        kind: KIND,
        created_at: prev ? Math.max(now, prev.ev.created_at + 1) : now,
        tags: [['d', full], ['t', g.tag]],
        content: await encryptJSON(g.key, data),
      },
      this.sk,
    );
    await this._ingest(g, ev, true);
    // Ältere, noch nicht gesendete Versionen desselben Eintrags verwerfen.
    this.outbox = this.outbox.filter((e) => e.tags.find((t) => t[0] === 'd')?.[1] !== full);
    this.outbox.push(ev);
    LS.set('outbox', this.outbox);
    this.flush();
  }

  async flush() {
    // Kommt während des Sendens etwas Neues dazu, gleich noch eine Runde.
    if (this._flushing) return void (this._again = true);
    if (!this.outbox.length) return;
    this._flushing = true;
    try {
      do {
        this._again = false;
        for (const ev of [...this.outbox]) {
          const res = await Promise.allSettled(this.pool.publish(this.relays, ev));
          if (res.some((r) => r.status === 'fulfilled')) {
            this.outbox = this.outbox.filter((e) => e.id !== ev.id);
            LS.set('outbox', this.outbox);
          }
        }
      } while (this._again);
    } finally {
      this._flushing = false;
      this._changed();
    }
  }

  // ---------- Aktionen ----------

  async createGroup({ name, packs, profile }) {
    const id = randomId(16);
    const key = b64u.enc(randomBytes(32));
    await this._open(id, key);
    this._saveList();
    await this._publish(id, 'meta', { type: 'meta', name, packs, seed: randomId(8), start: dayKey() });
    await this.setProfile(id, profile);
    return id;
  }

  async joinGroup(id, key) {
    await this._open(id, key);
    this._saveList();
    this._changed();
  }

  async leaveGroup(id) {
    const me = this.view(id).me;
    if (me) await this._publish(id, 'm', { ...me.data, type: 'member', left: true });
    await this.flush();
    const g = this.groups.get(id);
    g?.sub?.close();
    this.groups.delete(id);
    this._saveList();
    idb.del(id);
    this._changed();
  }

  setProfile(gid, { name, emoji }) {
    const me = this.view(gid).me;
    return this._publish(gid, 'm', {
      type: 'member',
      name: name.trim().slice(0, 30),
      emoji,
      joined: me?.data.joined || Math.floor(Date.now() / 1000),
    });
  }

  setMeta(gid, patch) {
    return this._publish(gid, 'meta', { ...this.view(gid).meta, ...patch, type: 'meta' });
  }

  vote(gid, rid, payload) {
    return this._publish(gid, 'v:' + rid, { type: 'vote', rid, ...payload });
  }

  async ask(gid, q) {
    const rid = 'c' + randomId(6);
    await this._publish(gid, 'r:' + rid, { type: 'round', rid, day: dayKey(), q });
    return rid;
  }

  withdraw(gid, rid) {
    const own = this.view(gid).rounds.find((r) => r.rid === rid && r.by === this.pk);
    if (!own) return;
    const { by, at, ...data } = own;
    return this._publish(gid, 'r:' + rid, { ...data, withdrawn: true });
  }

  comment(gid, rid, text) {
    return this._publish(gid, 'c:' + randomId(6), { type: 'comment', rid, text: text.trim().slice(0, 500) });
  }

  inviteCode(gid) {
    const g = this.groups.get(gid);
    return `${g.id}.${g.keyB64}`;
  }

  pending() {
    return this.outbox.length;
  }

  relayStatus() {
    const s = this.pool.listConnectionStatus();
    return this.relays.map((url) => ({ url, ok: s.get(url) ?? s.get(url + '/') ?? false }));
  }

  setRelays(list) {
    this.relays = list;
    LS.set('relays', list);
    kv.set('relays', list);
    this.resync();
  }

  // ---------- Lesesicht ----------

  view(gid) {
    const g = this.groups.get(gid);
    if (!g) return null;
    let meta = null;
    let metaAt = 0;
    const members = [];
    const rounds = [];
    const votes = new Map();
    const comments = new Map();
    const push = (map, k, v) => (map.get(k) || map.set(k, []).get(k)).push(v);
    let me = null;
    for (const it of g.items.values()) {
      const { d, data } = it;
      if (d === 'meta' && data.type === 'meta') {
        if (it.at > metaAt) [meta, metaAt] = [data, it.at];
      } else if (d === 'm' && data.type === 'member') {
        if (it.by === this.pk) me = it;
        if (!data.left) members.push({ pk: it.by, name: data.name || '?', emoji: data.emoji, joined: data.joined || it.at });
      } else if (d === 'v:' + data.rid && data.type === 'vote') {
        push(votes, data.rid, it);
      } else if (d === 'r:' + data.rid && data.type === 'round' && data.q) {
        rounds.push({ ...data, by: it.by, at: it.at });
      } else if (d.startsWith('c:') && data.type === 'comment') {
        push(comments, data.rid, it);
      }
    }
    members.sort((a, b) => a.joined - b.joined || (a.pk < b.pk ? -1 : 1));
    for (const list of comments.values()) list.sort((a, b) => a.at - b.at);
    if (me?.data.left) me = null;
    return { id: gid, loading: g.loading, meta, members, rounds, votes, comments, me };
  }
}
