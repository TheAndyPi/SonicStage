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
    let depth = 1, end = body + 1;
    while (depth && end < html.length) {
        if (html[end] === '{') depth++;
        if (html[end] === '}') depth--;
        end++;
    }
    return html.slice(start, end);
}
let size = new THREE.Vector2(1440,900), allocations = 0, paints = 0;
let viewport;
const camera = new THREE.PerspectiveCamera(40, 2, .1, 120);
camera.position.set(0,7.4,12.8);
const controls = { target: new THREE.Vector3(0,.5,0), maxDistance:85 };
const cameraTargetPos = camera.position.clone();
const stage = vm.createContext({
    THREE, camera, controls, cameraTargetPos, cameraLookAtTarget: controls.target.clone(),
    cinematicState:{active:false}, scene:{}, songState:{view:'stage'},
    compactStageDevice:false, window:{devicePixelRatio:1}, stageResizeFrame:0,
    getActiveTierConfig:()=>({outerR:6}), getStageViewport:()=>viewport,
    updateHUDProjections:()=>{}, renderer:{
        getSize:out=>out.copy(size), getPixelRatio:()=>1,
        setSize:(w,h)=>{size.set(w,h);allocations++;}, render:()=>paints++
    }
});
for (const name of ['stageFraming','frameStageViewport','updateStageCameraRange','resizeStageViewport']) {
    vm.runInContext(productionFunction(name), stage);
}
const desktop = {width:1440,height:900,clearWidth:1440,clearHeight:550,clearLeft:0,clearTop:68};
const portrait = {width:390,height:844,clearWidth:390,clearHeight:495,clearLeft:0,clearTop:86};
const layouts = [desktop,portrait,
    {width:844,height:390,clearWidth:844,clearHeight:40,clearLeft:0,clearTop:86},
    {width:320,height:844,clearWidth:320,clearHeight:495,clearLeft:0,clearTop:86},
    {width:1280,height:800,clearWidth:1024,clearHeight:438,clearLeft:256,clearTop:104}];
for (let cycle=0;cycle<30;cycle++) for (const layout of layouts) {
    viewport = layout;
    stage.resizeStageViewport();
    camera.lookAt(controls.target);camera.updateMatrixWorld();
    assert.ok(camera.projectionMatrix.elements.every(Number.isFinite));
    assert.ok(camera.far > camera.position.distanceTo(controls.target)+24);
    assert.ok(controls.maxDistance >= cameraTargetPos.distanceTo(stage.cameraLookAtTarget));
    assert.equal(size.x, layout.width);assert.equal(size.y, layout.height);
    const center=controls.target.clone().project(camera);
    const x=(center.x*.5+.5)*layout.width, y=(-center.y*.5+.5)*layout.height;
    assert.ok(Math.abs(x-layout.clearLeft-Math.max(160,layout.clearWidth)/2)<1e-6);
    assert.ok(Math.abs(y-layout.clearTop-Math.max(120,layout.clearHeight)/2)<1e-6);
}
const before = allocations;
stage.resizeStageViewport();stage.resizeStageViewport();
assert.equal(allocations,before,'unchanged sizes must not clear the drawing buffer');
const position = camera.position.clone(), projection = camera.projectionMatrix.clone();
viewport={...desktop,height:0};stage.resizeStageViewport();
assert.deepEqual(camera.position.toArray(),position.toArray());
assert.deepEqual(camera.projectionMatrix.elements,projection.elements);
viewport={...desktop,height:320,clearHeight:0};stage.resizeStageViewport();
assert.equal(size.y,320,'a short window still needs a full drawing buffer');
assert.ok(camera.projectionMatrix.elements.every(Number.isFinite));
viewport=desktop;stage.resizeStageViewport();
assert.ok(camera.position.distanceTo(new THREE.Vector3(0,7.4,12.8))<1e-8,'aspect changes must not accumulate camera drift');
assert.ok(paints>=150);

const actions=[];
let dialogOpen=false;
let startPage=false;
const workspace=vm.createContext({
    document:{getElementById:id=>({click:()=>actions.push(id),classList:{contains:()=>!startPage}}),querySelector:()=>dialogOpen},
    cinematicState:{active:false},playSongFrom:()=>actions.push('start'),stopSong:()=>actions.push('stop'),
    showHelp:()=>actions.push('help'),toggleCinematicPause:()=>actions.push('cinema')
});
vm.runInContext(readPublic('js/ui/workspace.js'),workspace);
// The global function declarations can be replaced without changing the keyboard routing.
workspace.undoStudio=()=>actions.push('undo');workspace.redoStudio=()=>actions.push('redo');
vm.runInContext('studioStarted=true',workspace);
function key(key, options={}) {
    const kind=options.focus || (options.editable ? 'text' : 'body');
    const tag={beat:'button',range:'input',text:'input',number:'input',checkbox:'input'}[kind] || kind;
    const type={range:'range',text:'text',number:'number',checkbox:'checkbox'}[kind];
    const target={
        matches(selector) {
            return selector.split(',').some(part=>{
                if (!part.trim().startsWith(tag)) return false;
                const excluded=[...part.matchAll(/:not\(\[type="([^"]+)"\]\)/g)].map(match=>match[1]);
                return !excluded.includes(type);
            });
        },
        closest(selector) { return this.matches(selector) ? this : null; }
    };
    const event={key,code:key===' '?'Space':key,prevented:false,stopped:false,
        preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},
        target,...options};
    workspace.handleStudioShortcut(event);return event;
}
for (const focus of ['button','select','range','summary','beat']) {
    for (const [shortcut,action] of [[' ','btn-play-toggle'],['Enter','start'],['0','stop'],['?','help']]) {
        const event=key(shortcut,{focus});assert.equal(actions.pop(),action,focus);
        assert.ok(event.prevented&&event.stopped,focus);
    }
}
for (const shortcut of [' ','Enter','0','?','z']) assert.equal(key(shortcut,{editable:true}).prevented,false);
key('s',{metaKey:true,editable:true});assert.equal(actions.pop(),'song-export');
key('z',{ctrlKey:true});assert.equal(actions.pop(),'undo');
key('Z',{metaKey:true,shiftKey:true});assert.equal(actions.pop(),'redo');
assert.equal(key('z',{metaKey:true,editable:true}).prevented,false);
assert.equal(key(' ',{repeat:true}).prevented,true);assert.equal(actions.length,0);
for (const options of [{altKey:true},{isComposing:true},{defaultPrevented:true}]) assert.equal(key(' ',options).prevented,false);
dialogOpen=true;assert.equal(key('Enter').prevented,false);dialogOpen=false;
startPage=true;assert.equal(key('Enter').prevented,false);startPage=false;
workspace.cinematicState.active=true;key(' ');assert.equal(actions.pop(),'cinema');
assert.equal(actions.length,0);
console.log('Passed: 150 camera layout changes, projection placement, clipping limits, zero-size recovery, buffer reuse, and global shortcuts with focused controls.');
