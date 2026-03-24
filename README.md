# Rattenfest 2026 - Live Dashboard

A real-time dashboard and timeline charting application built with Node.js, Express, Socket.io, WebRTC, and HTML5 Canvas.

## Setup and Running

1. **Install Dependencies**
   Navigate to the project directory and run:
   ```bash
   npm install
   ```
   This will install `express`, `socket.io`, and `sqlite3` as defined in `package.json`.

2. **Start the Server**
   ```bash
   node server.js
   ```
   The server will run on `http://localhost:3000` by default.

## Application Interfaces

- **Live Dashboard**: [http://localhost:3000](http://localhost:3000) – Real-time timeline chart and leaderboard
- **Control Panel**: [http://localhost:3000/control](http://localhost:3000/control) – Debug tools and data management
- **Fortune Wheel**: [http://localhost:3000/spin](http://localhost:3000/spin) – Standalone fortune wheel (also integrated into dashboard)
- **Super Spin**: [http://localhost:3000/superspin](http://localhost:3000/superspin) – Slot-machine style single-column spinner

## Directory Architecture
The platform is built on fully-modular, DRY principles across both the Node.js backend and the browser frontend:

```
BarMotivator/
├── server.js                      # Entry point, orchestrates backend modules
├── wheel-config.json              # Fortune wheel field definitions & probabilities
├── superspin-config.json          # Super Spin field definitions & probabilities
├── categories.json                # Data category definitions
├── package.json                   # Dependencies (express, socket.io, sqlite3)
├── src/                           # Backend Classes
│   ├── config/AppConfig.js        # Config loader
│   ├── database/Database.js       # SQLite wrapper
│   └── server/
│       ├── ApiServer.js           # Express API endpoints & wheel state management
│       └── SignalingServer.js     # Socket.io/WebRTC endpoints
├── public/                        # Static HTML and Assets
│   ├── index.html                 # Live Dashboard (with integrated wheel overlay)
│   ├── control.html               # Control Panel
│   ├── spin.html                  # Standalone Fortune Wheel page
│   ├── superspin.html             # Super Spin page (slot machine)
│   ├── style.css                  # Shared styles (dashboard + wheel)
│   └── js/                        # Frontend ES6 Modules
│       ├── main.js                # Dashboard controller
│       ├── control.js             # Control Panel controller
│       ├── spin.js                # Fortune wheel app (overlay mode)
│       ├── superspin.js           # Super Spin app (slot machine)
│       ├── core/                  # Base classes (Store, UIComponent)
│       ├── components/            # UI subclasses (TimelineChart, Leaderboard)
│       └── network/               # SocketClient, WebRTCManager
└── tests/                         # Test Suite (Jest + Supertest)
    ├── AppConfig.test.js
    ├── Database.test.js
    └── ApiServer.test.js
```

## API Reference


### 1. Log a New Entry

Use the `/log` endpoint to insert new data into the timeline. 

**Endpoint:** `GET /log`

**Parameters:**
- `Bier` (integer) - Value for the first counter.
- `Cocktail` (integer) - Value for the second counter.
- `Shot` (integer) - Value for the third counter.
- `category` (string) - Must match one of the categories defined in `categories.json` (e.g., `alpha`, `beta`, `gamma`).
- `timestamp` (string, optional) - Custom timeline timestamp (e.g. `2026-03-09T08:00:00`). **Requires Debug Mode to be active**.

**Example Request:**
```bash
curl "http://localhost:3000/log?Bier=1&Cocktail=2&Shot=3&category=alpha"
```
**Success Response:** `OK` (HTTP 200)
**Error Response:** `ERROR` (HTTP 400) if parameters are missing/invalid or the category is unknown.

### 2. Fetch All Historical Data

This endpoint is used internally by the client to load the initial dataset on boot.

**Endpoint:** `GET /api/data`

**Returns:** A JSON object containing the `categories` and an array of previously logged `entries`.

### 3. Clear All Data

This endpoint permanently deletes all entries from the SQLite database. Connected clients will immediately wipe their charts via Socket.io/WebRTC syncing.

**Endpoint:** `POST /api/clear`

**Example Request:**
```bash
curl -X POST "http://localhost:3000/api/clear"
```
**Returns:** `{"status": "ok"}`

### 4. Toggle Debug Mode

Enables or disables "Debug Mode", which allows custom timestamps to be injected via `/log`, and unlocks the speed-up stress testing tools in the `/control` panel.

**Endpoint:** `POST /api/debug`

**Example Request:**
```bash
curl -X POST -H 'Content-Type: application/json' -d '{"debug":true}' http://localhost:3000/api/debug
```
**Returns:** `{"debug": true}`

---

## Fortune Wheel API

The fortune wheel is an interactive overlay that appears on the dashboard. Control it via these endpoints.

### 5. Get Wheel Configuration

Fetch the wheel field definitions, colors, probabilities, and fireworks settings.

**Endpoint:** `GET /api/spin/config`

**Returns:** JSON object with `fields` array containing:
```json
{
  "fields": [
    { "label": "$1000", "color": "#e53e3e", "probability": 0.03, "fireworks": true },
    { "label": "$900", "color": "#dd6b20", "probability": 0.05, "fireworks": true },
    ...
  ]
}
```

### 6. Get Current Wheel State

Poll this endpoint to track the wheel's status and properties. Clients poll every ~200ms to sync state changes.

**Endpoint:** `GET /api/spin/state`

**Returns:** JSON object with current state:
```json
{
  "status": "idle | spinning | stopping",
  "selectedFieldIndex": null | 0-9,
  "spinStartedAt": null | <unix-ms-timestamp>,
  "deviceId": null | <integer>
}
```

**Status values:**
- `idle` – Wheel is at rest, ready to spin
- `spinning` – Wheel is actively spinning (10-second countdown active)
- `stopping` – Wheel is decelerating to land on target field

### 7. Start Spinning

Begin a new spin. Only allowed when status is `idle`. A winning field is selected via weighted random, and a 10-second auto-stop timer is activated.

**Endpoint:** `GET /api/spin/start`

**Query Parameters:**
- `device` (integer, optional) – Device ID that triggered the spin (e.g., `?device=1`). Enables device-locking for stop.

**Example Requests:**
```bash
# Start without device tracking
curl "http://localhost:3000/api/spin/start"

# Start with device ID (enables device-locking)
curl "http://localhost:3000/api/spin/start?device=1"
```

**Success Response (HTTP 200):**
```json
{ "status": "started", "fieldIndex": 3, "deviceId": 1 }
```

**Error Response (HTTP 409):**
```json
{ "error": "Wheel is not idle", "status": "spinning" }
```

### 8. Stop Spinning

Stop the wheel at the pre-selected field. Only allowed while status is `spinning`. Triggers smooth deceleration animation.

**Endpoint:** `GET /api/spin/stop`

**Query Parameters:**
- `device` (integer, optional) – Device ID stopping the spin. Must match the device that started it (if device-locking is active).

**Device-Locking Rules:**
- If spin started **with** device ID (e.g., `device=1`), stop **must** provide the same device ID
- If spin started **without** device ID, stop can be called with or without a device ID
- Mismatched device IDs return **HTTP 403 Forbidden**

**Example Requests:**
```bash
# Stop without device (allowed if started without device)
curl "http://localhost:3000/api/spin/stop"

# Stop with device (must match start device if device-locking is active)
curl "http://localhost:3000/api/spin/stop?device=1"
```

**Success Response (HTTP 200):**
```json
{ "status": "stopping", "fieldIndex": 3, "stopDeviceId": 1 }
```

**Device-Lock Violation (HTTP 403):**
```json
{
  "error": "Only the device that started the spin can stop it",
  "requiredDeviceId": 1,
  "attemptedDeviceId": 2
}
```

**Not Spinning Error (HTTP 409):**
```json
{ "error": "Wheel is not spinning", "status": "idle" }
```

### 9. Complete Result Display

Called by the browser after showing the result for 7 seconds. Resets the wheel to `idle` state.

**Endpoint:** `GET /api/spin/complete`

**Returns:**
```json
{ "status": "idle" }
```

---

## HTML Page Routes

### 10. Live Dashboard

Serves the main dashboard with real-time timeline chart and leaderboard, with integrated fortune wheel overlay.

**Endpoint:** `GET /`

**Returns:** HTML page

### 11. Control Panel

Serves the debug/control panel for testing and data management.

**Endpoint:** `GET /control`

**Returns:** HTML page

### 12. Fortune Wheel (Standalone)

Serves the fortune wheel as a standalone full-screen page (also available as overlay in dashboard).

**Endpoint:** `GET /spin`

**Returns:** HTML page

### 13. Super Spin (Standalone)

Serves the slot-machine spinner as a standalone full-screen page.

**Endpoint:** `GET /superspin`

**Returns:** HTML page

---

## Super Spin API

The Super Spin is a slot-machine style single-column spinner. It has a four-step lifecycle controlled via GET endpoints.

**State machine:** `idle` → `enabled` → `spinning` → `stopping` → *(showdown)* → `idle`

The purpose is for the fog screen:

1. Press Buzzer
2. engage fogscreen
3. enable spinner
4. Press Buzzer to stop spinner
5. Showdown
6. Clear spinner
7. Clear Fog

### Super Spin: Enable

Makes the reel appear on screen. Winning field is selected at this point.
Only allowed when status is `idle`.

**Endpoint:** `GET /api/superspin/enable`

**Query Parameters:**
- `device` (integer, optional) – Device ID (enables device-locking for start/stop).

**Success Response (HTTP 200):**
```json
{ "status": "enabled", "fieldIndex": 4, "deviceId": null }
```

### Super Spin: Start

Starts the reel scrolling. Only allowed when status is `enabled`.

**Endpoint:** `GET /api/superspin/start`

**Query Parameters:**
- `device` (integer, optional) – Must match the device that called enable (if device-locking is active).

**Success Response (HTTP 200):**
```json
{ "status": "started", "fieldIndex": 4, "deviceId": null }
```

### Super Spin: Stop

Decelerates the reel to the pre-selected winning field. Only allowed when status is `spinning`.
A 10-second auto-stop also triggers automatically if this endpoint is not called.

**Endpoint:** `GET /api/superspin/stop`

**Query Parameters:**
- `device` (integer, optional) – Must match the device that called enable (if device-locking is active).

**Success Response (HTTP 200):**
```json
{ "status": "stopping", "fieldIndex": 4, "stopDeviceId": null }
```

### Super Spin: State

Poll this endpoint to track current status. Clients poll every ~200ms.

**Endpoint:** `GET /api/superspin/state`

**Returns:**
```json
{
  "status": "idle | enabled | spinning | stopping",
  "selectedFieldIndex": null | 0-9,
  "spinStartedAt": null | <unix-ms-timestamp>,
  "deviceId": null | <integer>
}
```

### Super Spin: Complete

Called automatically by the browser after the 7-second result display. Resets to `idle`.

**Endpoint:** `GET /api/superspin/complete`

**Returns:** `{ "status": "idle" }`

### Super Spin: Config

Returns field definitions for the slot machine.

**Endpoint:** `GET /api/superspin/config`

**Returns:** JSON with `fields` array (same structure as `/api/spin/config`).

### Example Flow
```bash
# 1. Show the reel
curl "http://localhost:3000/api/superspin/enable"

# 2. Start spinning
curl "http://localhost:3000/api/superspin/start"

# 3. Stop (at any time; auto-stops after 10s if not called)
curl "http://localhost:3000/api/superspin/stop"
# → browser decelerates, shows winner, then auto-calls /complete
```

---

## Fortune Wheel Configuration

The wheel is defined in `wheel-config.json`. Each field has:

- **label** – Display text (e.g., "$1000")
- **color** – Hex color code
- **probability** – Decimal probability (0.0 to 1.0) of landing on this field
- **fireworks** – Boolean whether to show fireworks animation on win

**Visual vs. Probability:**
- All segments have **equal visual area** on the wheel (same angle)
- But segments have **different probabilities** of being selected
- This creates the appearance that some prizes are "harder to win"

**Example from wheel-config.json:**
```json
{
  "fields": [
    { "label": "$1000", "color": "#e53e3e", "probability": 0.03, "fireworks": true },
    { "label": "$900", "color": "#dd6b20", "probability": 0.05, "fireworks": true },
    { "label": "$100", "color": "#319795", "probability": 0.15, "fireworks": false }
  ]
}
```

The probabilities don't need to sum to exactly 1.0; the system normalizes them internally.

---

## Wheel Animation Details

### Spinning Phase
- Constant rotation at ~3 rotations/second
- Countdown timer shows remaining seconds until auto-stop
- Countdown starts at 10 seconds and counts down
- Auto-stop triggers if `/api/spin/stop` is not called within 10 seconds

### Stopping Phase
- Realistic **cubic ease-out deceleration** (spring physics)
- Wheel decelerates smoothly over 5–7 seconds
- Landing field is pre-selected server-side at spin start
- Pointer at top of wheel aligns with winning field segment
- 5–8 extra full rotations added for visual drama

### Result Display
- Prize label shown in large, glowing text for 7 seconds
- Fireworks animation (if enabled for that field)
- Result overlay fades out smoothly
- Wheel overlay collapses and disappears (fly-out animation)
- Dashboard returns to normal

### Device Tracking
- Each wheel spin can be associated with a device ID (e.g., phone #1, phone #2)
- Device badge shows in top-right corner during spin
- Only the device that started the spin can stop it (device-locking)
- Useful for multi-player/multi-device bar events

---

## Testing

The project includes a comprehensive test suite using **Jest** and **Supertest**.

### Prerequisites

The dev dependencies are already listed in `package.json` under `devDependencies`. Ensure they are installed:

```bash
npm install
```

### Running the Tests

```bash
npm test
```

This will execute all unit tests located in the `tests/` directory.

### Test Coverage

The tests cover:

- `AppConfig` – configuration loading
- `Database` – SQLite wrapper functionality
- `ApiServer` – Express API endpoints

Make sure the server is not running when you execute the tests, as they start an isolated instance.
