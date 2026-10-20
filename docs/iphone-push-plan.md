# Plan: Benachrichtigungen fürs iPhone über einen Cloudflare Worker

Stand: 21.10.2026 · noch nicht umgesetzt

## Warum überhaupt ein Worker?

Auf dem iPhone darf eine Web-App im Hintergrund nichts selbst ausführen, also auch nicht nach neuen Daten auf den Nostr-Relays schauen. Der einzige Weg zu einer Benachrichtigung ist **Web Push** (ab iOS 16.4, nur für Apps auf dem Home-Bildschirm). Dafür muss jemand die Push-Nachricht an Apples Push-Dienst schicken. Das übernimmt ein kleiner **Cloudflare Worker**: ohne eigenen Server, im kostenlosen Tarif.

Android kann denselben Weg nutzen und wäre dann zuverlässiger als mit dem jetzigen Periodic Background Sync.

## Grundidee: der Worker kennt keine Inhalte

Der Worker verschickt **leere Pushes** (ohne Nutzdaten). Auf dem Handy wacht dann der Service Worker auf, holt die neuen Events von den Relays, entschlüsselt sie mit dem Gruppenschlüssel und baut daraus die Benachrichtigung. Das erledigt schon heute `js/bg.js`.

Der Worker sieht nur:
- ein **Push-Thema pro Gruppe**: `SHA-256("push:" + Gruppen-ID + Schlüssel)`. Daraus lässt sich weder die Gruppe noch ein Inhalt ableiten.
- die **Push-Adressen der Geräte** (URLs bei Apple/Google)
- wann gepusht wird, und IP-Adressen

Er sieht weder Namen noch Fragen noch Antworten.

## Ablauf

```
Handy (PWA)                     Cloudflare Worker                 Apple/Google Push
───────────                     ─────────────────                 ─────────────────
Benachrichtigungen aktivieren
  PushManager.subscribe() ───►  POST /subscribe {topic, sub}
                                  speichert in KV
Lisa reicht Frage ein / kommentiert
  POST /notify {topic} ───────►  bündelt (max. 1 Push / 10 min)
                                  ───── leerer Push ─────────────►  an alle Geräte
                                                                   ◄── weckt Service Worker
  SW: FR.check() → Relays abfragen, entschlüsseln, anzeigen

Täglich 9:00 (Cron) ──────────►  Push an alle Themen: „Fragen von heute“
```

## Bausteine

### 1. Worker (`push-worker/`, ca. 150 Zeilen)

| Endpunkt | Zweck |
| --- | --- |
| `POST /subscribe` | `{topic, subscription}` speichern (KV-Schlüssel `sub:<topic>:<hash(endpoint)>`) |
| `POST /unsubscribe` | Eintrag löschen (beim Verlassen der Gruppe oder Abschalten) |
| `POST /notify` | `{topic}`: höchstens 1 Push pro Thema alle 10 Minuten, der Rest wird gebündelt |
| Cron `0 * * * *` | stündlich laufen, aber nur um 9:00 Uhr Berliner Zeit an alle senden (Cron läuft in UTC, Sommer-/Winterzeit) |

- **VAPID-Schlüsselpaar** einmal erzeugen. Der private Schlüssel kommt als Secret in den Worker (`wrangler secret put VAPID_PRIVATE`), der öffentliche in die App.
- Leere Pushes brauchen keine Payload-Verschlüsselung, nur einen signierten VAPID-JWT (ES256 über WebCrypto, das gibt es in Workers).
- Antwortet ein Push-Dienst mit **404/410**, ist das Abo tot und wird gelöscht.
- **Missbrauchsschutz:** CORS nur für die eigene Pages-Domain, Rate-Limit pro IP, Themen müssen 64 Hex-Zeichen lang sein.

### 2. App

- Einstellungen → „Benachrichtigungen“: Auf dem iPhone, und nur in der installierten App (`display-mode: standalone`), erscheint „Push aktivieren“. Danach `Notification.requestPermission()` → `pushManager.subscribe({userVisibleOnly: true, applicationServerKey})` → `/subscribe` für jede Gruppe.
- Beim Beitreten oder Verlassen einer Gruppe: Thema an- bzw. abmelden.
- Nach dem Einreichen einer Frage und nach Kommentaren: `POST /notify`. Ein Push direkt nach dem Einreichen würde die Überraschung verraten, deshalb nur „Kommentare“ sofort; eingereichte Fragen kommen mit der 9-Uhr-Erinnerung an ihrem Tag.

### 3. Service Worker

- `push`-Event: `event.waitUntil(FR.check({ force: true }))`. Wichtig: **iOS verlangt bei jedem Push eine sichtbare Benachrichtigung.** Findet `check()` nichts (z. B. weil die Relays nicht antworten), muss trotzdem eine kommen, etwa „Neues in deiner Fragerunde“. Sonst entzieht Safari nach ein paar Fällen die Push-Berechtigung.
- iOS gibt dem Service Worker nur wenige Sekunden. Deshalb `maxWait` für die Relays auf etwa 4 s senken und notfalls die Ersatz-Benachrichtigung zeigen.

## Kosten und Grenzen

- Cloudflare Workers Free: 100.000 Anfragen pro Tag, KV Free: 100.000 Lesezugriffe und 1.000 Schreibzugriffe pro Tag. Für eine Freundesgruppe reicht das um Größenordnungen.
- Du brauchst ein **Cloudflare-Konto** (privat, nicht vom Verein) und einmalig `wrangler` zum Ausrollen. Das Ausrollen kann eine GitHub Action übernehmen (`CLOUDFLARE_API_TOKEN` als Secret).
- Bekommt jemand den Einladungslink, kann er auch Pushes an die Gruppe auslösen. Mehr als „ein Push alle 10 Minuten“ ist dank Rate-Limit nicht drin.

## Aufwand

| Schritt | Aufwand |
| --- | --- |
| Worker mit VAPID, KV, Cron, Rate-Limit | ca. 2–3 h |
| App: Abo-Verwaltung, `/notify`-Aufrufe | ca. 1–2 h |
| Service Worker: `push`-Handler mit Ersatzmeldung | ca. 30 min |
| Test auf einem echten iPhone (geht nicht im Simulator) | ca. 1 h |

## Offene Entscheidungen

1. **Uhrzeit der täglichen Erinnerung:** fest 9:00 Uhr oder pro Gruppe einstellbar?
2. **Sofort-Pushes für Kommentare:** ja, nein, oder nur bei Antworten auf die eigene Frage?
3. **Android ebenfalls auf Web Push umstellen?** Das wäre zuverlässiger, macht aber den Worker auch für Android zur Pflicht.
