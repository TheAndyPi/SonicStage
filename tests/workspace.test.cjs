const assert = require('node:assert/strict');
const vm = require('node:vm');
const THREE = require('../public/vendor/three.min.js');
const { appSource, readPublic } = require('./app-source.cjs');
const html = appSource();
// Isolate the production camera functions without starting Web Audio or WebGL.
function productionFunction(name) {
    const start = html.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const body = html.indexOf('{', start);
    let depth = 1,
        end = body + 1;
    while (depth && end < html.length) {
        if (html[end] === '{') depth++;
        if (html[end] === '}') depth--;
        end++;
    }
    return html.slice(start, end);
}
let size = new THREE.Vector2(1440, 900),
    allocations = 0,
    paints = 0;
let viewport;
const camera = new THREE.PerspectiveCamera(40, 2, 0.1, 120);
camera.position.set(0, 7.4, 12.8);
const controls = { target: new THREE.Vector3(0, 0.5, 0), maxDistance: 85 };
const cameraTargetPos = camera.position.clone();
const stage = vm.createContext({
    THREE,
    camera,
    controls,
    cameraTargetPos,
    cameraLookAtTarget: controls.target.clone(),
    cinematicState: { active: false },
    scene: {},
    songState: { view: 'stage' },
    compactStageDevice: false,
    window: { devicePixelRatio: 1 },
    stageResizeFrame: 0,
    getActiveTierConfig: () => ({ outerR: 6 }),
    getStageViewport: () => viewport,
    updateHUDProjections: () => {},
    renderer: {
        getSize: out => out.copy(size),
        getPixelRatio: () => 1,
        setSize: (w, h) => {
            size.set(w, h);
            allocations++;
        },
        render: () => paints++,
    },
});
for (const name of ['stageFraming', 'frameStageViewport', 'updateStageCameraRange', 'resizeStageViewport']) {
    vm.runInContext(productionFunction(name), stage);
}
const desktop = { width: 1440, height: 900, clearWidth: 1440, clearHeight: 550, clearLeft: 0, clearTop: 68 };
const portrait = { width: 390, height: 844, clearWidth: 390, clearHeight: 495, clearLeft: 0, clearTop: 86 };
const layouts = [
    desktop,
    portrait,
    { width: 844, height: 390, clearWidth: 844, clearHeight: 40, clearLeft: 0, clearTop: 86 },
    { width: 320, height: 844, clearWidth: 320, clearHeight: 495, clearLeft: 0, clearTop: 86 },
    { width: 1280, height: 800, clearWidth: 1024, clearHeight: 438, clearLeft: 256, clearTop: 104 },
];
for (let cycle = 0; cycle < 30; cycle++)
    for (const layout of layouts) {
        viewport = layout;
        stage.resizeStageViewport();
        camera.lookAt(controls.target);
        camera.updateMatrixWorld();
        assert.ok(camera.projectionMatrix.elements.every(Number.isFinite));
        assert.ok(camera.far > camera.position.distanceTo(controls.target) + 24);
        assert.ok(controls.maxDistance >= cameraTargetPos.distanceTo(stage.cameraLookAtTarget));
        assert.equal(size.x, layout.width);
        assert.equal(size.y, layout.height);
        const center = controls.target.clone().project(camera);
        const x = (center.x * 0.5 + 0.5) * layout.width,
            y = (-center.y * 0.5 + 0.5) * layout.height;
        assert.ok(Math.abs(x - layout.clearLeft - Math.max(160, layout.clearWidth) / 2) < 1e-6);
        assert.ok(Math.abs(y - layout.clearTop - Math.max(120, layout.clearHeight) / 2) < 1e-6);
    }
const before = allocations;
stage.resizeStageViewport();
stage.resizeStageViewport();
assert.equal(allocations, before, 'unchanged sizes must not clear the drawing buffer');
const position = camera.position.clone(),
    projection = camera.projectionMatrix.clone();
viewport = { ...desktop, height: 0 };
stage.resizeStageViewport();
assert.deepEqual(camera.position.toArray(), position.toArray());
assert.deepEqual(camera.projectionMatrix.elements, projection.elements);
viewport = { ...desktop, height: 320, clearHeight: 0 };
stage.resizeStageViewport();
assert.equal(size.y, 320, 'a short window still needs a full drawing buffer');
assert.ok(camera.projectionMatrix.elements.every(Number.isFinite));
viewport = desktop;
stage.resizeStageViewport();
assert.ok(
    camera.position.distanceTo(new THREE.Vector3(0, 7.4, 12.8)) < 1e-8,
    'aspect changes must not accumulate camera drift',
);
assert.ok(paints >= 150);

// Use real geometry and raycasts to reproduce a foreground performer blocking another.
const selectionScene = new THREE.Scene();
const selectionCamera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
const selectionPedestals = [];
const selectionProxies = [];
for (let index = 0; index < 2; index++) {
    const rootGroup = new THREE.Group();
    rootGroup.position.z = index === 0 ? 3.4 : 0;
    const proxy = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1.85, 12));
    proxy.position.y = 0.75;
    proxy.userData.slotIndex = index;
    const baseCyl = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.16, 12));
    baseCyl.position.y = -0.08;
    baseCyl.userData.slotIndex = index;
    rootGroup.add(proxy, baseCyl);
    selectionScene.add(rootGroup);
    selectionPedestals.push({
        rootGroup,
        baseCyl,
        baseScale: 1,
        performerGroup: new THREE.Group(),
        departingPerformers: [new THREE.Group()],
        effectVisuals: new THREE.Group(),
    });
    selectionProxies.push(proxy);
}
selectionScene.updateMatrixWorld(true);
const selectionState = { unlockedSlots: 2, slots: [{ preset: {} }, { preset: {} }] };
const selectionApp = { hoveredSlotIndex: -1 };
const selectionClasses = new Set();
const selectionCanvas = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 600, bottom: 600 }) };
const selection = vm.createContext({
    camera: selectionCamera,
    raycaster: new THREE.Raycaster(),
    mouseNDC: new THREE.Vector2(),
    _tempVec3: new THREE.Vector3(),
    pedestalMeshes: selectionPedestals,
    pedestalHitProxies: selectionProxies,
    stageState: selectionState,
    appState: selectionApp,
    renderer: { domElement: selectionCanvas },
    cinematicState: { active: false },
    document: { body: { classList: { contains: name => selectionClasses.has(name) } } },
    playerDrag: null,
    controls: { enabled: true },
    pointerDownPos: {},
});
selection.setStagePointer = (x, y) => selection.mouseNDC.set((x / 600) * 2 - 1, -(y / 600) * 2 + 1);
for (const name of [
    'stagePlayersLocked',
    'updateStageCutaway',
    'pickStageSlot',
    'checkPedestalHover',
    'beginPlayerDrag',
    'onStagePointerDown',
    'onStagePointerUp',
])
    vm.runInContext(productionFunction(name), selection);
function placeSelectionCamera(z) {
    selectionCamera.position.set(0, 0.9, z);
    selectionCamera.lookAt(0, 0.9, 0);
    selectionCamera.updateMatrixWorld(true);
    selection.updateStageCutaway();
}
placeSelectionCamera(8);
assert.equal(selection.pickStageSlot(300, 300), 0, 'normal picking still selects the front player');
assert.equal(selection.pickStageSlot(300, 300, 0), 1, 'the dragged source cannot block a destination behind it');
placeSelectionCamera(5);
assert.equal(selectionPedestals[0].performerGroup.visible, false, 'close models clear the foreground');
assert.equal(selectionPedestals[0].departingPerformers[0].visible, false, 'departing models clear too');
assert.equal(selectionPedestals[0].effectVisuals.visible, false, 'effect halos cannot obscure the rear player');
assert.equal(selectionPedestals[1].performerGroup.visible, true);
assert.equal(selection.pickStageSlot(300, 300), 1, 'click through the cleared model to the rear player');
selection.checkPedestalHover(300, 300);
assert.equal(selectionApp.hoveredSlotIndex, 1, 'drag and effect hover use the same cutaway picking');
selection.onStagePointerDown({ target: selectionCanvas, button: 0, clientX: 300, clientY: 300 });
assert.equal(selection.playerDrag.from, 1, 'dragging starts on the intended rear player');
assert.equal(selection.controls.enabled, false);
selection.playerDrag = null;
let selectedPlayer = -1;
selection.toggleSlotMute = index => (selectedPlayer = index);
selectionApp.slots = selectionState.slots;
selection.onStagePointerUp({ target: selectionCanvas, clientX: 300, clientY: 300 });
assert.equal(selectedPlayer, 1, 'click actions agree with drag selection');
selectionCamera.lookAt(0, -0.08, 3.4);
selectionCamera.updateMatrixWorld(true);
assert.equal(selection.pickStageSlot(300, 300), 0, 'the cleared player remains selectable via its pedestal');
placeSelectionCamera(6.4);
assert.equal(selectionPedestals[0].cameraCutaway, true, 'the exit buffer prevents flicker');
placeSelectionCamera(6.8);
assert.equal(selectionPedestals[0].performerGroup.visible, true, 'models return when the camera backs away');
placeSelectionCamera(6.4);
assert.equal(selectionPedestals[0].cameraCutaway, false, 'the entry buffer prevents flicker');
placeSelectionCamera(5);
selectionState.unlockedSlots = 1;
assert.equal(selection.pickStageSlot(300, 300), -1, 'locked slots cannot be selected through the cutaway');
selectionState.unlockedSlots = 2;
selectionPedestals[1].rootGroup.visible = false;
assert.equal(selection.pickStageSlot(300, 300), -1, 'hidden pedestals cannot intercept clicks');
selectionPedestals[1].rootGroup.visible = true;
assert.equal(selection.pickStageSlot(-1, 300), -1, 'drops outside the canvas are ignored');
selection.cinematicState.active = true;
selection.updateStageCutaway();
assert.ok(
    selectionPedestals.every(ped => ped.performerGroup.visible),
    'showcase keeps every model',
);
selection.cinematicState.active = false;
selectionClasses.add('home-open');
selection.updateStageCutaway();
assert.ok(
    selectionPedestals.every(ped => ped.performerGroup.visible),
    'the landing stage keeps every model',
);
selectionClasses.clear();
selectionPedestals[0].baseScale = 0.82;
placeSelectionCamera(6);
assert.equal(selectionPedestals[0].cameraCutaway, false, 'smaller outer-ring models use a smaller clearance');
placeSelectionCamera(5);
assert.equal(selectionPedestals[0].cameraCutaway, true);

const actions = [];
const bodyClasses = new Set();
let dialogOpen = false;
let startPage = false;
const workspace = vm.createContext({
    document: {
        body: { classList: { add: name => bodyClasses.add(name), remove: name => bodyClasses.delete(name) } },
        getElementById: id => ({ click: () => actions.push(id), classList: { contains: () => !startPage } }),
        querySelector: () => dialogOpen,
    },
    cinematicState: { active: false },
    playSongFrom: () => actions.push('start'),
    stopSong: () => actions.push('stop'),
    showHelp: () => actions.push('help'),
    toggleCinematicPause: () => actions.push('cinema'),
});
vm.runInContext(readPublic('js/ui/workspace.js'), workspace);
// The global function declarations can be replaced without changing the keyboard routing.
workspace.undoStudio = () => actions.push('undo');
workspace.redoStudio = () => actions.push('redo');
vm.runInContext('studioStarted=true', workspace);
function key(key, options = {}) {
    const kind = options.focus || (options.editable ? 'text' : 'body');
    const tag = { beat: 'button', range: 'input', text: 'input', number: 'input', checkbox: 'input' }[kind] || kind;
    const type = { range: 'range', text: 'text', number: 'number', checkbox: 'checkbox' }[kind];
    const target = {
        matches(selector) {
            return selector.split(',').some(part => {
                if (!part.trim().startsWith(tag)) return false;
                const excluded = [...part.matchAll(/:not\(\[type="([^"]+)"\]\)/g)].map(match => match[1]);
                return !excluded.includes(type);
            });
        },
        closest(selector) {
            return this.matches(selector) ? this : null;
        },
    };
    const event = {
        key,
        code: key === ' ' ? 'Space' : key,
        prevented: false,
        stopped: false,
        preventDefault() {
            this.prevented = true;
        },
        stopImmediatePropagation() {
            this.stopped = true;
        },
        target,
        ...options,
    };
    workspace.handleStudioShortcut(event);
    return event;
}
for (const focus of ['button', 'select', 'range', 'summary', 'beat']) {
    for (const [shortcut, action] of [
        [' ', 'btn-play-toggle'],
        ['Enter', 'start'],
        ['0', 'stop'],
        ['?', 'help'],
    ]) {
        const event = key(shortcut, { focus });
        assert.equal(actions.pop(), action, focus);
        assert.ok(event.prevented && event.stopped, focus);
    }
}
for (const shortcut of [' ', 'Enter', '0', '?', 'z']) assert.equal(key(shortcut, { editable: true }).prevented, false);
key('s', { metaKey: true, editable: true });
assert.equal(actions.pop(), 'song-export');
key('z', { ctrlKey: true });
assert.equal(actions.pop(), 'undo');
key('Z', { metaKey: true, shiftKey: true });
assert.equal(actions.pop(), 'redo');
assert.equal(key('z', { metaKey: true, editable: true }).prevented, false);
assert.equal(key(' ', { repeat: true }).prevented, true);
assert.equal(actions.length, 0);
key(' ', { focus: 'beat' });
assert.equal(actions.pop(), 'btn-play-toggle');
assert.ok(bodyClasses.has('transport-shortcut'), 'transport hides the incidental focus ring');
key(' ', { repeat: true });
assert.ok(bodyClasses.has('transport-shortcut'), 'holding Space keeps the focus ring hidden');
key('Tab');
assert.ok(!bodyClasses.has('transport-shortcut'), 'Tab restores visible keyboard focus');
key(' ', { editable: true });
assert.ok(!bodyClasses.has('transport-shortcut'), 'typing a space leaves text field focus alone');
for (const options of [{ altKey: true }, { isComposing: true }, { defaultPrevented: true }])
    assert.equal(key(' ', options).prevented, false);
dialogOpen = true;
assert.equal(key('Enter').prevented, false);
dialogOpen = false;
startPage = true;
assert.equal(key('Enter').prevented, false);
startPage = false;
workspace.cinematicState.active = true;
key(' ');
assert.equal(actions.pop(), 'cinema');
assert.equal(actions.length, 0);
const menuListeners = new Map();
const documentListeners = new Map();
const menuButton = { closest: selector => (selector === 'button' ? menuButton : null) };
const summary = { closest: () => null };
const outside = {};
const stageMenu = {
    open: true,
    contains: target => target === menuButton || target === summary,
    addEventListener: (name, listener) => menuListeners.set(name, listener),
};
const menuContext = vm.createContext({
    document: {
        querySelector: () => stageMenu,
        body: { classList: { remove: () => {} } },
        addEventListener: (name, listener) => documentListeners.set(name, listener),
    },
});
vm.runInContext(productionFunction('bindStageMenu'), menuContext);
menuContext.bindStageMenu();
documentListeners.get('pointerdown')({ target: menuButton });
menuListeners.get('focusout')({ relatedTarget: null });
assert.ok(stageMenu.open, 'a touch blur must leave the action mounted until its click');
menuListeners.get('click')({ target: menuButton });
assert.ok(!stageMenu.open, 'the menu dismisses after the action click');
stageMenu.open = true;
menuListeners.get('click')({ target: summary });
menuListeners.get('focusout')({ relatedTarget: menuButton });
assert.ok(stageMenu.open, 'moving focus within the menu keeps it open');
menuListeners.get('focusout')({ relatedTarget: outside });
assert.ok(!stageMenu.open, 'tabbing outside still dismisses the menu');
stageMenu.open = true;
documentListeners.get('pointerdown')({ target: outside });
assert.ok(!stageMenu.open, 'tapping outside still dismisses the menu');
console.log(
    'Passed: 150 camera layout changes, projection placement, clipping limits, zero-size recovery, buffer reuse, foreground cutaway selection and dragging, global shortcuts with focused controls, and touch menu dismissal.',
);
