const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readPublic } = require('./app-source.cjs');

// Extract the production handlers without starting WebGL or Web Audio.
function productionFunction(file, name) {
    const source = readPublic(file);
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    let end = source.indexOf('{', start) + 1;
    let depth = 1;
    while (depth && end < source.length) {
        if (source[end] === '{') depth++;
        if (source[end] === '}') depth--;
        end++;
    }
    return source.slice(start, end);
}

// Closing stays mounted; an interrupted close must never hide a reopened window.
const animations = [];
let reducedMotion = false;
const scopeWindow = {
    hidden: true,
    classList: { toggle() {} },
    setAttribute() {},
    focus() {},
    animate: (frames, options) => {
        const animation = { frames, options, cancel() {} };
        animations.push(animation);
        return animation;
    },
};
const scopeState = {
    ready: true,
    windowEl: scopeWindow,
    windowOpen: false,
    meterEl: { classList: { toggle() {} } },
};
const scopeContext = vm.createContext({
    masterScope: scopeState,
    cinematicState: { active: false },
    appState: { proFxOpen: false },
    matchMedia: () => ({ matches: reducedMotion }),
    getComputedStyle: () => ({ opacity: '0.5', transform: 'matrix(1, 0, 0, 1, 0, -4)' }),
    placeScopeWindow() {},
    clampScopeWindow() {},
    labelMasterScope() {},
    resetScopeFxPlacement() {},
});
vm.runInContext(productionFunction('js/ui/master-scope.js', 'setScopeWindowOpen'), scopeContext);
scopeContext.setScopeWindowOpen(true);
assert.equal(scopeWindow.hidden, false);
assert.equal(scopeWindow.inert, false);
animations.at(-1).onfinish();
scopeContext.setScopeWindowOpen(false);
assert.equal(scopeWindow.hidden, false, 'closing waits for the animation');
assert.equal(scopeWindow.inert, true, 'closing controls immediately leave the tab order');
const interruptedClose = animations.at(-1);
scopeContext.setScopeWindowOpen(true);
assert.equal(animations.at(-1).frames[0].opacity, '0.5', 'reopening resumes from the visible animation frame');
interruptedClose.onfinish();
assert.equal(scopeWindow.hidden, false, 'a stale animation cannot hide a reopened scope');
animations.at(-1).onfinish();
scopeContext.cinematicState.active = true;
scopeContext.setScopeWindowOpen(false);
animations.at(-1).onfinish();
scopeContext.setScopeWindowOpen(true);
assert.equal(scopeState.windowOpen, false, 'showcase prevents reopening the scope');
scopeContext.cinematicState.active = false;
reducedMotion = true;
const animatedCount = animations.length;
scopeContext.setScopeWindowOpen(true);
scopeContext.setScopeWindowOpen(false);
assert.equal(scopeWindow.hidden, true);
assert.equal(animations.length, animatedCount, 'reduced motion changes visibility immediately');
assert.match(productionFunction('js/stage/camera.js', 'startCinematic'), /setScopeWindowOpen\(false\)/);

// Showcase remembers the open state once, including when replaying before exit.
const vector = { clone: () => ({}), copy() {} };
Object.assign(scopeContext, {
    songState: { ready: true, view: 'song', audition: true },
    camera: { position: vector, fov: 40, far: 120, updateProjectionMatrix() {} },
    controls: { enabled: true, target: vector, update() {} },
    scene: { fog: { density: 0.1 } },
    audioEngine: { init() {}, ctx: { state: 'running' } },
    document: {
        body: { classList: { add() {}, remove() {} } },
        getElementById: () => ({ focus() {}, hidden: true }),
    },
    stopSong() {},
    resetSongTransport() {},
    syncStageToMeasure() {},
    setCinematicShot() {},
    updateCinematicUI() {},
    setSongView(view) {
        scopeContext.songState.view = view;
    },
});
scopeContext.cinematicState.visits = new Set();
for (const name of ['startCinematic', 'exitCinematic'])
    vm.runInContext(productionFunction('js/stage/camera.js', name), scopeContext);
for (const initiallyOpen of [true, false]) {
    scopeContext.setScopeWindowOpen(initiallyOpen);
    scopeContext.startCinematic();
    assert.equal(scopeState.windowOpen, false, 'showcase closes the visualizer');
    scopeContext.startCinematic();
    scopeContext.exitCinematic();
    assert.equal(scopeState.windowOpen, initiallyOpen, 'exit restores the prior visualizer state after replay');
    assert.equal(scopeContext.songState.view, 'song');
    assert.equal(scopeContext.songState.audition, true);
}

// Both card types share tap, scroll, hold, and mouse-drag behavior.
function gestureHarness(effect) {
    const listeners = new Map();
    const timers = new Map();
    const cardListeners = new Map();
    let time = 0,
        nextId = 0,
        drags = 0,
        clicks = 0;
    const card = { isConnected: true, addEventListener: (type, callback) => cardListeners.set(type, callback) };
    const context = vm.createContext({
        appState: {},
        window: {
            addEventListener: (type, callback) => listeners.set(type, callback),
            removeEventListener: (type, callback) => {
                if (listeners.get(type) === callback) listeners.delete(type);
            },
        },
        setTimeout: (callback, delay) => {
            const id = ++nextId;
            timers.set(id, { callback, at: time + delay });
            return id;
        },
        clearTimeout: id => timers.delete(id),
        card,
        startDrag: () => drags++,
        activate: () => clicks++,
        startEffectDrag: () => drags++,
        applyLibraryEffect: () => clicks++,
    });
    vm.runInContext(productionFunction('js/ui/sequencer.js', 'bindLibraryCardDrag'), context);
    vm.runInContext(productionFunction('js/ui/effects.js', 'bindEffectDrag'), context);
    vm.runInContext(
        effect ? "bindEffectDrag(card, { id: 'echo' })" : 'bindLibraryCardDrag(card, startDrag, activate)',
        context,
    );
    const event = { button: 0, pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100, detail: 1 };
    return {
        card,
        down: (overrides = {}) => cardListeners.get('pointerdown')({ ...event, ...overrides }),
        click: (detail = 1) => cardListeners.get('click')({ ...event, detail }),
        emit: (type, overrides = {}) => listeners.get(type)?.({ ...event, ...overrides }),
        tick(ms) {
            time += ms;
            for (const [id, timer] of timers)
                if (timer.at <= time) {
                    timers.delete(id);
                    timer.callback();
                }
        },
        get drags() {
            return drags;
        },
        get clicks() {
            return clicks;
        },
        get pending() {
            return timers.size + listeners.size;
        },
    };
}
for (const effect of [false, true]) {
    const tap = gestureHarness(effect);
    tap.down();
    tap.tick(80);
    tap.emit('pointerup');
    tap.click();
    tap.tick(600);
    assert.equal(tap.clicks, 1);
    assert.equal(tap.drags, 0, 'a released tap never starts a delayed drag');
    assert.equal(tap.pending, 0);
    for (const end of ['pointerup', 'pointercancel', 'blur']) {
        const canceled = gestureHarness(effect);
        canceled.down();
        canceled.emit(end);
        canceled.tick(600);
        assert.equal(canceled.drags, 0, `${end} cancels a press outside the card`);
        assert.equal(canceled.pending, 0);
    }
    for (const move of [{ clientX: 140 }, { clientY: 70 }]) {
        const scroll = gestureHarness(effect);
        scroll.down();
        scroll.tick(100);
        scroll.emit('pointermove', move);
        scroll.tick(600);
        scroll.click();
        assert.equal(scroll.drags, 0, 'swipes scroll rather than lift cards');
        assert.equal(scroll.clicks, 0, 'a swipe does not activate a card');
    }
    const hold = gestureHarness(effect);
    hold.down();
    hold.emit('pointermove', { clientX: 104, clientY: 97 });
    hold.tick(499);
    assert.equal(hold.drags, 0);
    hold.tick(1);
    assert.equal(hold.drags, 1, 'a deliberate stationary hold lifts a card');
    hold.click();
    assert.equal(hold.clicks, 0, 'dropping cannot also activate a card');
    hold.click(0);
    assert.equal(hold.clicks, 1, 'keyboard activation remains available');
    const mouse = gestureHarness(effect);
    mouse.down({ pointerType: 'mouse' });
    mouse.tick(600);
    assert.equal(mouse.drags, 0, 'holding the mouse still does not steal a click');
    mouse.emit('pointermove', { clientX: 200, clientY: 300 });
    assert.equal(mouse.drags, 1, 'fast mouse drags are tracked beyond card bounds');
    assert.equal(mouse.pending, 0);
    const removed = gestureHarness(effect);
    removed.down();
    removed.card.isConnected = false;
    removed.tick(600);
    assert.equal(removed.drags, 0, 'a library rebuild cannot lift a detached card');
}

// Placement must keep the two panels separate at desktop, tablet, and phone widths.
const rackClasses = new Set();
const rackStyle = new Map();
const rack = {
    offsetLeft: 900,
    offsetTop: 120,
    offsetWidth: 520,
    get offsetHeight() {
        return rackClasses.has('scope-stacked')
            ? Math.min(360, parseFloat(rackStyle.get('--scope-fx-max-height')))
            : 360;
    },
    getClientRects: () => [{}],
    classList: { add: name => rackClasses.add(name), remove: name => rackClasses.delete(name) },
    style: { setProperty: (name, value) => rackStyle.set(name, value), removeProperty: name => rackStyle.delete(name) },
};
const placementWindow = { offsetWidth: 440, offsetHeight: 214, style: {} };
const placement = vm.createContext({
    innerWidth: 1440,
    innerHeight: 900,
    appState: { proFxOpen: true },
    masterScope: { windowEl: placementWindow },
    document: {
        getElementById: id => (id === 'pro-fx-drawer' ? rack : { getBoundingClientRect: () => ({ bottom: 110 }) }),
        querySelector: () => null,
    },
});
for (const name of ['resetScopeFxPlacement', 'moveScopeWindow', 'placeScopeWindow'])
    vm.runInContext(productionFunction('js/ui/master-scope.js', name), placement);
placement.placeScopeWindow();
assert.equal(parseFloat(placementWindow.style.left) + placementWindow.offsetWidth + 12, rack.offsetLeft);
assert.equal(parseFloat(placementWindow.style.top), rack.offsetTop);
assert.equal(rackClasses.size, 0, 'side-by-side placement leaves the rack at its normal height');
placement.innerWidth = 800;
rack.offsetLeft = 268;
placement.placeScopeWindow();
assert.equal(parseFloat(placementWindow.style.top), rack.offsetTop + rack.offsetHeight + 12);
assert.ok(rackClasses.has('scope-stacked'));
placement.innerWidth = 390;
placement.innerHeight = 568;
placementWindow.offsetWidth = 374;
rack.offsetLeft = 8;
rack.offsetWidth = 374;
placement.placeScopeWindow();
assert.equal(placementWindow.style.left, '8px');
assert.equal(parseFloat(placementWindow.style.top), rack.offsetTop + rack.offsetHeight + 12);
assert.ok(parseFloat(placementWindow.style.top) + placementWindow.offsetHeight <= placement.innerHeight - 8);
assert.ok(rack.offsetHeight < 360, 'short viewports reserve room by making the rack scroll');
placement.innerWidth = 1440;
rack.offsetLeft = 900;
rack.offsetWidth = 520;
placementWindow.offsetWidth = 440;
placement.placeScopeWindow();
assert.equal(rackClasses.size, 0, 'resizing wide restores the full rack');
assert.equal(rackStyle.size, 0);
placement.appState.proFxOpen = false;
placement.placeScopeWindow();
assert.equal(placementWindow.style.top, '122px', 'a closed rack uses the normal scope anchor');

// Pending snapshots may finish out of order after a quick change of mind.
const classes = new Set();
const transitions = [];
const experienceContext = vm.createContext({
    studioExperience: 'immersive',
    studioExperienceTransition: null,
    studioExperienceRevision: 0,
    playfulReady: true,
    studioStarted: true,
    matchMedia: () => ({ matches: reducedMotion }),
    document: {
        body: {
            classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
        },
        querySelectorAll: () => [],
        startViewTransition: update => {
            const transition = {
                update,
                skipTransition() {},
                ready: { catch() {} },
                finished: { finally: callback => (transition.finish = callback) },
            };
            transitions.push(transition);
            return transition;
        },
    },
});
experienceContext.applyStudioExperience = next => (experienceContext.studioExperience = next);
vm.runInContext(productionFunction('js/ui/views.js', 'setStudioExperience'), experienceContext);
reducedMotion = false;
experienceContext.setStudioExperience('pro');
const first = transitions.at(-1);
experienceContext.setStudioExperience('immersive');
first.update();
assert.equal(experienceContext.studioExperience, 'immersive', 'superseded snapshots cannot apply stale modes');
first.finish();
assert.ok(classes.has('experience-transition'), 'stale cleanup cannot interrupt the latest transition');
transitions.at(-1).update();
transitions.at(-1).finish();
assert.equal(classes.size, 0);
reducedMotion = true;
experienceContext.setStudioExperience('pro');
assert.equal(experienceContext.studioExperience, 'pro', 'reduced motion applies the mode synchronously');
assert.equal(transitions.length, 2);
experienceContext.document.startViewTransition = undefined;
reducedMotion = false;
experienceContext.setStudioExperience('immersive');
assert.equal(experienceContext.studioExperience, 'immersive', 'older browsers still change modes');

console.log(
    'Passed: scope animation interruption, showcase restoration, sound/effect tap and drag gestures, responsive FX rack placement, mode transition races, reduced motion, and browser fallback.',
);
