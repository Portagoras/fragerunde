#!/usr/bin/env node
// Erzeugt neue Fragen mit der Copilot CLI und hängt sie an
// js/questions-generated.js an. Läuft in der GitHub Action
// .github/workflows/neue-fragen.yml: alle 100 Tage für die Tagesfragen
// (klassiker), für Zusatzpakete auf Abruf.
//
//   node scripts/generate-questions.mjs --packs klassiker [--per-pack 10] [--mock]
//
// Copilot bekommt keine Werkzeuge und läuft in einem leeren Ordner: Es soll
// nur JSON zurückgeben, alles Weitere (Prüfen, Schreiben) macht dieses Skript.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACKS, CATALOG, MAIN_PACK } from '../js/questions.js';
import GENERATED from '../js/questions-generated.js';

const root = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : fallback;
};
const PER_PACK = Number(opt('per-pack', 10));
const ONLY = opt('packs', '')?.split(',').filter(Boolean);
const MOCK = args.includes('--mock');

// Tonvorgabe pro Paket – ohne sie werden alle Pakete gleich harmlos-witzig.
const TONE = {
  klassiker: 'witzig und harmlos, "Wer würde am ehesten …"-Situationen aus dem Alltag, über die man lachen und diskutieren kann',
  geschichten: 'kleine absurde Geschichten über eine Person aus der Gruppe, die zum Fantasieren und Lachen einladen',
  entweder: 'kurze, knackige Entweder-oder-Fragen (höchstens 70 Zeichen), echte Dilemmas oder Geschmacksfragen, keine langen Erklärungen',
  niemals: 'Dinge, die viele schon erlebt haben und andere nicht – von harmlos-peinlich bis leicht gewagt, aber nichts Illegales',
  party: 'rund ums Feiern, Ausgehen, Alkohol, Kater, Flirten und peinliche Partymomente',
  frech: 'frech, leicht gemein, peinlich-ehrlich: Lästern, Lügen, Flirten, Eifersucht, kleine Sünden – provokant, aber nicht verletzend oder diskriminierend',
  tiefgang: 'ernsthaft, warm und ehrlich, KEINE Witze: Freundschaft, Dankbarkeit, Vertrauen, Erinnerungen, Wünsche, Ängste – Fragen, die Nähe schaffen',
};

const TYPE_HELP = {
  who: 'Man stimmt für eine Person aus der Gruppe. Text beginnt typischerweise mit "Wer …?". Keine Platzhalter.',
  yesno: 'Ja/Nein-Frage über Gruppenmitglieder. Nutze {A} und optional {B} als Platzhalter für Namen, z. B. "Würde {A} {B} beim Armdrücken besiegen?".',
  text: 'Freie Antwort. Nutze {A} als Platzhalter für eine Person, z. B. "{A} eröffnet ein Restaurant. Was steht auf der Karte?" – oder eine offene Frage an alle ohne Platzhalter.',
  never: 'Satz beginnt exakt mit "Ich hab noch nie " und endet mit einem Punkt. Keine Platzhalter.',
  either: 'Entweder-oder-Frage mit 2 bis 4 kurzen Antwortoptionen im Feld "options" (je höchstens 30 Zeichen, gern mit Emoji). Keine Platzhalter.',
};

const norm = (s) => s.toLowerCase().replace(/\{[ab]\}/g, '').replace(/[^a-zäöüß0-9]/g, '');

function prompt(pack, existing, types) {
  return [
    'Du schreibst Fragen für "Fragerunde", eine Spiele-App für Freundesgruppen (ab ca. 16 Jahren).',
    'Jeden Tag beantwortet die Gruppe eine Frage aus jedem Paket und sieht danach, wer wie abgestimmt hat.',
    '',
    `Paket: "${pack.name}" – ${pack.desc}`,
    `Ton: ${TONE[pack.id] || pack.desc}`,
    `Erlaubte Fragetypen in diesem Paket: ${types.join(', ')}`,
    ...types.map((t) => `- ${t}: ${TYPE_HELP[t]}`),
    '',
    `Schreibe ${PER_PACK} NEUE Fragen auf Deutsch. Regeln:`,
    '- passend zum Ton oben, gut für Diskussionen; nicht verletzend, diskriminierend oder sexuell explizit',
    '- nicht zu ähnlich zu den vorhandenen Fragen unten, keine Dubletten untereinander',
    '- höchstens 120 Zeichen pro Frage, geschlechtsneutral formulieren',
    '',
    'Vorhandene Fragen (nicht wiederholen):',
    ...existing.map((q) => '- ' + q.text),
    '',
    'Antworte AUSSCHLIESSLICH mit einem JSON-Array, ohne Erklärung und ohne Markdown, z. B.:',
    '[{"type":"who","text":"Wer …?"},{"type":"either","text":"… oder …?","options":["A","B"]}]',
  ].join('\n');
}

function askCopilot(text) {
  const cwd = mkdtempSync(join(tmpdir(), 'fragen-'));
  return execFileSync('copilot', ['-p', text, '--no-ask-user'], { cwd, encoding: 'utf8', timeout: 5 * 60 * 1000 });
}

function mockAnswer(pack, types) {
  return (
    'Klar, hier sind die Fragen:\n' +
    JSON.stringify(
      [...Array(3)].map((_, i) => {
        const type = types[i % types.length];
        const text =
          type === 'never' ? `Ich hab noch nie Testfrage ${pack.id} ${i}.`
          : type === 'yesno' ? `Würde {A} Testfrage ${pack.id} ${i} mögen?`
          : type === 'text' ? `{A} macht Testfrage ${pack.id} ${i}. Warum?`
          : `Wer würde Testfrage ${pack.id} ${i} stellen?`;
        return type === 'either' ? { type, text: `Test ${pack.id} ${i} oder nicht?`, options: ['Ja', 'Nein'] } : { type, text };
      }),
    )
  );
}

function parse(out) {
  const start = out.indexOf('[');
  const end = out.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('kein JSON-Array in der Antwort');
  return JSON.parse(out.slice(start, end + 1));
}

// Prüft eine vorgeschlagene Frage; gibt die bereinigte Frage oder einen Grund zurück.
export function check(q, types, seen) {
  if (!q || typeof q.text !== 'string') return 'kein Text';
  const text = q.text.trim().replace(/\s+/g, ' ');
  if (!types.includes(q.type)) return `Typ ${q.type} nicht erlaubt`;
  if (text.length < 10 || text.length > 140) return 'Länge';
  if (/\{(?![AB]\})[^}]*\}/.test(text)) return 'unbekannter Platzhalter';
  const ph = /\{[AB]\}/.test(text);
  if (['who', 'never', 'either'].includes(q.type) && ph) return 'Platzhalter nicht erlaubt';
  if (text.includes('{B}') && !text.includes('{A}')) return '{B} ohne {A}';
  if (q.type === 'never' && !text.startsWith('Ich hab noch nie ')) return 'muss mit "Ich hab noch nie" beginnen';
  const out = { type: q.type, text };
  if (q.type === 'either') {
    const options = (Array.isArray(q.options) ? q.options : []).map((o) => String(o).trim()).filter(Boolean);
    if (options.length < 2 || options.length > 4 || options.some((o) => o.length > 40)) return 'Optionen';
    out.options = options;
  }
  const key = norm(text);
  if (seen.has(key)) return 'Dublette';
  seen.add(key);
  return out;
}

function main() {
  const seen = new Set(CATALOG.map((q) => norm(q.text)));
  const result = [...GENERATED];
  const summary = [];
  let added = 0;

  const packs = PACKS.filter((p) => !ONLY.length || ONLY.includes(p.id));
  if (!packs.length) {
    console.error(`Unbekanntes Paket: ${ONLY.join(', ')}`);
    process.exit(1);
  }
  for (const pack of packs) {
    const existing = CATALOG.filter((q) => q.pack === pack.id);
    const types = [...new Set(existing.map((q) => q.type))];
    let proposals;
    try {
      const out = MOCK ? mockAnswer(pack, types) : askCopilot(prompt(pack, existing, types));
      proposals = parse(out);
    } catch (e) {
      console.warn(`⚠️ ${pack.name}: ${e.message}`);
      summary.push(`### ${pack.emoji} ${pack.name}\n\n⚠️ übersprungen: ${e.message}\n`);
      continue;
    }
    let n = Math.max(0, ...result.filter((q) => q.pack === pack.id).map((q) => Number(q.id.split('-g')[1]) || 0));
    const lines = [];
    for (const p of proposals) {
      const q = check(p, types, seen);
      if (typeof q === 'string') {
        console.warn(`  verworfen (${q}): ${p?.text}`);
        continue;
      }
      n++;
      result.push({ id: `${pack.id}-g${String(n).padStart(3, '0')}`, pack: pack.id, ...q });
      lines.push(`- ${q.text}${q.options ? ` _(${q.options.join(' / ')})_` : ''}`);
      added++;
    }
    console.log(`${pack.name}: ${lines.length} neue Fragen`);
    summary.push(`### ${pack.emoji} ${pack.name}\n\n${lines.join('\n') || '_keine_'}\n`);
  }

  if (!added) {
    console.error('Keine neuen Fragen erzeugt.');
    process.exit(1);
  }

  writeFileSync(
    join(root, 'js/questions-generated.js'),
    '// Automatisch erzeugt von scripts/generate-questions.mjs – nicht von Hand bearbeiten.\n' +
      `export default ${JSON.stringify(result, null, 2)};\n`,
  );
  // Der 100-Tage-Zähler gilt nur für die Tagesfragen.
  if (packs.some((p) => p.id === MAIN_PACK)) {
    const statePath = join(root, '.github/fragen-state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    writeFileSync(statePath, JSON.stringify({ ...state, last: new Date().toISOString().slice(0, 10) }, null, 2) + '\n');
  }
  writeFileSync(
    join(root, 'generated-summary.md'),
    `Die GitHub Action hat ${added} neue Fragen mit Copilot erzeugt. Bitte vor dem Mergen durchlesen – unpassende einfach in \`js/questions-generated.js\` löschen.\n\n${summary.join('\n')}`,
  );
  console.log(`Fertig: ${added} neue Fragen.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
