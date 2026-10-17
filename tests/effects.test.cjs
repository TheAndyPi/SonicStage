const assert = require('node:assert/strict');
const vm = require('node:vm');
const THREE = require('../public/vendor/three.min.js');
const { readPublic } = require('./app-source.cjs');

const timers = [];
const allNodes = [];
function param(value = 0) {
    return {
        value,
        setTargetAtTime(value, time) {
            assert.ok(Number.isFinite(value) && Number.isFinite(time));
            this.value = value;
            this.time = time;
        },
    };
}
function node(type) {
    const result = {
        type,
        connections: new Set(),
        disconnected: false,
        started: false,
        stopped: false,
        gain: param(1),
        frequency: param(440),
        Q: param(1),
        pan: param(),
        delayTime: param(),
        connect(target) {
            this.connections.add(target);
        },
        disconnect(target) {
            if (target) assert.ok(this.connections.delete(target), 'disconnect only existing connections');
            else {
                this.connections.clear();
                this.disconnected = true;
            }
        },
        start() {
            this.started = true;
        },
        stop() {
            assert.ok(!this.stopped);
            this.stopped = true;
        },
    };
    allNodes.push(result);
    return result;
}
const audioContext = { currentTime: 1 };
for (const type of ['Gain', 'BiquadFilter', 'WaveShaper', 'Delay', 'Convolver', 'Oscillator', 'StereoPanner'])
    audioContext[`create${type}`] = () => node(type);

const context = vm.createContext({
    THREE,
    structuredClone,
    Float32Array,
    Uint8Array,
    Map,
    Set,
    setTimeout: callback => timers.push(callback),
    document: { getElementById: id => (id === 'project-title' ? { value: 'FX test' } : null) },
    matchMedia: () => ({ matches: false }),
    sharedPerformerGeometries: null,
    pedestalMeshes: [],
    stageTheme: 'light',
    scene: null,
});
context.window = context;
for (const file of [
    'music/presets',
    'music/effects',
    'music/app-state',
    'music/song',
    'music/audio-engine',
    'stage/effects',
])
    vm.runInContext(readPublic(`js/${file}.js`), context);
context.testContext = audioContext;
const run = code => vm.runInContext(code, context);
run(`audioEngine.ctx = testContext;
    audioEngine.createImpulseResponse = duration => ({ duration });
    for (let i = 0; i < 100; i++) {
        const gain = testContext.createGain(), panner = testContext.createStereoPanner();
        gain.connect(panner); audioEngine.slotGains.push(gain); audioEngine.slotPanners.push(panner);
    }`);
assert.equal(run('PERFORMER_EFFECTS.length'), 21);
assert.equal(run('PERFORMER_EFFECT_BY_ID.size'), 21);
assert.equal(
    run(
        `normalizePerformerEffects([{id:'unknown'}, {id:'echo',amount:10}, {id:'echo'}, {id:'chorus',amount:NaN}]).length`,
    ),
    2,
);
assert.equal(run(`normalizePerformerEffects([{id:'echo',amount:10}])[0].amount`), 1);

// Every processor creates a connected signal path, finite controls, and disposable LFOs.
for (const id of run('PERFORMER_EFFECTS.map(effect => effect.id)')) {
    context.effectId = id;
    const before = allNodes.length;
    run(`audioEngine.setSlotEffects(0, [{id:effectId,amount:.75,enabled:true}]);`);
    const rack = run('audioEngine.slotEffectRacks[0].rack');
    assert.ok(rack.input.connections.size > 0, id);
    assert.ok(rack.output.connections.has(run('audioEngine.slotPanners[0]')), id);
    assert.ok(
        allNodes.slice(before).every(item => item.type !== 'WaveShaper' || [...item.curve].every(Number.isFinite)),
        id,
    );
    run(`audioEngine.setSlotEffects(0, [{id:effectId,amount:0,enabled:true}]);`);
    assert.equal(run('audioEngine.slotEffectRacks[0].rack'), rack, 'amount changes reuse the rack');
    run('audioEngine.setSlotEffects(0, []);');
    audioContext.currentTime += 0.2;
    while (timers.length) timers.shift()();
    assert.ok(rack.nodes.length === 0, `${id} nodes disposed`);
}
assert.ok(
    allNodes.filter(item => item.started).every(item => item.stopped),
    'all retired LFOs stop',
);
assert.equal(run('audioEngine.slotGains[1].connections.size'), 1, 'another player keeps its dry channel');
assert.ok(run('audioEngine.slotGains[1].connections.has(audioEngine.slotPanners[1])'));
assert.equal(run('audioEngine.performerImpulses.size'), 3, 'reverb buffers are shared');
run(`audioEngine.setSlotEffects(0, [{id:'echo', amount:.8, enabled:false}]);`);
assert.equal(run('audioEngine.slotEffectRacks[0].key'), '', 'bypassed effects leave no processor');
audioContext.currentTime += 0.2;
while (timers.length) timers.shift()();
run(`audioEngine.setSlotEffects(0, [{id:'echo',amount:.5,enabled:true}], testContext.currentTime, false);`);
assert.equal(run('audioEngine.slotEffectRacks[0].rack.output.gain.value'), 0, 'muted effect tails are gated');
run(`audioEngine.setSlotEffects(0, [{id:'echo',amount:.5,enabled:true}], testContext.currentTime, true);`);
assert.equal(run('audioEngine.slotEffectRacks[0].rack.output.gain.value'), 1);
audioContext.currentTime += 0.2;
while (timers.length) timers.shift()();
run(`audioEngine.setSlotEffects(0, [{id:'chorus',amount:.5,enabled:true}]);
    var suspendedRack = audioEngine.slotEffectRacks[0].rack;
    audioEngine.setSlotEffects(0, []);`);
audioContext.state = 'suspended';
const pendingRetirements = timers.splice(0);
pendingRetirements.forEach(callback => callback());
assert.ok(run('suspendedRack.nodes.length > 0'), 'wall time cannot retire a graph while audio time is suspended');
audioContext.state = 'running';
audioContext.currentTime += 0.3;
while (timers.length) timers.shift()();
assert.equal(run('suspendedRack.nodes.length'), 0);

for (const bpm of [1, 2400]) {
    context.testBpm = bpm;
    run(`appState.bpm = testBpm;
        audioEngine.setSlotEffects(0, [{id:'dub-delay',amount:.8,enabled:true}]);`);
    assert.ok(
        run(`audioEngine.slotEffectRacks[0].rack.nodes.filter(node => node.type === 'Delay')
        .every(node => node.delayTime.value > 0 && node.delayTime.value <= 2)`),
    );
}
run('appState.bpm = 112;');
audioContext.currentTime += 0.3;
while (timers.length) timers.shift()();

// The master inserts replace only the DJ-filter-to-output edge; player channels stay isolated.
run(`audioEngine.djFilterNode = testContext.createBiquadFilter();
    audioEngine.masterGain = testContext.createGain();
    audioEngine.limiter = testContext.createGain();
    audioEngine.djFilterNode.connect(audioEngine.masterGain);
    audioEngine.masterGain.connect(audioEngine.limiter);
    var untouchedPlayerRack = audioEngine.slotEffectRacks[0];
    audioEngine.setMasterEffects([]);`);
assert.equal(run('audioEngine.masterEffectRack'), null, 'empty masters allocate no rack');
for (const id of run('PERFORMER_EFFECTS.map(effect => effect.id)')) {
    context.effectId = id;
    run(`audioEngine.setMasterEffects([{id:effectId,amount:.8,enabled:true}]);`);
    const rack = run('audioEngine.masterEffectRack.rack');
    assert.ok(run('audioEngine.djFilterNode.connections.has(audioEngine.masterEffectRack.rack.input)'));
    assert.ok(rack.output.connections.has(run('audioEngine.masterGain')));
    assert.ok(run('!audioEngine.djFilterNode.connections.has(audioEngine.masterGain)'), 'no dry bypass around master');
    assert.ok(
        run('audioEngine.masterGain.connections.has(audioEngine.limiter)'),
        'output protection remains connected',
    );
    assert.ok(run('audioEngine.slotEffectRacks[0] === untouchedPlayerRack'), 'master edits leave player racks alone');
    run(`audioEngine.setMasterEffects([{id:effectId,amount:.2,enabled:true}]);`);
    assert.equal(run('audioEngine.masterEffectRack.rack'), rack, 'master faders reuse processors');
    run(`audioEngine.setMasterEffects([{id:effectId,amount:.2,enabled:false}]);`);
    assert.equal(run('audioEngine.masterEffectRack.key'), '', 'master bypass removes the processor');
    audioContext.currentTime += 0.3;
    while (timers.length) timers.shift()();
    assert.equal(rack.nodes.length, 0, 'retired master nodes are disposed');
    assert.equal(run('audioEngine.djFilterNode.connections.size'), 1, 'one current signal path after retirement');
}
run(`appState.masterEffects = [{id:'echo',amount:.6,enabled:true}];
    audioEngine.setMasterEffects(appState.masterEffects);
    appState.bpm = 120; audioEngine.updateDelaySync();`);
assert.equal(
    run(`audioEngine.masterEffectRack.rack.nodes.find(node => node.type === 'Delay').delayTime.value`),
    0.25,
    'master repeats follow tempo changes during playback',
);
run(`appState.masterEffects = [{id:'chorus',amount:.6,enabled:true}, {id:'air',amount:.3,enabled:false}];`);

// Persistence, duplication, and legacy files all use the production schema.
run(`assignTestPlayer = () => {
    const slot = appState.slots[0]; slot.preset = INSTRUMENT_PRESETS[0];
    initSlotSequenceFromPreset(slot, slot.preset);
    slot.effects = [{id:'bass-boost',amount:.73,enabled:true}, {id:'echo',amount:.2,enabled:false}];
}; assignTestPlayer();
var saved = songDocument(); var restored = readSongDocument(saved);`);
assert.equal(
    run('JSON.stringify(restored.measures[0].slots[0].effects)'),
    run('JSON.stringify(appState.slots[0].effects)'),
);
assert.equal(run('JSON.stringify(restored.masterEffects)'), run('JSON.stringify(appState.masterEffects)'));
run(`restored.masterEffects[0].amount = .1;`);
assert.equal(run('appState.masterEffects[0].amount'), 0.6, 'imported master chains are independent');
run(`var legacyMaster = structuredClone(saved); delete legacyMaster.masterEffects;`);
assert.equal(run('readSongDocument(legacyMaster).masterEffects.length'), 0, 'legacy songs default to a dry master');
run(`var duplicated = cloneMeasure(songState.measures[0]); duplicated.slots[0].effects[0].amount = .1;`);
assert.equal(run('appState.slots[0].effects[0].amount'), 0.73, 'duplicate bars own their effects');
assert.equal(run('cloneMeasure(songState.measures[0], true).slots[0].effects.length'), 0);
run(`delete saved.measures[0].slots[0].effects;`);
assert.equal(run('readSongDocument(saved).measures[0].slots[0].effects.length'), 0, 'old songs remain importable');
for (const invalid of [
    null,
    [{ id: 'unknown', amount: 0.5, enabled: true }],
    [{ id: 'echo', amount: NaN, enabled: true }],
    [{ id: 'echo', amount: 2, enabled: true }],
    [{ id: 'echo', amount: 0.5 }],
    Array.from({ length: 2 }, () => ({ id: 'echo', amount: 0.5, enabled: true })),
    ['echo', 'room', 'chorus', 'warmth', 'fuzz'].map(id => ({ id, amount: 0.5, enabled: true })),
]) {
    context.invalid = invalid;
    assert.throws(
        () => run(`saved.measures[0].slots[0].effects = invalid; readSongDocument(saved);`),
        /Invalid performer effects/,
    );
    assert.throws(
        () => run(`saved.masterEffects = invalid; saved.measures[0].slots[0].effects = []; readSongDocument(saved);`),
        /Invalid master effects/,
    );
    run('saved.masterEffects = [];');
}

// Stage accents follow the same enabled/amount state and retain pooled geometry.
context.ped = { rootGroup: new THREE.Group() };
run(`var player = appState.slots[0];
    player.effects = [{id:'echo',amount:.5,enabled:true}, {id:'fuzz',amount:.5,enabled:true}];
    updatePerformerEffectVisuals(ped, player, 1, false);`);
assert.equal(context.ped.effectVisuals.children.length, 2);
const geometry = context.ped.effectVisuals.children[0].geometry;
run(`player.effects = [{id:'echo',amount:.7,enabled:true}, {id:'fuzz',amount:.5,enabled:true}];
    updatePerformerEffectVisuals(ped, player, 3, true);`);
assert.equal(context.ped.effectVisuals.children[0].geometry, geometry);
assert.ok(context.ped.effectVisuals.children.every(mesh => mesh.position.toArray().every(Number.isFinite)));
run(`player.muted = true; updatePerformerEffectVisuals(ped, player, 4, false);`);
assert.equal(context.ped.effectVisuals.visible, false);
run(`player.effects = []; updatePerformerEffectVisuals(ped, player, 5, false);`);
assert.equal(context.ped.effectVisuals, null);

// Moving and clearing players must carry and clear their inserts in every bar.
context.rebuildPedestalPerformer = () => {};
context.refreshAllUI = () => {};
run('syncStageToMeasure = () => {};');
vm.runInContext(readPublic('js/ui/tracks.js'), context);
run(`assignTestPlayer(); songState.measures.push(cloneMeasure(songState.measures[0]));
    appState.effectsSlotIndex = 0; moveStagePlayer(0, 2);`);
assert.equal(run('appState.effectsSlotIndex'), 2);
assert.equal(run('songState.measures[0].slots[2].effects.length'), 2);
assert.equal(run('songState.measures[1].slots[2].effects.length'), 2);
assert.equal(run('songState.measures[0].slots[0].effects.length'), 0);
run(`appState.slots[5].preset = INSTRUMENT_PRESETS[1];
    initSlotSequenceFromPreset(appState.slots[5], appState.slots[5].preset);
    appState.slots[5].effects = [{id:'hall',amount:.8,enabled:true}];
    appState.effectsSlotIndex = 5; clearSlot(2);`);
assert.equal(run('appState.slots[0].effects[0].id'), 'hall', 'compacting players preserves inserts');
assert.equal(run('appState.effectsSlotIndex'), 0);
assert.equal(run('appState.slots[2].effects.length'), 0);
assert.equal(run('appState.slots[5].effects.length'), 0);
run('clearAllSlots();');
assert.ok(run('appState.slots.every(slot => slot.effects.length === 0)'));

// A fast pointer can leave the card before its first move event arrives.
const windowListeners = new Map();
const cardListeners = new Map();
context.addEventListener = (type, callback) => windowListeners.set(type, callback);
context.removeEventListener = (type, callback) => {
    if (windowListeners.get(type) === callback) windowListeners.delete(type);
};
context.clearTimeout = () => {};
context.testCard = { isConnected: true, addEventListener: (type, callback) => cardListeners.set(type, callback) };
vm.runInContext(readPublic('js/ui/sequencer.js'), context);
vm.runInContext(readPublic('js/ui/effects.js'), context);
run(`var dragStarted = null;
    startEffectDrag = (definition, x, y) => dragStarted = { id: definition.id, x, y };
    bindEffectDrag(testCard, { id: 'hall' });`);
cardListeners.get('pointerdown')({ button: 0, pointerId: 1, pointerType: 'mouse', clientX: 12, clientY: 15 });
windowListeners.get('pointermove')({ pointerId: 1, clientX: 130, clientY: 500 });
assert.equal(run('dragStarted.id'), 'hall');
assert.equal(run('dragStarted.y'), 500);
assert.equal(windowListeners.size, 0, 'press listeners are removed when dragging starts');
console.log(
    'Passed: all 21 effect graphs, amount reuse, channel isolation, master routing and tempo sync, bypass, LFO disposal, persistence, legacy songs, invalid imports, copied bars, and 3D accents.',
);
