const express = require('express');
const path = require('path');
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

        // HTML Panel Routes
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
        });

        this.app.get('/control', (req, res) => {
            res.sendFile(path.join(__dirname, '..', '..', 'public', 'control.html'));
        });
    }

    getApp() {
        return this.app;
    }
}

module.exports = ApiServer;
