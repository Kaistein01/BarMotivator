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
});
