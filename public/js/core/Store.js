/**
 * Centralized Store for managing application state.
 */
export class Store {
    constructor() {
        this.state = {
            categories: [],
            entries: [],
            totals: {},
            isDebugMode: false
        };
        this.listeners = [];
    }

    subscribe(listener) {
        this.listeners.push(listener);
    }

    notify() {
        this.listeners.forEach(listener => listener(this.state));
    }

    setInitialData(categories, entries) {
        this.state.categories = categories || [];
        this.state.entries = entries || [];
        this.recalculateTotals();
        this.notify();
    }

    addEntry(entry) {
        this.state.entries.push(entry);
        this.state.totals[entry.category] += entry.weighted_sum;
        this.notify();
    }

    clearEntries() {
        this.state.entries = [];
        this.recalculateTotals();
        this.notify();
    }

    setDebugMode(isDebug) {
        this.state.isDebugMode = isDebug;
        this.notify();
    }

    mergeSyncEntries(newEntries) {
        const existingMap = new Map();
        this.state.entries.forEach(e => existingMap.set(e.timestamp + e.category, e));

        let modified = false;
        newEntries.forEach(e => {
            const key = e.timestamp + e.category;
            if (!existingMap.has(key)) {
                this.state.entries.push(e);
                modified = true;
            }
        });

        if (modified) {
            this.state.entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            this.recalculateTotals();
            this.notify();
        }
        return modified;
    }

    recalculateTotals() {
        this.state.totals = {};
        this.state.categories.forEach(c => this.state.totals[c.name] = 0);
        this.state.entries.forEach(e => {
            this.state.totals[e.category] = (this.state.totals[e.category] || 0) + e.weighted_sum;
        });
    }

    getState() {
        return this.state;
    }
}
