import { UIComponent } from '../core/UIComponent.js';
import { TimeUtils } from '../utils/TimeUtils.js';

/**
 * Complex Canvas-based chart visualizing timeline entries.
 */
export class TimelineChart extends UIComponent {
    constructor(canvasId, store) {
        super(canvasId);
        this.store = store;
        this.canvas = this.container;
        this.ctx = this.canvas.getContext('2d');
        this.tooltipPos = null;

        this._bindEvents();
    }

    _bindEvents() {
        this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
        this.canvas.addEventListener('mouseleave', () => {
            this.tooltipPos = null;
            this.render();
        });
        window.addEventListener('resize', () => {
            this.render();
        });

        setInterval(() => this.render(), 1000);
    }

    _onMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const padding = { top: 20, right: 0, bottom: 40, left: 0 };
        if (x >= padding.left && x <= rect.width - padding.right && y >= padding.top && y <= rect.height - padding.bottom) {
            this.tooltipPos = { x, y };
        } else {
            this.tooltipPos = null;
        }
        this.render();
    }

    render() {
        const state = this.store.getState();
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.scale(dpr, dpr);
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;

        const width = rect.width;
        const height = rect.height;

        this.ctx.clearRect(0, 0, width, height);

        if (state.categories.length === 0) return;

        const padding = { top: 20, right: 0, bottom: 40, left: 0 };
        const plotWidth = width - padding.left - padding.right;
        const plotHeight = height - padding.top - padding.bottom;
        const fourHoursMs = 4 * 60 * 60 * 1000;

        let maxTime = Date.now();
        let minTime = maxTime - fourHoursMs;

        if (state.isDebugMode && state.entries.length > 0) {
            maxTime = TimeUtils.isoToMs(state.entries[state.entries.length - 1].timestamp);
            minTime = maxTime - fourHoursMs;
        }

        let maxY = 10;
        const tempTotals = {};
        state.categories.forEach(c => tempTotals[c.name] = 0);

        const seriesData = {};
        state.categories.forEach(c => {
            seriesData[c.name] = [{ x: minTime, y: 0 }];
        });

        state.entries.forEach(e => {
            const t = TimeUtils.isoToMs(e.timestamp);
            tempTotals[e.category] += e.weighted_sum;
            seriesData[e.category].push({ x: t, y: tempTotals[e.category] });
            if (tempTotals[e.category] > maxY) maxY = tempTotals[e.category];
        });

        state.categories.forEach(c => {
            seriesData[c.name].push({ x: maxTime, y: tempTotals[c.name] });
        });

        // Grid
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        this.ctx.lineWidth = 1;
        this.ctx.fillStyle = '#64748b';
        this.ctx.font = '600 12px Inter, sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'top';

        const ONE_HOUR = 60 * 60 * 1000;
        const firstHour = Math.ceil(minTime / ONE_HOUR) * ONE_HOUR;

        for (let t = firstHour; t <= maxTime; t += ONE_HOUR) {
            const x = padding.left + ((t - minTime) / fourHoursMs) * plotWidth;
            this.ctx.beginPath();
            this.ctx.moveTo(x, padding.top);
            this.ctx.lineTo(x, height - padding.bottom);
            this.ctx.stroke();

            const d = new Date(t);
            const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
            this.ctx.fillText(timeStr, x, height - padding.bottom + 10);
        }

        // Lines
        this.ctx.lineWidth = 3;
        state.categories.forEach(cat => {
            this.ctx.strokeStyle = cat.color;
            this.ctx.beginPath();
            const data = seriesData[cat.name];

            for (let i = 0; i < data.length; i++) {
                const pt = data[i];
                const px = padding.left + ((pt.x - minTime) / fourHoursMs) * plotWidth;
                const py = padding.top + plotHeight - ((pt.y / maxY) * plotHeight);

                if (i === 0) {
                    this.ctx.moveTo(px, py);
                } else {
                    const prev = data[i - 1];
                    const prevPx = padding.left + ((prev.x - minTime) / fourHoursMs) * plotWidth;
                    const prevPy = padding.top + plotHeight - ((prev.y / maxY) * plotHeight);

                    this.ctx.lineTo(px, prevPy);
                    this.ctx.lineTo(px, py);
                }
            }
            this.ctx.stroke();
        });

        if (this.tooltipPos) {
            this._drawTooltip(width, height, padding, plotWidth, minTime, fourHoursMs, state);
        }
    }

    _drawTooltip(width, height, padding, plotWidth, minTime, fourHoursMs, state) {
        const hoverMs = minTime + ((this.tooltipPos.x - padding.left) / plotWidth) * fourHoursMs;
        this.ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        this.ctx.beginPath();
        this.ctx.moveTo(this.tooltipPos.x, padding.top);
        this.ctx.lineTo(this.tooltipPos.x, height - padding.bottom);
        this.ctx.stroke();

        const tooltipW = 140;
        const tooltipH = state.categories.length * 20 + 30;
        let tx = this.tooltipPos.x + 15;
        let ty = this.tooltipPos.y - tooltipH / 2;
        if (tx + tooltipW > width) tx = this.tooltipPos.x - tooltipW - 15;
        if (ty < 0) ty = 10;

        this.ctx.fillStyle = 'rgba(0,0,0,0.8)';
        this.ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        this.ctx.beginPath();
        this.ctx.roundRect(tx, ty, tooltipW, tooltipH, 8);
        this.ctx.fill();
        this.ctx.stroke();

        this.ctx.fillStyle = '#fff';
        this.ctx.font = '600 14px Inter, sans-serif';
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'middle';
        const d = new Date(hoverMs);
        const tStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        this.ctx.fillText(tStr, tx + 10, ty + 15);

        const hoverVals = {};
        let currentTotals = {};
        state.categories.forEach(c => currentTotals[c.name] = 0);

        for (let e of state.entries) {
            if (TimeUtils.isoToMs(e.timestamp) <= hoverMs) {
                currentTotals[e.category] += e.weighted_sum;
            } else {
                break;
            }
        }

        this.ctx.font = '12px Inter, sans-serif';
        state.categories.forEach((cat, idx) => {
            this.ctx.fillStyle = cat.color;
            const val = currentTotals[cat.name];
            this.ctx.fillText(cat.name + ": " + val.toFixed(1), tx + 10, ty + 35 + idx * 20);
        });
    }
}
