/***********************************************************************
 * 9B. PRO OUTPUT SCOPE: SPECTRUM, SPECTROGRAM & PHOSPHOR OSCILLOSCOPE
 *     WITH STEREO VECTORSCOPE AND SEGMENTED L/R PEAK METERS
 ***********************************************************************/
const SCOPE_MODES = [
    { id: 'spectrum', label: 'Spectrum' },
    { id: 'spectrogram', label: 'Spectrogram' },
    { id: 'scope', label: 'Oscilloscope' },
    { id: 'bars', label: 'Bars' },
];
const SCOPE_COLORS = ['#ff7959', '#f4ca54', '#69bf91', '#58b6db', '#9e85e3', '#e98fbb'];
const SCOPE_MIN_HZ = 30;
const SCOPE_MAX_HZ = 18000;
const SCOPE_FLOOR_DB = -82;
const SCOPE_RANGE_DB = 54;
// Pink-noise tilt so a balanced mix reads flat instead of sloping down into the highs.
const SCOPE_TILT_DB_PER_OCTAVE = 4.5;
// Spectrogram heat map stops: [position, r, g, b, a].
const SCOPE_HEAT = [
    [0, 8, 6, 20, 0],
    [0.24, 46, 28, 104, 150],
    [0.46, 158, 133, 227, 225],
    [0.68, 255, 121, 89, 255],
    [0.86, 244, 202, 84, 255],
    [1, 255, 250, 236, 255],
];
const SCOPE_METER_DB = 60;
// Free control-bar width the inline display needs before it shows in full instead of as mini bars.
const SCOPE_FULL_MIN_WIDTH = 250;
const SCOPE_COMPACT_BARS = 12;

const scopeSignal = {
    freq: [new Float32Array(1024), new Float32Array(1024)],
    wave: [new Float32Array(2048), new Float32Array(2048)],
    mix: new Float32Array(1024),
    sampleRate: 48000,
    loudest: 0,
    meters: [0, 1].map(() => ({ level: 0, hold: 0, holdTime: 0, clipTime: 0 })),
    readoutPeak: -Infinity,
    readoutHold: 0,
    readoutNow: '',
    readoutText: '',
    readoutNowLevel: '',
    readoutLevel: '',
    bassAverage: 0,
    pulse: 0,
};

const masterScope = {
    ready: false,
    mode: 0,
    modeFlash: 0,
    heatLut: null,
    views: [],
    inline: null,
    windowView: null,
    readouts: [],
    bar: null,
    meterEl: null,
    hit: null,
    popout: null,
    windowEl: null,
    windowOpen: false,
    windowPlaced: false,
    compact: false,
};

function scopeHzToUnit(hz) {
    return Math.log(hz / SCOPE_MIN_HZ) / Math.log(SCOPE_MAX_HZ / SCOPE_MIN_HZ);
}
function scopeUnitToHz(unit) {
    return SCOPE_MIN_HZ * Math.pow(SCOPE_MAX_HZ / SCOPE_MIN_HZ, unit);
}

function buildScopeHeatLut() {
    const lut = new Uint8ClampedArray(256 * 4);
    for (let i = 0; i < 256; i++) {
        const t = i / 255;
        let k = 1;
        while (k < SCOPE_HEAT.length - 1 && SCOPE_HEAT[k][0] < t) k++;
        const a = SCOPE_HEAT[k - 1];
        const b = SCOPE_HEAT[k];
        const f = (t - a[0]) / (b[0] - a[0]);
        for (let c = 0; c < 4; c++) lut[i * 4 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * f;
    }
    return lut;
}

// Each entry is [first bin, last bin, tilt dB] for one log-spaced column or row.
function buildScopeBinMap(count, sampleRate, binCount) {
    const map = new Float32Array(count * 3);
    const binHz = sampleRate / (binCount * 2);
    for (let i = 0; i < count; i++) {
        const lo = scopeUnitToHz(i / count) / binHz;
        const hi = scopeUnitToHz((i + 1) / count) / binHz;
        const center = scopeUnitToHz((i + 0.5) / count);
        map[i * 3] = Math.min(binCount - 1, lo);
        map[i * 3 + 1] = Math.min(binCount - 1, hi);
        map[i * 3 + 2] = SCOPE_TILT_DB_PER_OCTAVE * Math.log2(center / 1000);
    }
    return map;
}

function scopeLevelAt(map, index, data) {
    const lo = map[index * 3];
    const hi = map[index * 3 + 1];
    let db;
    if (hi - lo < 1) {
        const pos = (lo + hi) / 2;
        const k = Math.floor(pos);
        const next = data[Math.min(data.length - 1, k + 1)];
        db = data[k] + (next - data[k]) * (pos - k);
    } else {
        db = -140;
        const end = Math.min(data.length - 1, Math.ceil(hi));
        for (let k = Math.floor(lo); k <= end; k++) if (data[k] > db) db = data[k];
    }
    const value = (db + map[index * 3 + 2] - SCOPE_FLOOR_DB) / SCOPE_RANGE_DB;
    return value < 0 ? 0 : value > 1 ? 1 : value;
}

/* ---------- Views: the inline display and the pop-out window each draw their own copy ---------- */

function createScopeView(canvas, screen) {
    const view = {
        canvas,
        screen,
        ctx: canvas.getContext('2d'),
        trail: document.createElement('canvas'),
        vector: document.createElement('canvas'),
        width: 0,
        height: 0,
        dpr: 1,
        compact: false,
        layout: null,
        bandMap: null,
        rowMap: null,
        sampleRate: 0,
        bands: new Float32Array(0),
        peaks: new Float32Array(0),
        peakHold: new Float32Array(0),
        peakFall: new Float32Array(0),
        scopeGain: 4,
        vectorGain: 2,
        scroll: 0,
        pulseText: '',
    };
    view.trailCtx = view.trail.getContext('2d');
    view.vectorCtx = view.vector.getContext('2d');
    new ResizeObserver(([entry]) => {
        view.width = Math.round(entry.contentRect.width);
        view.height = Math.round(entry.contentRect.height);
        layoutScopeView(view);
    }).observe(canvas);
    masterScope.views.push(view);
    return view;
}

function layoutScopeView(view) {
    view.layout = null;
    view.bandMap = null;
    view.rowMap = null;
    if (!view.width || !view.height) return;
    view.dpr = Math.min(2, window.devicePixelRatio || 1);
    view.canvas.width = Math.round(view.width * view.dpr);
    view.canvas.height = Math.round(view.height * view.dpr);

    const w = view.width;
    const h = view.height;
    let columns = SCOPE_COMPACT_BARS;
    if (view.compact) view.layout = { compact: true };
    else {
        const scale = Math.max(1, Math.min(1.8, h / 34));
        const pad = Math.round(4 * scale);
        const meterW = Math.round(11 * scale);
        const vecSize = w >= 150 ? Math.min(h - pad * 2, Math.round(w * 0.3)) : 0;
        const mainW = w - meterW - pad * 2 - 2 - (vecSize ? vecSize + 10 : 0);
        view.layout = {
            scale,
            main: { x: 0, w: mainW, h },
            vec: vecSize ? { x: mainW + 7, y: Math.round((h - vecSize) / 2), size: vecSize } : null,
            meters: { x: w - meterW - pad, y: pad, w: meterW, h: h - pad * 2 },
        };
        columns = Math.max(8, Math.floor(mainW / 2));

        view.trail.width = Math.max(1, Math.round(mainW * view.dpr));
        view.trail.height = view.canvas.height;
        view.column = view.trailCtx.createImageData(8, view.trail.height);
        if (vecSize) view.vector.width = view.vector.height = Math.round(vecSize * view.dpr);

        const rainbow = context => {
            const gradient = context.createLinearGradient(0, 0, mainW, 0);
            SCOPE_COLORS.forEach((color, i) => gradient.addColorStop(i / (SCOPE_COLORS.length - 1), color));
            return gradient;
        };
        view.gradient = rainbow(view.ctx);
        view.trailGradient = rainbow(view.trailCtx);
        view.fade = view.ctx.createLinearGradient(0, 0, 0, h);
        view.fade.addColorStop(0, 'rgba(0,0,0,0)');
        view.fade.addColorStop(0.45, 'rgba(0,0,0,0.2)');
        view.fade.addColorStop(1, 'rgba(0,0,0,1)');
        if (view === masterScope.inline && masterScope.popout) masterScope.popout.style.right = `${w - mainW + 4}px`;
    }
    view.bands = new Float32Array(columns);
    view.peaks = new Float32Array(columns);
    view.peakHold = new Float32Array(columns);
    view.peakFall = new Float32Array(columns);
}

/* ---------- Setup, modes, compact fitting and the pop-out window ---------- */

function initMasterScope() {
    const s = masterScope;
    s.ready = true;
    s.bar = document.querySelector('.control-bar');
    s.meterEl = document.querySelector('.output-meter');
    s.hit = document.getElementById('scope-mode');
    s.popout = document.getElementById('scope-popout');
    s.windowEl = document.getElementById('scope-window');
    const inlineCanvas = document.getElementById('fft-canvas');
    const windowCanvas = document.getElementById('scope-window-canvas');
    if (!inlineCanvas || !s.hit || !s.windowEl || !windowCanvas) return;
    s.heatLut = buildScopeHeatLut();
    s.inline = createScopeView(inlineCanvas, inlineCanvas.parentElement);
    s.windowView = createScopeView(windowCanvas, windowCanvas.parentElement);
    s.readouts = ['master-db', 'scope-window'].map(prefix => {
        const now = document.getElementById(`${prefix}-now`);
        const peak = document.getElementById(prefix === 'master-db' ? 'master-db-value' : 'scope-window-db');
        return { now, peak, nowCell: now && now.parentElement, peakCell: peak && peak.parentElement };
    });
    try {
        const saved = SCOPE_MODES.findIndex(mode => mode.id === localStorage.getItem('sonicstage-scope-mode'));
        if (saved >= 0) s.mode = saved;
    } catch (_) {}

    s.hit.addEventListener('click', () => (s.compact ? setScopeWindowOpen(!s.windowOpen) : cycleScopeMode()));
    s.popout.addEventListener('click', () => setScopeWindowOpen(!s.windowOpen));
    document.getElementById('scope-window-hit').addEventListener('click', cycleScopeMode);
    document.getElementById('scope-window-close').addEventListener('click', () => {
        setScopeWindowOpen(false);
        (s.compact ? s.hit : s.popout).focus({ preventScroll: true });
    });
    s.windowEl
        .querySelectorAll('[data-scope-mode]')
        .forEach(button => button.addEventListener('click', () => setScopeMode(Number(button.dataset.scopeMode))));
    s.windowEl.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        setScopeWindowOpen(false);
        (s.compact ? s.hit : s.popout).focus({ preventScroll: true });
    });
    initScopeWindowDrag();
    window.addEventListener('resize', () => s.windowOpen && clampScopeWindow());

    let fitQueued = false;
    const queueFit = () => {
        if (fitQueued) return;
        fitQueued = true;
        requestAnimationFrame(() => {
            fitQueued = false;
            fitMasterScope();
        });
    };
    const sizes = new ResizeObserver(queueFit);
    const observeBar = () => {
        sizes.disconnect();
        sizes.observe(s.bar);
        for (const child of s.bar.children) if (child !== s.meterEl) sizes.observe(child);
        queueFit();
    };
    new MutationObserver(observeBar).observe(s.bar, { childList: true });
    observeBar();
    labelMasterScope();
}

function fitMasterScope() {
    const s = masterScope;
    if (getComputedStyle(s.meterEl).display === 'none') return;
    const style = getComputedStyle(s.bar);
    const gap = parseFloat(style.columnGap) || 0;
    let used = 0;
    let count = 0;
    for (const child of s.bar.children) {
        if (child === s.meterEl || !child.getClientRects().length) continue;
        used += child.getBoundingClientRect().width;
        count++;
    }
    const free =
        s.bar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - used - gap * count;
    // A little hysteresis so the display does not flicker between forms at the threshold.
    const compact = free < SCOPE_FULL_MIN_WIDTH + (s.compact ? 12 : 0);
    if (compact === s.compact) return;
    s.compact = compact;
    s.inline.compact = compact;
    s.meterEl.classList.toggle('is-compact', compact);
    layoutScopeView(s.inline);
    labelMasterScope();
}

function labelMasterScope() {
    const s = masterScope;
    const current = SCOPE_MODES[s.mode].label;
    const next = SCOPE_MODES[(s.mode + 1) % SCOPE_MODES.length].label;
    if (s.compact) {
        s.hit.setAttribute('aria-label', s.windowOpen ? 'Close output visualizer' : 'Open output visualizer');
        s.hit.setAttribute('aria-expanded', s.windowOpen);
        s.hit.title = s.windowOpen ? 'Close visualizer' : 'Open visualizer';
    } else {
        s.hit.setAttribute('aria-label', `Output visualizer: ${current}. Switch to ${next}`);
        s.hit.removeAttribute('aria-expanded');
        s.hit.title = `${current} · click for ${next.toLowerCase()}`;
    }
    s.popout.setAttribute('aria-expanded', s.windowOpen);
    s.popout.setAttribute('aria-label', s.windowOpen ? 'Close visualizer window' : 'Pop out visualizer');
    s.popout.title = s.windowOpen ? 'Close window' : 'Pop out';
    document.getElementById('scope-window-hit').setAttribute('aria-label', `${current}. Switch to ${next}`);
    s.windowEl
        .querySelectorAll('[data-scope-mode]')
        .forEach(button => button.setAttribute('aria-pressed', Number(button.dataset.scopeMode) === s.mode));
}

function setScopeMode(index) {
    const s = masterScope;
    s.mode = index;
    s.modeFlash = 1;
    s.views.forEach(view => view.trailCtx.clearRect(0, 0, view.trail.width, view.trail.height));
    labelMasterScope();
    try {
        localStorage.setItem('sonicstage-scope-mode', SCOPE_MODES[index].id);
    } catch (_) {}
}
function cycleScopeMode() {
    setScopeMode((masterScope.mode + 1) % SCOPE_MODES.length);
}

function setScopeWindowOpen(open) {
    const s = masterScope;
    s.windowOpen = open;
    s.windowEl.hidden = !open;
    s.meterEl.classList.toggle('is-popped', open);
    s.windowEl.classList.toggle('is-open', open);
    if (open) {
        if (!s.windowPlaced) placeScopeWindow();
        else clampScopeWindow();
        s.windowEl.focus({ preventScroll: true });
    }
    labelMasterScope();
}

// Opens just under the stage camera controls, or under the header when the stage is not showing.
function placeScopeWindow() {
    const s = masterScope;
    const box = s.windowEl.getBoundingClientRect();
    const tools = document.querySelector('#stage-toolbar .stage-tools');
    const anchor = tools && tools.getClientRects().length ? tools.getBoundingClientRect() : null;
    const header = document.getElementById('transport-header').getBoundingClientRect();
    const right = anchor ? anchor.right : innerWidth - 18;
    const top = anchor ? anchor.bottom + 8 : header.bottom + 12;
    moveScopeWindow(right - box.width, top);
}
function moveScopeWindow(x, y) {
    const box = masterScope.windowEl.getBoundingClientRect();
    const left = Math.max(8, Math.min(innerWidth - box.width - 8, x));
    const top = Math.max(8, Math.min(innerHeight - box.height - 8, y));
    masterScope.windowEl.style.left = `${Math.round(left)}px`;
    masterScope.windowEl.style.top = `${Math.round(top)}px`;
}
function clampScopeWindow() {
    const box = masterScope.windowEl.getBoundingClientRect();
    moveScopeWindow(box.left, box.top);
}

function initScopeWindowDrag() {
    const s = masterScope;
    const handle = s.windowEl.querySelector('.scope-window-bar');
    let grab = null;
    handle.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.target.closest('button')) return;
        const box = s.windowEl.getBoundingClientRect();
        grab = { x: event.clientX - box.left, y: event.clientY - box.top, id: event.pointerId };
        handle.setPointerCapture(event.pointerId);
        s.windowEl.classList.add('is-dragging');
        event.preventDefault();
    });
    handle.addEventListener('pointermove', event => {
        if (!grab || event.pointerId !== grab.id) return;
        moveScopeWindow(event.clientX - grab.x, event.clientY - grab.y);
        s.windowPlaced = true;
    });
    const release = event => {
        if (!grab || event.pointerId !== grab.id) return;
        grab = null;
        s.windowEl.classList.remove('is-dragging');
    };
    handle.addEventListener('pointerup', release);
    handle.addEventListener('pointercancel', release);
}

/* ---------- Shared signal analysis ---------- */

function readMasterScopeSignal(dt, reducedMotion) {
    const sig = scopeSignal;
    const analysers = audioEngine.scopeAnalysers;
    if (analysers && audioEngine.ctx.state === 'running') {
        for (let ch = 0; ch < 2; ch++) {
            analysers[ch].getFloatFrequencyData(sig.freq[ch]);
            analysers[ch].getFloatTimeDomainData(sig.wave[ch]);
        }
    } else {
        sig.freq[0].fill(-140);
        sig.freq[1].fill(-140);
        sig.wave[0].fill(0);
        sig.wave[1].fill(0);
    }
    const left = sig.freq[0];
    const right = sig.freq[1];
    for (let k = 0; k < sig.mix.length; k++) {
        const v = left[k] > right[k] ? left[k] : right[k];
        sig.mix[k] = v > -140 ? v : -140;
    }
    sig.sampleRate = audioEngine.ctx ? audioEngine.ctx.sampleRate : 48000;

    let loudest = 0;
    for (let ch = 0; ch < 2; ch++) {
        const wave = sig.wave[ch];
        let peak = 0;
        for (let i = 0; i < wave.length; i++) {
            const a = wave[i] < 0 ? -wave[i] : wave[i];
            if (a > peak) peak = a;
        }
        if (peak > loudest) loudest = peak;
        const meter = sig.meters[ch];
        const db = peak > 1e-6 ? 20 * Math.log10(peak) : -120;
        const target = Math.max(0, Math.min(1, (db + SCOPE_METER_DB) / SCOPE_METER_DB));
        meter.level = target > meter.level ? target : Math.max(target, meter.level - dt * 0.45);
        if (meter.level >= meter.hold) {
            meter.hold = meter.level;
            meter.holdTime = 1.2;
        } else if ((meter.holdTime -= dt) <= 0) meter.hold = Math.max(meter.level, meter.hold - dt * 0.35);
        meter.clipTime = peak >= 0.98 ? 1.6 : Math.max(0, meter.clipTime - dt);
    }
    sig.loudest = loudest;

    const db = loudest > 1e-6 ? 20 * Math.log10(loudest) : -120;
    sig.readoutHold -= dt;
    if (db >= sig.readoutPeak || sig.readoutHold <= 0) {
        sig.readoutPeak = db;
        sig.readoutHold = 1;
    }
    const nowText = formatScopeDb(db);
    const peakText = formatScopeDb(sig.readoutPeak);
    const nowLevel = scopeDbLevel(db);
    const peakLevel = scopeDbLevel(sig.readoutPeak);
    if (
        nowText !== sig.readoutNow ||
        peakText !== sig.readoutText ||
        nowLevel !== sig.readoutNowLevel ||
        peakLevel !== sig.readoutLevel
    ) {
        sig.readoutNow = nowText;
        sig.readoutText = peakText;
        sig.readoutNowLevel = nowLevel;
        sig.readoutLevel = peakLevel;
        masterScope.readouts.forEach(readout => {
            if (!readout.now) return;
            readout.now.textContent = nowText;
            readout.peak.textContent = peakText;
            readout.nowCell.dataset.level = nowLevel;
            readout.peakCell.dataset.level = peakLevel;
        });
    }

    // Kick detector for the screen glow: the loudest bin under 140 Hz against its running average.
    const binHz = sig.sampleRate / (sig.mix.length * 2);
    let bassDb = -140;
    for (let k = 1; k * binHz < 140; k++) if (sig.mix[k] > bassDb) bassDb = sig.mix[k];
    const bassTilt = SCOPE_TILT_DB_PER_OCTAVE * Math.log2(80 / 1000);
    const bass = Math.max(0, Math.min(1, (bassDb + bassTilt - SCOPE_FLOOR_DB) / SCOPE_RANGE_DB));
    if (!reducedMotion && bass > 0.32 && bass > sig.bassAverage + 0.07 && sig.pulse < 0.45) sig.pulse = 1;
    sig.bassAverage += (bass - sig.bassAverage) * (1 - Math.exp(-dt * 4));
    sig.pulse = reducedMotion ? 0 : sig.pulse * Math.exp(-dt * 6);
}

function updateScopeViewBands(view, dt) {
    if (!view.bandMap || view.sampleRate !== scopeSignal.sampleRate) {
        view.sampleRate = scopeSignal.sampleRate;
        view.bandMap = buildScopeBinMap(view.bands.length, view.sampleRate, scopeSignal.mix.length);
        if (!view.compact) view.rowMap = buildScopeBinMap(view.trail.height, view.sampleRate, scopeSignal.mix.length);
    }
    const attack = 1 - Math.exp(-dt * 38);
    const release = 1 - Math.exp(-dt * 7);
    for (let i = 0; i < view.bands.length; i++) {
        const target = scopeLevelAt(view.bandMap, i, scopeSignal.mix);
        const band = (view.bands[i] += (target - view.bands[i]) * (target > view.bands[i] ? attack : release));
        if (band >= view.peaks[i]) {
            view.peaks[i] = band;
            view.peakHold[i] = 0.7;
            view.peakFall[i] = 0;
        } else if ((view.peakHold[i] -= dt) <= 0) {
            view.peakFall[i] += dt * 1.8;
            view.peaks[i] = Math.max(band, view.peaks[i] - view.peakFall[i] * dt);
        }
    }
}

/* ---------- Drawing ---------- */

function formatScopeDb(db) {
    return db <= -59 ? '−∞' : Math.min(0, db).toFixed(1);
}
function scopeDbLevel(db) {
    return db > -1 ? 'hot' : db > -6 ? 'warm' : db > -59 ? 'ok' : 'idle';
}

function drawScopeCompact(view, ctx, silent) {
    const step = view.width / SCOPE_COMPACT_BARS;
    const barW = step * 0.7;
    for (let i = 0; i < SCOPE_COMPACT_BARS; i++) {
        const color = SCOPE_COLORS[i % SCOPE_COLORS.length];
        if (silent && view.bands[i] < 0.03) {
            ctx.fillStyle = `${color}66`;
            ctx.fillRect(i * step, view.height - 3, barW, 3);
            continue;
        }
        const barH = Math.max(2, view.bands[i] * view.height);
        ctx.fillStyle = color;
        ctx.fillRect(i * step, view.height - barH, barW, barH);
    }
}

function drawScopeBars(view, ctx, main, silent) {
    const count = SCOPE_COMPACT_BARS;
    const k = view.layout.scale;
    const gap = Math.max(2, 1.4 * k);
    const barW = (main.w - gap * (count + 1)) / count;
    const top = 12 * k;
    const base = main.h - 2 * k;
    const span = base - top;
    const group = view.bands.length / count;
    for (let i = 0; i < count; i++) {
        let level = 0;
        let peak = 0;
        const start = Math.floor(i * group);
        const end = Math.min(view.bands.length, Math.ceil((i + 1) * group));
        for (let j = start; j < end; j++) {
            if (view.bands[j] > level) level = view.bands[j];
            if (view.peaks[j] > peak) peak = view.peaks[j];
        }
        const x = main.x + gap + i * (barW + gap);
        const color = SCOPE_COLORS[i % SCOPE_COLORS.length];
        ctx.fillStyle = color;
        if (silent && level < 0.03) {
            ctx.globalAlpha = 0.45;
            ctx.fillRect(x, base - 3 * k, barW, 3 * k);
            ctx.globalAlpha = 1;
            continue;
        }
        const barH = Math.max(3 * k, level * span);
        ctx.globalAlpha = 0.95;
        ctx.fillRect(x, base - barH, barW, barH);
        if (peak > level + 0.02) {
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = '#fff';
            ctx.fillRect(x, base - Math.min(span, peak * span) - k, barW, Math.max(1.5, k));
        }
        ctx.globalAlpha = 1;
    }
}

function drawScopeSpectrum(view, ctx, main, elapsed, silent, reducedMotion) {
    const k = view.layout.scale;
    const top = 11 * k;
    const base = main.h - 1.5 * k;
    const span = base - top;
    const step = main.w / (view.bands.length - 1);
    const line = new Path2D();
    const area = new Path2D();
    area.moveTo(main.x, base);
    for (let i = 0; i < view.bands.length; i++) {
        const px = main.x + i * step;
        const py = base - view.bands[i] * span;
        if (i) line.lineTo(px, py);
        else line.moveTo(px, py);
        area.lineTo(px, py);
    }
    area.lineTo(main.x + main.w, base);
    area.closePath();

    ctx.globalAlpha = 0.7 + scopeSignal.pulse * 0.3;
    ctx.fillStyle = view.gradient;
    ctx.fill(area);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = view.fade;
    ctx.fillRect(main.x, 0, main.w, main.h);

    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = view.gradient;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.2 * k;
    ctx.globalAlpha = 0.26;
    ctx.stroke(line);
    ctx.lineWidth = 1.1 * k;
    ctx.globalAlpha = 1;
    ctx.stroke(line);

    ctx.fillStyle = '#fff';
    ctx.globalAlpha = 0.6;
    for (let i = 0; i < view.peaks.length; i++) {
        if (view.peaks[i] > 0.03) ctx.fillRect(main.x + i * step - 0.75, base - view.peaks[i] * span - 1.2 * k, 1.5, k);
    }

    if (silent) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = view.gradient;
        ctx.fillRect(main.x, base - 0.5, main.w, 1);
        if (!reducedMotion) {
            const sweep = main.x + ((elapsed * 0.22) % 1) * (main.w + 60) - 30;
            const glint = ctx.createLinearGradient(sweep - 26, 0, sweep + 26, 0);
            glint.addColorStop(0, 'rgba(255,255,255,0)');
            glint.addColorStop(0.5, 'rgba(255,255,255,0.75)');
            glint.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = glint;
            ctx.fillRect(sweep - 26, base - 1, 52, 2);
        }
    }

    // Grid and frequency labels sit underneath everything drawn so far.
    ctx.globalCompositeOperation = 'destination-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.055)';
    for (let row = 1; row < 3; row++) ctx.fillRect(main.x, Math.round(top + (span * row) / 3), main.w, 0.5);
    ctx.font = `500 ${6.5 * k}px "IBM Plex Mono", monospace`;
    ctx.textBaseline = 'alphabetic';
    [
        [100, '100'],
        [1000, '1k'],
        [10000, '10k'],
    ].forEach(([hz, label]) => {
        const px = Math.round(main.x + scopeHzToUnit(hz) * main.w);
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fillRect(px, top - 3, 0.5, main.h);
        ctx.fillStyle = 'rgba(255,255,255,0.26)';
        if (px + 16 * k < main.x + main.w) ctx.fillText(label, px + 2.5, main.h - 3 * k);
    });
}

function drawScopeSpectrogram(view, ctx, main, dt, reducedMotion) {
    const tctx = view.trailCtx;
    const tw = view.trail.width;
    const th = view.trail.height;
    const heat = masterScope.heatLut;
    view.scroll += dt * (reducedMotion ? 24 : 46) * view.dpr * view.layout.scale;
    const shift = Math.min(view.column.width, Math.floor(view.scroll));
    view.scroll -= Math.floor(view.scroll);
    if (shift > 0) {
        tctx.globalCompositeOperation = 'copy';
        tctx.drawImage(view.trail, -shift, 0);
        tctx.globalCompositeOperation = 'source-over';
        const pixels = view.column.data;
        const rowStride = view.column.width * 4;
        for (let row = 0; row < th; row++) {
            const value = scopeLevelAt(view.rowMap, th - 1 - row, scopeSignal.mix);
            const lut = Math.round(Math.pow(value, 0.8) * 255) * 4;
            for (let col = 0; col < shift; col++) {
                const p = row * rowStride + col * 4;
                pixels[p] = heat[lut];
                pixels[p + 1] = heat[lut + 1];
                pixels[p + 2] = heat[lut + 2];
                pixels[p + 3] = heat[lut + 3];
            }
        }
        tctx.putImageData(view.column, tw - shift, 0, 0, 0, shift, th);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(view.trail, Math.round(main.x * view.dpr), 0);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(main.x + main.w - 0.5, 0, 0.5, main.h);
}

function drawScopeWaveform(view, ctx, main, dt, reducedMotion) {
    const tctx = view.trailCtx;
    const left = scopeSignal.wave[0];
    const right = scopeSignal.wave[1];
    const k = view.layout.scale;
    const samples = 768;
    let start = 0;
    for (let i = 1; i < left.length - samples; i++) {
        if (left[i - 1] + right[i - 1] < 0 && left[i] + right[i] >= 0) {
            start = i;
            break;
        }
    }
    const targetGain = 0.4 / Math.max(0.05, scopeSignal.loudest);
    view.scopeGain += (targetGain - view.scopeGain) * (1 - Math.exp(-dt * 3));

    tctx.globalCompositeOperation = 'destination-out';
    tctx.globalAlpha = reducedMotion ? 1 : 1 - Math.exp(-dt * 15);
    tctx.fillRect(0, 0, view.trail.width, view.trail.height);
    tctx.globalAlpha = 1;
    tctx.globalCompositeOperation = 'lighter';
    tctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    const mid = main.h / 2;
    const stride = Math.max(1, Math.floor(samples / main.w));
    tctx.beginPath();
    for (let i = 0; i < samples; i += stride) {
        const v = ((left[start + i] + right[start + i]) / 2) * view.scopeGain;
        const px = (i / samples) * main.w;
        const py = mid - Math.max(-0.48, Math.min(0.48, v)) * main.h;
        if (i) tctx.lineTo(px, py);
        else tctx.moveTo(px, py);
    }
    tctx.strokeStyle = view.trailGradient;
    tctx.lineJoin = 'round';
    tctx.lineWidth = 3 * k;
    tctx.globalAlpha = 0.22;
    tctx.stroke();
    tctx.lineWidth = 1.1 * k;
    tctx.globalAlpha = 0.95;
    tctx.stroke();
    tctx.globalAlpha = 1;
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(main.x, Math.round(mid), main.w, 0.5);
    for (let tick = 1; tick < 8; tick++) ctx.fillRect(main.x + (main.w * tick) / 8, mid - 1.5 * k, 0.5, 3 * k);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(view.trail, Math.round(main.x * view.dpr), 0);
    ctx.restore();
}

function drawScopeVector(view, ctx, vec, dt, reducedMotion) {
    const vctx = view.vectorCtx;
    const size = view.vector.width;
    const left = scopeSignal.wave[0];
    const right = scopeSignal.wave[1];
    const k = view.layout.scale;
    const targetGain = 0.34 / Math.max(0.08, scopeSignal.loudest);
    view.vectorGain += (targetGain - view.vectorGain) * (1 - Math.exp(-dt * 3));

    vctx.globalCompositeOperation = 'destination-out';
    vctx.globalAlpha = reducedMotion ? 1 : 1 - Math.exp(-dt * 9);
    vctx.fillRect(0, 0, size, size);
    vctx.globalCompositeOperation = 'lighter';
    vctx.globalAlpha = 0.5;
    vctx.fillStyle = '#6ccbb4';
    const c = size / 2;
    const g = view.vectorGain * size * Math.SQRT1_2;
    const dot = Math.max(1, Math.round(view.dpr * k * 0.6));
    for (let i = 0; i < left.length; i += 3) {
        vctx.fillRect(c + (left[i] - right[i]) * g, c - (left[i] + right[i]) * g, dot, dot);
    }
    vctx.globalAlpha = 1;
    vctx.globalCompositeOperation = 'source-over';

    const cx = vec.x + vec.size / 2;
    const cy = vec.y + vec.size / 2;
    const r = vec.size / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(cx, vec.y);
    ctx.lineTo(cx, vec.y + vec.size);
    ctx.moveTo(cx - r * 0.7, cy - r * 0.7);
    ctx.lineTo(cx + r * 0.7, cy + r * 0.7);
    ctx.moveTo(cx + r * 0.7, cy - r * 0.7);
    ctx.lineTo(cx - r * 0.7, cy + r * 0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = `600 ${5.5 * k}px "IBM Plex Mono", monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillText('L', vec.x - 1, vec.y + 5 * k);
    ctx.fillText('R', vec.x + vec.size - 3 * k, vec.y + 5 * k);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(view.vector, Math.round(vec.x * view.dpr), Math.round(vec.y * view.dpr));
    ctx.restore();
}

function drawScopeMeters(view, ctx, meters) {
    const k = view.layout.scale;
    const barW = Math.round(4 * k);
    const segH = 1.5 * k;
    const gap = k;
    const ledH = 2 * k;
    const height = meters.h - ledH - 2 * k;
    const count = Math.floor((height + gap) / (segH + gap));
    for (let ch = 0; ch < 2; ch++) {
        const meter = scopeSignal.meters[ch];
        const x = ch ? meters.x + meters.w - barW : meters.x;
        ctx.fillStyle = meter.clipTime > 0 ? '#ff4d4d' : 'rgba(255,77,77,0.16)';
        ctx.fillRect(x, meters.y, barW, ledH);
        const holdSegment = Math.round(meter.hold * count) - 1;
        for (let i = 0; i < count; i++) {
            const fraction = (i + 1) / count;
            const db = fraction * SCOPE_METER_DB - SCOPE_METER_DB;
            const lit = fraction <= meter.level + 0.5 / count;
            ctx.globalAlpha = lit ? 1 : i === holdSegment ? 0.95 : 0.13;
            ctx.fillStyle = i === holdSegment && !lit ? '#fff' : db > -6 ? '#ff7959' : db > -18 ? '#f4ca54' : '#69bf91';
            ctx.fillRect(x, meters.y + meters.h - (i + 1) * (segH + gap) + gap, barW, segH);
        }
        ctx.globalAlpha = 1;
    }
}

function drawScopeView(view, dt, elapsed, silent, reducedMotion) {
    const { ctx, layout } = view;
    updateScopeViewBands(view, dt);
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, view.width, view.height);
    if (layout.compact) {
        drawScopeCompact(view, ctx, silent);
        return;
    }

    const pulseText = scopeSignal.pulse.toFixed(2);
    if (pulseText !== view.pulseText) view.screen.style.setProperty('--scope-pulse', (view.pulseText = pulseText));

    const k = layout.scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(layout.main.x, 0, layout.main.w, layout.main.h);
    ctx.clip();
    const mode = SCOPE_MODES[masterScope.mode].id;
    if (mode === 'spectrum') drawScopeSpectrum(view, ctx, layout.main, elapsed, silent, reducedMotion);
    else if (mode === 'spectrogram') drawScopeSpectrogram(view, ctx, layout.main, dt, reducedMotion);
    else if (mode === 'scope') drawScopeWaveform(view, ctx, layout.main, dt, reducedMotion);
    else drawScopeBars(view, ctx, layout.main, silent);
    ctx.restore();

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.font = `600 ${6.5 * k}px "IBM Plex Mono", monospace`;
    ctx.fillStyle = `rgba(255,255,255,${0.36 + masterScope.modeFlash * 0.6})`;
    ctx.fillText(SCOPE_MODES[masterScope.mode].label.toUpperCase(), layout.main.x + 6 * k, 8.5 * k);

    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(layout.main.x + layout.main.w + 3, 4 * k, 0.5, view.height - 8 * k);
    if (layout.vec) {
        drawScopeVector(view, ctx, layout.vec, dt, reducedMotion);
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fillRect(layout.meters.x - 4 * k, 4 * k, 0.5, view.height - 8 * k);
    }
    drawScopeMeters(view, ctx, layout.meters);
}

function drawMasterScope(dt, elapsed, reducedMotion) {
    const s = masterScope;
    if (!s.ready) initMasterScope();
    if (s.meterEl && getComputedStyle(s.meterEl).display === 'none') {
        if (s.windowOpen) setScopeWindowOpen(false);
        return;
    }
    if (!s.views.some(view => view.layout)) return;
    readMasterScopeSignal(dt, reducedMotion);
    s.modeFlash = Math.max(0, s.modeFlash - dt * 0.7);
    const silent = scopeSignal.loudest < 0.0005;
    for (const view of s.views) if (view.layout) drawScopeView(view, dt, elapsed, silent, reducedMotion);
}
