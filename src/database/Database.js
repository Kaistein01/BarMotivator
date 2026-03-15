const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
    constructor(dbFilename = 'logs.db') {
        this.dbPath = path.join(__dirname, '..', '..', dbFilename);
        this.db = new sqlite3.Database(this.dbPath);
        this.weights = { c1: 1.0, c2: 1.5, c3: 2.0 };
    }

    async init() {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS entries (
                        id           INTEGER PRIMARY KEY AUTOINCREMENT,
                        timestamp    TEXT    NOT NULL,
                        category     TEXT    NOT NULL,
                        Bier     INTEGER NOT NULL,
                        Cocktail     INTEGER NOT NULL,
                        Shot     INTEGER NOT NULL,
                        weighted_sum REAL    NOT NULL
                    )
                `, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });
    }

    async insertEntry(timestamp, category, c1, c2, c3) {
        return new Promise((resolve, reject) => {
            const weightedSum = c1 * this.weights.c1 + c2 * this.weights.c2 + c3 * this.weights.c3;
            this.db.run(
                `INSERT INTO entries (timestamp, category, Bier, Cocktail, Shot, weighted_sum) VALUES (?, ?, ?, ?, ?, ?)`,
                [timestamp, category, c1, c2, c3, weightedSum],
                function (err) {
                    if (err) reject(err);
                    else resolve(weightedSum);
                }
            );
        });
    }

    async getAllEntries() {
        return new Promise((resolve, reject) => {
            this.db.all(`SELECT timestamp, category, weighted_sum FROM entries ORDER BY timestamp ASC`, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async clearEntries() {
        return new Promise((resolve, reject) => {
            this.db.run(`DELETE FROM entries`, [], function (err) {
                if (err) reject(err);
                else resolve();
            });
        });
    }
}

module.exports = Database;
