const express = require('express');
const path = require('path');
const fs = require('fs');
const AppConfig = require('../config/AppConfig');

/**
 * ApiServer acts as the Express controller handling all URL routing.
 */
class ApiServer {
    constructor(database, signalingServer) {
        this.db = database;
        this.signaling = signalingServer;
        this.app = express();

        this.isDebugMode = false;

        // Load wheel configuration
        const wheelConfigPath = path.join(__dirname, '..', '..', 'wheel-config.json');
        this.wheelFields = JSON.parse(fs.readFileSync(wheelConfigPath, 'utf-8')).fields;

        // Load superspin configuration
        const superspinConfigPath = path.join(__dirname, '..', '..', 'superspin-config.json');
        this.superspinFields = JSON.parse(fs.readFileSync(superspinConfigPath, 'utf-8')).fields;

        // Per-device state maps: key = deviceId (integer), value = state object
        // Each device has its own independent spin and superspin slot.
        // Spin and superspin for the *same* device are mutually exclusive.
        this.wheelStates = {};    // { [deviceId]: { status, selectedFieldIndex, spinStartedAt, autoStopTimer } }
        this.superspinStates = {}; // { [deviceId]: { status, selectedFieldIndex, spinStartedAt, autoStopTimer } }

        this._configureMiddleware();
        this._configureRoutes();
    }

    _configureMiddleware() {
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname, '..', '..', 'public')));
    }

    _configureRoutes() {
        const validCategoryNames = AppConfig.getValidCategoryNames();
        const categoriesInfo = AppConfig.getCategories();

        // Data Insertion Route
        this.app.get('/log', async (req, res) => {
            const c1 = parseInt(req.query.Bier, 10);
            const c2 = parseInt(req.query.Cocktail, 10);
            const c3 = parseInt(req.query.Shot, 10);
            const category = req.query.category || '';

            if (isNaN(c1) || isNaN(c2) || isNaN(c3) || !validCategoryNames.has(category)) {
                return res.status(400).send('ERROR');
            }

            let isoString;

            // Allow custom timestamps if debug mode is enabled
            if (this.isDebugMode && req.query.timestamp) {
                isoString = req.query.timestamp;
            } else {
                // YYYY-MM-DDTHH:mm:ss format in local time
                const now = new Date();
                const tzoffset = now.getTimezoneOffset() * 60000;
                const localNow = new Date(now.getTime() - tzoffset);
                isoString = localNow.toISOString().split('.')[0];
            }

            try {
                const weightedSum = await this.db.insertEntry(isoString, category, c1, c2, c3);

                const newEntry = { timestamp: isoString, category, weighted_sum: weightedSum };
                // Broadcast new entry to all connected clients
                this.signaling.broadcastNewEntry(newEntry);

                res.status(200).send('OK');
            } catch (err) {
                console.error(err);
                res.status(500).send('DB ERROR');
            }
        });

        // Historical Data Route
        this.app.get('/api/data', async (_req, res) => {
            try {
                const entries = await this.db.getAllEntries();
                res.json({ categories: categoriesInfo, entries });
            } catch (err) {
                console.error('Error fetching entries:', err);
                res.status(500).json({ error: 'Database error' });
            }
        });

        // Dashboard Clear Route
        this.app.post('/api/clear', async (_req, res) => {
            try {
                await this.db.clearEntries();
                this.signaling.broadcastClear();
                res.json({ status: 'ok' });
            } catch (err) {
                console.error('Error clearing entries:', err);
                res.status(500).json({ error: 'Database error' });
            }
        });

        // Export Data as CSV Route
        this.app.get('/api/export-csv', async (_req, res) => {
            try {
                const entries = await this.db.getAllEntriesWithAll();
                const csv = this._convertToCSV(entries);
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', 'attachment; filename="export.csv"');
                res.send(csv);
            } catch (err) {
                console.error('Error exporting data:', err);
                res.status(500).json({ error: 'Export error' });
            }
        });

        // Debug Toggle Routes
        this.app.get('/api/debug', (_req, res) => {
            res.json({ debug: this.isDebugMode });
        });

        this.app.post('/api/debug', (req, res) => {
            this.isDebugMode = !!req.body.debug;
            this.signaling.broadcastDebugState(this.isDebugMode);
            res.json({ debug: this.isDebugMode });
        });

        // ── Spin Wheel Routes ─────────────────────────────────────────────────

        // Wheel config (fields without sensitive data)
        this.app.get('/api/spin/config', (_req, res) => {
            res.json({ fields: this.wheelFields });
        });

        // Current wheel state for a device (polled by the browser)
        // ?device=<integer> – returns idle state if device has no active spin
        this.app.get('/api/spin/state', (req, res) => {
            const dId = this._parseDevice(req);
            const state = this.wheelStates[dId] || { status: 'idle', selectedFieldIndex: null, spinStartedAt: null };
            res.json({ status: state.status, selectedFieldIndex: state.selectedFieldIndex, spinStartedAt: state.spinStartedAt, deviceId: dId });
        });

        // Start spinning – per-device; blocked if superspin is active for same device
        this.app.get('/api/spin/start', (req, res) => {
            const dId = this._parseDevice(req);
            const ws = this.wheelStates[dId];
            if (ws && ws.status !== 'idle') {
                return res.status(409).json({ error: 'Wheel is not idle for this device', status: ws.status });
            }
            const ss = this.superspinStates[dId];
            if (ss && ss.status !== 'idle') {
                return res.status(409).json({ error: 'Superspin is active for this device', status: ss.status });
            }

            const fieldIndex = this._selectWeightedField();
            const state = { status: 'spinning', selectedFieldIndex: fieldIndex, spinStartedAt: Date.now(), autoStopTimer: null };
            state.autoStopTimer = setTimeout(() => {
                if (state.status === 'spinning') state.status = 'stopping';
            }, 10000);
            this.wheelStates[dId] = state;

            res.json({ status: 'started', fieldIndex, deviceId: dId });
        });

        // Stop spinning – only the device that started can stop
        this.app.get('/api/spin/stop', (req, res) => {
            const dId = this._parseDevice(req);
            const state = this.wheelStates[dId];
            if (!state || state.status !== 'spinning') {
                return res.status(409).json({ error: 'Wheel is not spinning for this device' });
            }

            clearTimeout(state.autoStopTimer);
            state.autoStopTimer = null;
            state.status = 'stopping';

            res.json({ status: 'stopping', fieldIndex: state.selectedFieldIndex, deviceId: dId });
        });

        // Complete result display – browser calls this after showing result for 7 s
        this.app.get('/api/spin/complete', (req, res) => {
            const dId = this._parseDevice(req);
            const state = this.wheelStates[dId];
            if (state) {
                clearTimeout(state.autoStopTimer);
                delete this.wheelStates[dId];
            }
            res.json({ status: 'idle' });
        });

        // ── Super Spin Routes ─────────────────────────────────────────────────

        // Superspin config
        this.app.get('/api/superspin/config', (_req, res) => {
            res.json({ fields: this.superspinFields });
        });

        // Current superspin state for a device
        this.app.get('/api/superspin/state', (req, res) => {
            const dId = this._parseDevice(req);
            const state = this.superspinStates[dId] || { status: 'idle', selectedFieldIndex: null, spinStartedAt: null };
            res.json({ status: state.status, selectedFieldIndex: state.selectedFieldIndex, spinStartedAt: state.spinStartedAt, deviceId: dId });
        });

        // Start superspin – per-device; blocked if wheel is active for same device
        this.app.get('/api/superspin/start', (req, res) => {
            const dId = this._parseDevice(req);
            const ss = this.superspinStates[dId];
            if (ss && ss.status !== 'idle') {
                return res.status(409).json({ error: 'Superspin is not idle for this device', status: ss.status });
            }
            const ws = this.wheelStates[dId];
            if (ws && ws.status !== 'idle') {
                return res.status(409).json({ error: 'Wheel is active for this device', status: ws.status });
            }

            const fieldIndex = this._selectWeightedFieldFrom(this.superspinFields);
            const state = { status: 'spinning', selectedFieldIndex: fieldIndex, spinStartedAt: Date.now(), autoStopTimer: null };
            state.autoStopTimer = setTimeout(() => {
                if (state.status === 'spinning') state.status = 'stopping';
            }, 10000);
            this.superspinStates[dId] = state;

            res.json({ status: 'started', fieldIndex, deviceId: dId });
        });

        // Stop superspin
        this.app.get('/api/superspin/stop', (req, res) => {
            const dId = this._parseDevice(req);
            const state = this.superspinStates[dId];
            if (!state || state.status !== 'spinning') {
                return res.status(409).json({ error: 'Superspin is not spinning for this device' });
            }

            clearTimeout(state.autoStopTimer);
            state.autoStopTimer = null;
            state.status = 'stopping';

            res.json({ status: 'stopping', fieldIndex: state.selectedFieldIndex, deviceId: dId });
        });

        // Complete superspin result display
        this.app.get('/api/superspin/complete', (req, res) => {
            const dId = this._parseDevice(req);
            const state = this.superspinStates[dId];
            if (state) {
                clearTimeout(state.autoStopTimer);
                delete this.superspinStates[dId];
            }
            res.json({ status: 'idle' });
        });

        // ── HTML Panel Routes ─────────────────────────────────────────────────

        this.app.get('/', (_req, res) => {
            res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
        });

        this.app.get('/screen1', (_req, res) => {
            res.sendFile(path.join(__dirname, '..', '..', 'public', 'screen1.html'));
        });

        this.app.get('/screen2', (_req, res) => {
            res.sendFile(path.join(__dirname, '..', '..', 'public', 'screen2.html'));
        });

        this.app.get('/control', (_req, res) => {
            res.sendFile(path.join(__dirname, '..', '..', 'public', 'control.html'));
        });
    }

    /** Parse ?device=<int> query param; returns the integer or null */
    _parseDevice(req) {
        const v = parseInt(req.query.device, 10);
        return Number.isFinite(v) ? v : null;
    }

    /** Weighted random selection over wheel fields */
    _selectWeightedField() {
        return this._selectWeightedFieldFrom(this.wheelFields);
    }

    /** Weighted random selection from an arbitrary fields array */
    _selectWeightedFieldFrom(fields) {
        const total = fields.reduce((sum, f) => sum + (f.probability || 0), 0);
        let r = Math.random() * total;
        for (let i = 0; i < fields.length; i++) {
            r -= fields[i].probability || 0;
            if (r <= 0) return i;
        }
        return fields.length - 1;
    }

    /** Convert entries array to CSV format */
    _convertToCSV(entries) {
        if (!entries || entries.length === 0) {
            return 'id,timestamp,category,Bier,Cocktail,Shot,weighted_sum\n';
        }

        const headers = ['id', 'timestamp', 'category', 'Bier', 'Cocktail', 'Shot', 'weighted_sum'];
        const rows = entries.map(entry => [
            entry.id,
            entry.timestamp,
            entry.category,
            entry.Bier,
            entry.Cocktail,
            entry.Shot,
            entry.weighted_sum
        ].map(cell => {
            if (typeof cell === 'string' && cell.includes(',')) {
                return `"${cell.replace(/"/g, '""')}"`;
            }
            return cell;
        }).join(','));

        return headers.join(',') + '\n' + rows.join('\n');
    }

    getApp() {
        return this.app;
    }
}

module.exports = ApiServer;
