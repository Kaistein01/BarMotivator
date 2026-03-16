import { UIComponent } from '../core/UIComponent.js';

/**
 * Leaderboard component displaying top categories.
 */
export class Leaderboard extends UIComponent {
    constructor(containerId, store) {
        super(containerId);
        this.store = store;
    }

    render() {
        const state = this.store.getState();
        const sorted = [...state.categories]
            .map(c => ({ name: c.name, displayName: c.displayName || c.name, color: c.color, total: state.totals[c.name] || 0 }))
            .sort((a, b) => b.total - a.total);

        if (sorted.length === 0 || sorted.every(s => s.total === 0)) {
            this.container.innerHTML = `
              <div class="empty-state">
                <span>📡</span>
                <p>No entries yet — fire a <code>/log</code> request to get started.</p>
              </div>`;
            return;
        }

        this.container.innerHTML = sorted.map((item, i) => {
            const rank = i + 1;
            const rankClass = rank === 1 ? 'top1' : rank === 2 ? 'top2' : rank === 3 ? 'top3' : '';
            const rankLabel = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
            return `
              <div class="lb-item">
                <span class="lb-rank ${rankClass}">${rankLabel}</span>
                <span class="lb-swatch" style="background:${item.color}; color:${item.color};"></span>
                <span class="lb-name">${item.displayName}</span>
              </div>`;
        }).join('');
    }
}
