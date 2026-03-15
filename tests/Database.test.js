const Database = require('../src/database/Database');

describe('Database', () => {
    let db;

    beforeAll(async () => {
        // Use an in-memory SQLite database for testing, so we don't pollute logs.db
        db = new Database(':memory:');
        await db.init();
    });

    afterAll(async () => {
        if (db.db) {
            db.db.close();
        }
    });

    beforeEach(async () => {
        await db.clearEntries();
    });

    it('should successfully initialize tables', async () => {
        // Table should exist, inserting an entry should just work without 'no such table' error
        await expect(db.insertEntry('2026-03-09T10:00:00', 'alpha', 1, 1, 1)).resolves.toBe(4.5);
    });

    it('should correctly insert an entry and calculate its weighted sum', async () => {
        // weights: c1: 1.0, c2: 1.5, c3: 2.0
        // (2 * 1) + (3 * 1.5) + (1 * 2) = 2 + 4.5 + 2 = 8.5
        const weightedSum = await db.insertEntry('2026-03-09T10:05:00', 'beta', 2, 3, 1);
        expect(weightedSum).toBe(8.5);

        const entries = await db.getAllEntries();
        expect(entries.length).toBe(1);
        expect(entries[0].category).toBe('beta');
        expect(entries[0].weighted_sum).toBe(8.5);
    });

    it('should return all entries ordered by timestamp ascending', async () => {
        await db.insertEntry('2026-03-09T10:10:00', 'gamma', 0, 0, 0);
        await db.insertEntry('2026-03-09T10:05:00', 'alpha', 0, 0, 0);
        await db.insertEntry('2026-03-09T10:08:00', 'beta', 0, 0, 0);

        const entries = await db.getAllEntries();
        expect(entries.length).toBe(3);
        expect(entries[0].category).toBe('alpha');
        expect(entries[1].category).toBe('beta');
        expect(entries[2].category).toBe('gamma');
    });

    it('should successfully clear all entries', async () => {
        await db.insertEntry('2026-03-09T10:00:00', 'alpha', 1, 1, 1);
        await db.insertEntry('2026-03-09T10:05:00', 'beta', 2, 3, 1);

        let entries = await db.getAllEntries();
        expect(entries.length).toBe(2);

        await db.clearEntries();

        entries = await db.getAllEntries();
        expect(entries.length).toBe(0);
    });
});
