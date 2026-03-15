const POLL_INTERVAL_MS = 200;
const SPIN_VELOCITY = 6 * Math.PI; // rad/s  (~3 rotations/sec)
const AUTO_STOP_SECONDS = 10;
const RESULT_DURATION_MS = 7000;
const INTRO_DURATION_MS = 700;
const OUTRO_DURATION_MS = 450;

// Easing helpers
function easeOutElastic(t) {
    if (t === 0) return 0;
    if (t === 1) return 1;
    const c4 = (2 * Math.PI) / 2.5;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

function easeInCubic(t) {
    return t * t * t;
}

class WheelApp {
    constructor() {
        this.overlay = document.getElementById('wheel-overlay');
        this.canvas = document.getElementById('wheel-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.resultOverlay = document.getElementById('spin-result-overlay');
        this.resultLabel = document.getElementById('spin-result-label');
        this.deviceBadge = document.getElementById('spin-device-badge');
        this.deviceIdEl = document.getElementById('spin-device-id');

        // Wheel config
        this.fields = [];

        // Animation state
        this.state = 'idle'; // 'idle' | 'spinning' | 'stopping'
        this.wheelAngle = 0;
        this.lastFrameTime = null;

        // Stopping phase
        this.stopStartAngle = 0;
        this.stopTotalAngle = 0;
        this.stopDuration = 0; // ms
        this.stopStartTime = 0;
        this.stopFieldIndex = -1;
        this.resultShown = false;

        // Countdown (synced to server's spinStartedAt)
        this.spinStartedAt = null;

        // Device
        this.deviceId = null;

        // Overlay fly-in / fly-out
        this.introStartTime = null;
        this.outroStartTime = null;

        // Fireworks
        this.particles = [];
        this.fireworksActive = false;
        this.fireworksTimer = null;

        // Layout (CSS pixels)
        this.w = 0; this.h = 0;
        this.cx = 0; this.cy = 0;
        this.radius = 0;

        this.init();
    }

    async init() {
        this.resize();
        window.addEventListener('resize', () => this.resize());

        try {
            const res = await fetch('/api/spin/config');
            const config = await res.json();
            this.fields = config.fields;
        } catch (e) {
            console.error('Failed to load wheel config:', e);
        }

        this.lastFrameTime = performance.now();
        requestAnimationFrame((ts) => this.animate(ts));
        this.schedulePoll();
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.scale(dpr, dpr);

        this.w = w;
        this.h = h;
        this.cx = w / 2;
        this.cy = h / 2;
        this.radius = Math.min(w, h) * 0.40;
    }

    // ─── Overlay management ───────────────────────────────────────────────────

    showOverlay() {
        this.overlay.classList.add('active');
        this.introStartTime = performance.now();
        this.outroStartTime = null;

        // Update device badge with the device ID from server state
        if (this.deviceId !== null) {
            this.deviceIdEl.textContent = this.deviceId;
        }
    }

    hideOverlay() {
        this.outroStartTime = performance.now();
        this.introStartTime = null;

        setTimeout(() => {
            this.overlay.classList.remove('active');
            this.outroStartTime = null;
            this.deviceId = null;
        }, OUTRO_DURATION_MS + 60);
    }

    // Returns the current scale multiplier for the wheel (for fly-in/out animation)
    getWheelScale(timestamp) {
        if (this.introStartTime !== null) {
            const t = Math.min((timestamp - this.introStartTime) / INTRO_DURATION_MS, 1);
            const scale = easeOutElastic(t);
            if (t >= 1) this.introStartTime = null;
            return Math.max(0, scale);
        }
        if (this.outroStartTime !== null) {
            const t = Math.min((timestamp - this.outroStartTime) / OUTRO_DURATION_MS, 1);
            return Math.max(0, 1 - easeInCubic(t));
        }
        return 1;
    }

    // ─── Polling ──────────────────────────────────────────────────────────────

    schedulePoll() {
        setTimeout(async () => {
            await this.poll();
            this.schedulePoll();
        }, POLL_INTERVAL_MS);
    }

    async poll() {
        try {
            const res = await fetch('/api/spin/state');
            if (!res.ok) return;
            const serverState = await res.json();
            this.handleServerState(serverState);
        } catch (_) { /* network error, ignore */ }
    }

    handleServerState({ status, selectedFieldIndex, spinStartedAt, deviceId }) {
        // Block state changes while decelerating or during result display
        if (this.state === 'stopping') return;

        if (status === 'spinning' && this.state === 'idle') {
            this.state = 'spinning';
            this.spinStartedAt = spinStartedAt;
            this.deviceId = deviceId;
            this.showOverlay();
        } else if (status === 'stopping' && this.state === 'spinning') {
            this.beginStopping(selectedFieldIndex);
        } else if (status === 'idle' && this.state === 'spinning') {
            // Server reset unexpectedly (edge case)
            this.state = 'idle';
            this.spinStartedAt = null;
            this.hideOverlay();
        }
    }

    // ─── Stop physics ─────────────────────────────────────────────────────────

    beginStopping(fieldIndex) {
        const n = this.fields.length;
        const segAngle = (2 * Math.PI) / n;

        // Target: wheelAngle ≡ -(fieldIndex + 0.5) * segAngle  (mod 2π)
        const targetMod = ((-(fieldIndex + 0.5) * segAngle) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        const currentMod = ((this.wheelAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

        let delta = (targetMod - currentMod + 2 * Math.PI) % (2 * Math.PI);
        if (delta < 0.01) delta = 2 * Math.PI;

        // Cubic ease-out: initial velocity = spinVelocity, duration = 3*total/velocity
        const desiredT = 5 + Math.random() * 2;
        const minTotalAngle = SPIN_VELOCITY * desiredT / 3;
        const extraRotations = Math.max(0, Math.ceil((minTotalAngle - delta) / (2 * Math.PI)));
        const totalAngle = delta + extraRotations * 2 * Math.PI;
        const durationMs = (3 * totalAngle / SPIN_VELOCITY) * 1000;

        this.state = 'stopping';
        this.stopStartAngle = this.wheelAngle;
        this.stopTotalAngle = totalAngle;
        this.stopDuration = durationMs;
        this.stopStartTime = performance.now();
        this.stopFieldIndex = fieldIndex;
        this.resultShown = false;
    }

    // ─── Animation loop ───────────────────────────────────────────────────────

    animate(timestamp) {
        requestAnimationFrame((ts) => this.animate(ts));

        const dt = Math.min((timestamp - this.lastFrameTime) / 1000, 0.05);
        this.lastFrameTime = timestamp;

        if (this.state === 'spinning') {
            this.wheelAngle += SPIN_VELOCITY * dt;
        } else if (this.state === 'stopping') {
            const elapsed = timestamp - this.stopStartTime;
            const t = Math.min(elapsed / this.stopDuration, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            this.wheelAngle = this.stopStartAngle + this.stopTotalAngle * eased;

            if (t >= 1 && !this.resultShown) {
                this.resultShown = true;
                this.onLanded();
            }
        }

        if (this.fireworksActive || this.particles.length > 0) {
            this.updateParticles(dt);
        }

        this.draw(timestamp);
    }

    // ─── Drawing ──────────────────────────────────────────────────────────────

    draw(timestamp) {
        const { ctx, w, h, cx, cy } = this;
        ctx.clearRect(0, 0, w, h);

        // Only draw if overlay is active or animating (intro/outro)
        const isVisible = this.overlay.classList.contains('active')
            || this.introStartTime !== null
            || this.outroStartTime !== null;

        if (!isVisible || this.fields.length === 0) return;

        const scale = this.getWheelScale(timestamp);

        // Apply scale transform from center so the wheel flies in/out from center
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.translate(-cx, -cy);

        this.drawWheel(timestamp);
        this.drawPointer();

        ctx.restore();

        if (this.state === 'spinning' && this.spinStartedAt !== null) {
            this.drawCountdown();
        }

        if (this.particles.length > 0) {
            this.drawParticles();
        }
    }

    drawWheel(timestamp) {
        const { ctx, cx, cy, radius, fields, wheelAngle } = this;
        const n = fields.length;
        const segAngle = (2 * Math.PI) / n;
        const rimW = Math.max(18, radius * 0.08);

        ctx.save();
        ctx.translate(cx, cy);

        // Outer glow
        const glowGrad = ctx.createRadialGradient(0, 0, radius * 0.7, 0, 0, radius + rimW + 20);
        glowGrad.addColorStop(0, 'rgba(80,140,255,0)');
        glowGrad.addColorStop(0.6, 'rgba(80,140,255,0.08)');
        glowGrad.addColorStop(1, 'rgba(80,140,255,0.22)');
        ctx.beginPath();
        ctx.arc(0, 0, radius + rimW + 20, 0, 2 * Math.PI);
        ctx.fillStyle = glowGrad;
        ctx.fill();

        ctx.rotate(wheelAngle);

        // ── Segments ──────────────────────────────────────────────────────────
        for (let i = 0; i < n; i++) {
            const startA = i * segAngle - Math.PI / 2;
            const endA = startA + segAngle;
            const field = fields[i];

            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, radius, startA, endA);
            ctx.closePath();
            ctx.fillStyle = field.color;
            ctx.fill();

            // Inner highlight for depth
            const lightGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
            lightGrad.addColorStop(0, 'rgba(255,255,255,0.18)');
            lightGrad.addColorStop(0.55, 'rgba(255,255,255,0.04)');
            lightGrad.addColorStop(1, 'rgba(0,0,0,0.18)');
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, radius, startA, endA);
            ctx.closePath();
            ctx.fillStyle = lightGrad;
            ctx.fill();

            // Separator
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, radius, startA, endA);
            ctx.closePath();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Label
            ctx.save();
            ctx.rotate(startA + segAngle / 2);
            const fontSize = Math.max(13, Math.min(22, radius * 0.086));
            ctx.font = `bold ${fontSize}px Inter, sans-serif`;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0,0,0,0.8)';
            ctx.shadowBlur = 5;
            ctx.fillStyle = '#ffffff';
            ctx.fillText(field.label, radius * 0.87, 0);
            ctx.restore();
        }

        // ── Rim ───────────────────────────────────────────────────────────────
        ctx.beginPath();
        ctx.arc(0, 0, radius + 3, 0, 2 * Math.PI);
        ctx.strokeStyle = '#c8960c';
        ctx.lineWidth = 4;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, 0, radius + rimW / 2 + 4, 0, 2 * Math.PI);
        ctx.strokeStyle = '#b91c1c';
        ctx.lineWidth = rimW;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, 0, radius + rimW + 8, 0, 2 * Math.PI);
        ctx.strokeStyle = '#c8960c';
        ctx.lineWidth = 4;
        ctx.stroke();

        // ── Light bulbs ───────────────────────────────────────────────────────
        const numLights = n * 2 + 2;
        const lightDist = radius + rimW / 2 + 4;
        const lightR = Math.max(5, rimW * 0.28);
        const blinkPhase = Math.floor(timestamp / 280);

        for (let i = 0; i < numLights; i++) {
            const angle = (i / numLights) * 2 * Math.PI - Math.PI / 2;
            const lx = Math.cos(angle) * lightDist;
            const ly = Math.sin(angle) * lightDist;
            const lit = (i + blinkPhase) % 2 === 0;

            ctx.beginPath();
            ctx.arc(lx, ly, lightR, 0, 2 * Math.PI);
            if (lit) {
                ctx.save();
                ctx.shadowColor = '#ffe033';
                ctx.shadowBlur = 12;
                ctx.fillStyle = '#ffd700';
                ctx.fill();
                ctx.restore();
            } else {
                ctx.fillStyle = '#6b4e00';
                ctx.fill();
            }
        }

        // ── Center hub ────────────────────────────────────────────────────────
        const hubR = Math.max(16, radius * 0.095);
        const hubGrad = ctx.createRadialGradient(0, -hubR * 0.25, hubR * 0.05, 0, 0, hubR);
        hubGrad.addColorStop(0, '#fff8e1');
        hubGrad.addColorStop(0.3, '#ffd700');
        hubGrad.addColorStop(0.65, '#c53030');
        hubGrad.addColorStop(1, '#6b1414');
        ctx.beginPath();
        ctx.arc(0, 0, hubR, 0, 2 * Math.PI);
        ctx.fillStyle = hubGrad;
        ctx.fill();
        ctx.strokeStyle = '#c8960c';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        ctx.restore();
    }

    drawPointer() {
        const { ctx, cx, cy, radius } = this;
        const tipY = cy - radius - 5;
        const pH = radius * 0.135;
        const pW = radius * 0.068;

        ctx.save();
        ctx.translate(cx, tipY);
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 3;

        const grad = ctx.createLinearGradient(0, -pH, 0, 0);
        grad.addColorStop(0, '#fffde7');
        grad.addColorStop(0.45, '#ffd700');
        grad.addColorStop(1, '#e8b800');

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-pW, -pH);
        ctx.lineTo(pW, -pH);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.strokeStyle = '#9a6700';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.restore();
    }

    drawCountdown() {
        const { ctx } = this;
        const now = Date.now();
        const elapsedSecs = (now - this.spinStartedAt) / 1000;
        const remaining = Math.max(0, AUTO_STOP_SECONDS - elapsedSecs);
        const fraction = remaining / AUTO_STOP_SECONDS;

        const x = 52, y = 52, r = 36;

        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(x, y, r - 5, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 7;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(x, y, r - 5, -Math.PI / 2, -Math.PI / 2 + fraction * 2 * Math.PI);
        ctx.strokeStyle = remaining > 4 ? '#48bb78' : '#fc8181';
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 21px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(Math.ceil(remaining), x, y);
        ctx.restore();
    }

    // ─── Fireworks ────────────────────────────────────────────────────────────

    updateParticles(dt) {
        this.particles = this.particles.filter(p => p.life > 0);
        for (const p of this.particles) {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += 220 * dt;
            p.life -= p.decay * dt;
        }
    }

    drawParticles() {
        const { ctx } = this;
        ctx.save();
        for (const p of this.particles) {
            const alpha = Math.max(0, p.life);
            ctx.globalAlpha = alpha * 0.9;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * Math.max(0.1, p.life), 0, 2 * Math.PI);
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 7;
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.restore();
    }

    spawnBurst(x, y) {
        const palette = [
            '#ff4444', '#ff8800', '#ffee00',
            '#44ff88', '#44aaff', '#cc44ff',
            '#ff44cc', '#ffffff'
        ];
        const count = 65 + Math.floor(Math.random() * 55);
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * 2 * Math.PI + Math.random() * 0.25;
            const speed = 120 + Math.random() * 280;
            const color = palette[Math.floor(Math.random() * palette.length)];
            this.particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 60,
                color,
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
            const x = this.w * (0.08 + Math.random() * 0.84);
            const y = this.h * (0.08 + Math.random() * 0.52);
            this.spawnBurst(x, y);
            this.fireworksTimer = setTimeout(launch, 350 + Math.random() * 350);
        };
        launch();
    }

    stopFireworks() {
        this.fireworksActive = false;
        if (this.fireworksTimer) {
            clearTimeout(this.fireworksTimer);
            this.fireworksTimer = null;
        }
        this.particles = [];
    }

    // ─── Result ───────────────────────────────────────────────────────────────

    onLanded() {
        const field = this.fields[this.stopFieldIndex];

        if (field.fireworks) {
            this.startFireworks();
        }

        this.resultLabel.textContent = field.label;
        this.resultLabel.style.color = field.color;
        this.resultOverlay.classList.add('visible');

        setTimeout(() => {
            this.resultOverlay.classList.remove('visible');
            this.stopFireworks();
            this.state = 'idle';
            this.spinStartedAt = null;
            fetch('/api/spin/complete').catch(() => {});
            this.hideOverlay();
        }, RESULT_DURATION_MS);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Only initialise if the wheel overlay elements are present on this page
    if (document.getElementById('wheel-overlay')) {
        new WheelApp();
    }
});
