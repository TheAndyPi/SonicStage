const assert = require('node:assert/strict');
const vm = require('node:vm');
const { appSource, readPublic } = require('./app-source.cjs');
const { convertScore, buildSong } = require('../scripts/build-keyboard-score.cjs');

const score = readPublic('songs/keyboard-score.txt');
const events = convertScore(score);
const song = JSON.parse(readPublic('songs/keyboard-score-piano.json'));
assert.deepEqual(song, buildSong(score), 'The shipped preset matches the complete source score');
assert.equal(events.length, 385);
assert.equal(events.filter(Boolean).length, 332);
assert.equal(events.filter(Boolean).flat().length, 587);
assert.deepEqual(convertScore('[7Ir] I T-S [(@ST] [DI]'), [
    [47, 59, 66],
    [66],
    [61],
    null,
    [73],
    [39, 51, 61, 73],
    [66, 75],
]);
assert.throws(() => convertScore('[?]'), /Unknown piano key/);
assert.equal(song.measures.length, 49);
const allSteps = song.measures.flatMap(bar => bar.slots[0].steps);
assert.deepEqual(allSteps.filter((_, index) => index % 2 === 0).slice(0, events.length), events);
assert(allSteps.filter((_, index) => index % 2 === 1).every(event => event === null));
assert(
    allSteps.slice(events.length * 2).every(event => event === null),
    'Final bar has silent padding',
);

const source = appSource();
const context = vm.createContext({
    structuredClone,
    window: { matchMedia: () => ({ matches: false }) },
    document: { getElementById: () => ({ value: 'Validation' }) },
    input: song,
});
vm.runInContext(
    source.slice(source.indexOf('const KEY_NAMES ='), source.indexOf('function applySongDocument(')),
    context,
);
const parsed = vm.runInContext('readSongDocument(input)', context);
assert.equal(parsed.measures.length, 49, 'The real importer accepts the preset');
vm.runInContext('appState.rootKey = input.rootKey; appState.scaleMode = input.scaleMode;', context);
for (const bar of song.measures) {
    const slot = bar.slots[0];
    assert.equal(slot.presetId, 'chords_grand');
    assert.equal(slot.steps.length, 16);
    assert.equal(slot.heights.length, 16);
    for (const [index, notes] of slot.steps.entries()) {
        assert.equal(notes === null, slot.heights[index] === 0);
        if (notes === null) continue;
        assert(Array.isArray(notes), 'Grand piano requires chord arrays, including single notes');
        for (const midi of notes) {
            context.midi = midi;
            const frequency = vm.runInContext('midiToFreq(midi)', context);
            assert(
                Math.abs(frequency - 440 * 2 ** ((midi - 69) / 12)) < 1e-8,
                'Chromatic pitches survive playback mapping',
            );
        }
    }
}

async function checkLoader() {
    let ok = true;
    let selected = 'keyboard-score';
    const fields = Object.fromEntries(
        ['generator-bars', 'generator-energy'].map(id => [
            id,
            {
                value: id === 'generator-bars' ? '32' : 'high',
                dataset: {},
                disabled: false,
                fixedOption: { hidden: true },
                querySelector() {
                    return this.fixedOption;
                },
            },
        ]),
    );
    fields['generator-form'] = { querySelector: () => ({ value: selected }) };
    const loader = vm.createContext({
        studioById: id => fields[id],
        fetch: async url => {
            assert.equal(url, 'songs/keyboard-score-piano.json');
            return { ok, json: async () => structuredClone(song) };
        },
        generateSong: options => options,
    });
    vm.runInContext(
        source.slice(source.indexOf('const KEYBOARD_SCORE_STYLE ='), source.indexOf('function setWorkspaceInert(')),
        loader,
    );
    const loaded = await vm.runInContext("loadExampleDocument('keyboard-score', 8, 'low')", loader);
    assert.deepEqual(loaded, song, 'The fixed style always loads the complete arrangement');
    vm.runInContext('updateExampleOptions()', loader);
    assert.equal(fields['generator-bars'].value, '49');
    assert.equal(fields['generator-energy'].value, 'original');
    assert(fields['generator-bars'].disabled && fields['generator-energy'].disabled);
    selected = 'house';
    vm.runInContext('updateExampleOptions()', loader);
    assert.equal(fields['generator-bars'].value, '32');
    assert.equal(fields['generator-energy'].value, 'high');
    assert(!fields['generator-bars'].disabled && !fields['generator-energy'].disabled);
    fields['generator-bars'].value = '64';
    selected = 'funk';
    vm.runInContext('updateExampleOptions()', loader);
    assert.equal(fields['generator-bars'].value, '64', 'Switching adjustable styles keeps the chosen length');
    const generated = await vm.runInContext("loadExampleDocument('house', 32, 'high')", loader);
    assert.equal(generated.style, 'house');
    ok = false;
    await assert.rejects(
        vm.runInContext("loadExampleDocument('keyboard-score', 49, 'original')", loader),
        /Could not load/,
    );
    assert(!readPublic('index.html').includes('id="load-keyboard-score"'), 'No separate oversized preset button');
}
assert.equal(song.bpm, 128);
assert.equal(song.measures[0].slots.length, 1, 'Piano introduces the song alone');
assert(song.measures[38].slots.length >= 7, 'Final chorus brings in the full ensemble');
assert(
    song.measures[33].slots.length < song.measures[38].slots.length,
    'Interlude leaves space before the final chorus',
);
assert.equal(song.measures.at(-1).slots.length, 1, 'Coda returns to piano');
const identities = new Map();
for (const bar of song.measures) {
    for (const slot of bar.slots) {
        if (identities.has(slot.index)) assert.equal(identities.get(slot.index), slot.presetId);
        identities.set(slot.index, slot.presetId);
        assert.equal(slot.steps.length, 16);
        assert.equal(slot.heights.length, 16);
        for (const event of slot.steps.filter(event => event !== null)) {
            if (slot.presetId.startsWith('drums_')) {
                assert((slot.presetId === 'drums_synthwave' ? ['K', 'G', 'H', 'T'] : ['C', 'O']).includes(event));
            } else {
                const arrayVoice = ['chords_grand', 'strings_ensemble', 'chords_arp'].includes(slot.presetId);
                assert.equal(Array.isArray(event), arrayVoice, 'Each instrument receives its supported event shape');
                for (const note of arrayVoice ? event : [event]) {
                    assert([11, 1, 3, 4, 6, 8, 10].includes(note % 12), 'Accompaniment follows B major');
                }
            }
        }
    }
}
checkLoader()
    .then(() =>
        console.log(
            'Keyboard score conversion, ensemble arrangement, import, pitch mapping and fixed style controls passed.',
        ),
    )
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
