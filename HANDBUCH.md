# 🗺 Germany 350km Map — Benutzerhandbuch

Eine Progressive Web App zur Visualisierung des 350km-Radius um Deutschland, mit Routing, Höhenprofil, Ladesäulensuche und mehr.

---

## Inhaltsverzeichnis

1. [Installation](#installation)
2. [Erste Schritte](#erste-schritte)
3. [Radius-Modi](#radius-modi)
4. [GPS & Standort](#gps--standort)
5. [Routing](#routing)
6. [Höhenprofil & GPX-Export](#höhenprofil--gpx-export)
7. [Alpenpässe](#alpenpässe)
8. [Ladesäulensuche](#ladesäulensuche)
9. [POI-Suche](#poi-suche)
10. [Ortssuche](#ortssuche)
11. [Länder-Whitelist](#länder-whitelist)
12. [API-Keys einrichten](#api-keys-einrichten)
13. [Offline-Nutzung](#offline-nutzung)
14. [Gesten & Buttons](#gesten--buttons)

---

## Installation

Die App läuft direkt im Browser — keine Installation aus dem App Store nötig.

**Android (Chrome):**
1. App-URL im Chrome-Browser öffnen
2. Menü (⋮) → *Zum Startbildschirm hinzufügen*
3. App startet danach wie eine native App

**iOS (Safari):**
1. App-URL in Safari öffnen
2. Teilen-Button (□↑) → *Zum Home-Bildschirm*
3. Beim ersten Start erscheint automatisch ein Hinweisbanner

**Desktop:**
Läuft in jedem modernen Browser. Vollständig ohne Installation nutzbar.

---

## Erste Schritte

Nach dem Öffnen zentriert die Karte auf Deutschland und zeigt den 350km-Luftlinienradius als gestrichelte rote Linie.

**Wichtigste Buttons:**

| Button | Funktion |
|--------|----------|
| ◎ | GPS-Standort aktivieren |
| ⚙ Luftlinie | Radius-Modus wechseln |
| 🗺 Route | Route zu einem Ziel berechnen |
| 📍 Orte | POI-Suche öffnen |
| 🏔 Pässe | Alpenpässe ein-/ausblenden |
| 🗃 Layer | Kartenstil wechseln |
| 🇩🇪 | Karte auf Deutschland zentrieren |
| ✕ | Route / Marker löschen |

**Kartenstile:**
- **Standard** — klassische OpenStreetMap-Ansicht
- **Topo** — topografische Karte mit Höhenlinien
- **Humanitarian** — vereinfachte Karte für bessere Lesbarkeit

---

## Radius-Modi

Der Radius kann auf drei Arten berechnet werden. Kurzer Tipp auf ⚙ öffnet die Moduswahl, **langer Druck** (0,5s) öffnet den Radius-Slider.

### Luftlinie (Standard)
Zeigt einen geometrischen Puffer um die deutsche Grenze. Wird sofort ohne API-Key berechnet. Genauigkeit: ±1km.

### Straßenkilometer
Berechnet wie weit man auf Straßen fahren kann, bevor man 350km von der Grenze entfernt ist. Erfordert einen OpenRouteService API-Key.

### Fahrzeit
Zeigt das Gebiet das in einer bestimmten Fahrzeit erreichbar ist (Standard: ca. 3,5h bei 350km). Erfordert einen OpenRouteService API-Key.

### Radius anpassen
Langer Druck auf ⚙ → Schieberegler von 100–500km. Nach Bestätigung wird der Radius neu berechnet und gespeichert.

> **Tipp:** ORS-Berechnungen werden 1 Stunde gecacht. Zweiter Aufruf mit gleichem Radius lädt sofort.

---

## GPS & Standort

Tipp auf **◎** aktiviert den GPS-Standort.

- Roter Punkt = dein aktueller Standort
- Grüner Chip unten: Koordinaten + Entfernung zur deutschen Grenze
- Luftlinie und Fahrstrecke zur nächsten Grenzübergangsstelle werden automatisch berechnet

**Anzeige im Chip:**
- `150 km in DE` — du bist innerhalb Deutschlands, 150km von der Grenze entfernt
- `+45 km außerhalb` — du bist 45km außerhalb des Radius
- `18,3 km · 22min zur Grenze` — Fahrstrecke und -zeit zur nächsten Grenzübergangsstelle

> **iOS-Hinweis:** GPS erfordert HTTPS. Auf `http://` ist kein GPS verfügbar.

---

## Routing

1. GPS-Standort aktivieren (◎)
2. Route-Modus aktivieren (🗺)
3. Auf die Karte tippen — Ziel setzen
4. Route wird automatisch berechnet (OSRM)

**Route-Panel zeigt:**
- Gesamtdistanz in km
- Fahrzeit
- Abstand zur deutschen Grenze vom Ziel aus
- Straßentyp-Aufschlüsselung (Autobahn / Bundesstraße / Landstraße / Stadtstraße)
- Höhenprofil
- Passwarnung (wenn Route an gesperrtem Alpenpass vorbeiführt)

**Popup bei normalem Kartentipp** (außerhalb Route-Modus):
- Zeigt Fahrweg + Zeit zur deutschen Grenze vom angeklickten Punkt
- Gibt an ob der Punkt innerhalb oder außerhalb des Radius liegt
- Straßentypen-Aufschlüsselung bis zur Grenze

---

## Höhenprofil & GPX-Export

Nach jeder Routenberechnung wird automatisch ein Höhenprofil geladen.

### Höhenprofil
- SVG-Kurve mit Gradient-Fill, direkt im Route-Panel
- **Hover / Touch:** Crosshair-Linie + Tooltip mit exakter Höhe in Metern
- Kennzahlen: ⬆ Gesamtanstieg · ⬇ Gesamtgefälle · ▲ Höchster Punkt · ▼ Tiefster Punkt
- Primäre API: Open-Elevation · Fallback: open-meteo (automatisch)

### GPX-Export
Nach einer Routenberechnung erscheint **⬇ GPX exportieren** im Route-Panel.

- Exportiert die vollständige Route als GPX 1.1-Datei
- Enthält `<ele>`-Tags mit Höhendaten (wenn verfügbar)
- Dateiname: `route-YYYY-MM-DD.gpx`
- Kompatibel mit Garmin, Komoot, OsmAnd, Google Maps

---

## Alpenpässe

Tipp auf **🏔 Pässe** zeigt 15 Alpenpässe auf der Karte.

**Marker-Farben:**
- 🟢 Grün = aktuell geöffnet
- 🔴 Rot = aktuell gesperrt (saisonale Wintersperre)

Tipp auf einen Marker zeigt Name, Höhe, aktuellen Status und typische Sperrmonate.

**Automatische Passwarnung:** Wenn eine berechnete Route innerhalb von 15km an einem gesperrten Pass vorbeiführt, erscheint im Route-Panel eine rote Warnung.

**Enthaltene Pässe:**
Brenner, Reschen, Fernpass, Arlberg, Silvretta, Timmelsjoch, Großglockner, Nufenen, Gotthard, Grimsel, Susten, Furka, Flüela, Maloja, Julier.

---

## Ladesäulensuche

Unter **📍 Orte** gibt es drei Schnelllader-Kategorien:

| Kategorie | Leistung | Farbe |
|-----------|----------|-------|
| ⚡ Lader ≥50 kW | 50–149 kW | Grün |
| ⚡ Lader ≥150 kW | 150–349 kW | Orange |
| ⚡ Lader ≥350 kW | ab 350 kW | Rot |

### Datenquellen

**OpenChargeMap (mit API-Key — empfohlen):**
- Verifizierte Leistungsangaben
- Echtzeit-Betriebsstatus (Operational / Out of Order)
- Steckertypen mit Anzahl (CCS, Type 2, CHAdeMO, Tesla)

**OpenStreetMap / Overpass (ohne Key — automatischer Fallback):**
- Community-gepflegte Daten
- Stationen ohne Leistungsangabe werden herausgefiltert

### Fahrzeit-Berechnung

Nach dem Laden berechnet die App automatisch die Fahrzeit zu den 5 nächsten Stationen:

1. Sofortanzeige nach Luftlinie
2. OSRM-Fahrzeit für Top 5 (parallel)
3. Neusortierung nach Fahrzeit
4. Top 3 mit `🚗 12min` Badge
5. Route zur nächsten Station wird automatisch gezeichnet

> Erfordert aktiven GPS-Standort.

---

## POI-Suche

Unter **📍 Orte** sind folgende Kategorien verfügbar:

- ⛽ Tankstellen
- 🍽 Restaurants
- 🏨 Hotels
- 🏥 Krankenhäuser
- ⭐ Sehenswürdigkeiten
- 🛒 Supermärkte
- ⚡ Ladesäulen (3 Leistungsklassen)

Alle POIs werden im aktuellen Radius gefiltert, nach Entfernung sortiert. Maximal 30 Ergebnisse. Tipp auf ein Ergebnis → Karte fliegt zum POI.

---

## Ortssuche

Suchfeld oben links. Ab 3 Zeichen startet die Suche automatisch (400ms Debounce).

- ✓-Symbol wenn der Ort innerhalb des Radius liegt
- Tipp auf Ergebnis → Karte fliegt zum Ort (Zoom 12)

---

## Länder-Whitelist

Klicks auf nicht erlaubte Länder zeigen: `⛔ Land nicht im erlaubten Bereich`

**Erlaubte Länder (25):**
Island · Irland · Vereinigtes Königreich · Norwegen · Schweden · Dänemark · Niederlande · Belgien · Luxemburg · Deutschland · Polen · Frankreich · Schweiz · Liechtenstein · Österreich · Tschechien · Slowenien · Kroatien · Italien · San Marino · Monaco · Andorra · Vatikanstadt · Spanien · Portugal

---

## API-Keys einrichten

### OpenRouteService (ORS)
Für Straßen-Radius und Fahrzeit-Isochrone.

- Registrierung: https://openrouteservice.org/dev/#/signup
- Kostenlos: 500 Anfragen/Tag
- In der App: ⚙ → Modus *Straße* oder *Fahrzeit* → Key-Panel

### OpenChargeMap (OCM)
Für Echtzeit-Ladesäulendaten.

- Registrierung: https://openchargemap.org/site/developerinfo
- Kostenlos, kein festes Limit
- In der App: 📍 Orte → 🔑 OpenChargeMap API-Key (ganz unten)

---

## Offline-Nutzung

Nach dem ersten Laden ist die App offline nutzbar (Service Worker).

**Offline verfügbar:** Karte navigieren (gecachte Tiles), Radius-Anzeige (Luftlinie), GPS-Standort, Alpenpässe.

**Erfordert Verbindung:** Neue Kartenbereiche, ORS-Isochrone, Routing, Höhenprofil, Ladesäulen- und POI-Suche, Ortssuche, Länderprüfung.

---

## Gesten & Buttons

| Aktion | Geste |
|--------|-------|
| Radius-Slider öffnen | Langer Druck (0,5s) auf ⚙ |
| Route-Modus aktivieren | 🗺 tippen (GPS aktiv erforderlich) |
| Route löschen | ✕ FAB oder ✕ im Route-Panel |
| Karte zentrieren | 🇩🇪 tippen |
| Pässe umschalten | 🏔 tippen |
| Layer wechseln | 🗃 tippen (3 Stile im Wechsel) |
| Alle Marker löschen | ✕ FAB |
| OCM-Key ändern | 📍 → 🔑 ganz unten |
| ORS-Key ändern | ⚙ → Modus Straße/Fahrzeit |
| Höhenprofil ablesen | Hover / Touch auf SVG-Kurve |

---

*Datenquellen: OpenStreetMap · OpenRouteService · OSRM · Open-Elevation · open-meteo · OpenChargeMap · Nominatim*
