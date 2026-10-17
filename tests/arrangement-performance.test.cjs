const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readPublic } = require('./app-source.cjs');

const elements = new Map();
let classWrites = 0;
function element(trackWrites = false) {
    const classes = new Set();
    return {
        value: '',
        classList: {
            add(name) {
                if (trackWrites) classWrites++;
                classes.add(name);
            },
            remove(name) {
                if (trackWrites) classWrites++;
                classes.delete(name);
            },
            toggle(name, active) {
                if (trackWrites) classWrites++;
                if (active) classes.add(name);
                else classes.delete(name);
            },
            contains: name => classes.has(name),
        },
        setAttribute(name, value) {
            this[name] = value;
        },
    };
}
const timers = [];
const frames = [];
const context = vm.createContext({
    structuredClone,
    window: { matchMedia: () => ({ matches: false }) },
    document: {
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, element());
            return elements.get(id);
        },
        // Transport and selection must never search the complete arrangement.
        querySelectorAll() {
            throw new Error('Full-document query during playback');
        },
    },
    setTimeout: callback => timers.push(callback),
    clearTimeout() {},
    requestAnimationFrame: callback => frames.push(callback),
});
const run = code => vm.runInContext(code, context);
for (const file of ['music/presets', 'music/effects', 'music/app-state', 'music/song'])
    run(readPublic(`js/${file}.js`));
run(`
    syncStageToMeasure = () => {};
    reconcileStageCapacity = () => {};
    refreshAllUI = notifyChange => { if (notifyChange !== false) songChanged(); };
    songState.measures = Array.from({ length: 1024 }, () => cloneMeasure(songState.measures[0], true));
    songState.ready = true;
    songState.view = 'song';
    appState.isPlaying = true;
`);

const columns = Array.from({ length: 1024 }, () => {
    const header = element(true);
    const button = element();
    header.querySelector = () => button;
    return {
        header,
        cells: Array.from({ length: 6 }, () => ({
            cell: element(true),
            steps: Array.from({ length: 16 }, () => element(true)),
        })),
    };
});
context.columns = columns;
run(`
    songSheetDOM.columns = columns;
    songSheetDOM.measures = songState.measures;
    songSheetDOM.dirty = false;
    songSheetDOM.selected = 0;
`);

// Cross bar boundaries using the same selection path as audible playback.
for (let bar = 1; bar <= 64; bar++) {
    run(`
        songState.heardMeasure = songState.measures[${bar}];
        selectSongMeasure(${bar});
        for (let step = 0; step < 16; step++) {
            appState.currentStep = step;
            updateSongPlayhead();
        }
    `);
}
assert.equal(timers.length, 0, 'following playback must not serialize or save the song');
assert.equal(frames.length, 0, 'following playback must not schedule an arrangement rebuild');
assert.ok(classWrites < 16000, 'highlight work must depend on column height, not song length');
assert.equal(columns.filter(column => column.header.classList.contains('is-selected')).length, 1);
assert.equal(columns[64].header.querySelector()['aria-pressed'], 'true');
assert.equal(columns[63].header.querySelector()['aria-pressed'], 'false');
assert.equal(columns.filter(column => column.header.classList.contains('is-playing')).length, 1);
assert.ok(columns[64].cells.every(({ steps }) => steps[15].classList.contains('playing-step')));
assert.ok(columns[63].cells.every(({ steps }) => steps.every(step => !step.classList.contains('playing-step'))));

const before = classWrites;
run('updateSongPlayhead()');
assert.equal(classWrites, before, 'unchanged steps must not rewrite highlight classes');
run('appState.isPlaying = false; updateSongPlayhead();');
assert.ok(columns.every(column => !column.header.classList.contains('is-playing')));
assert.ok(
    columns[64].cells.every(
        ({ cell, steps }) =>
            !cell.classList.contains('is-playing-step') &&
            steps.every(step => !step.classList.contains('playing-step')),
    ),
);

// Navigation stays cheap while content edits still invalidate and save the sheet.
run('songChanged()');
assert.equal(run('songSheetDOM.dirty'), true);
assert.equal(timers.length, 1);
assert.equal(frames.length, 1);

// A synchronous edit render can consume the invalidation before the queued frame.
let forcedRebuild;
context.renderSongArrangement = rebuild => (forcedRebuild = rebuild);
frames[0]();
assert.equal(forcedRebuild, false, 'the queued frame must reuse a sheet already rendered by an edit');

// Keep the production refresh path honest: navigation suppresses edit notifications.
const sequencer = readPublic('js/ui/sequencer.js');
const refresh = sequencer.slice(
    sequencer.indexOf('function refreshAllUI('),
    sequencer.indexOf('\nfunction updatePlayButtonUI('),
);
let notify;
Object.assign(context, {
    renderTimelineTracks: value => (notify = value),
    audioEngine: { syncPerformerEffects() {} },
    renderTokenPalette() {},
    updatePedestalHUDBadges() {},
    updateStageHeaderUI() {},
    highlightSequencerStep() {},
});
run(refresh);
run('refreshAllUI(false)');
assert.equal(notify, false);
run('refreshAllUI()');
assert.equal(notify, true);

console.log(
    'Passed: 1024-bar playback, bounded highlight updates, selection reuse, stop cleanup, edit invalidation, and no playback autosaves.',
);
