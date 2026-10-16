/*
 * Local song composer. Returns a regular SonicStage document without changing
 * the open song, so callers can take an undo snapshot before applying it.
 *
 * generateSong({ style: 'house', bars: 16, energy: 'medium', seed: 'optional' })
 * applySongDocument(readSongDocument(generateSong(options)))
 */
(function (scope) {
    'use strict';

    // Notes are encoded in the editor's source C Dorian scale. The audio engine
    // maps them to the document's key and mode at playback time.
    const SOURCE_SCALE = [0, 2, 3, 5, 7, 9, 10];
    const STYLES = {
        house: {
            bpm: 122, mode: 'minor', swing: 0.035,
            progression: [0, 5, 2, 6],
            sections: ['Intro', 'Groove', 'Build', 'Drop', 'Breakdown', 'Final drop', 'Outro'],
            presets: ['drums_house909', 'drums_ukgarage', 'bass_moog', 'chords_dubtechno', 'melody_marimba', 'strings_ensemble'],
            levels: [0.76, 0.43, 0.68, 0.49, 0.45, 0.27],
            pans: [0, 0.12, 0, -0.16, 0.21, -0.24],
            motifs: [[0, 2, 4, 6, 4, 2], [4, 2, 0, 2, 6, 4], [0, 4, 2, 6, 4, 0]]
        },
        lofi: {
            bpm: 82, mode: 'dorian', swing: 0.18,
            progression: [0, 3, 1, 4],
            sections: ['Intro', 'Verse', 'Turnaround', 'Refrain', 'Bridge', 'Reprise', 'Outro'],
            presets: ['drums_boombap', 'drums_hats', 'bass_upright', 'chords_rhodes', 'melody_sax', 'strings_ensemble'],
            levels: [0.64, 0.23, 0.64, 0.57, 0.43, 0.21],
            pans: [0, -0.17, 0, -0.18, 0.19, 0.29],
            motifs: [[4, 6, 4, 2, 1, 0], [2, 4, 6, 4, 2, 0], [6, 4, 2, 1, 2, 0]]
        },
        cinematic: {
            bpm: 94, mode: 'harmonicMinor', swing: 0,
            progression: [0, 5, 3, 4],
            sections: ['Opening', 'Theme', 'Rising', 'Climax', 'Interlude', 'Return', 'Coda'],
            presets: ['drums_taiko', 'strings_frenchhorn', 'bass_organped', 'chords_grand', 'strings_spiccato', 'strings_ensemble'],
            levels: [0.63, 0.38, 0.55, 0.50, 0.40, 0.42],
            pans: [0, 0.22, 0, -0.17, -0.28, 0.19],
            motifs: [[0, 4, 2, 6, 4, 0], [0, 2, 4, 6, 8, 7], [4, 6, 7, 6, 4, 2]]
        },
        funk: {
            bpm: 108, mode: 'mixolydian', swing: 0.075,
            progression: [0, 0, 3, 6],
            sections: ['Intro', 'Pocket', 'Pickup', 'Hook', 'Break', 'Solo', 'Outro'],
            presets: ['drums_boombap', 'drums_hats', 'bass_slap', 'chords_clav', 'melody_guitar', 'strings_brass'],
            levels: [0.72, 0.36, 0.71, 0.47, 0.45, 0.32],
            pans: [0, 0.19, 0, -0.25, 0.23, -0.12],
            motifs: [[0, 2, 3, 4, 6, 4], [4, 2, 0, 2, 4, 6], [0, 0, 2, 4, 3, 2]]
        }
    };

    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    const round = value => Math.round(value * 1000) / 1000;

    function randomSource(seed) {
        let state = 2166136261;
        for (const char of String(seed)) {
            state ^= char.charCodeAt(0);
            state = Math.imul(state, 16777619);
        }
        return function () {
            state += 0x6D2B79F5;
            let value = Math.imul(state ^ state >>> 15, 1 | state);
            value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
            return ((value ^ value >>> 14) >>> 0) / 4294967296;
        };
    }

    function note(degree, octave = 60) {
        return octave + Math.floor(degree / 7) * 12 + SOURCE_SCALE[((degree % 7) + 7) % 7];
    }

    function grid(events) {
        const steps = Array(16).fill(null);
        events.forEach(([step, value]) => {
            steps[step] = Array.isArray(value) ? [...value] : value;
        });
        return steps;
    }

    function put(steps, positions, value) {
        positions.forEach((step, index) => {
            const event = typeof value === 'function' ? value(index, step) : value;
            steps[step] = Array.isArray(event) ? [...event] : event;
        });
        return steps;
    }

    function chordVoicing(degree, previous, seventh = true) {
        const chord = [0, 2, 4, ...(seventh ? [6] : [])].map(interval => note(degree + interval));
        let best = chord;
        let bestCost = Infinity;
        for (let inversion = 0; inversion < chord.length; inversion++) {
            const inverted = chord.slice(inversion).concat(chord.slice(0, inversion).map(value => value + 12));
            [-24, -12, 0, 12].forEach(shift => {
                const candidate = inverted.map(value => value + shift);
                if (candidate[0] < 48 || candidate.at(-1) > 84) return;
                const center = candidate.reduce((sum, value) => sum + value, 0) / candidate.length;
                const movement = previous
                    ? candidate.reduce((sum, value, index) => sum + Math.abs(value - previous[Math.min(index, previous.length - 1)]), 0)
                    : 0;
                const cost = movement + Math.abs(center - 65) * 0.7;
                if (cost < bestCost) { best = candidate; bestCost = cost; }
            });
        }
        return best;
    }

    function sectionsFor(bars) {
        // A short form still has an entrance, a theme, tension, a payoff, and an
        // ending. Longer forms add a quiet bridge and a distinct final return.
        return bars === 8
            ? [[0, 1], [1, 2], [2, 1], [3, 2], [5, 1], [6, 1]]
            : [[0, bars / 8], [1, bars / 4], [2, bars / 8], [3, bars / 4], [4, bars / 16], [5, bars / 8], [6, bars / 16]];
    }

    function makeContext(section, offset, length, index, total, energy) {
        const progress = length < 2 ? 1 : offset / (length - 1);
        const sectionGains = [0.68 + progress * 0.14, 0.87, 0.84 + progress * 0.16, 1, 0.64, 1.04, 0.72 - progress * 0.20];
        return {
            section, offset, length, index, progress, energy,
            intro: section === 0, build: section === 2, hook: section === 3 || section === 5,
            bridge: section === 4, outro: section === 6,
            final: index === total - 1,
            fill: section !== 6 && offset === length - 1 && (section === 2 || section === 3 || section === 5 || (section === 1 && energy > 0)),
            gain: sectionGains[section] * [0.84, 1, 1.06][energy]
        };
    }

    function rhythm(style, ctx) {
        const main = Array(16).fill(null);
        const support = Array(16).fill(null);
        const quiet = ctx.intro || ctx.bridge;
        if (style === 'house') {
            put(main, quiet ? [0, 8] : [0, 4, 8, 12], 'K');
            put(main, quiet ? [6, 14] : [2, 6, 10, 14], 'O');
            if (!quiet) {
                put(support, [4, 12], 'S');
                if (ctx.energy > 0) put(support, [1, 3, 5, 7, 9, 11, 13, 15], 'C');
            }
            if (ctx.build) {
                put(support, ctx.progress > 0.5 ? [4, 6, 8, 10, 12, 14] : [4, 8, 12], 'S');
                if (ctx.fill) put(support, [12, 13, 14, 15], 'S');
            } else if (ctx.fill) put(support, ctx.energy === 2 ? [12, 14, 15] : [12, 15], 'S');
        } else if (style === 'cinematic') {
            put(main, quiet ? [0] : [0, 8], 'T');
            if (!quiet) put(main, [6, 14], 'M');
            if (ctx.build || ctx.hook) {
                put(main, [4, 10, 12], 'M');
                if (ctx.energy > 0) put(main, [2, 7, 9, 15], 'S');
            }
            if (ctx.fill) put(main, [10, 12, 13, 14, 15], index => index % 2 ? 'T' : 'M');
        } else {
            put(main, quiet ? [0, 8] : (style === 'funk' ? [0, 3, 8, 10] : [0, 7, 8, 10]), 'K');
            if (!ctx.intro || ctx.offset > 0) put(main, [4, 12], 'S');
            put(main, quiet ? [6, 14] : [2, 6, 14], 'H');
            if (!quiet) {
                put(support, style === 'funk' || ctx.energy === 2 ? [1, 3, 5, 7, 9, 11, 13, 15] : [2, 6, 10, 14], 'C');
                if (style === 'funk') put(support, [6, 14], 'O');
            }
            if (ctx.fill) put(main, ctx.energy === 2 ? [12, 13, 15] : [12, 15], 'S');
        }
        if (ctx.bridge) {
            // Leave a genuine gap before the final return.
            for (let step = 8; step < 16; step++) main[step] = null;
        }
        if (ctx.outro) {
            for (let step = 12; step < 16; step++) { main[step] = null; support[step] = null; }
        }
        if (ctx.final) return [grid([[0, style === 'cinematic' ? 'T' : 'K']]), Array(16).fill(null)];
        return [main, support];
    }

    function bassLine(style, degree, nextDegree, ctx) {
        const steps = Array(16).fill(null);
        if (ctx.intro && ctx.offset < Math.max(1, ctx.length / 2)) return steps;
        if (ctx.bridge && ctx.offset === 0) return steps;
        if (ctx.final) return grid([[0, note(0, 36)]]);
        if (ctx.outro || style === 'cinematic') return grid([[0, note(degree, 36)], [8, note(degree + 4, 36)]]);
        if (style === 'house') {
            put(steps, [2, 6, 10, 14], (index) => note(degree + (index === 3 && ctx.offset % 2 ? 4 : 0), 36));
            if (ctx.energy === 2 && ctx.hook) put(steps, [7, 15], note(degree + 7, 36));
        } else if (style === 'lofi') {
            put(steps, [0, 6, 8, 14], index => note(degree + [0, 4, 0, 2][index], 36));
            if (ctx.offset % 2 && ctx.energy > 0) steps[11] = note(degree + 6, 36);
        } else {
            put(steps, [0, 3, 6, 7, 8, 10, 14], index => note(degree + [0, 7, 4, 6, 0, 7, 4][index], 36));
            if (ctx.energy === 0) [7, 10].forEach(step => { steps[step] = null; });
            if (ctx.energy === 2) steps[11] = note(degree + 2, 36);
        }
        // A single pickup leads into the next chord instead of changing the
        // whole bass pattern every bar.
        if (ctx.offset % 4 === 3 || ctx.fill) steps[15] = note(nextDegree, 36);
        if (ctx.build && ctx.progress > 0.7) [12, 13, 14, 15].forEach(step => { steps[step] = null; });
        return steps;
    }

    function harmony(style, degree, chord, ctx) {
        if (ctx.final) return grid([[0, chord]]);
        if (ctx.intro || ctx.bridge || ctx.outro) return grid([[0, chord], [8, chord]]);
        if (style === 'house') return put(Array(16).fill(null), ctx.energy === 0 ? [2, 10] : [2, 6, 10, 14], chord);
        if (style === 'lofi') {
            const ninth = [...chord, note(degree + 8)];
            return grid([[0, ninth], [7, chord.slice(1)], [10, chord], [14, chord.slice(1)]]);
        }
        if (style === 'cinematic') return grid([[0, chord], [4, [chord[1], chord[2]]], [8, chord], [12, [chord[0] + 12, chord[2]]]]);
        return grid([[1, chord.slice(1)], [3, chord], [6, [chord[1]]], [9, chord], [11, chord.slice(0, 2)], [14, chord]]);
    }

    function melody(style, degree, motif, ctx) {
        if (ctx.final) return grid([[0, note(0, 72)]]);
        if (ctx.intro && ctx.offset < ctx.length - 1) return Array(16).fill(null);
        if (ctx.section === 1 && ctx.offset % 2 === 0) return Array(16).fill(null);
        if (ctx.build) {
            const rising = [0, 2, 4, 6];
            return put(Array(16).fill(null), ctx.progress > 0.5 ? [0, 2, 4, 6, 8, 10, 12, 14] : [0, 4, 8, 12], index => note(degree + rising[index % 4], 72));
        }
        const positions = style === 'funk' ? [0, 3, 5, 7, 10, 14]
            : style === 'lofi' ? [2, 5, 8, 10, 12, 14]
            : style === 'cinematic' ? [0, 2, 4, 8, 10, 12]
            : [0, 3, 6, 8, 10, 14];
        const steps = Array(16).fill(null);
        positions.forEach((step, index) => {
            if ((ctx.intro || ctx.bridge || ctx.outro || ctx.energy === 0) && index % 2) return;
            // The same six-note idea returns over each chord. Alternate bars
            // answer it in reverse, with a chord-tone resolution at phrase ends.
            const motifIndex = ctx.offset % 2 ? motif.length - 1 - index : index;
            let pitch = note(degree + motif[motifIndex], style === 'lofi' ? 60 : 72);
            while (pitch > 84) pitch -= 12;
            while (pitch < 65) pitch += 12;
            steps[step] = pitch;
        });
        if (ctx.offset % 4 === 3 || ctx.fill) steps[14] = note(degree, 72);
        if (style === 'cinematic' && ctx.energy === 2 && ctx.hook) {
            [1, 5, 9, 13].forEach((step, index) => { steps[step] = note(degree + [0, 4, 2, 4][index], 72); });
        }
        return steps;
    }

    function texture(style, chord, ctx) {
        if (ctx.final) return style === 'funk' ? grid([[0, chord]]) : grid([[0, chord.map(pitch => pitch + 12)]]);
        if (style === 'funk') return ctx.hook ? grid([[5, chord], [13, chord]]) : Array(16).fill(null);
        if (style === 'lofi' && !(ctx.intro || ctx.bridge || ctx.outro)) return Array(16).fill(null);
        if (style === 'house' && !(ctx.build || ctx.hook || ctx.bridge)) return Array(16).fill(null);
        return grid([[0, chord], [6, chord], [12, chord]]);
    }

    function makeSlot(index, presetId, steps, ctx, config) {
        const heights = steps.map((event, step) => event === null ? 0 : round(clamp((step % 4 === 0 ? 0.96 : step % 2 === 0 ? 0.8 : 0.62) * ctx.gain, 0.2, 1)));
        return {
            index, presetId, steps, heights,
            volume: round(clamp(config.levels[index] * ctx.gain, 0, 1)),
            pan: config.pans[index], pitchShift: 0, muted: false, solo: false
        };
    }

    scope.generateSong = function generateSong(options = {}) {
        if (!options || typeof options !== 'object') throw new Error('Choose song settings to continue.');
        const style = options.style ?? 'house';
        const bars = Number(options.bars ?? 16);
        const energyName = options.energy ?? 'medium';
        const energy = ['low', 'medium', 'high'].indexOf(energyName);
        if (!Object.hasOwn(STYLES, style)) throw new Error('Choose House, Lo-fi, Cinematic, or Funk.');
        if (![8, 16, 32].includes(bars)) throw new Error('Choose a length of 8, 16, or 32 bars.');
        if (energy < 0) throw new Error('Choose low, medium, or high energy.');
        if (options.seed !== undefined && !['string', 'number'].includes(typeof options.seed)) throw new Error('Use text or a number for the song seed.');
        const seed = options.seed ?? `${Date.now()}-${Math.random()}`;
        const random = randomSource(seed);
        const config = STYLES[style];
        const presets = [...config.presets];
        // Keep a consistent ensemble for the whole song. Timbre variation is
        // restricted to instruments that serve the same musical role.
        if (style === 'lofi' && random() > 0.5) { presets[3] = 'chords_wurli'; presets[4] = 'melody_flute'; }
        if (style === 'house' && random() > 0.5) presets[3] = 'chords_juno';
        if (style === 'cinematic' && energy === 0) presets[4] = 'strings_cello';
        const missing = presets.find(id => !INSTRUMENT_PRESETS.some(preset => preset.id === id));
        if (missing) throw new Error(`The sound library is missing ${missing}.`);
        const rootKeys = [0, 2, 5, 7, 9];
        const motif = config.motifs[Math.floor(random() * config.motifs.length)];
        const document = {
            format: 'sonicstage-song', version: 1,
            bpm: config.bpm + (energy - 1) * (style === 'lofi' ? 3 : 5) + (Math.floor(random() * 3) - 1) * 2,
            rootKey: rootKeys[Math.floor(random() * rootKeys.length)], scaleMode: config.mode,
            globalSwing: config.swing, loop: false, selected: 0, measures: []
        };
        let previousChord = null;
        sectionsFor(bars).forEach(([section, length]) => {
            for (let offset = 0; offset < length; offset++) {
                const index = document.measures.length;
                const ctx = makeContext(section, offset, length, index, bars, energy);
                const degree = ctx.final || ctx.intro ? 0 : config.progression[offset % config.progression.length];
                const nextDegree = ctx.fill || ctx.outro ? 0 : config.progression[(offset + 1) % config.progression.length];
                const chord = chordVoicing(degree, previousChord, style !== 'funk' || degree === 0);
                previousChord = chord;
                const [drums, percussion] = rhythm(style, ctx);
                const support = style === 'cinematic'
                    ? (ctx.hook || ctx.build ? grid([[0, chord], [8, chord]]) : Array(16).fill(null))
                    : percussion;
                const patterns = [drums, support, bassLine(style, degree, nextDegree, ctx), harmony(style, degree, chord, ctx), melody(style, degree, motif, ctx), texture(style, chord, ctx)];
                const label = config.sections[section] + (offset ? ` · ${offset + 1}` : '');
                document.measures.push({ label, slots: patterns.flatMap((steps, slotIndex) =>
                    steps.some(event => event !== null) ? [makeSlot(slotIndex, presets[slotIndex], steps, ctx, config)] : []) });
            }
        });
        // Use the import validator as the authority for the document contract.
        // Validation builds independent runtime slots and does not apply them.
        readSongDocument(document);
        return document;
    };
})(globalThis);
