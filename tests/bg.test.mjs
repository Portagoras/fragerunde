// Auswertung des Hintergrund-Checks (js/bg.js ist ein klassisches Worker-Script).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = { self: {}, TextEncoder, TextDecoder, atob, crypto, console };
vm.runInNewContext(readFileSync(new URL('../js/bg.js', import.meta.url), 'utf8'), ctx);
const FR = ctx.self.FR;

const items = [
  { by: 'lisa', at: 100, d: 'r:c1', data: { type: 'round', rid: 'c1', q: { type: 'yesno', text: 'Grillen am Samstag?' } } },
  { by: 'max', at: 300, d: 'r:c2', data: { type: 'round', rid: 'c2', q: { type: 'text', text: 'Wer bringt was mit?' } } },
  { by: 'me', at: 400, d: 'r:c3', data: { type: 'round', rid: 'c3', q: { type: 'text', text: 'Eigene Frage' } } },
  { by: 'lisa', at: 500, d: 'c:x1', data: { type: 'comment', rid: 'c1', text: 'Bin dabei!' } },
  { by: 'max', at: 50, d: 'c:x0', data: { type: 'comment', rid: 'c1', text: 'alt' } },
  { by: 'lisa', at: 600, d: 'r:falsch', data: { type: 'round', rid: 'c9', q: { text: 'manipuliert' } } },
];
const names = { lisa: 'Lisa', max: 'Max' };

test('Nur neue Kommentare von anderen zählen, eingereichte Fragen nicht', () => {
  const r = FR.summarize(items, { me: 'me', after: 60 });
  assert.deepEqual(Object.keys(r), ['comments']);
  assert.deepEqual(r.comments.map((c) => c.data.text), ['Bin dabei!']);
});

test('Nachricht nennt Kommentar und offene Tagesfragen', () => {
  const { comments } = FR.summarize(items, { me: 'me', after: 60 });
  const m = FR.message({ name: 'Die Chaoten', comments, daily: true, names });
  assert.equal(m.title, 'Die Chaoten');
  assert.equal(m.body, '💬 Lisa: Bin dabei!\n🔥 Die Fragen von heute warten auf dich');
});

test('Mehrere Kommentare werden zusammengefasst, nichts Neues ergibt keine Nachricht', () => {
  const c = [1, 2, 3].map((i) => ({ by: 'lisa', at: i, data: { text: 't' } }));
  assert.equal(FR.message({ name: 'G', comments: c, daily: false, names }).body, '💬 3 neue Kommentare');
  assert.equal(FR.message({ name: 'G', comments: [], daily: false, names }), null);
});
