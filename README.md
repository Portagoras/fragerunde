# Fragerunde

Jeden Tag eine Frage für deine Freundesgruppe – „Wer würde am ehesten …?", „Ich hab noch nie …", Entweder-oder und Fragen über einzelne Leute aus der Gruppe. Alle stimmen ab, danach sieht man, wer wen gewählt hat, und kann darüber diskutieren.

Freie Alternative zu kommerziellen „Wer würde eher"-Apps: **kein Konto, keine Werbung, keine In-App-Käufe, kein eigener Server.**

## Funktionen

- **Tagesfrage** pro Gruppe, für jede Gruppe in eigener, gemischter Reihenfolge (keine Wiederholung, bis der Fragenpool durch ist)
- **Fragetypen:** Wer von uns? · Ja/Nein · Ich hab noch nie · Entweder oder · Freitext
- **Platzhalter:** Fragen wie „Würde *Lisa* *Max* beim Armdrücken besiegen?" setzen echte Gruppenmitglieder ein
- **Fair Play:** Ergebnisse und Diskussion sieht man erst nach der eigenen Antwort
- **Eigene Fragen** jederzeit stellen, auch mit eigenen Antwortmöglichkeiten
- **Diskussion** zu jeder Frage, **Verlauf** aller bisherigen Fragen, **Serie** 🔥
- **7 Fragenpakete** (≈180 Fragen), pro Gruppe an- und abschaltbar
- **Einladen per QR-Code** oder Link, Scanner in der App
- **Umzug auf ein neues Gerät** per QR-Code
- Installierbar als **PWA**, funktioniert offline (Änderungen werden nachgesendet), Hell/Dunkel

## Wie funktioniert das ohne Server?

Die App ist eine statische Webseite (z. B. auf GitHub Pages). Die Daten liegen auf mehreren **öffentlichen [Nostr](https://nostr.com)-Relays**, die Events kostenlos speichern und weiterverteilen.

- Jede Gruppe hat eine zufällige **ID** und einen **AES-256-Schlüssel**. Beides steckt nur im Einladungslink bzw. QR-Code, und zwar im `#`-Teil der URL, der nie an einen Webserver geschickt wird.
- Alles, was auf den Relays landet, ist mit diesem Schlüssel **verschlüsselt** (AES-GCM). Die Relays sehen nur Zufallsdaten, einen Hash der Gruppen-ID und pseudonyme Schlüssel.
- Jedes Gerät erzeugt beim ersten Start ein eigenes Nostr-Schlüsselpaar; damit werden Stimmen signiert, sodass niemand im Namen anderer abstimmen kann.
- Die **Tagesfrage wird auf jedem Gerät gleich berechnet** (aus Gruppen-Seed und Datum), es braucht also niemanden, der sie verschickt. Die erste abgegebene Stimme legt die Frage des Tages fest.
- Gespeichert wird als NIP-78-Event (Kind 30078). Pro Person und Eintrag gilt nur die neueste Version.

### Warum nicht Gun.js?

Gun.js braucht zum Synchronisieren mindestens einen erreichbaren Relay-Peer. Die öffentlichen Gun-Relays sind praktisch alle offline (Stand Oktober 2026), man müsste also doch selbst einen Server betreiben. Bei Nostr gibt es dagegen viele stabile, kostenlose Relays, die Daten dauerhaft speichern. Für Abstimmungen über den Tag verteilt ist das entscheidend.

### Grenzen

- **Keine Push-Benachrichtigungen.** Dafür bräuchte es einen Server. Die Gruppe sieht neue Fragen beim Öffnen der App.
- Öffentliche Relays können Daten irgendwann löschen. Deshalb wird auf mehrere Relays gleichzeitig geschrieben, und jedes Gerät hält eine lokale Kopie. Relays lassen sich in den Einstellungen ändern, auch ein eigenes Relay ist möglich.
- Wer den Einladungslink hat, ist drin. Den Link also nur an Leute geben, die in die Gruppe sollen.
- **iPhone:** Eine installierte Web-App hat einen eigenen Speicher, getrennt von Safari. Also erst „Zum Home-Bildschirm" hinzufügen und die Einladung dann **in der App** scannen.

## Entwickeln

Keine Build-Tools nötig, nur ein statischer Webserver:

```bash
npm start          # python3 -m http.server 8080
npm test           # Tests für die Tagesfragen-Logik (Node ≥ 20)
```

Aufbau:

| Datei | Inhalt |
| --- | --- |
| `js/app.js` | Oberfläche, Routing, QR-Scanner |
| `js/store.js` | Nostr-Sync, Verschlüsselung, Offline-Cache |
| `js/logic.js` | Tagesfrage, Auszählung, Serie (ohne DOM, getestet) |
| `js/questions.js` | Fragenkatalog. Neue Fragen nur **hinten** an eine Liste anhängen. |
| `sw.js` | Service Worker. Bei jeder Veröffentlichung `VERSION` erhöhen. |
| `vendor/` | nostr-tools 2.25.2 (Unlicense), qrcode-generator 1.4.4 (MIT), jsQR 1.4.0 (Apache-2.0) |

## Veröffentlichen mit GitHub Pages

Repository → *Settings* → *Pages* → *Deploy from a branch* → `main` / `/ (root)`. Fertig.

## Lizenz

MIT, siehe [LICENSE](LICENSE). Die Fragen sind eigens für dieses Projekt geschrieben.
