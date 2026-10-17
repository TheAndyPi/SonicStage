const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readPublic } = require('./app-source.cjs');

const elements = new Map();
const html = readPublic('index.html');
for (const match of html.matchAll(/<input\s[^>]*id="(fx-[^"]+)"[^>]*>/g)) {
    const attributes = Object.fromEntries([...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
    const listeners = new Map();
    elements.set(attributes.id, {
        ...attributes,
        addEventListener: (type, listener) => listeners.set(type, listener),
        dispatchEvent(event) {
            listeners.get(event.type)({ target: this });
        },
    });
}
const getElementById = id => {
    if (!elements.has(id)) {
        const listeners = new Map();
        elements.set(id, {
            value: '',
            textContent: '',
            addEventListener: (type, listener) => listeners.set(type, listener),
            click: () => listeners.get('click')(),
        });
    }
    return elements.get(id);
};

function param(value = 0) {
    return {
        value,
        setValueAtTime(value) {
            this.value = value;
        },
        setTargetAtTime(value, time, smoothing) {
            assert.ok(Number.isFinite(value) && Number.isFinite(time) && smoothing > 0);
            this.value = value;
        },
    };
}
function node() {
    return {
        gain: param(1),
        frequency: param(440),
        Q: param(1),
        pan: param(),
        delayTime: param(),
        threshold: param(),
        knee: param(),
        ratio: param(),
        attack: param(),
        release: param(),
        frequencyBinCount: 64,
        connect() {},
    };
}
class AudioContext {
    constructor() {
        this.currentTime = 1;
        this.destination = node();
    }
}
for (const type of [
    'Gain',
    'WaveShaper',
    'BiquadFilter',
    'DynamicsCompressor',
    'Analyser',
    'Convolver',
    'Delay',
    'StereoPanner',
    'ChannelSplitter',
])
    AudioContext.prototype[`create${type}`] = node;

const context = vm.createContext({
    AudioContext,
    Float32Array,
    Uint8Array,
    structuredClone,
    crypto: require('node:crypto').webcrypto,
    matchMedia: () => ({ matches: false }),
    document: { getElementById },
    Event: class {
        constructor(type) {
            this.type = type;
        }
    },
    songChanged() {},
    showStageToast() {},
    applyMeterLayout() {},
});
context.window = context;
const run = code => vm.runInContext(code, context);
for (const file of ['presets', 'effects', 'app-state', 'song', 'audio-engine']) run(readPublic(`js/music/${file}.js`));
// Keep the production graph and UI bindings; omit noise allocation and the playback timer.
run(`audioEngine.createImpulseResponse = () => ({});
    audioEngine.createNoiseBuffer = () => ({});
    audioEngine.startScheduler = () => {};
    songChanged = () => {};
    showStageToast = () => {};
    applyMeterLayout = () => {};`);
const main = readPublic('js/main.js');
run(main.slice(main.indexOf('    // Bind Pro FX Rack Sliders'), main.indexOf('    // Step Edit Mode')));
const slide = (id, value) => {
    const element = getElementById(id);
    element.value = String(value);
    element.dispatchEvent({ type: 'input' });
};
assert.equal(run('audioEngine.ctx'), null, 'binding controls does not start audio');
slide('fx-drive', 0);
assert.ok(run('audioEngine.ctx'), 'first slider interaction initializes the engine');
const initialReverb = run('audioEngine.reverbSend.gain.value');
const initialSwing = run('appState.globalSwing');

// Sample the transfer function as a WaveShaper does, with its half-level input.
function shape(curve, signal) {
    const position = (signal / 2 + 1) * 0.5 * (curve.length - 1);
    const index = Math.floor(position);
    return curve[index] + (curve[Math.min(index + 1, curve.length - 1)] - curve[index]) * (position - index);
}
const curves = [];
for (const amount of [0, 12, 50, 100]) {
    slide('fx-drive', amount);
    const curve = run('audioEngine.driveNode.curve');
    assert.ok([...curve].every(Number.isFinite));
    assert.equal(getElementById('fx-drive-val').textContent, `${amount}%`);
    for (const signal of [-0.9, -0.1, 0, 0.1, 0.9]) {
        assert.ok(Math.abs(shape(curve, signal) + shape(curve, -signal)) < 1e-6, 'no DC offset');
        if (amount === 0) assert.ok(Math.abs(shape(curve, signal) - signal) < 1e-6, 'zero drive is clean');
    }
    curves.push(curve);
}
assert.ok(shape(curves[3], 0.05) > shape(curves[0], 0.05) * 5, 'drive reaches quiet signals');
const harmonicRatio = curve => {
    let fundamental = 0,
        third = 0;
    for (let i = 0; i < 4096; i++) {
        const phase = (i / 4096) * Math.PI * 2;
        const sample = shape(curve, 0.1 * Math.sin(phase));
        fundamental += sample * Math.sin(phase);
        third += sample * Math.sin(phase * 3);
    }
    return Math.abs(third / fundamental);
};
assert.ok(harmonicRatio(curves[0]) < 1e-6);
assert.ok(harmonicRatio(curves[3]) > 0.1, 'drive adds harmonics, not just volume');
assert.ok(harmonicRatio(curves[3]) > harmonicRatio(curves[2]));

// Exercise every other rack slider across the range declared by the real markup.
const bindings = [
    ['fx-eq-low', 'audioEngine.eqLowNode.gain.value', v => v, v => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`],
    ['fx-eq-mid', 'audioEngine.eqMidNode.gain.value', v => v, v => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`],
    ['fx-eq-high', 'audioEngine.eqHighNode.gain.value', v => v, v => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`],
    ['fx-reverb-mix', 'audioEngine.reverbSend.gain.value', v => (v / 100) * 0.9, v => `${v}%`],
    ['fx-delay-mix', 'audioEngine.delayWetGain.gain.value', v => (v / 100) * 0.75, v => `${v}%`],
    ['fx-delay-fb', 'audioEngine.delayFeedback.gain.value', v => v / 100, v => `${v}%`],
    ['fx-global-swing', 'appState.globalSwing', v => v / 100, v => `${v}%`],
    ['fx-comp-thresh', 'audioEngine.compressor.threshold.value', v => v, v => `${v}dB`],
    ['fx-master-vol', 'audioEngine.masterGain.gain.value', v => v / 100, v => `${v}%`],
];
for (const [id, expression, expected, label] of bindings) {
    const element = getElementById(id);
    for (const value of [Number(element.min), (Number(element.min) + Number(element.max)) / 2, Number(element.max)]) {
        slide(id, value);
        assert.ok(Math.abs(run(expression) - expected(value)) < 1e-12, id);
        assert.equal(getElementById(`${id}-val`).textContent, label(value), id);
    }
}
for (const [morph, type, cutoff, badge] of [
    [0, 'lowpass', 80, 'LOWPASS'],
    [24, 'lowpass', 1200, 'LOWPASS'],
    [50, 'lowpass', 20000, 'BYPASS'],
    [76, 'highpass', Math.sqrt(35 * 6500), 'HIGHPASS'],
    [100, 'highpass', 6500, 'HIGHPASS'],
]) {
    slide('fx-filter-morph', morph);
    assert.equal(run('audioEngine.djFilterNode.type'), type);
    assert.ok(Math.abs(run('audioEngine.djFilterNode.frequency.value') - cutoff) < 1e-8);
    assert.equal(getElementById('fx-filter-mode-badge').textContent, badge);
    for (const q of [0.7, 1.2, 12]) {
        slide('fx-filter-q', q);
        assert.equal(run('audioEngine.djFilterNode.Q.value'), q);
        assert.equal(getElementById('fx-filter-q-val').textContent, q.toFixed(1));
    }
}
run('appState.bpm = 120;');
slide('fx-delay-mix', 50);
assert.equal(run('audioEngine.delayNodeL.delayTime.value'), 0.375, 'delay follows tempo');
slide('fx-global-swing', 65);
run('audioEngine.current16thStep = 0; audioEngine.nextNoteTime = 0; audioEngine.advanceStep();');
assert.equal(run('audioEngine.nextNoteTime'), 0.125 * 1.65, 'swing changes note timing by its displayed amount');
run('audioEngine.advanceStep();');
assert.equal(run('audioEngine.nextNoteTime'), 0.25, 'swing preserves beat length');

getElementById('btn-reset-fx').click();
assert.equal(run('audioEngine.reverbSend.gain.value'), initialReverb, 'reset matches initial reverb');
assert.equal(run('appState.globalSwing'), initialSwing, 'reset matches initial swing');
for (const [id, expression, expected, label] of bindings) {
    const value = Number(getElementById(id).value);
    assert.equal(run(expression), expected(value), `${id} resets engine and UI together`);
    assert.equal(getElementById(`${id}-val`).textContent, label(value));
}
assert.equal(run('audioEngine.djFilterNode.frequency.value'), 20000);
assert.equal(run('audioEngine.djFilterNode.Q.value'), 1.2);
assert.equal(getElementById('fx-drive-val').textContent, '12%');

for (const swing of [0, 0.04, 0.65]) {
    context.savedSwing = swing;
    run('var saved = songDocument(); saved.globalSwing = savedSwing; applySongDocument(readSongDocument(saved));');
    assert.equal(Number(getElementById('fx-global-swing').value), swing * 100, 'loaded swing fits slider range');
    assert.equal(getElementById('fx-global-swing-val').textContent, `${Math.round(swing * 100)}%`);
    slide('fx-global-swing', getElementById('fx-global-swing').value);
    assert.equal(run('appState.globalSwing'), swing, 'touching a restored slider preserves its value');
}
console.log(
    'Passed: all 12 pro FX sliders, quiet-signal drive harmonics, clean zero drive, filter sweeps and resonance, delay sync, swing timing and import, and reset defaults.',
);
