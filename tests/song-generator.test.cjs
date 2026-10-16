const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'sonicstage_3d_interactive_instrument_loop_station.html'), 'utf8');
const start = html.indexOf('const KEY_NAMES =');
const end = html.indexOf('function applySongDocument(');
assert(start > 0 && end > start, 'Existing song validator and sound library are available');
const context = vm.createContext({
    structuredClone,
    window: { matchMedia: () => ({ matches: false }) },
    document: { getElementById: id => id === 'project-title' ? { value: 'Current song' } : null },
});
// Exercise the actual app's presets, state model, and import validator. No DOM,
// renderer, or audio device is needed to validate composition and persistence.
vm.runInContext(html.slice(start, end), context);
vm.runInContext(fs.readFileSync(path.join(root, 'song-generator.js'), 'utf8'), context);
const originalSong = vm.runInContext('JSON.stringify(songDocument())', context);
const styles = ['house', 'lofi', 'cinematic', 'funk'];
const energies = ['low', 'medium', 'high'];
const allowedChroma = new Set([0, 2, 3, 5, 7, 9, 10]);
let generated = 0;

function activity(measure) {
    return measure.slots.reduce((sum, slot) => sum + slot.steps.filter(event => event !== null).length, 0);
}

for (const style of styles) {
    for (const bars of [8, 16, 32]) {
        for (const energy of energies) {
            for (const seed of ['session-one', 'session-two', 0, 947]) {
                const options = { style, bars, energy, seed };
                const song = context.generateSong(options);
                assert.equal(song.measures.length, bars);
                assert.equal(song.loop, false, 'A generated song has a complete ending');
                assert.equal(JSON.stringify(song), JSON.stringify(context.generateSong(options)), 'Seeds reproduce a composition');
                assert.equal(vm.runInContext('JSON.stringify(songDocument())', context), originalSong, 'Generating does not replace the current song');
                const sections = new Set(song.measures.map(measure => measure.label.split(' · ')[0]));
                assert(sections.size >= 6, 'The arrangement has distinct musical sections');
                const maxActivity = Math.max(...song.measures.map(activity));
                assert(activity(song.measures[0]) < maxActivity, 'The arrangement opens with space');
                assert(activity(song.measures.at(-1)) < maxActivity, 'The arrangement resolves to an ending');
                const patterns = new Set(song.measures.map(measure => JSON.stringify(measure.slots.map(slot => slot.steps))));
                assert(patterns.size >= Math.min(6, bars), 'Measures develop through the song');
                const mixLevels = new Set();
                const ensemble = new Map();
                for (const measure of song.measures) {
                    assert(measure.slots.length > 0 && measure.slots.length <= 6);
                    const uniquePresets = new Set(measure.slots.map(slot => slot.presetId));
                    assert.equal(uniquePresets.size, measure.slots.length, 'Each track remains visible in the arrangement');
                    for (const slot of measure.slots) {
                        if (ensemble.has(slot.index)) assert.equal(slot.presetId, ensemble.get(slot.index), 'Track identity stays consistent');
                        ensemble.set(slot.index, slot.presetId);
                        mixLevels.add(slot.volume);
                        assert.equal(slot.steps.length, 16);
                        assert(slot.steps.some(event => event !== null), 'Empty tracks are omitted');
                        slot.steps.forEach((event, index) => {
                            assert.equal(slot.heights[index] > 0, event !== null);
                            const notes = typeof event === 'number' ? [event] : Array.isArray(event) ? event : [];
                            notes.forEach(note => assert(allowedChroma.has(((note % 12) + 12) % 12), 'Generated pitches use the app source scale'));
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

for (const options of [{ style: 'unknown' }, { bars: 0 }, { bars: 17 }, { energy: 'maximum' }, { seed: {} }, null]) {
    assert.throws(() => context.generateSong(options));
}
const first = context.generateSong({ seed: 'one' });
const second = context.generateSong({ seed: 'two' });
assert.notEqual(JSON.stringify(first), JSON.stringify(second), 'A new seed makes a different song');
console.log(`Passed: ${generated} generated songs, deterministic seeds, musical sections, harmony, dynamics, import round trips, and no state mutation.`);
