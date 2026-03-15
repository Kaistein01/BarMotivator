const request = require('supertest');
const express = require('express');
const AppConfig = require('../src/config/AppConfig');

// We mock the database and signaling so the API Server test is perfectly isolated
const mockDb = {
    insertEntry: jest.fn(),
    getAllEntries: jest.fn(),
    clearEntries: jest.fn()
};

const mockSignaling = {
    broadcastNewEntry: jest.fn(),
    broadcastClear: jest.fn(),
    broadcastDebugState: jest.fn()
};

const ApiServer = require('../src/server/ApiServer');

describe('ApiServer', () => {
    let api;
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        api = new ApiServer(mockDb, mockSignaling);
        app = api.getApp();
    });

    describe('GET /log', () => {
        it('should validate counter parameters and return 400 if missing or invalid', async () => {
            const res = await request(app).get('/log');
            expect(res.status).toBe(400);
            expect(res.text).toBe('ERROR');
        });

        it('should validate category and return 400 if unknown', async () => {
            const res = await request(app).get('/log?counter1=1&counter2=2&counter3=3&category=unknownCat');
            expect(res.status).toBe(400);
            expect(res.text).toBe('ERROR');
        });

        it('should successfully log a valid request, update cache, and broadcast', async () => {
            // Mock the DB insert to return a static weighted sum
            mockDb.insertEntry.mockResolvedValue(10.5);

            const res = await request(app).get('/log?counter1=1&counter2=2&counter3=3&category=alpha');

            expect(res.status).toBe(200);
            expect(res.text).toBe('OK');

            // Expect DB to be called
            expect(mockDb.insertEntry).toHaveBeenCalledTimes(1);

            // Expect Broadcast
            expect(mockSignaling.broadcastNewEntry).toHaveBeenCalledTimes(1);
            const broadcastedArg = mockSignaling.broadcastNewEntry.mock.calls[0][0];
            expect(broadcastedArg.category).toBe('alpha');
            expect(broadcastedArg.weighted_sum).toBe(10.5);
        });

        it('should ignore provided timestamps if debug mode is OFF and log normally', async () => {
            // debug mode is FALSE by default
            mockDb.insertEntry.mockResolvedValue(10.5);
            const res = await request(app).get('/log?counter1=1&counter2=2&counter3=3&category=alpha&timestamp=2026-03-09T10:00:00');
            expect(res.status).toBe(200);
            expect(res.text).toBe('OK');
        });

        it('should accept requests with provided timestamps if debug mode is ON', async () => {
            // enable debug mode
            api.isDebugMode = true;
            mockDb.insertEntry.mockResolvedValue(10.5);

            const res = await request(app).get('/log?counter1=1&counter2=2&counter3=3&category=alpha&timestamp=2026-03-09T10:00:00');
            expect(res.status).toBe(200);
            expect(mockDb.insertEntry).toHaveBeenCalledWith('2026-03-09T10:00:00', 'alpha', 1, 2, 3);
        });
    });

    describe('GET /api/data', () => {
        it('should return categories and entries from db', async () => {
            mockDb.getAllEntries.mockResolvedValue([{ category: 'alpha', weighted_sum: 5 }]);

            const res = await request(app).get('/api/data');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('categories');
            expect(res.body).toHaveProperty('entries');
            expect(res.body.entries.length).toBe(1);
            expect(res.body.entries[0].category).toBe('alpha');
        });
    });

    describe('POST /api/clear', () => {
        it('should clear the database, cache, and broadcast', async () => {
            const res = await request(app).post('/api/clear');
            expect(res.status).toBe(200);
            expect(res.body.status).toBe('ok');

            expect(mockDb.clearEntries).toHaveBeenCalledTimes(1);
            expect(mockSignaling.broadcastClear).toHaveBeenCalledTimes(1);
        });
    });

    describe('POST /api/debug', () => {
        it('should toggle debug mode and broadcast', async () => {
            const res = await request(app)
                .post('/api/debug')
                .send({ debug: true })
                .set('Content-Type', 'application/json');

            expect(res.status).toBe(200);
            expect(res.body.debug).toBe(true);
            expect(api.isDebugMode).toBe(true);
            expect(mockSignaling.broadcastDebugState).toHaveBeenCalledWith(true);
        });
    });

    describe('Spin wheel endpoints', () => {
        afterEach(() => {
            // Clean up any pending auto-stop timers
            if (api.wheelState.autoStopTimer) {
                clearTimeout(api.wheelState.autoStopTimer);
                api.wheelState.autoStopTimer = null;
            }
            api.wheelState.status = 'idle';
            api.wheelState.selectedFieldIndex = null;
            api.wheelState.spinStartedAt = null;
        });

        describe('GET /api/spin/config', () => {
            it('should return wheel fields', async () => {
                const res = await request(app).get('/api/spin/config');
                expect(res.status).toBe(200);
                expect(res.body).toHaveProperty('fields');
                expect(Array.isArray(res.body.fields)).toBe(true);
                expect(res.body.fields.length).toBeGreaterThan(0);
                expect(res.body.fields[0]).toHaveProperty('label');
                expect(res.body.fields[0]).toHaveProperty('color');
                expect(res.body.fields[0]).toHaveProperty('probability');
                expect(res.body.fields[0]).toHaveProperty('fireworks');
            });
        });

        describe('GET /api/spin/state', () => {
            it('should return idle state initially', async () => {
                const res = await request(app).get('/api/spin/state');
                expect(res.status).toBe(200);
                expect(res.body.status).toBe('idle');
            });
        });

        describe('GET /api/spin/start', () => {
            it('should start spinning from idle and return started status', async () => {
                const res = await request(app).get('/api/spin/start');
                expect(res.status).toBe(200);
                expect(res.body.status).toBe('started');
                expect(typeof res.body.fieldIndex).toBe('number');
                expect(api.wheelState.status).toBe('spinning');
                expect(api.wheelState.spinStartedAt).toBeTruthy();
            });

            it('should return 409 when already spinning', async () => {
                await request(app).get('/api/spin/start');
                const res = await request(app).get('/api/spin/start');
                expect(res.status).toBe(409);
            });

            it('should select a valid field index', async () => {
                const res = await request(app).get('/api/spin/start');
                expect(res.body.fieldIndex).toBeGreaterThanOrEqual(0);
                expect(res.body.fieldIndex).toBeLessThan(api.wheelFields.length);
            });
        });

        describe('GET /api/spin/stop', () => {
            it('should transition to stopping when spinning', async () => {
                await request(app).get('/api/spin/start');
                const res = await request(app).get('/api/spin/stop');
                expect(res.status).toBe(200);
                expect(res.body.status).toBe('stopping');
                expect(typeof res.body.fieldIndex).toBe('number');
                expect(api.wheelState.status).toBe('stopping');
            });

            it('should return 409 when not spinning', async () => {
                const res = await request(app).get('/api/spin/stop');
                expect(res.status).toBe(409);
            });

            it('should not be callable twice', async () => {
                await request(app).get('/api/spin/start');
                await request(app).get('/api/spin/stop');
                const res = await request(app).get('/api/spin/stop');
                expect(res.status).toBe(409);
            });
        });

        describe('GET /api/spin/complete', () => {
            it('should reset state to idle', async () => {
                await request(app).get('/api/spin/start');
                await request(app).get('/api/spin/stop');
                const res = await request(app).get('/api/spin/complete');
                expect(res.status).toBe(200);
                expect(res.body.status).toBe('idle');
                expect(api.wheelState.status).toBe('idle');
                expect(api.wheelState.selectedFieldIndex).toBeNull();
            });
        });

        describe('Full spin cycle', () => {
            it('should go start → state shows spinning → stop → complete → state idle', async () => {
                await request(app).get('/api/spin/start');

                let stateRes = await request(app).get('/api/spin/state');
                expect(stateRes.body.status).toBe('spinning');
                expect(stateRes.body.spinStartedAt).toBeTruthy();

                await request(app).get('/api/spin/stop');

                stateRes = await request(app).get('/api/spin/state');
                expect(stateRes.body.status).toBe('stopping');
                expect(typeof stateRes.body.selectedFieldIndex).toBe('number');

                await request(app).get('/api/spin/complete');

                stateRes = await request(app).get('/api/spin/state');
                expect(stateRes.body.status).toBe('idle');
            });
        });
    });
});
