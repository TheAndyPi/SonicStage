/* Performer inserts. Only populated channels allocate processors or LFOs. */
const MAX_PERFORMER_EFFECTS = 4;
const EFFECT_CATEGORIES = {
    tone: { name: 'Tone', color: '#c59a43', visual: 'pulse', glyph: '≋' },
    grit: { name: 'Grit', color: '#dd775e', visual: 'spark', glyph: 'ϟ' },
    space: { name: 'Space', color: '#6ca7bc', visual: 'orbit', glyph: '◎' },
    motion: { name: 'Motion', color: '#a58ac6', visual: 'warp', glyph: '∿' },
};
const PERFORMER_EFFECTS = [
    ['bass-boost', 'Bass boost', 'tone', 'Big, rounded low end'],
    ['warmth', 'Warmth', 'tone', 'Mellow, golden tone'],
    ['air', 'Air', 'tone', 'Crisp, sparkling highs'],
    ['telephone', 'Telephone', 'tone', 'Small-speaker character'],
    ['underwater', 'Underwater', 'tone', 'Deep, muffled texture'],
    ['wah', 'Auto wah', 'motion', 'A slow, talking filter'],
    ['overdrive', 'Overdrive', 'grit', 'Warm, driven harmonics'],
    ['fuzz', 'Fuzz', 'grit', 'Thick, unruly distortion'],
    ['bitcrush', 'Bitcrush', 'grit', 'Crunchy digital steps'],
    ['echo', 'Echo', 'space', 'Repeats in time with the beat'],
    ['slapback', 'Slapback', 'space', 'A short, vintage bounce'],
    ['dub-delay', 'Dub delay', 'space', 'Dark, rolling repeats'],
    ['room', 'Room', 'space', 'Close, intimate reflections'],
    ['hall', 'Hall', 'space', 'A wide concert-hall tail'],
    ['cavern', 'Cavern', 'space', 'Long, drifting atmosphere'],
    ['chorus', 'Chorus', 'motion', 'Lush, doubled movement'],
    ['flanger', 'Flanger', 'motion', 'Sweeping metallic ripples'],
    ['vibrato', 'Vibrato', 'motion', 'Wavy, bending pitch'],
    ['tremolo', 'Tremolo', 'motion', 'Rhythmic volume pulses'],
    ['auto-pan', 'Auto pan', 'motion', 'A wandering stereo image'],
    ['ring-mod', 'Ring mod', 'motion', 'Robotic, bell-like overtones'],
].map(([id, name, category, description]) => ({ ...EFFECT_CATEGORIES[category], id, name, category, description }));
const PERFORMER_EFFECT_BY_ID = new Map(PERFORMER_EFFECTS.map(effect => [effect.id, effect]));

function normalizePerformerEffects(effects) {
    if (!Array.isArray(effects)) return [];
    const seen = new Set();
    return effects
        .filter(effect => {
            if (!effect || !PERFORMER_EFFECT_BY_ID.has(effect.id) || seen.has(effect.id)) return false;
            seen.add(effect.id);
            return true;
        })
        .slice(0, MAX_PERFORMER_EFFECTS)
        .map(effect => ({
            id: effect.id,
            amount: Number.isFinite(effect.amount) ? Math.max(0, Math.min(1, effect.amount)) : 0.5,
            enabled: effect.enabled !== false,
        }));
}

class PerformerEffectRack {
    constructor(engine, effects, time) {
        this.engine = engine;
        this.ctx = engine.ctx;
        this.nodes = [];
        this.oscillators = [];
        this.processors = [];
        this.input = this.node('Gain');
        this.output = this.node('Gain');
        let previous = this.input;
        effects.forEach(effect => {
            const processor = this.createProcessor(effect.id);
            previous.connect(processor.input);
            previous = processor.output;
            this.processors.push(processor);
        });
        previous.connect(this.output);
        this.initializing = true;
        this.update(effects, time);
        this.initializing = false;
    }

    node(type, ...args) {
        const node = this.ctx[`create${type}`](...args);
        this.nodes.push(node);
        return node;
    }

    target(param, value, time) {
        if (this.initializing) param.value = value;
        else param.setTargetAtTime(value, Math.max(this.ctx.currentTime, time), 0.018);
    }

    lfo(param, rate, depth) {
        const oscillator = this.node('Oscillator');
        const gain = this.node('Gain');
        oscillator.frequency.value = rate;
        gain.gain.value = depth;
        oscillator.connect(gain);
        gain.connect(param);
        oscillator.start();
        this.oscillators.push(oscillator);
        return { oscillator, gain };
    }

    createProcessor(id) {
        const input = this.node('Gain');
        const output = this.node('Gain');
        const dry = this.node('Gain');
        const wet = this.node('Gain');
        input.connect(dry);
        dry.connect(output);
        wet.connect(output);
        let update = () => {};
        let wetScale = 1;
        if (['bass-boost', 'warmth', 'air', 'telephone', 'underwater', 'wah'].includes(id)) {
            const filter = this.node('BiquadFilter');
            input.connect(filter);
            filter.connect(wet);
            const settings = {
                'bass-boost': ['lowshelf', 180, 14, 0.7],
                warmth: ['lowpass', 2600, 0, 0.6],
                air: ['highshelf', 3800, 10, 0.7],
                telephone: ['bandpass', 1500, 0, 1.8],
                underwater: ['lowpass', 350, 0, 1.1],
                wah: ['bandpass', 1100, 0, 2.8],
            }[id];
            filter.type = settings[0];
            filter.frequency.value = settings[1];
            filter.gain.value = settings[2];
            filter.Q.value = settings[3];
            if (id === 'bass-boost') wetScale = 0.72;
            if (id === 'air') wetScale = 0.8;
            if (id === 'wah') this.lfo(filter.frequency, 0.8, 850);
        } else if (['overdrive', 'fuzz', 'bitcrush'].includes(id)) {
            const shaper = this.node('WaveShaper');
            const curve = new Float32Array(4096);
            for (let i = 0; i < curve.length; i++) {
                const x = (i * 2) / (curve.length - 1) - 1;
                curve[i] = id === 'bitcrush' ? Math.round(x * 12) / 12 : Math.tanh(x * (id === 'fuzz' ? 14 : 4)) * 0.65;
            }
            shaper.curve = curve;
            shaper.oversample = id === 'bitcrush' ? 'none' : '2x';
            input.connect(shaper);
            shaper.connect(wet);
        } else if (['echo', 'slapback', 'dub-delay'].includes(id)) {
            const delay = this.node('Delay', 2);
            const feedback = this.node('Gain');
            const filter = this.node('BiquadFilter');
            filter.type = 'lowpass';
            filter.frequency.value = id === 'dub-delay' ? 1700 : 5200;
            input.connect(delay);
            delay.connect(filter);
            filter.connect(feedback);
            feedback.connect(delay);
            filter.connect(wet);
            wetScale = 0.65;
            update = (amount, time, bpm) => {
                const beat = 60 / Math.max(1, Math.min(2400, bpm));
                let repeatTime = beat * (id === 'dub-delay' ? 0.75 : 0.5);
                while (repeatTime > 1.8) repeatTime /= 2;
                this.target(delay.delayTime, id === 'slapback' ? 0.095 : repeatTime, time);
                this.target(feedback.gain, id === 'slapback' ? 0.12 : 0.18 + amount * 0.42, time);
            };
        } else if (['room', 'hall', 'cavern'].includes(id)) {
            const reverb = this.node('Convolver');
            if (!this.engine.performerImpulses) this.engine.performerImpulses = new Map();
            if (!this.engine.performerImpulses.has(id)) {
                const duration = { room: 0.45, hall: 1.8, cavern: 3.8 }[id];
                this.engine.performerImpulses.set(id, this.engine.createImpulseResponse(duration, 2.6));
            }
            reverb.buffer = this.engine.performerImpulses.get(id);
            input.connect(reverb);
            reverb.connect(wet);
            wetScale = 0.85;
        } else if (['chorus', 'flanger', 'vibrato'].includes(id)) {
            const delay = this.node('Delay', 0.1);
            delay.delayTime.value = { chorus: 0.022, flanger: 0.004, vibrato: 0.012 }[id];
            const mod = this.lfo(delay.delayTime, id === 'vibrato' ? 4.5 : 0.45, 0.002);
            input.connect(delay);
            delay.connect(wet);
            update = (amount, time) => this.target(mod.gain.gain, amount * (id === 'flanger' ? 0.003 : 0.007), time);
        } else if (id === 'auto-pan' && this.ctx.createStereoPanner) {
            const panner = this.node('StereoPanner');
            this.lfo(panner.pan, 0.65, 0.95);
            input.connect(panner);
            panner.connect(wet);
        } else {
            const modulated = this.node('Gain');
            modulated.gain.value = id === 'ring-mod' ? 0 : 0.55;
            const mod = this.lfo(modulated.gain, id === 'ring-mod' ? 45 : 4, id === 'ring-mod' ? 0.9 : 0.45);
            input.connect(modulated);
            modulated.connect(wet);
            update = (amount, time, bpm) => {
                if (id === 'tremolo') this.target(mod.oscillator.frequency, Math.min(12, bpm / 30), time);
            };
        }
        return {
            input,
            output,
            update: (effect, time, bpm) => {
                this.target(dry.gain, 1 - effect.amount, time);
                this.target(wet.gain, effect.amount * wetScale, time);
                update(effect.amount, time, bpm);
            },
        };
    }

    update(effects, time) {
        this.processors.forEach((processor, index) => processor.update(effects[index], time, appState.bpm));
    }

    dispose() {
        this.oscillators.forEach(oscillator => oscillator.stop());
        this.nodes.forEach(node => node.disconnect());
        this.nodes.length = 0;
        this.oscillators.length = 0;
    }
}
