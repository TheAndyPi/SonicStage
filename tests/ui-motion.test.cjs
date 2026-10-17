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
    'Passed: scope animation interruption, showcase dismissal, responsive FX rack placement, mode transition races, reduced motion, and browser fallback.',
);
