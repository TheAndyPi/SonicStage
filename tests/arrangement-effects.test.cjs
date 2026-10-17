const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readPublic } = require('./app-source.cjs');

const elements = new Map();
const calls = { checkpoints: 0, audio: [], changes: 0 };
const context = vm.createContext({
    structuredClone,
    window: { matchMedia: () => ({ matches: false }) },
    document: {
        getElementById: id => {
            if (!elements.has(id)) elements.set(id, { value: 'Effects test', setAttribute() {} });
            return elements.get(id);
        },
        elementFromPoint: () => context.pointElement,
    },
    checkpointSong: () => calls.checkpoints++,
    audioEngine: { init() {}, setSlotEffects: (...args) => calls.audio.push(args) },
    showStageToast: message => (calls.toast = message),
    renderTimelineTracks() {},
    updatePedestalHUDBadges() {},
    renderEffectsLibrary() {},
});
const run = code => vm.runInContext(code, context);
for (const file of [
    'music/presets',
    'music/effects',
    'music/app-state',
    'music/song',
    'ui/effects',
    'ui/arrangement-effects',
])
    run(readPublic(`js/${file}.js`));
context.showStageToast = message => (calls.toast = message);
run(`var productionArrangementRenderer = renderSongArrangement;
    renderSongArrangement = () => {};
    renderEffectsLibrary = () => {};
    selectSongMeasure = index => { songState.selected = index; appState.slots = songState.measures[index].slots; };
    songChanged = () => {};
    function populate(measure, index, preset = INSTRUMENT_PRESETS[0]) {
        const slot = measure.slots[index]; slot.preset = preset;
        initSlotSequenceFromPreset(slot, preset);
        return slot;
    }
    var a = songState.measures[0], b = cloneMeasure(a, true), c = cloneMeasure(a, true), empty = cloneMeasure(a, true);
    songState.measures = [a,b,c,empty]; songState.view = 'song';
    populate(a,0); populate(a,1); populate(a,2,INSTRUMENT_PRESETS[1]);
    populate(b,0); populate(b,1); populate(b,2,INSTRUMENT_PRESETS[1]);
    populate(c,0); populate(c,2,INSTRUMENT_PRESETS[1]);
    songState.playMeasure = a; appState.isPlaying = true;`);

// Explicit clip drops address the destination even while a different bar plays.
assert.equal(run(`applyArrangementEffect('echo', 1, 1)`), true);
assert.equal(calls.checkpoints, 1);
assert.equal(run('b.slots[1].effects[0].id'), 'echo');
assert.equal(run('a.slots[1].effects.length'), 0);
assert.equal(run('b.slots[0].effects.length'), 0);
assert.equal(run('songState.selected'), 1);
assert.equal(run('appState.effectsScope'), 'player');
assert.ok(run('songState.playMeasure === a'), 'editing does not move playback');
assert.equal(calls.audio.length, 0, 'editing an upcoming bar does not reroute the playing bar');

run(`b.slots[0].effects = ['room','chorus','warmth','air'].map(id => ({id,amount:.5,enabled:true}));
    b.slots[1].effects = [{id:'hall',amount:.2,enabled:false}];
    var beforePlan = JSON.stringify(b);
    var plan = arrangementEffectPlan(b.slots,'hall');`);
assert.equal(run('plan.changes.length'), 1);
assert.equal(run('plan.full'), 1);
assert.equal(run('plan.existing'), 1);
assert.equal(run('JSON.stringify(b)'), run('beforePlan'), 'planning does not mutate bar data');
const beforeBatch = calls.checkpoints;
assert.equal(run(`applyArrangementEffect('hall',1)`), true);
assert.equal(calls.checkpoints, beforeBatch + 1, 'one undo checkpoint for a whole-bar application');
assert.equal(run('b.slots[0].effects.length'), 4, 'full racks retain their chain');
assert.equal(run('b.slots[1].effects.length'), 1, 'existing inserts are not duplicated');
assert.equal(run('b.slots[2].effects[0].id'), 'hall');
assert.equal(run('appState.effectsScope'), 'bar');
assert.match(calls.toast, /full rack/);

const beforeInvalid = calls.checkpoints;
for (const operation of [
    `applyArrangementEffect('hall',1)`,
    `applyArrangementEffect('hall',3)`,
    `applyArrangementEffect('hall',2,1)`,
    `applyArrangementEffect('unknown',0)`,
    `applyArrangementEffect('echo',-1)`,
    `applyArrangementEffect('echo',99)`,
])
    assert.equal(run(operation), false);
assert.equal(calls.checkpoints, beforeInvalid, 'rejected drops do not add undo history');
assert.equal(run('empty.slots.filter(slot => slot.preset).length'), 0, 'effects never create players');

run(`var entries = arrangementEffectEntries(b.slots.filter(slot => slot.preset));`);
assert.equal(run(`entries.find(effect => effect.id === 'hall').count`), 2);
assert.equal(run(`entries.find(effect => effect.id === 'hall').mixed`), true);
assert.equal(run(`entries.find(effect => effect.id === 'hall').enabled`), true);
run(
    `mutateEffectsRack(effects => { const item = effects.find(effect => effect.id === 'hall'); if(item) item.enabled = false; }, false);`,
);
assert.equal(run('b.slots[1].effects[0].enabled'), false);
assert.equal(run('b.slots[2].effects[0].enabled'), false);
assert.equal(run('b.slots[0].effects.length'), 4, 'batch controls affect only players with that insert');

const beforeCopy = calls.checkpoints;
assert.equal(run(`copyArrangementEffects('next')`), true);
assert.equal(calls.checkpoints, beforeCopy + 1);
assert.equal(run('JSON.stringify(c.slots[0].effects)'), run('JSON.stringify(b.slots[0].effects)'));
assert.equal(run('c.slots[1].effects.length'), 0, 'copying skips empty player positions');
assert.ok(run('c.slots[0].effects !== b.slots[0].effects && c.slots[0].effects[0] !== b.slots[0].effects[0]'));
assert.equal(run(`copyArrangementEffects('next')`), false, 'unchanged copies are a no-op');
run(`appState.effectsScope = 'player'; appState.effectsSlotIndex = 2;`);
assert.equal(run(`copyArrangementEffects('all')`), true);
assert.equal(run('a.slots[2].effects[0].id'), 'hall');
assert.equal(run('empty.slots[2].preset'), null);
run('c.slots[2].effects[0].amount = .9;');
assert.equal(run('b.slots[2].effects[0].amount'), 0.5, 'copied bars remain independent');
run(`var saved = songDocument(); var imported = readSongDocument(saved);`);
assert.equal(run('imported.measures[1].slots[2].effects[0].id'), 'hall');
assert.equal(run('imported.measures[2].slots[2].effects[0].amount'), 0.9);

// The arrangement must expose separate rows and targets for duplicate instruments.
assert.equal(run('arrangementRows(songState.measures).length'), 3);
run(`updateTransportPosition = () => {}; fitSongSheet = () => {}; updateSongPlayhead = () => {};
    productionArrangementRenderer();`);
const sheet = elements.get('song-sheet').innerHTML;
assert.match(sheet, /PLAYER 01/);
assert.match(sheet, /PLAYER 02/);
assert.match(sheet, /data-measure-index="1" data-slot-index="1"/);
assert.match(sheet, /data-measure-index="2" data-empty-clip/);
assert.match(sheet, /Edit Hall for player 3, bar 2/);
assert.match(sheet, /Effects for bar 2, 6 inserts/);

const cell = (tagName, measureIndex, slotIndex) => ({
    tagName,
    dataset: {
        measureIndex: String(measureIndex),
        ...(slotIndex === undefined ? {} : { slotIndex: String(slotIndex) }),
    },
    hasAttribute: name => name === 'data-slot-index' && slotIndex !== undefined,
    closest(selector) {
        return selector === '#song-sheet [data-measure-index]' ? this : null;
    },
});
context.pointElement = cell('TH', 1);
assert.equal(run('effectDropTarget(10,10).kind'), 'bar');
context.pointElement = cell('TD', 1, 2);
assert.equal(run('effectDropTarget(10,10).slotIndex'), 2);
assert.equal(run('effectDropTarget(10,10).measureIndex'), 1);
context.pointElement = cell('TD', 2);
assert.equal(run('effectDropTarget(10,10).kind'), 'empty');

console.log(
    'Passed: arrangement clip/bar drops, atomic batches, full/empty racks, playback isolation, copy scope, independent persistence, duplicate players, badges, and drop targets.',
);
