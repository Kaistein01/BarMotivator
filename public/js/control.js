import { TimeUtils } from './utils/TimeUtils.js';

/**
 * Controller class for the dashboard control panel.
 */
class ControlPanel {
    constructor() {
        this.isDebugActive = false;

        this.btnToggleDebug = document.getElementById('debug-toggle-btn');
        this.btnClear = document.getElementById('clear-btn');
        this.testingTools = document.getElementById('testing-tools');
        this.statusInfo = document.getElementById('status');
        this.inputSamples = document.getElementById('test-samples');
        this.inputHours = document.getElementById('test-hours');
        this.btnCustomTest = document.getElementById('test-custom-btn');

        this._bindEvents();
        this._checkDebug();
    }

    _bindEvents() {
        this.btnClear.addEventListener('click', () => this.clearData());
        this.btnToggleDebug.addEventListener('click', () => this.toggleDebug());
        this.btnCustomTest.addEventListener('click', () => this.runCustomStressTest());
    }

    async _checkDebug() {
        try {
            const res = await fetch('/api/debug');
            const data = await res.json();
            this.isDebugActive = data.debug;
            this._updateDebugUI();
        } catch (e) {
            console.error('Failed to get debug state', e);
        }
    }

    async toggleDebug() {
        try {
            const res = await fetch('/api/debug', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ debug: !this.isDebugActive })
            });
            const data = await res.json();
            this.isDebugActive = data.debug;
            this._updateDebugUI();
        } catch (e) {
            console.error('Failed to toggle debug state', e);
        }
    }

    _updateDebugUI() {
        if (this.isDebugActive) {
            this.btnToggleDebug.innerText = "Disable Debug Mode";
            this.btnToggleDebug.style.background = "var(--danger)";
            this.testingTools.style.opacity = "1";
            this.testingTools.style.pointerEvents = "auto";
        } else {
            this.btnToggleDebug.innerText = "Enable Debug Mode";
            this.btnToggleDebug.style.background = "#475569";
            this.testingTools.style.opacity = "0.5";
            this.testingTools.style.pointerEvents = "none";
        }
    }

    async clearData() {
        if (!confirm("Are you absolutely sure you want to erase ALL timeline data? This cannot be undone.")) return;

        this.btnClear.disabled = true;
        this.btnClear.innerText = "Erasing...";
        this.statusInfo.className = "";
        this.statusInfo.innerText = "";

        try {
            const res = await fetch('/api/clear', { method: 'POST' });
            if (res.ok) {
                this.statusInfo.className = "success";
                this.statusInfo.innerText = "✓ Dashboard successfully reset.";
                setTimeout(() => this.statusInfo.innerText = "", 3000);
            } else {
                throw new Error("Server returned " + res.status);
            }
        } catch (err) {
            this.statusInfo.className = "error";
            this.statusInfo.innerText = "❌ Error: " + err.message;
        } finally {
            this.btnClear.disabled = false;
            this.btnClear.innerText = "ERASE ALL DATA";
        }
    }

    async runCustomStressTest() {
        const count = parseInt(this.inputSamples.value, 10);
        const hours = parseFloat(this.inputHours.value);
        if (isNaN(count) || isNaN(hours) || count <= 0 || hours <= 0) return;

        const btns = document.querySelectorAll('button');
        btns.forEach(b => b.disabled = true);

        this.statusInfo.className = "";
        this.statusInfo.innerText = `Preparing to send ${count} requests...`;

        try {
            const res = await fetch('/api/data');
            const data = await res.json();
            const cats = data.categories.map(c => c.name);

            if (cats.length === 0) throw new Error("No categories found");

            this.statusInfo.innerText = `Sending ${count} tracking requests...`;
            let successCount = 0;

            let startTime = new Date().getTime();
            if (data.entries && data.entries.length > 0) {
                const latestEntry = data.entries[data.entries.length - 1];
                startTime = new Date(latestEntry.timestamp).getTime();
            }

            const durationMs = hours * 3600 * 1000;
            const timeStep = Math.floor(durationMs / count);

            for (let i = 0; i < count; i++) {
                const c1 = Math.floor(Math.random() * 5);
                const c2 = Math.floor(Math.random() * 5);
                const c3 = Math.floor(Math.random() * 5);
                const cat = cats[Math.floor(Math.random() * cats.length)];

                const tsDate = new Date(startTime + ((i + 1) * timeStep));
                const timestampStr = TimeUtils.getISOString(tsDate);

                const url = `/log?Bier=${c1}&Cocktail=${c2}&Shot=${c3}&category=${cat}&timestamp=${encodeURIComponent(timestampStr)}`;
                fetch(url).then(r => { if (r.ok) successCount++; });
            }

            this.statusInfo.className = "success";
            this.statusInfo.innerText = `✓ Sent ${count} requests successfully. They will arrive on the chart dynamically.`;
            setTimeout(() => { if (this.statusInfo.innerText.includes('✓')) this.statusInfo.innerText = ""; }, 4000);

        } catch (err) {
            this.statusInfo.className = "error";
            this.statusInfo.innerText = "❌ Error: " + err.message;
        } finally {
            btns.forEach(b => b.disabled = false);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new ControlPanel();
});
