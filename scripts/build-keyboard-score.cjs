// Rebuild the preset from the user's original Virtual Piano keyboard notation.
const fs = require('node:fs');
const path = require('node:path');

const whiteKeys = '1234567890qwertyuiopasdfghjklzxcvbnm';
const whitePitchClasses = [0, 2, 4, 5, 7, 9, 11];
const pitches = new Map();
[...whiteKeys].forEach((key, index) => {
    pitches.set(key, 36 + 12 * Math.floor(index / 7) + whitePitchClasses[index % 7]);
});
const shiftedDigits = '!@#$%^&*()';
[...whiteKeys].forEach((key, index) => {
    const midi = pitches.get(key);
    // Only C, D, F, G and A have a sharp key on this keyboard layout.
    if (![0, 2, 5, 7, 9].includes(midi % 12)) return;
    pitches.set(index < 10 ? shiftedDigits[index] : key.toUpperCase(), midi + 1);
});

function convertScore(source) {
    const tokens = source.match(/\[[^\]\n]+\]|-|[^\s]/g) || [];
    return tokens.map(token => {
        if (token === '-') return null;
        const keys = token.startsWith('[') ? token.slice(1, -1) : token;
        const notes = [...keys].map(key => {
            if (!pitches.has(key)) throw new Error(`Unknown piano key: ${key}`);
            return pitches.get(key);
        });
        return [...new Set(notes)].sort((a, b) => a - b);
    });
}

function buildSong(source) {
    const events = convertScore(source);
    const steps = events.flatMap(event => [event, null]);
    const measures = [];
    let heldRoot = 47;
    const scale = [11, 1, 3, 4, 6, 8, 10]; // B major, matching the supplied score.
    const sections = [
        [0, 'Opening'],
        [4, 'Theme'],
        [16, 'Lift'],
        [24, 'Chorus'],
        [32, 'Interlude'],
        [36, 'Final chorus'],
        [44, 'Coda'],
    ];
    const pattern = hits => Array.from({ length: 16 }, (_, step) => hits[step] ?? null);
    function player(index, presetId, hits, volume, pan = 0, ambience = 0.12) {
        const part = pattern(hits);
        return {
            index,
            presetId,
            steps: part,
            heights: part.map((hit, step) =>
                hit === null
                    ? 0
                    : typeof hit === 'string' && ['H', 'C'].includes(hit)
                      ? 0.3
                      : step % 4 === 0
                        ? 0.8
                        : 0.6,
            ),
            volume,
            pan,
            effects: ambience ? [{ id: 'room', amount: ambience, enabled: true }] : [],
            pitchShift: 0,
            muted: false,
            solo: false,
        };
    }
    for (let offset = 0; offset < steps.length; offset += 16) {
        const bar = measures.length;
        const section = sections.filter(([start]) => bar >= start).at(-1)[1];
        const chorus = section.includes('chorus') || section === 'Chorus';
        const final = section === 'Final chorus';
        const sparse = section === 'Opening' || section === 'Interlude' || section === 'Coda';
        const barSteps = Array.from({ length: 16 }, (_, index) => steps[offset + index] ?? null);
        // Follow the score's lower voice at each half-bar instead of imposing a new progression.
        const chords = [0, 8].map(start => {
            const low = barSteps
                .slice(start, start + 8)
                .flatMap(notes => notes || [])
                .filter(note => note < 60);
            if (low.length) heldRoot = low[0];
            const degree = scale.indexOf(heldRoot % 12);
            if (degree < 0) throw new Error('Score harmony falls outside B major');
            const root = 47 + (((heldRoot % 12) - 11 + 12) % 12);
            const third = root + ((scale[(degree + 2) % 7] - (heldRoot % 12) + 12) % 12);
            const fifth = root + ((scale[(degree + 4) % 7] - (heldRoot % 12) + 12) % 12);
            return [root, third, fifth];
        });
        const fade = section === 'Coda' ? Math.max(0.18, (49 - bar) / 5) : 1;
        const slots = [player(0, 'chords_grand', barSteps, (chorus ? 0.62 : 0.72) * fade, -0.08, 0.18)];
        if (bar >= 2 && bar < 48) {
            const bass = {};
            for (const start of [0, 8]) {
                const root = chords[start / 8][0] - 12;
                bass[start] = root;
                if (!sparse) bass[start + 6] = root;
                if (chorus) {
                    bass[start + 3] = root + 12;
                    bass[start + 7] = chords[start / 8][2] - 12;
                }
            }
            slots.push(player(1, 'bass_moog', bass, (chorus ? 0.48 : 0.36) * fade, 0, 0));
        }
        if (bar >= 4 && bar < 46 && section !== 'Interlude') {
            const drums = { 0: 'K', 4: 'G', 8: 'K', 12: 'G' };
            if (chorus) {
                drums[6] = 'K';
                drums[10] = 'K';
            }
            if (section === 'Lift') {
                drums[10] = 'H';
                drums[14] = 'G';
            }
            if ([15, 23, 31, 43].includes(bar)) {
                drums[13] = 'T';
                drums[14] = 'T';
                drums[15] = 'G';
            }
            slots.push(player(2, 'drums_synthwave', drums, (chorus ? 0.53 : 0.36) * fade, 0, 0.08));
            const hats = {};
            for (let step = chorus ? 0 : 2; step < 16; step += chorus ? 2 : 4)
                hats[step] = step % 4 === 2 && chorus ? 'O' : 'C';
            slots.push(player(3, 'drums_hats', hats, (final ? 0.22 : 0.16) * fade, 0.2, 0));
        }
        if ((bar >= 8 && bar < 32) || (bar >= 36 && bar < 47)) {
            const pads = { 0: chords[0].map(note => note + 12), 8: chords[1].map(note => note + 12) };
            slots.push(player(4, 'strings_ensemble', pads, (chorus ? 0.24 : 0.14) * fade, 0.28, 0.26));
        }
        if (section === 'Lift' || chorus) {
            const arp = {};
            for (let step = 2; step < 16; step += final ? 2 : 4) {
                const chord = chords[step < 8 ? 0 : 1];
                arp[step] = [chord[(step / 2 + bar) % 3] + 12];
            }
            slots.push(player(5, 'chords_arp', arp, final ? 0.17 : 0.12, -0.32, 0.2));
        }
        if (section === 'Interlude' || final) {
            // Long, low responses leave the piano's upper melody exposed.
            slots.push(
                player(6, 'strings_cello', { 0: chords[0][0], 8: chords[1][2] }, final ? 0.2 : 0.28, -0.25, 0.25),
            );
        }
        if (bar === 48) {
            // Only one source attack remains in the final bar: let its tail close the song.
            slots.forEach(slot =>
                slot.steps.forEach((_, step) => {
                    if (offset + step >= steps.length) {
                        slot.steps[step] = null;
                        slot.heights[step] = 0;
                    }
                }),
            );
        }
        measures.push({
            label: `${section} ${bar + 1}`,
            slots,
        });
    }
    return {
        format: 'sonicstage-song',
        version: 1,
        title: 'Piano Keyboard Score — Full Band',
        bpm: 128,
        timeSignature: '4/4',
        // C/Dorian is the engine's identity chromatic mapping, preserving sharps.
        rootKey: 0,
        scaleMode: 'dorian',
        globalSwing: 0,
        masterEffects: [],
        loop: false,
        selected: 0,
        measures,
    };
}

if (require.main === module) {
    const folder = path.resolve(__dirname, '../public/songs');
    const song = buildSong(fs.readFileSync(path.join(folder, 'keyboard-score.txt'), 'utf8'));
    fs.writeFileSync(path.join(folder, 'keyboard-score-piano.json'), JSON.stringify(song, null, 2) + '\n');
    console.log(`Built ${song.title}: ${song.measures.length} bars at ${song.bpm} BPM`);
}

module.exports = { convertScore, buildSong };
