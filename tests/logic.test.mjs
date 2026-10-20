// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';
import { CATALOG, PACKS } from '../js/questions.js';

const meta = { seed: 'abc123', start: '2026-10-01', packs: PACKS.map((p) => p.id) };
const members = [
  { pk: 'aa', name: 'A', joined: 0 },
  { pk: 'bb', name: 'B', joined: 0 },
  { pk: 'cc', name: 'C', joined: 0 },
];

test('Katalog: eindeutige IDs, gültige Typen, Platzhalter nur wo erlaubt', () => {
  const ids = new Set(CATALOG.map((q) => q.id));
  assert.equal(ids.size, CATALOG.length);
  for (const q of CATALOG) {
    assert.ok(L.TYPE_LABEL[q.type], q.id);
    if (q.type === 'either') assert.ok(q.options.length >= 2, q.id);
    if (q.type === 'who' || q.type === 'never' || q.type === 'either') assert.ok(!/\{[AB]\}/.test(q.text), q.id);
  }
  assert.ok(CATALOG.length > 150);
});

test('Tagesfrage ist deterministisch und unabhängig von der Reihenfolge der Mitglieder', () => {
  const a = L.dailyRound(meta, members, '2026-10-20', CATALOG);
  const b = L.dailyRound(meta, [...members].reverse(), '2026-10-20', CATALOG);
  assert.deepEqual(a, b);
  assert.equal(a.rid, 'd2026-10-20');
});

test('Innerhalb eines Durchlaufs wiederholt sich keine Frage', () => {
  const seen = new Set();
  const start = L.dayNumber(meta.start);
  for (let i = 0; i < CATALOG.length; i++) {
    const r = L.dailyRound(meta, members, L.keyFromNumber(start + i), CATALOG);
    assert.ok(!seen.has(r.qid), `Wiederholung an Tag ${i}: ${r.qid}`);
    seen.add(r.qid);
  }
});

test('Gruppen mit anderem Seed bekommen eine andere Reihenfolge', () => {
  const days = [...Array(10)].map((_, i) => L.keyFromNumber(L.dayNumber(meta.start) + i));
  const q1 = days.map((k) => L.dailyRound(meta, members, k, CATALOG).qid);
  const q2 = days.map((k) => L.dailyRound({ ...meta, seed: 'other' }, members, k, CATALOG).qid);
  assert.notDeepEqual(q1, q2);
});

test('Platzhalter: zwei verschiedene Personen, nur Mitglieder', () => {
  const start = L.dayNumber(meta.start);
  for (let i = 0; i < 400; i++) {
    const r = L.dailyRound(meta, members, L.keyFromNumber(start + i), CATALOG);
    const q = CATALOG.find((x) => x.id === r.qid);
    const need = L.needs(q.text);
    assert.equal(r.subj.length, (need.a ? 1 : 0) + (need.b ? 1 : 0));
    if (need.b) assert.notEqual(r.subj[0], r.subj[1]);
    for (const pk of r.subj) assert.ok(members.some((m) => m.pk === pk));
  }
});

test('Mit nur einer Person keine {B}-Fragen', () => {
  const start = L.dayNumber(meta.start);
  for (let i = 0; i < 200; i++) {
    const r = L.dailyRound(meta, members.slice(0, 1), L.keyFromNumber(start + i), CATALOG);
    const q = CATALOG.find((x) => x.id === r.qid);
    assert.ok(!q.text.includes('{B}'));
  }
});

test('Erste Stimme friert die Tagesfrage ein', () => {
  const r = L.dailyRound(meta, members, '2026-10-20', CATALOG);
  const votes = [
    { by: 'bb', at: 200, data: { qid: 'x-2', subj: ['cc'] } },
    { by: 'aa', at: 100, data: { qid: 'x-1', subj: ['aa'] } },
  ];
  const f = L.frozenDaily(r, votes);
  assert.equal(f.qid, 'x-1');
  assert.deepEqual(f.subj, ['aa']);
  assert.equal(L.frozenDaily(r, []).qid, r.qid);
});

test('Auszählung sortiert nach Stimmen', () => {
  const opts = L.optionsFor({ type: 'yesno' }, []);
  const rows = L.tally(opts, [
    { data: { choice: '1' } },
    { data: { choice: '1' } },
    { data: { choice: '0' } },
  ]);
  assert.deepEqual(rows.map((r) => [r.label, r.voters.length]), [['Nein', 2], ['Ja', 1]]);
});

test('Serie zählt aufeinanderfolgende Tage', () => {
  const s = new Set(['2026-10-17', '2026-10-18', '2026-10-19']);
  assert.equal(L.streak(s, '2026-10-20'), 3);
  s.add('2026-10-20');
  assert.equal(L.streak(s, '2026-10-20'), 4);
  assert.equal(L.streak(new Set(['2026-10-15']), '2026-10-20'), 0);
});

test('Tageszählung über Sommerzeit-Umstellung hinweg', () => {
  assert.equal(L.dayNumber('2026-10-26') - L.dayNumber('2026-10-24'), 2);
  assert.equal(L.keyFromNumber(L.dayNumber('2026-03-29')), '2026-03-29');
});
