# Rattenfest 2026 - Live Dashboard

A real-time dashboard and timeline charting application built with Node.js, Express, Socket.io, WebRTC, and HTML5 Canvas.

## Setup and Running

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Start the Server**
   ```bash
   node server.js
   ```
   The server runs on `http://localhost:3000` by default.

---

## Application Interfaces

| URL | Description |
|-----|-------------|
| `/` | Launcher — choose Screen 1 or Screen 2 |
| `/screen1` | Live dashboard + integrated spinners for **Device 1** |
| `/screen2` | Live dashboard + integrated spinners for **Device 2** |
| `/control` | Control panel — debug tools, data export, data wipe |

Each screen shows the same real-time timeline chart and leaderboard. The fortune wheel and super spin overlays appear on top when triggered, filtered to the screen's device.

---

## Directory Architecture

```
BarMotivator/
├── server.js                      # Entry point, orchestrates backend modules
├── wheel-config.json              # Fortune wheel field definitions & probabilities
├── superspin-config.json          # Super Spin field definitions & probabilities
├── categories.json                # Data category definitions
├── package.json                   # Dependencies (express, socket.io, sqlite3)
├── test-spinner.js                # Standalone probability test (1000 spins)
├── src/                           # Backend classes
│   ├── config/AppConfig.js        # Config loader
│   ├── database/Database.js       # SQLite wrapper
│   └── server/
│       ├── ApiServer.js           # Express routes & per-device spinner state
│       └── SignalingServer.js     # Socket.io / WebRTC signaling
├── public/                        # Static HTML and assets
│   ├── index.html                 # Launcher page (Screen 1 / Screen 2 buttons)
│   ├── screen1.html               # Dashboard for Device 1
│   ├── screen2.html               # Dashboard for Device 2
│   ├── control.html               # Control panel
│   ├── style.css                  # Shared styles
│   └── js/                        # Frontend ES6 modules
│       ├── main.js                # Dashboard bootstrap
│       ├── control.js             # Control panel controller
│       ├── spin.js                # Fortune wheel overlay
│       ├── superspin.js           # Super Spin overlay (slot machine)
│       ├── core/                  # Store, UIComponent base classes
│       ├── components/            # TimelineChart, Leaderboard
│       └── network/               # SocketClient, WebRTCManager
└── tests/                         # Jest + Supertest test suite
    ├── AppConfig.test.js
    ├── Database.test.js
    └── ApiServer.test.js
```

---

## Spinner Architecture

Both the **Fortune Wheel** and the **Super Spin** are overlays rendered on top of the dashboard. They are not separate pages.

### Per-Device Independence

Spinners are scoped to a **device ID** (`?device=1` or `?device=2`). Each device has its own independent state slot on the server:

- **Device 1 and Device 2 can spin simultaneously** (fully independent)
- **Within a device**, the fortune wheel and super spin are mutually exclusive — starting one blocks the other for the same device
- Screen 1 polls and reacts only to device 1 events; Screen 2 only to device 2

### State Machine (both spinners)

```
idle → spinning → stopping → (result display 7s) → idle
```

Auto-stop fires after **10 seconds** if `/stop` is not called.

---

## API Reference

### Data Endpoints

#### Log a New Entry

**`GET /log`**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `Bier` | integer | yes | Beer counter |
| `Cocktail` | integer | yes | Cocktail counter |
| `Shot` | integer | yes | Shot counter |
| `category` | string | yes | Must match a category in `categories.json` |
| `timestamp` | string | no | Custom timestamp (`2026-03-09T08:00:00`). Requires Debug Mode. |

```bash
curl "http://localhost:3000/log?Bier=1&Cocktail=2&Shot=3&category=alpha"
```

Returns `OK` (200) or `ERROR` (400).

---

#### Fetch All Historical Data

**`GET /api/data`**

Returns `{ categories, entries }`. Used internally on page load.

---

#### Export Data as CSV

**`GET /api/export-csv`**

Downloads all database entries as a CSV file with columns:
`id, timestamp, category, Bier, Cocktail, Shot, weighted_sum`

```bash
curl "http://localhost:3000/api/export-csv" -o export.csv
```

---

#### Clear All Data

**`POST /api/clear`**

Permanently deletes all entries. Connected clients wipe their charts immediately via Socket.io.

```bash
curl -X POST "http://localhost:3000/api/clear"
```

Returns `{ "status": "ok" }`.

---

#### Toggle Debug Mode

**`POST /api/debug`**

Enables/disables debug mode (custom timestamps, stress testing tools).

```bash
curl -X POST -H 'Content-Type: application/json' -d '{"debug":true}' http://localhost:3000/api/debug
```

Returns `{ "debug": true }`.

---

### Fortune Wheel API

The fortune wheel appears as an overlay on the dashboard. All endpoints require `?device=<integer>`.

#### Get Wheel Config

**`GET /api/spin/config`**

Returns `{ fields }` — label, color, probability, fireworks for each segment.

---

#### Get Wheel State

**`GET /api/spin/state?device=<id>`**

```json
{
  "status": "idle | spinning | stopping",
  "selectedFieldIndex": null,
  "spinStartedAt": null,
  "deviceId": 1
}
```

Returns `idle` state if no spin is active for the given device.

---

#### Start Spinning

**`GET /api/spin/start?device=<id>`**

Starts a new spin for the given device. Winning field is selected server-side via weighted random. A 10-second auto-stop timer activates.

**Blocked (HTTP 409) if:**
- A spin is already active for this device
- A super spin is already active for this device

```bash
curl "http://localhost:3000/api/spin/start?device=1"
```

```json
{ "status": "started", "fieldIndex": 3, "deviceId": 1 }
```

---

#### Stop Spinning

**`GET /api/spin/stop?device=<id>`**

Triggers deceleration to the pre-selected field. Only the device that started the spin can stop it.

```bash
curl "http://localhost:3000/api/spin/stop?device=1"
```

```json
{ "status": "stopping", "fieldIndex": 3, "deviceId": 1 }
```

---

#### Complete Result

**`GET /api/spin/complete?device=<id>`**

Called automatically by the browser after the 7-second result display. Resets the device's spin slot to idle.

---

### Super Spin API

The Super Spin is a slot-machine style single-column spinner. It uses the same two-step lifecycle as the fortune wheel.

#### Get Super Spin Config

**`GET /api/superspin/config`**

Returns `{ fields }` — same structure as `/api/spin/config`.

---

#### Get Super Spin State

**`GET /api/superspin/state?device=<id>`**

```json
{
  "status": "idle | spinning | stopping",
  "selectedFieldIndex": null,
  "spinStartedAt": null,
  "deviceId": 1
}
```

---

#### Start Super Spin

**`GET /api/superspin/start?device=<id>`**

Winning field is selected server-side. 10-second auto-stop activates.

**Blocked (HTTP 409) if:**
- A super spin is already active for this device
- A fortune wheel spin is already active for this device

```bash
curl "http://localhost:3000/api/superspin/start?device=1"
```

```json
{ "status": "started", "fieldIndex": 4, "deviceId": 1 }
```

---

#### Stop Super Spin

**`GET /api/superspin/stop?device=<id>`**

Decelerates the reel to the pre-selected field.

```bash
curl "http://localhost:3000/api/superspin/stop?device=1"
```

```json
{ "status": "stopping", "fieldIndex": 4, "deviceId": 1 }
```

---

#### Complete Super Spin Result

**`GET /api/superspin/complete?device=<id>`**

Called automatically by the browser after the 7-second result display.

---

#### Typical Spinner Flow (both spinners)

```bash
# 1. Start spinning
curl "http://localhost:3000/api/spin/start?device=1"
# or
curl "http://localhost:3000/api/superspin/start?device=1"

# 2. Stop at any time (auto-stops after 10s if not called)
curl "http://localhost:3000/api/spin/stop?device=1"
# or
curl "http://localhost:3000/api/superspin/stop?device=1"

# 3. Browser shows result for 7s, then auto-calls /complete
```

---

## Wheel & Super Spin Configuration

Both spinners are configured via JSON files. Each field has:

| Key | Type | Description |
|-----|------|-------------|
| `label` | string | Display text |
| `color` | hex string | Segment/item color |
| `probability` | float | Relative probability (does not need to sum to 1.0) |
| `fireworks` | boolean | Whether to show fireworks on win |

**Note:** All fortune wheel segments have equal visual area, but different win probabilities — creating the illusion that some prizes are harder to win.

### Test Spinner Probabilities

```bash
node test-spinner.js
```

Runs 1000 simulated spins and reports actual vs. expected probabilities with a chi-square fairness test.

---

## Animation Details

### Fortune Wheel
- **Spinning:** ~3 rotations/second, countdown timer top-left
- **Stopping:** cubic ease-out deceleration over 5–7 seconds, 5–8 extra rotations for drama
- **Result:** prize label in large glowing text for 7 seconds, optional fireworks, then fly-out

### Super Spin
- **Spinning:** continuous vertical reel scroll with casino-style gold frame and blinking lights
- **Stopping:** ease-out deceleration ensuring the reel never accelerates on stop; guaranteed to decelerate from full speed
- **Result:** reel disappears, winner shown in large glowing text for 7 seconds, optional fireworks

Both overlays show a **10-second countdown** in the top-left corner during the spinning phase.

---

## Testing

```bash
npm test
```

Runs the Jest + Supertest suite covering `AppConfig`, `Database`, and `ApiServer`. Make sure the server is not already running when executing tests.
