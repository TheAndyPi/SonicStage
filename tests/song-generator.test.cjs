const assert = require('node:assert/strict');
const vm = require('node:vm');
const { appSource, readPublic } = require('./app-source.cjs');

const html = appSource();
const start = html.indexOf('const KEY_NAMES =');
const end = html.indexOf('function applySongDocument(');
assert(start > 0 && end > start, 'Existing song validator and sound library are available');
const context = vm.createContext({
    structuredClone,
    window: { matchMedia: () => ({ matches: false }) },
    document: { getElementById: id => (id === 'project-title' ? { value: 'Current song' } : null) },
});
// Exercise the actual app's presets, state model, and import validator. No DOM,
// renderer, or audio device is needed to validate composition and persistence.
vm.runInContext(html.slice(start, end), context);
vm.runInContext(readPublic('js/music/song-generator.js'), context);
const originalSong = vm.runInContext('JSON.stringify(songDocument())', context);
const styles = context.SONG_STYLES.map(style => style.id);
assert(styles.length >= 16, 'The generator offers a wide selection of styles');
assert.equal(new Set(styles).size, styles.length);
const energies = ['low', 'medium', 'high'];
const allowedChroma = new Set([0, 2, 3, 5, 7, 9, 10]);
const meterSteps = { '2/4': 8, '3/4': 12, '4/4': 16, '5/8': 10, '6/8': 12, '7/8': 14 };
let generated = 0;

function activity(measure) {
    return measure.slots.reduce((sum, slot) => sum + slot.steps.filter(event => event !== null).length, 0);
}

function pitchesOf(event) {
    if (typeof event === 'number') return [event];
    if (Array.isArray(event)) return event;
    if (event && typeof event === 'object') {
        if (Array.isArray(event.notes)) return event.notes;
        if (typeof event.n === 'number') return [event.n];
    }
    return [];
}

for (const style of styles) {
    const meta = context.SONG_STYLES.find(entry => entry.id === style);
    for (const bars of [8, 16, 32, 64]) {
        for (const energy of energies) {
            for (const seed of bars === 64 ? ['long-form'] : ['session-one', 0, 947]) {
                const options = { style, bars, energy, seed };
                const song = context.generateSong(options);
                assert.equal(song.measures.length, bars);
                assert.equal(song.style, style);
                assert.equal(song.timeSignature, meta.meter);
                assert(typeof song.title === 'string' && song.title.length > 0, 'Songs get a title');
                assert.equal(song.loop, false, 'A generated song has a complete ending');
                assert.equal(
                    JSON.stringify(song),
                    JSON.stringify(context.generateSong(options)),
                    'Seeds reproduce a composition',
                );
                assert.equal(
                    vm.runInContext('JSON.stringify(songDocument())', context),
                    originalSong,
                    'Generating does not replace the current song',
                );
                const sections = new Set(song.measures.map(measure => measure.label.split(' · ')[0]));
                assert(sections.size >= (bars === 8 ? 3 : 4), `${style} ${bars}: the arrangement has sections`);
                const maxActivity = Math.max(...song.measures.map(activity));
                assert(activity(song.measures[0]) < maxActivity, 'The arrangement opens with space');
                assert(activity(song.measures.at(-1)) < maxActivity, 'The arrangement resolves to an ending');
                const patterns = new Set(
                    song.measures.map(measure => JSON.stringify(measure.slots.map(slot => slot.steps))),
                );
                assert(patterns.size >= Math.min(6, bars), 'Measures develop through the song');
                const playable = meterSteps[song.timeSignature];
                const mixLevels = new Set();
                const ensemble = new Map();
                for (const measure of song.measures) {
                    assert(measure.slots.length > 0 && measure.slots.length <= 10);
                    const uniquePresets = new Set(measure.slots.map(slot => slot.presetId));
                    assert.equal(
                        uniquePresets.size,
                        measure.slots.length,
                        'Each track remains visible in the arrangement',
                    );
                    for (const slot of measure.slots) {
                        if (ensemble.has(slot.index))
                            assert.equal(slot.presetId, ensemble.get(slot.index), 'Track identity stays consistent');
                        ensemble.set(slot.index, slot.presetId);
                        mixLevels.add(slot.volume);
                        assert.equal(slot.steps.length, 16);
                        assert(
                            slot.steps.some(event => event !== null),
                            'Empty tracks are omitted',
                        );
                        slot.steps.forEach((event, index) => {
                            assert.equal(slot.heights[index] > 0, event !== null);
                            if (index >= playable) assert.equal(event, null, 'Steps beyond the meter stay silent');
                            pitchesOf(event).forEach(note =>
                                assert(
                                    allowedChroma.has(((note % 12) + 12) % 12),
                                    'Generated pitches use the app source scale',
                                ),
                            );
                        });
                    }
                }
                assert(mixLevels.size > 6, 'Section dynamics are written into the arrangement');
                const raw = JSON.parse(JSON.stringify(song));
                context.documentToRead = raw;
                const parsed = vm.runInContext('readSongDocument(documentToRead)', context);
                assert.equal(parsed.measures.length, bars, 'Generated files reopen with the real importer');
                assert.equal(parsed.measures[0].slots.length, 100);
                assert.notEqual(parsed.measures[0].slots, parsed.measures[1].slots);
                generated++;
            }
        }
    }
}

const surprise = context.generateSong({ style: 'random', seed: 'surprise' });
assert(styles.includes(surprise.style), 'Surprise picks a real style');
for (const options of [{ style: 'unknown' }, { bars: 0 }, { bars: 17 }, { energy: 'maximum' }, { seed: {} }, null]) {
    assert.throws(() => context.generateSong(options));
}
const legacy = context.generateSong({ style: 'house', seed: 'meter' });
delete legacy.timeSignature;
context.documentToRead = legacy;
assert.equal(
    vm.runInContext('readSongDocument(documentToRead)', context).timeSignature,
    '4/4',
    'Older files open in 4/4',
);
for (const signature of ['2/4', '3/4', '5/8', '6/8', '7/8']) {
    context.documentToRead = { ...context.generateSong({ seed: 'meter' }), timeSignature: signature };
    assert.equal(vm.runInContext('readSongDocument(documentToRead)', context).timeSignature, signature);
}
for (const signature of ['9/8', '4/3', 4, '']) {
    context.documentToRead = { ...context.generateSong({ seed: 'meter' }), timeSignature: signature };
    assert.throws(() => vm.runInContext('readSongDocument(documentToRead)', context));
}
const first = context.generateSong({ seed: 'one' });
const second = context.generateSong({ seed: 'two' });
assert.notEqual(JSON.stringify(first), JSON.stringify(second), 'A new seed makes a different song');
console.log(
    `Passed: ${generated} generated songs across ${styles.length} styles, deterministic seeds, sections, harmony, dynamics, import round trips, and no state mutation.`,
);
