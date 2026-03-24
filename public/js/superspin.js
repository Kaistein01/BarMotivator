const POLL_INTERVAL_MS = 200;
const RESULT_DURATION_MS = 7000;
const VISIBLE_ITEMS = 5;          // how many items show in the reel at once
const ITEM_HEIGHT_RATIO = 0.14;   // item height as fraction of canvas height
const SPIN_SPEED = 18;            // items per second during full spin
const STOP_DURATION_MS = 4000;    // deceleration time
const REEL_FADEIN_MS = 600;       // ms to fade the reel in on enable

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

class SuperSpinApp {
    constructor() {
        this.canvas      = document.getElementById('superspin-canvas');
        this.ctx         = this.canvas.getContext('2d');
        this.resultOverlay = document.getElementById('superspin-result-overlay');
        this.resultLabel   = document.getElementById('superspin-result-label');

        this.fields = [];

        // State machine:
        //   'idle'     – completely black, nothing drawn
        //   'enabled'  – reel fades in, sitting still
        //   'spinning' – reel scrolling at full speed
        //   'stopping' – reel decelerating to result
        //   'showdown' – reel gone, result overlay on pure black
        this.state = 'idle';

        // Reel scroll position (continuous item index)
        this.scrollOffset = 0;
        this.lastFrameTime = null;

        // Reel fade-in
        this.enabledAt = null;   // performance.now() timestamp
        this.reelAlpha = 0;

        // Stop phase
        this.stopStartOffset = 0;
        this.stopTotalOffset = 0;
        this.stopStartTime   = 0;
        this.stopFieldIndex  = -1;
        this.resultShown     = false;

        // Fireworks
        this.particles       = [];
        this.fireworksActive = false;
        this.fireworksTimer  = null;

        // Layout (CSS px)
        this.w = 0; this.h = 0;
        this.itemH = 0;

        this.init();
    }

    async init() {
        this.resize();
        window.addEventListener('resize', () => this.resize());

        try {
            const res = await fetch('/api/superspin/config');
            const cfg = await res.json();
            this.fields = cfg.fields;
        } catch (e) {
            console.error('Failed to load superspin config:', e);
        }

        this.lastFrameTime = performance.now();
        requestAnimationFrame(ts => this.animate(ts));
        this.schedulePoll();
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.canvas.width  = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width  = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.scale(dpr, dpr);
        this.w = w; this.h = h;
        this.itemH = Math.round(h * ITEM_HEIGHT_RATIO);
    }

    // ── Polling ───────────────────────────────────────────────────────────────

    schedulePoll() {
        setTimeout(async () => {
            await this.poll();
            this.schedulePoll();
        }, POLL_INTERVAL_MS);
    }

    async poll() {
        try {
            const res = await fetch('/api/superspin/state');
            if (!res.ok) return;
            this.handleServerState(await res.json());
        } catch (_) {}
    }

    handleServerState({ status, selectedFieldIndex }) {
        // Never interrupt a deceleration or the showdown
        if (this.state === 'stopping' || this.state === 'showdown') return;

        if (status === 'enabled' && this.state === 'idle') {
            this.state = 'enabled';
            this.enabledAt = performance.now();
            this.reelAlpha = 0;

        } else if (status === 'spinning' && (this.state === 'enabled' || this.state === 'idle')) {
            this.state = 'enabled';           // ensure reel is shown
            this.reelAlpha = 1;
            this.state = 'spinning';

        } else if (status === 'stopping' && this.state === 'spinning') {
            this.beginStopping(selectedFieldIndex);

        } else if (status === 'idle' && this.state !== 'idle') {
            // Unexpected reset from server – snap back to black
            this.state = 'idle';
            this.reelAlpha = 0;
            this.resultOverlay.classList.remove('visible');
            this.stopFireworks();
        }
    }

    // ── Stop physics ──────────────────────────────────────────────────────────

    beginStopping(fieldIndex) {
        const n = this.fields.length;
        // Land so field fieldIndex is centred: scrollOffset ≡ fieldIndex (mod n)
        const target = Math.ceil(this.scrollOffset / n) * n + fieldIndex;
        const minExtra = SPIN_SPEED * (STOP_DURATION_MS / 1000) * 0.5;
        let totalOffset = target - this.scrollOffset;
        if (totalOffset < minExtra) totalOffset += n * Math.ceil((minExtra - totalOffset) / n);

        this.state           = 'stopping';
        this.stopStartOffset = this.scrollOffset;
        this.stopTotalOffset = totalOffset;
        this.stopStartTime   = performance.now();
        this.stopFieldIndex  = fieldIndex;
        this.resultShown     = false;
    }

    // ── Animation loop ────────────────────────────────────────────────────────

    animate(ts) {
        requestAnimationFrame(t => this.animate(t));
        const dt = Math.min((ts - this.lastFrameTime) / 1000, 0.05);
        this.lastFrameTime = ts;

        if (this.state === 'enabled') {
            // Animate reel fade-in
            const t = Math.min((ts - this.enabledAt) / REEL_FADEIN_MS, 1);
            this.reelAlpha = easeOutCubic(t);

        } else if (this.state === 'spinning') {
            this.reelAlpha = 1;
            this.scrollOffset += SPIN_SPEED * dt;

        } else if (this.state === 'stopping') {
            this.reelAlpha = 1;
            const elapsed = ts - this.stopStartTime;
            const t = Math.min(elapsed / STOP_DURATION_MS, 1);
            this.scrollOffset = this.stopStartOffset + this.stopTotalOffset * easeOutCubic(t);

            // Snap to integer at end to eliminate floating-point drift
            if (t >= 1) this.scrollOffset = Math.round(this.scrollOffset);

            if (t >= 1 && !this.resultShown) {
                this.resultShown = true;
                this.onLanded();
            }
        }

        if (this.fireworksActive || this.particles.length > 0) {
            this.updateParticles(dt);
        }

        this.draw(ts);
    }

    // ── Drawing ───────────────────────────────────────────────────────────────

    draw(ts) {
        const { ctx, w, h } = this;

        // Always clear to pure black
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, h);

        if (this.fields.length === 0) return;

        // Showdown and idle: nothing drawn on canvas (result is the HTML overlay)
        if (this.state === 'idle' || this.state === 'showdown') {
            if (this.particles.length > 0) this.drawParticles();
            return;
        }

        // Draw reel at current alpha
        ctx.save();
        ctx.globalAlpha = this.reelAlpha;
        this.drawReel(ts);
        this.drawOverlayMasks();
        this.drawSelectorBar();
        this.drawCasinoFrame(ts);
        ctx.restore();

        if (this.particles.length > 0) this.drawParticles();
    }

    drawReel(ts) {
        const { ctx, w, h, itemH, fields, scrollOffset } = this;
        const n = fields.length;
        const cx = w / 2;
        const centreY = h / 2;
        const colW = Math.min(w * 0.68, 600);

        const totalDraw = VISIBLE_ITEMS + 2;
        const startSlot = -Math.floor(totalDraw / 2) - 1;
        const offsetFraction = scrollOffset % 1;

        for (let slot = startSlot; slot <= Math.floor(totalDraw / 2) + 1; slot++) {
            const slotCentreY = centreY + (slot - offsetFraction) * itemH;

            const distFromCentre = Math.abs(slotCentreY - centreY) / (itemH * (VISIBLE_ITEMS / 2));
            if (distFromCentre > 1.15) continue;

            // Math.floor so indices stay consistent regardless of fractional part
            const fieldIdx = (Math.floor(scrollOffset) + slot + n * 100) % n;
            const field = fields[fieldIdx];

            const perspective = 1 - distFromCentre * 0.22;
            const itemW   = colW * perspective;
            const itemHeight = itemH * perspective;
            const x = cx - itemW / 2;
            const y = slotCentreY - itemHeight / 2;
            const alpha = Math.max(0, 1 - distFromCentre * 1.1);
            const isCenter = Math.abs(slotCentreY - centreY) < itemH * 0.5;
            const radius = 18 * perspective;

            ctx.save();
            ctx.globalAlpha *= alpha;

            // Background
            this.roundRect(ctx, x, y, itemW, itemHeight, radius);
            ctx.fillStyle = isCenter ? field.color : this.dimColor(field.color, 0.25);
            ctx.fill();

            // Glow border for centre item
            if (isCenter) {
                ctx.save();
                ctx.shadowColor = field.color;
                ctx.shadowBlur = 40;
                this.roundRect(ctx, x, y, itemW, itemHeight, radius);
                ctx.strokeStyle = field.color;
                ctx.lineWidth = 3;
                ctx.stroke();
                ctx.restore();
            }

            // Label
            const fontSize = Math.max(18, Math.min(itemHeight * 0.5, 72)) * perspective;
            ctx.font = `900 ${fontSize}px Inter, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            if (isCenter) {
                ctx.fillStyle = this.contrastColor(field.color);
                ctx.shadowColor = 'rgba(0,0,0,0.7)';
                ctx.shadowBlur = 6;
            } else {
                ctx.fillStyle = field.color;
                ctx.shadowBlur = 0;
            }
            ctx.fillText(field.label, cx, slotCentreY);

            ctx.restore();
        }
    }

    drawOverlayMasks() {
        const { ctx, w, h } = this;
        const fadeH = h * 0.28;

        const topGrad = ctx.createLinearGradient(0, 0, 0, fadeH);
        topGrad.addColorStop(0, 'rgba(0,0,0,1)');
        topGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = topGrad;
        ctx.fillRect(0, 0, w, fadeH);

        const botGrad = ctx.createLinearGradient(0, h - fadeH, 0, h);
        botGrad.addColorStop(0, 'rgba(0,0,0,0)');
        botGrad.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = botGrad;
        ctx.fillRect(0, h - fadeH, w, fadeH);
    }

    drawSelectorBar() {
        const { ctx, w, h, itemH } = this;
        const cy = h / 2;
        const lineY1 = cy - itemH / 2;
        const lineY2 = cy + itemH / 2;
        const lineW = Math.min(w * 0.75, 640);
        const lx = (w - lineW) / 2;

        ctx.save();
        ctx.shadowColor = '#ff2222';
        ctx.shadowBlur = 18;
        ctx.strokeStyle = '#ff2222';
        ctx.lineWidth = 3;

        ctx.beginPath(); ctx.moveTo(lx, lineY1); ctx.lineTo(lx + lineW, lineY1); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(lx, lineY2); ctx.lineTo(lx + lineW, lineY2); ctx.stroke();

        const triSize = 14;
        ctx.fillStyle = '#ff2222';
        ctx.shadowBlur = 10;

        // Left triangles
        ctx.beginPath(); ctx.moveTo(lx - 6, lineY1 - triSize); ctx.lineTo(lx - 6 + triSize * 0.8, lineY1 - triSize); ctx.lineTo(lx - 6 + triSize * 0.4, lineY1); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(lx - 6, lineY2 + triSize); ctx.lineTo(lx - 6 + triSize * 0.8, lineY2 + triSize); ctx.lineTo(lx - 6 + triSize * 0.4, lineY2); ctx.closePath(); ctx.fill();

        // Right triangles
        const rx = lx + lineW + 6;
        ctx.beginPath(); ctx.moveTo(rx, lineY1 - triSize); ctx.lineTo(rx + triSize * 0.8, lineY1 - triSize); ctx.lineTo(rx + triSize * 0.4, lineY1); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(rx, lineY2 + triSize); ctx.lineTo(rx + triSize * 0.8, lineY2 + triSize); ctx.lineTo(rx + triSize * 0.4, lineY2); ctx.closePath(); ctx.fill();

        ctx.restore();
    }

    drawCasinoFrame(ts) {
        const { ctx, w, h, itemH } = this;
        const colW = Math.min(w * 0.68, 600);
        const colX = (w - colW) / 2;
        const frameH = itemH * VISIBLE_ITEMS;
        const frameY = h / 2 - frameH / 2;
        const cornerR = 24;

        ctx.save();
        ctx.shadowColor = 'rgba(255,220,0,0.6)';
        ctx.shadowBlur = 20;
        ctx.strokeStyle = '#c8960c';
        ctx.lineWidth = 4;
        this.roundRect(ctx, colX - 10, frameY - 10, colW + 20, frameH + 20, cornerR);
        ctx.stroke();

        const numLights = 28;
        const tw = colW + 20, th = frameH + 20;
        const ox = colX - 10, oy = frameY - 10;
        const perimeter = 2 * (tw + th);
        const step = perimeter / numLights;
        const blinkPhase = Math.floor(ts / 300);

        for (let i = 0; i < numLights; i++) {
            const d = (i * step) % perimeter;
            let lx, ly;
            if (d < tw)             { lx = ox + d;           ly = oy; }
            else if (d < tw + th)   { lx = ox + tw;          ly = oy + (d - tw); }
            else if (d < 2*tw + th) { lx = ox + tw - (d - tw - th); ly = oy + th; }
            else                    { lx = ox;                ly = oy + th - (d - 2*tw - th); }

            const lit = (i + blinkPhase) % 2 === 0;
            ctx.beginPath();
            ctx.arc(lx, ly, 5, 0, 2 * Math.PI);
            if (lit) {
                ctx.save(); ctx.shadowColor = '#ffe033'; ctx.shadowBlur = 10;
                ctx.fillStyle = '#ffd700'; ctx.fill(); ctx.restore();
            } else {
                ctx.fillStyle = '#4a3800'; ctx.fill();
            }
        }
        ctx.restore();
    }

    // ── Fireworks ─────────────────────────────────────────────────────────────

    updateParticles(dt) {
        this.particles = this.particles.filter(p => p.life > 0);
        for (const p of this.particles) {
            p.x += p.vx * dt; p.y += p.vy * dt;
            p.vy += 220 * dt;
            p.life -= p.decay * dt;
        }
    }

    drawParticles() {
        const { ctx } = this;
        ctx.save();
        for (const p of this.particles) {
            ctx.globalAlpha = Math.max(0, p.life) * 0.9;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * Math.max(0.1, p.life), 0, 2 * Math.PI);
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 7;
            ctx.fill();
        }
        ctx.globalAlpha = 1; ctx.shadowBlur = 0;
        ctx.restore();
    }

    spawnBurst(x, y) {
        const palette = ['#ff4444','#ff8800','#ffee00','#44ff88','#44aaff','#cc44ff','#ff44cc','#ffffff'];
        const count = 65 + Math.floor(Math.random() * 55);
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * 2 * Math.PI + Math.random() * 0.25;
            const speed = 120 + Math.random() * 280;
            this.particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 60,
                color: palette[Math.floor(Math.random() * palette.length)],
                size: 2.5 + Math.random() * 2.5,
                life: 1,
                decay: 0.38 + Math.random() * 0.32
            });
        }
    }

    startFireworks() {
        this.fireworksActive = true;
        const launch = () => {
            if (!this.fireworksActive) return;
            this.spawnBurst(this.w * (0.08 + Math.random() * 0.84), this.h * (0.08 + Math.random() * 0.52));
            this.fireworksTimer = setTimeout(launch, 350 + Math.random() * 350);
        };
        launch();
    }

    stopFireworks() {
        this.fireworksActive = false;
        clearTimeout(this.fireworksTimer);
        this.fireworksTimer = null;
        this.particles = [];
    }

    // ── Result / showdown ─────────────────────────────────────────────────────

    onLanded() {
        const field = this.fields[this.stopFieldIndex];

        // Switch to showdown: canvas goes black, only result overlay remains
        this.state = 'showdown';

        if (field.fireworks) this.startFireworks();

        this.resultLabel.textContent = field.label;
        this.resultLabel.style.color = field.color;
        this.resultOverlay.classList.add('visible');

        setTimeout(() => {
            this.resultOverlay.classList.remove('visible');
            this.stopFireworks();
            this.state = 'idle';
            this.reelAlpha = 0;
            fetch('/api/superspin/complete').catch(() => {});
        }, RESULT_DURATION_MS);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    dimColor(hex, factor) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${Math.round(r*factor)},${Math.round(g*factor)},${Math.round(b*factor)},1)`;
    }

    contrastColor(hex) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return (0.299 * r + 0.587 * g + 0.114 * b) > 140 ? '#000000' : '#ffffff';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('superspin-canvas')) {
        new SuperSpinApp();
    }
});
