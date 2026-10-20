// Hintergrund-Check für den Service Worker (klassisches Script, per
// importScripts geladen). Android/Chrome weckt den Worker per Periodic
// Background Sync gelegentlich auf – wie oft, entscheidet der Browser.
// Dann: Relays abfragen, neue Kommentare anderer und die offene Tagesfrage
// melden. Eigene Fragen der Gruppe werden NICHT gemeldet – sie sind bis zu
// ihrem Tag in der Warteschlange eine Überraschung. Die Entschlüsselung
// passiert hier auf dem Gerät.
/* global NostrTools */
self.FR = (() => {
  const KIND = 30078;
  const MAIN_PACK = 'klassiker'; // wie in js/questions.js
  const te = new TextEncoder();
  const td = new TextDecoder();
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const b64d = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  const dOf = (e) => e.tags.find((t) => t[0] === 'd')?.[1] || '';

  // ---------- IndexedDB (Schema wie in js/store.js) ----------

  let dbp;
  function db() {
    return (dbp ||= new Promise((res, rej) => {
      const r = indexedDB.open('fragerunde', 2);
      r.onupgradeneeded = () => {
        for (const name of ['groups', 'kv']) {
          if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name);
        }
      };
      r.onsuccess = () => {
        r.result.onversionchange = () => {
          r.result.close();
          dbp = null;
        };
        res(r.result);
      };
      r.onerror = () => rej(r.error);
    }));
  }
  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req?.result);
      t.onerror = () => rej(t.error);
    });
  }
  const kvGet = (k) => tx('kv', 'readonly', (s) => s.get(k));
  const kvSet = (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k));

  // ---------- Krypto (wie in js/store.js) ----------

  const aes = (keyB64) => crypto.subtle.importKey('raw', b64d(keyB64), 'AES-GCM', false, ['decrypt']);
  async function decrypt(key, str) {
    const [iv, ct] = str.split('.');
    return JSON.parse(td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(iv) }, key, b64d(ct))));
  }
  const groupTag = async (gid) => hex(await crypto.subtle.digest('SHA-256', te.encode('fragerunde:' + gid))).slice(0, 32);

  // ---------- Auswertung (ohne Netz, getestet) ----------

  // items: entschlüsselte Einträge { by, at, d, data } mit d ohne Gruppen-Tag.
  function summarize(items, { me, after }) {
    const fresh = items.filter((i) => i.by !== me && i.at > after);
    return { comments: fresh.filter((i) => i.d.startsWith('c:') && i.data.type === 'comment') };
  }

  function message({ name, comments, daily, names }) {
    const who = (pk) => names[pk] || 'Jemand';
    const lines = [];
    if (comments.length === 1) lines.push(`💬 ${who(comments[0].by)}: ${comments[0].data.text}`);
    else if (comments.length > 1) lines.push(`💬 ${comments.length} neue Kommentare`);
    if (daily) lines.push('🔥 Die Fragen von heute warten auf dich');
    return lines.length ? { title: name, body: lines.join('\n') } : null;
  }

  // ---------- Abfrage ----------

  async function checkGroup(pool, g, { pk, relays, now, dry, after: forceAfter }) {
    const tag = await groupTag(g.id);
    const key = await aes(g.key);
    const after = forceAfter ?? (await kvGet('seen:' + g.id)) ?? now;
    const cached = (await tx('groups', 'readonly', (s) => s.get(g.id))) || [];
    const evs = await pool.querySync(relays, { kinds: [KIND], '#t': [tag], since: Math.max(0, after - 600) }, { maxWait: 8000 });
    const known = new Set(cached.map((e) => e.id));
    const added = evs.filter((e) => !known.has(e.id) && dOf(e).startsWith(tag + ':'));
    // Neue Events gleich in den Cache der App legen – dann öffnet sie schneller.
    if (added.length && !dry) await tx('groups', 'readwrite', (s) => s.put(cached.concat(added), g.id));
    const all = cached.concat(added);

    const decode = async (e) => {
      try {
        return { by: e.pubkey, at: e.created_at, d: dOf(e).slice(tag.length + 1), data: await decrypt(key, e.content) };
      } catch {
        return null;
      }
    };
    const metaEv = all.filter((e) => dOf(e) === tag + ':meta').sort((a, b) => b.created_at - a.created_at)[0];
    const meta = metaEv && (await decode(metaEv))?.data;
    const names = {};
    for (const e of all.filter((x) => dOf(x) === tag + ':m')) {
      const it = await decode(e);
      if (it && it.data.name) names[it.by] = it.data.name;
    }
    // Auch schon gecachte Events zählen: Die App kann sie im Hintergrund
    // empfangen haben, ohne dass jemand hingeschaut hat.
    const fresh = all.filter((e) => e.created_at > after && e.pubkey !== pk && dOf(e).startsWith(tag + ':c:'));
    const items = (await Promise.all(fresh.map(decode))).filter(Boolean);
    const { comments } = summarize(items, { me: pk, after });

    const today = dayKey();
    const answered = all.some((e) => e.pubkey === pk && dOf(e) === `${tag}:v:d${today}:${MAIN_PACK}`);
    const daily = Boolean(meta) && !answered && (await kvGet('daily:' + g.id)) !== today;

    if (!dry) {
      const newest = Math.max(after, ...evs.map((e) => e.created_at));
      await kvSet('seen:' + g.id, newest);
      if (daily) await kvSet('daily:' + g.id, today);
    }
    const msg = message({ name: meta?.name || 'Fragerunde', comments, daily, names });
    return msg && { ...msg, gid: g.id, url: `./#/g/${g.id}` };
  }

  // dry: nichts anzeigen und nichts merken (zum Testen aus der App).
  // force: auch nachts und ohne aktivierte Benachrichtigungen prüfen.
  async function check({ dry = false, force = false, after } = {}) {
    const [groups, pk, relays, enabled] = await Promise.all([kvGet('groups'), kvGet('pk'), kvGet('relays'), kvGet('notify')]);
    if (!pk || !groups?.length || !relays?.length) return [];
    if (!enabled && !force) return [];
    const hour = new Date().getHours();
    if (!force && (hour < 8 || hour >= 22)) return []; // Nachtruhe
    const now = Math.floor(Date.now() / 1000);
    const pool = new NostrTools.SimplePool();
    const notes = [];
    try {
      for (const g of groups) {
        try {
          const n = await checkGroup(pool, g, { pk, relays, now, dry, after });
          if (n) notes.push(n);
        } catch (e) {
          console.warn('bg check', g.id, e);
        }
      }
    } finally {
      pool.destroy();
    }
    if (!dry) {
      for (const n of notes) {
        await self.registration.showNotification(n.title, {
          body: n.body,
          tag: 'fr-' + n.gid,
          data: { url: n.url },
          icon: 'icons/icon-192.png',
          badge: 'icons/icon-192.png',
        });
      }
      if (notes.length) {
        try {
          await navigator.setAppBadge?.(notes.length);
        } catch {}
      }
    }
    return notes;
  }

  return { check, summarize, message, dayKey };
})();
