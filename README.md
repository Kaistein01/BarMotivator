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

- **Live Dashboard**: [http://localhost:3000](http://localhost:3000)
- **Control Panel**: [http://localhost:3000/control](http://localhost:3000/control) (Used to clear all timeline data)

## Directory Architecture
The platform is built on fully-modular, DRY principles across both the Node.js backend and the browser frontend:

```
Graph/
├── server.js                      # Entry point, orchestrates backend modules
├── src/                           # Backend Classes
│   ├── config/AppConfig.js        # Config loader
│   ├── database/Database.js       # SQLite wrapper
│   └── server/
│       ├── ApiServer.js           # Express API endpoints
│       └── SignalingServer.js     # Socket.io/WebRTC endpoints
└── public/                        # Static HTML and Assets
    └── js/                        # Frontend ES6 Modules
        ├── main.js                # Index controller
        ├── control.js             # Testing Panel controller
        ├── core/                  # Base classes (Store, UIComponent)
        ├── components/            # UI subclasses (TimelineChart, Leaderboard)
        └── network/               # SocketClient, WebRTCManager
```

## API Reference


### 1. Log a New Entry

Use the `/log` endpoint to insert new data into the timeline. 

**Endpoint:** `GET /log`

**Parameters:**
- `counter1` (integer) - Value for the first counter.
- `counter2` (integer) - Value for the second counter.
- `counter3` (integer) - Value for the third counter.
- `category` (string) - Must match one of the categories defined in `categories.json` (e.g., `alpha`, `beta`, `gamma`).
- `timestamp` (string, optional) - Custom timeline timestamp (e.g. `2026-03-09T08:00:00`). **Requires Debug Mode to be active**.

**Example Request:**
```bash
curl "http://localhost:3000/log?counter1=1&counter2=2&counter3=3&category=alpha"
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
