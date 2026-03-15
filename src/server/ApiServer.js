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

        // Wheel spin state machine
        this.wheelState = {
            status: 'idle',        // 'idle' | 'spinning' | 'stopping'
            selectedFieldIndex: null,
            spinStartedAt: null,   // Date.now() when spin started
            autoStopTimer: null
        };

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
            const c1 = parseInt(req.query.counter1, 10);
            const c2 = parseInt(req.query.counter2, 10);
            const c3 = parseInt(req.query.counter3, 10);
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
        this.app.get('/api/data', async (req, res) => {
            try {
                const entries = await this.db.getAllEntries();
                res.json({ categories: categoriesInfo, entries });
            } catch (err) {
                console.error('Error fetching entries:', err);
                res.status(500).json({ error: 'Database error' });
            }
        });

        // Dashboard Clear Route
        this.app.post('/api/clear', async (req, res) => {
            try {
                await this.db.clearEntries();
                this.signaling.broadcastClear();
                res.json({ status: 'ok' });
            } catch (err) {
                console.error('Error clearing entries:', err);
                res.status(500).json({ error: 'Database error' });
            }
        });

        // Debug Toggle Routes
        this.app.get('/api/debug', (req, res) => {
            res.json({ debug: this.isDebugMode });
        });

        this.app.post('/api/debug', (req, res) => {
            this.isDebugMode = !!req.body.debug;
            this.signaling.broadcastDebugState(this.isDebugMode);
            res.json({ debug: this.isDebugMode });
        });

        // ── Spin Wheel Routes ─────────────────────────────────────────────────

        // Serve spin page
        this.app.get('/spin', (_req, res) => {
            res.sendFile(path.join(__dirname, '..', '..', 'public', 'spin.html'));
        });

        // Wheel config (fields without sensitive data)
        this.app.get('/api/spin/config', (_req, res) => {
            res.json({ fields: this.wheelFields });
        });

        // Current wheel state (polled by the browser)
        this.app.get('/api/spin/state', (_req, res) => {
            const { status, selectedFieldIndex, spinStartedAt } = this.wheelState;
            res.json({ status, selectedFieldIndex, spinStartedAt });
        });

        // Start spinning – only allowed when idle
        this.app.get('/api/spin/start', (_req, res) => {
            if (this.wheelState.status !== 'idle') {
                return res.status(409).json({ error: 'Wheel is not idle', status: this.wheelState.status });
            }

            const fieldIndex = this._selectWeightedField();
            this.wheelState.status = 'spinning';
            this.wheelState.selectedFieldIndex = fieldIndex;
            this.wheelState.spinStartedAt = Date.now();

            // Auto-stop after AUTO_STOP_SECONDS if stop is not called
            const AUTO_STOP_MS = 10000;
            this.wheelState.autoStopTimer = setTimeout(() => {
                if (this.wheelState.status === 'spinning') {
                    this.wheelState.status = 'stopping';
                }
            }, AUTO_STOP_MS);

            res.json({ status: 'started', fieldIndex });
        });

        // Stop spinning – only allowed while spinning
        this.app.get('/api/spin/stop', (_req, res) => {
            if (this.wheelState.status !== 'spinning') {
                return res.status(409).json({ error: 'Wheel is not spinning', status: this.wheelState.status });
            }

            clearTimeout(this.wheelState.autoStopTimer);
            this.wheelState.autoStopTimer = null;
            this.wheelState.status = 'stopping';

            res.json({ status: 'stopping', fieldIndex: this.wheelState.selectedFieldIndex });
        });

        // Complete result display – browser calls this after showing result for 7 s
        this.app.get('/api/spin/complete', (_req, res) => {
            clearTimeout(this.wheelState.autoStopTimer);
            this.wheelState.autoStopTimer = null;
            this.wheelState.status = 'idle';
            this.wheelState.selectedFieldIndex = null;
            this.wheelState.spinStartedAt = null;
            res.json({ status: 'idle' });
        });

        // ── HTML Panel Routes ─────────────────────────────────────────────────

        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
        });

        this.app.get('/control', (req, res) => {
            res.sendFile(path.join(__dirname, '..', '..', 'public', 'control.html'));
        });
    }

    /** Weighted random selection over wheel fields */
    _selectWeightedField() {
        const fields = this.wheelFields;
        const total = fields.reduce((sum, f) => sum + (f.probability || 0), 0);
        let r = Math.random() * total;
        for (let i = 0; i < fields.length; i++) {
            r -= fields[i].probability || 0;
            if (r <= 0) return i;
        }
        return fields.length - 1;
    }

    getApp() {
        return this.app;
    }
}

module.exports = ApiServer;
