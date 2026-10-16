/* Workspace controls. The audio and score remain in the original engine. */
const studioHistory = { undo: [], redo: [], restoring: false, last: '' };
let studioStarted = false;
let studioCommandDepth = 0;
let studioPreviousFocus = null;
let studioResizeObserver;
const studioById = id => document.getElementById(id);

function studioSnapshot() { return JSON.stringify(songDocument()); }
function updateHistoryControls() {
    studioById('project-undo').disabled = !studioHistory.undo.length;
    studioById('project-redo').disabled = !studioHistory.redo.length;
}
function checkpointSong() {
    if (studioHistory.restoring || (!songState.ready && !songState.restored)) return;
    const snapshot = studioSnapshot();
    if (studioHistory.undo.at(-1) !== snapshot) {
        studioHistory.undo.push(snapshot);
        if (studioHistory.undo.length > 30) studioHistory.undo.shift();
    }
    studioHistory.redo.length = 0;
    updateHistoryControls();
}
function restoreStudioSnapshot(serialized) {
    studioHistory.restoring = true;
    try {
        const data = readSongDocument(JSON.parse(serialized));
        stopSong(); applySongDocument(data); resetSongTransport();
        audioEngine.updateDelaySync();
        reconcileStageCapacity(false); refreshAllUI(); renderSongArrangement();
        saveSongLocally(); updateRecentSession();
    } finally { studioHistory.restoring = false; updateHistoryControls(); }
}
function undoStudio() {
    if (!studioHistory.undo.length) return;
    studioHistory.redo.push(studioSnapshot());
    restoreStudioSnapshot(studioHistory.undo.pop());
    showStageToast('Undone', '#a2b88e');
}
function redoStudio() {
    if (!studioHistory.redo.length) return;
    studioHistory.undo.push(studioSnapshot());
    restoreStudioSnapshot(studioHistory.redo.pop());
    showStageToast('Redone', '#a2b88e');
}
const RECENT_SONGS_KEY = 'sonicstage-recents-v1';
const RECENT_SONG_LIMIT = 24;
let rememberingRecent = false;
let recentSongsSeeded = false;
function readRecentSongs() {
    try {
        const list = JSON.parse(localStorage.getItem(RECENT_SONGS_KEY) || '[]');
        return Array.isArray(list) ? list.filter(item => item && typeof item.id === 'string' && item.doc?.format === 'sonicstage-song' && Array.isArray(item.doc.measures)) : [];
    } catch (_) { return []; }
}
function writeRecentSongs(list) {
    const trimmed = list.slice(0, RECENT_SONG_LIMIT);
    while (trimmed.length) {
        try { localStorage.setItem(RECENT_SONGS_KEY, JSON.stringify(trimmed)); return; }
        catch (_) { trimmed.pop(); }
    }
    try { localStorage.removeItem(RECENT_SONGS_KEY); } catch (_) {}
}
function recentSongMeta(doc) {
    const bars = doc.measures.length;
    const players = new Set(doc.measures.flatMap(measure => measure.slots.map(slot => slot.presetId))).size;
    const ensemble = players === 0 ? 'Empty' : `${players} ${players === 1 ? 'player' : 'players'}`;
    return `${ensemble} · ${bars} ${bars === 1 ? 'bar' : 'bars'} · ${doc.bpm} BPM`;
}
function rememberRecentSong() {
    if (rememberingRecent || (!songState.ready && !songState.restored && !studioStarted)) return;
    if (!songState.projectId) songState.projectId = newProjectId();
    rememberingRecent = true;
    try {
        const doc = songDocument();
        const list = readRecentSongs().filter(item => item.id !== doc.id);
        list.unshift({ id: doc.id, updated: Date.now(), doc });
        writeRecentSongs(list);
        if (songState.restored && !songState.ready) {
            try {
                const stored = JSON.parse(localStorage.getItem(SONG_STORAGE_KEY) || 'null');
                if (stored && !stored.id) localStorage.setItem(SONG_STORAGE_KEY, JSON.stringify(doc));
            } catch (_) {}
        }
        updateRecentSession();
    } finally { rememberingRecent = false; }
}
function updateRecentSession() {
    const hasSong = songState.restored || songState.ready || studioStarted;
    if (!recentSongsSeeded && !rememberingRecent && hasSong) {
        recentSongsSeeded = true;
        if (!songState.projectId) songState.projectId = newProjectId();
        if (!readRecentSongs().some(item => item.id === songState.projectId)) rememberRecentSong();
    }
    const projects = readRecentSongs();
    const list = studioById('recent-list');
    studioById('recent-session').hidden = projects.length === 0;
    if (!list) return;
    list.replaceChildren();
    projects.forEach(item => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'home-doc';
        if (item.id === songState.projectId) button.classList.add('is-current');
        button.dataset.recentId = item.id;
        if (item.id === songState.projectId) button.setAttribute('aria-current', 'true');
        button.innerHTML = '<span class="recent-icon" aria-hidden="true"></span><span><strong></strong><small></small></span>';
        button.querySelector('strong').textContent = item.doc.title || 'Untitled song';
        button.querySelector('small').textContent = recentSongMeta(item.doc);
        list.append(button);
    });
    if (document.body.classList.contains('home-open') && typeof syncHomeFrame === 'function') {
        syncHomeFrame();
        requestAnimationFrame(() => onWindowResize());
    }
}
function openRecentProject(id) {
    if (!id) return;
    if (id === songState.projectId) { enterStudio(); return; }
    const entry = readRecentSongs().find(item => item.id === id);
    if (!entry) return;
    try {
        const data = readSongDocument(JSON.parse(JSON.stringify(entry.doc)));
        rememberRecentSong();
        checkpointSong();
        stopSong();
        applySongDocument(data);
        resetSongTransport();
        audioEngine.updateDelaySync();
        reconcileStageCapacity(true);
        enterStudio();
        saveSongLocally();
        showStageToast('Song opened', '#34d399');
    } catch (error) {
        showStageToast(error instanceof SyntaxError ? 'Unable to read this song.' : error.message, '#f43f5e');
    }
}
function setWorkspaceInert(inert) {
    ['transport-header','bottom-dock','selector-tray-panel','library-resize-handle','stage-toolbar','pedestal-hud-layer','song-workspace','immersive-heading'].forEach(id=>{const el=studioById(id);if(el)el.inert=inert;});
}
function focusStudioTrack(index) {
    editStageMeasure();
    const row=studioExperience === 'pro' && document.querySelector(`.timeline-track-row[data-slot-index="${index}"]`);
    if (row) {
        document.querySelectorAll('.track-selected').forEach(el=>el.classList.remove('track-selected'));
        row.classList.add('track-selected');
        row.scrollIntoView({block:'nearest',inline:'nearest',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});
    }
    openTrackControls(index);
}
let homeReturnView = null;
function renderHomePlayers() {
    const list = studioById('home-players');
    if (!list) return;
    const selected = songState.measures[songState.selected];
    const slots = (homeStageOverride || selected.slots).filter(slot => slot.preset);
    const bar = homeStageOverride ? songState.measures.findIndex(measure => measure.slots === homeStageOverride) : songState.selected;
    const preview = bar < 0;
    studioById('home-roster-label').textContent = preview ? 'House band' : 'On stage';
    list.replaceChildren();
    slots.slice(0, 10).forEach(slot => {
        const meta = CATEGORY_META[slot.preset.category];
        const item = document.createElement('li');
        item.innerHTML = '<i></i><span></span><small></small>';
        item.children[0].style.background = meta.color;
        item.children[1].textContent = slot.preset.shortName;
        item.children[2].textContent = meta.name;
        list.append(item);
    });
    if (slots.length > 10) {
        const more = document.createElement('li');
        more.className = 'home-more';
        more.textContent = `+ ${slots.length - 10} more`;
        list.append(more);
    }
    const count = `${slots.length} ${slots.length === 1 ? 'player' : 'players'}`;
    studioById('home-stage-meta').textContent = preview ? `${count} · Preview` : bar !== songState.selected ? `${count} · Bar ${bar + 1}` : count;
}
function syncHomeFrame() {
    if (!document.body.classList.contains('home-open')) return;
    const header = document.querySelector('#welcome-modal .start-header');
    const footer = document.querySelector('#welcome-modal .start-footer');
    const rail = document.querySelector('.home-rail');
    if (!header || !footer || !rail) return;
    const sheet = matchMedia('(max-width: 760px), (max-height: 500px)').matches;
    document.documentElement.style.setProperty('--home-bar', `${Math.ceil(header.getBoundingClientRect().height)}px`);
    document.documentElement.style.setProperty('--home-foot', `${Math.ceil(footer.getBoundingClientRect().height)}px`);
    document.documentElement.style.setProperty('--home-sheet', sheet ? `${Math.ceil(rail.getBoundingClientRect().height)}px` : '0px');
}
function refreshHomeStage() {
    const open = !studioById('welcome-modal').classList.contains('is-hidden');
    document.body.classList.toggle('home-open', open);
    if (open) {
        if (homeReturnView === null) homeReturnView = songState.view;
        if (songState.view !== 'stage') setSongView('stage');
    }
    prepareHomeStage();
    syncStageToMeasure();
    if (open) renderHomePlayers();
    else if (homeReturnView && homeReturnView !== songState.view) setSongView(homeReturnView);
    if (!open) homeReturnView = null;
    syncHomeFrame();
    requestAnimationFrame(() => onWindowResize());
}
function enterStudio() {
    setWorkspaceInert(false);
    studioStarted = true;
    songState.ready = true;
    studioById('welcome-modal').classList.add('is-hidden');
    studioById('welcome-modal').inert = true;
    document.body.classList.add('studio-active');
    refreshHomeStage();
    document.title = `${studioById('project-title').value || 'Untitled song'} · SonicStage`;
    refreshAllUI(); renderSongArrangement(); updatePlayButtonUI();
    syncStudioPanels();
    requestAnimationFrame(onWindowResize);
    studioById('btn-play-toggle').focus({preventScroll: true});
}
function showStudioHome() {
    stopSong(); saveSongLocally(); updateRecentSession();
    setWorkspaceInert(true);
    studioById('welcome-modal').classList.remove('is-hidden');
    studioById('welcome-modal').inert = false;
    refreshHomeStage();
    studioById('pro-fx-drawer').inert = true;
    if (appState.proFxOpen) studioById('btn-close-fx').click();
    studioById('start-new').focus({preventScroll:true});
}
function newStudioSong() {
    checkpointSong();
    rememberRecentSong();
    const doc = {format:'sonicstage-song', version:1, id:newProjectId(), title:'Untitled song', bpm:112, rootKey:0, scaleMode:'dorian', globalSwing:.04, loop:true, selected:0, measures:[{label:'', slots:[]}]};
    stopSong(); applySongDocument(readSongDocument(doc)); resetSongTransport();
    reconcileStageCapacity(true); setSongView('stage'); enterStudio(); saveSongLocally();
    showStageToast('New song', '#d6b477');
}
function openGenerator() {
    studioPreviousFocus = document.activeElement;
    studioById('generator-error').hidden = true;
    studioById('generator-dialog').showModal();
}
function closeStudioDialog(dialog) {
    dialog.close();
    if(document.contains(studioPreviousFocus))studioPreviousFocus?.focus?.({preventScroll:true});
    else studioById('btn-play-toggle').focus({preventScroll:true});
}
function syncTrackControls() {
    const index=Number(studioById('track-dialog').dataset.slotIndex),slot=appState.slots[index];
    if (!slot?.preset) return;
    studioById('track-dialog-name').textContent=slot.preset.shortName;
    studioById('track-volume').value=Math.round(slot.volume*100);
    studioById('track-volume-value').textContent=`${Math.round(slot.volume*100)}%`;
    studioById('track-pan').value=slot.pan||0;
    studioById('track-pan-value').textContent=!slot.pan?'Center':`${Math.round(Math.abs(slot.pan)*100)}% ${slot.pan<0?'left':'right'}`;
    studioById('track-octave').value=slot.pitchShift||0;
    studioById('track-mute').setAttribute('aria-pressed',slot.muted);
    studioById('track-solo').setAttribute('aria-pressed',slot.solo);
}
function openTrackControls(index) {
    if (!appState.slots[index]?.preset) return;
    studioPreviousFocus=document.activeElement;
    studioById('track-dialog').dataset.slotIndex=index;
    syncTrackControls();studioById('track-dialog').showModal();
}
function setStudioBeatHeight(height) {
    const mobile = matchMedia('(max-width:640px)').matches;
    const minStage = mobile ? 110 : 130;
    const header = studioById('transport-header')?.getBoundingClientRect().height || 104;
    const max = Math.max(155, window.innerHeight - header - minStage - (studioExperience === 'immersive' ? 92 : mobile ? 100 : 0));
    const value = Math.round(Math.max(155, Math.min(max, Number(height) || (mobile ? 224 : 258))));
    document.documentElement.style.setProperty('--beat-height', `${value}px`);
    const handle = studioById('beatbar-resize-handle');
    handle?.setAttribute('aria-valuenow', value);
    handle?.setAttribute('aria-valuemax', Math.floor(max));
    try { localStorage.setItem(mobile ? 'sonicstage-beats-mobile' : 'sonicstage-beats-desktop', value); } catch (_) {}
}
function setStudioLibrarySize(value) {
    const mobile = matchMedia('(max-width:640px)').matches;
    if (studioExperience === 'immersive') {
        const next=Math.round(Math.max(156,Math.min(Math.max(156,innerHeight*.42),value)));
        document.documentElement.style.setProperty('--immersive-sound-height',`${next}px`);
        studioById('library-resize-handle')?.setAttribute('aria-valuenow',next);
        return;
    }
    const bound = mobile ? Math.max(100, Math.min(260, window.innerHeight * .3)) : Math.min(420, window.innerWidth * .4);
    const next = Math.round(Math.max(mobile ? 100 : 190, Math.min(bound, value)));
    document.documentElement.style.setProperty(mobile ? '--sound-height' : '--library-width', `${next}px`);
    studioById('library-resize-handle')?.setAttribute('aria-valuenow', next);
    try { localStorage.setItem(mobile ? 'sonicstage-sounds-mobile' : 'sonicstage-sounds-desktop', next); } catch (_) {}
}
function bindStudioResize(handle, kind) {
    const mobile = () => matchMedia('(max-width:640px)').matches;
    const defaultSize = () => kind === 'beats' ? mobile() ? 224 : 258 : studioExperience === 'immersive' ? mobile() ? 179 : 186 : mobile() ? 146 : 256;
    const read = () => kind === 'beats' ? studioById('bottom-dock').getBoundingClientRect().height : (mobile() || studioExperience === 'immersive') ? studioById('selector-tray-panel').getBoundingClientRect().height : studioById('selector-tray-panel').getBoundingClientRect().width;
    const apply = kind === 'beats' ? setStudioBeatHeight : setStudioLibrarySize;
    handle.setAttribute('role','separator'); handle.tabIndex = 0;
    handle.setAttribute('aria-label', kind === 'beats' ? 'Resize beat editor' : 'Resize sound browser');
    handle.setAttribute('aria-orientation', kind === 'beats' || mobile() ? 'horizontal' : 'vertical');
    handle.setAttribute('aria-valuemin', kind === 'beats' ? '155' : mobile() ? '100' : '190');
    handle.setAttribute('aria-valuemax', kind === 'beats' ? window.innerHeight - 210 : mobile() ? '260' : '420');
    handle.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault();
        handle.focus({preventScroll:true});
        const vertical = kind === 'beats' || mobile() || studioExperience === 'immersive';
        const initial = vertical ? event.clientY : event.clientX;
        const size = read();
        let latest = initial, frame = 0;
        handle.setPointerCapture(event.pointerId);
        document.body.classList.add('is-resizing');
        const paint = () => { frame=0; apply(size + (vertical ? initial - latest : latest - initial)); };
        const move = e => { latest = vertical ? e.clientY : e.clientX; if (!frame) frame=requestAnimationFrame(paint); };
        const end = e => {
            if(frame) {cancelAnimationFrame(frame); paint();}
            try {handle.releasePointerCapture(e.pointerId);} catch (_) {}
            handle.removeEventListener('pointermove',move); handle.removeEventListener('pointerup',end); handle.removeEventListener('pointercancel',end);
            document.body.classList.remove('is-resizing');
        };
        handle.addEventListener('pointermove',move); handle.addEventListener('pointerup',end); handle.addEventListener('pointercancel',end);
    });
    handle.addEventListener('keydown', event => {
        const vertical = kind === 'beats' || mobile() || studioExperience === 'immersive';
        let delta = 0;
        if (vertical && event.key === 'ArrowUp') delta=20;
        if (vertical && event.key === 'ArrowDown') delta=-20;
        if (!vertical && event.key === 'ArrowRight') delta=20;
        if (!vertical && event.key === 'ArrowLeft') delta=-20;
        if(delta) {event.preventDefault();apply(read()+delta);}
        if(event.key === 'Home') {event.preventDefault();apply(defaultSize());}
    });
    handle.addEventListener('dblclick', () => apply(defaultSize()));
}

function handleStudioShortcut(event) {
    if (event.defaultPrevented || event.isComposing || event.altKey || !studioStarted || !studioById('welcome-modal').classList.contains('is-hidden') || document.querySelector('dialog[open]')) return;
    const target = event.target;
    const editable = target.closest('textarea,[contenteditable=""],[contenteditable="true"]') || target.matches('input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])');
    const command = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    let action;
    if (command) {
        if (key === 's') action = () => studioById('song-export').click();
        else if (key === 'z' && !editable && !cinematicState.active) action = event.shiftKey ? redoStudio : undoStudio;
    } else if (!editable) {
        if (event.code === 'Space' || event.key === ' ') action = cinematicState.active ? toggleCinematicPause : () => studioById('btn-play-toggle').click();
        else if (!cinematicState.active) {
            if (event.key === 'Enter') action = () => playSongFrom(0);
            else if (event.key === '0') action = stopSong;
            else if (event.key === '?') action = showHelp;
        }
    }
    if (!action) return;
    // Capture before a focused button, select, or beat step can consume the same key.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) action();
}

function initStudio() {
    const tray = studioById('selector-tray-panel');
    const palette = studioById('token-palette');
    const filters = tray.querySelector('.cat-tab').parentElement;
    filters.className = 'library-filters';
    const togglePalette = studioById('btn-toggle-palette');
    const toggleTimeline = studioById('btn-toggle-timeline');
    tray.replaceChildren();
    const heading = document.createElement('div');heading.className='library-heading';
    heading.innerHTML='<h2>Sounds <span>100</span></h2>';
    togglePalette.textContent='Hide';togglePalette.setAttribute('aria-expanded','true');heading.append(togglePalette);
    const search=document.createElement('label');search.className='sound-search';
    search.innerHTML='<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="8" cy="8" r="5"/><path d="m12 12 5 5"/></svg><input id="sound-search" type="search" placeholder="Search sounds" aria-label="Search sounds">';
    const caption=document.createElement('div');caption.className='library-caption';caption.innerHTML='<span>INSTRUMENT</span><span>ADD</span>';
    const footer=document.createElement('div');footer.className='library-footer';footer.innerHTML='<span class="live-dot"></span> CLICK TO ADD · DRAG TO PLACE';
    tray.append(heading,search,filters,caption,palette,footer);
    document.body.appendChild(tray);
    const separator=document.createElement('div');separator.id='library-resize-handle';separator.title='Drag to resize sounds · Double-click to reset';document.body.append(separator);
    const beatActions=document.createElement('div');beatActions.className='beat-context-actions';
    const help=document.createElement('button');help.className='quiet-button';help.textContent='?';help.title='Keyboard shortcuts';help.setAttribute('aria-label','Keyboard shortcuts');
    toggleTimeline.textContent='Hide beats';beatActions.append(help,toggleTimeline);studioById('measure-context').appendChild(beatActions);
    studioById('measure-context').querySelector('.measure-editor-hint')?.remove();
    studioById('sound-search').addEventListener('input',renderTokenPalette);
    document.querySelectorAll('.cat-tab').forEach(tab => {
        const active = tab.dataset.cat === appState.selectedCategory;
        tab.setAttribute('aria-pressed',active);
        if (tab.dataset.cat === 'all') tab.textContent='All';
        else tab.lastChild.textContent = tab.dataset.cat.charAt(0).toUpperCase() + tab.dataset.cat.slice(1);
        tab.addEventListener('click',()=>document.querySelectorAll('.cat-tab').forEach(t=>t.setAttribute('aria-pressed',t===tab)));
    });
    renderTokenPalette();
    studioById('project-undo').addEventListener('click',undoStudio);studioById('project-redo').addEventListener('click',redoStudio);
    studioById('project-new').addEventListener('click',newStudioSong);studioById('start-new').addEventListener('click',newStudioSong);
    studioById('project-open').addEventListener('click',()=>studioById('song-file').click());studioById('start-open').addEventListener('click',()=>studioById('song-file').click());
    studioById('project-save').addEventListener('click',()=>studioById('song-export').click());
    studioById('project-generate').addEventListener('click',openGenerator);studioById('start-generate').addEventListener('click',openGenerator);
    studioById('studio-home').addEventListener('click',showStudioHome);
    studioById('transport-restart').addEventListener('click',()=>playSongFrom(0));studioById('transport-stop').addEventListener('click',stopSong);
    const showHelp = () => {studioPreviousFocus=document.activeElement;studioById('shortcuts-dialog').showModal();};
    help.addEventListener('click',showHelp);studioById('start-shortcuts').addEventListener('click',showHelp);
    document.querySelectorAll('[data-close-dialog]').forEach(button=>button.addEventListener('click',()=>closeStudioDialog(button.closest('dialog'))));
    document.querySelectorAll('.studio-dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeStudioDialog(dialog);}}));
    const trackIndex=()=>Number(studioById('track-dialog').dataset.slotIndex);
    studioById('track-volume').addEventListener('input',event=>{setSlotVolume(trackIndex(),event.target.value);syncTrackControls();});
    studioById('track-pan').addEventListener('input',event=>{setSlotPan(trackIndex(),event.target.value);syncTrackControls();});
    studioById('track-octave').addEventListener('change',event=>{checkpointSong();appState.slots[trackIndex()].pitchShift=Number(event.target.value);refreshAllUI();syncTrackControls();});
    studioById('track-mute').addEventListener('click',()=>{toggleSlotMute(trackIndex());syncTrackControls();});
    studioById('track-solo').addEventListener('click',()=>{toggleSlotSolo(trackIndex());syncTrackControls();});
    studioById('track-shuffle').addEventListener('click',()=>randomizeSlotPattern(trackIndex()));
    studioById('track-reset').addEventListener('click',()=>resetSlotPattern(trackIndex()));
    studioById('track-remove').addEventListener('click',()=>{clearSlot(trackIndex());studioById('track-dialog').close();studioById('sound-search').focus();});
    studioById('generator-form').addEventListener('submit',async event=>{
        event.preventDefault();const button=studioById('generator-submit');button.disabled=true;button.textContent='Composing…';
        await new Promise(requestAnimationFrame);
        try {
            const style = new FormData(event.target).get('style');
            rememberRecentSong();
            const data=generateSong({style,bars:Number(studioById('generator-bars').value),energy:studioById('generator-energy').value});
            data.title={house:'After hours',lofi:'Slow mornings',funk:'In the pocket',cinematic:'First light'}[style];
            data.id=newProjectId();
            const valid=readSongDocument(data);
            checkpointSong();stopSong();applySongDocument(valid);resetSongTransport();audioEngine.updateDelaySync();
            reconcileStageCapacity(true);studioById('generator-dialog').close();enterStudio();setSongView(studioExperience === 'pro' ? 'song' : 'stage');saveSongLocally();
            showStageToast(`${data.measures.length} bars ready · ${data.bpm} BPM`, '#b9c695');
        } catch(error) {studioById('generator-error').textContent=error.message || 'Could not generate this song.';studioById('generator-error').hidden=false;}
        finally {button.disabled=false;button.textContent='✳ Generate song';}
    });
    // One history entry per command or fader gesture, including keyboard edits.
    const wrap = fn => function(...args){
        if (!studioCommandDepth) checkpointSong();
        const focused = document.activeElement;
        const step = focused?.matches('.timeline-cell') ? {slot:focused.closest('[data-slot-index]').dataset.slotIndex,step:focused.dataset.step} : null;
        const sound = focused?.closest('.studio-token')?.getAttribute('aria-label');
        studioCommandDepth++;
        try {return fn.apply(this,args);} finally {
            studioCommandDepth--;
            if (step) document.querySelector(`[data-slot-index="${step.slot}"] [data-step="${step.step}"]`)?.focus({preventScroll:true});
            if (sound && !document.contains(focused)) {
                const name = sound.replace(/^(Add|Remove) /,'');
                [...document.querySelectorAll('.studio-token')].find(el=>el.getAttribute('aria-label')?.endsWith(' '+name))?.focus({preventScroll:true});
            }
        }
    };
    assignPresetToSlot=wrap(assignPresetToSlot);handleStepCellClick=wrap(handleStepCellClick);
    randomizeSlotPattern=wrap(randomizeSlotPattern);resetSlotPattern=wrap(resetSlotPattern);
    toggleSlotMute=wrap(toggleSlotMute);toggleSlotSolo=wrap(toggleSlotSolo);cycleSlotOctave=wrap(cycleSlotOctave);
    clearSlot=wrap(clearSlot);clearAllSlots=wrap(clearAllSlots);moveStagePlayer=wrap(moveStagePlayer);triggerAutoMix=wrap(triggerAutoMix);
    insertSongMeasures=wrap(insertSongMeasures);
    document.addEventListener('pointerdown',event=>{
        if(event.target.matches('input[type=range],#project-title,#song-measure-label,#bpm-number-input,#key-select,#scale-select')||event.target.closest('#song-delete,#song-move-left,#song-move-right,#song-loop')) checkpointSong();
    },true);
    document.addEventListener('keydown',event=>{
        if(event.target.matches('input[type=range],#project-title,#song-measure-label,#bpm-number-input,#key-select,#scale-select')&&!event.metaKey&&!event.ctrlKey && !['Tab','Shift','Control','Alt','Meta'].includes(event.key)) checkpointSong();
    },true);
    studioById('project-title').addEventListener('input',()=>{songChanged();document.title=`${studioById('project-title').value || 'Untitled song'} · SonicStage`;});
    const saveStatus = studioById('song-save-status');
    new MutationObserver(()=>{
        const status=saveStatus.textContent;
        studioById('project-status').textContent=status==='Saving…'?'SAVING…':status==='Saved on this browser'?'SAVED LOCALLY':status.toUpperCase();
    }).observe(saveStatus,{childList:true,characterData:true,subtree:true});
    document.addEventListener('keydown', event=>{
        const cell=event.target.closest('.timeline-cell');
        if (!cell || !['ArrowRight','ArrowLeft','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
        event.preventDefault();
        const rows=[...document.querySelectorAll('.timeline-track-row')];
        let row=rows.indexOf(cell.closest('.timeline-track-row')), step=Number(cell.dataset.step);
        if(event.key==='ArrowRight')step=Math.min(15,step+1);
        if(event.key==='ArrowLeft')step=Math.max(0,step-1);
        if(event.key==='ArrowDown')row=Math.min(rows.length-1,row+1);
        if(event.key==='ArrowUp')row=Math.max(0,row-1);
        if(event.key==='Home')step=0;
        if(event.key==='End')step=15;
        rows[row]?.querySelector(`[data-step="${step}"]`)?.focus();
    });
    studioById('btn-pro-fx').addEventListener('click',()=>{if(appState.proFxOpen)studioById('fx-eq-low').focus({preventScroll:true});});
    studioById('btn-close-fx').addEventListener('click',()=>studioById('btn-pro-fx').focus({preventScroll:true}));
    studioById('pro-fx-drawer').inert=true;
    document.querySelectorAll('#pro-fx-drawer input[type=range]').forEach(input=>{if(!input.hasAttribute('aria-label')) input.setAttribute('aria-label',input.id.replace('fx-','').replaceAll('-',' '));});
    studioById('btn-close-fx').setAttribute('aria-label','Close effects rack');
    bindStudioResize(studioById('beatbar-resize-handle'),'beats');bindStudioResize(separator,'sounds');
    let wasMobile=matchMedia('(max-width:640px)').matches;
    const restoreSizes=()=>{
        const mobile=matchMedia('(max-width:640px)').matches;
        document.documentElement.style.removeProperty('--library-width');document.documentElement.style.removeProperty('--sound-height');
        let beat=mobile?224:258,library=mobile?146:256;
        try{beat=Number(localStorage.getItem(mobile?'sonicstage-beats-mobile':'sonicstage-beats-desktop'))||beat;library=Number(localStorage.getItem(mobile?'sonicstage-sounds-mobile':'sonicstage-sounds-desktop'))||library;}catch(_){}
        setStudioBeatHeight(beat);if(studioExperience === 'pro')setStudioLibrarySize(library);
        syncStudioResizeHandle();
        wasMobile=mobile;
    };
    restoreSizes();
    window.addEventListener('resize',()=>{if(wasMobile!==matchMedia('(max-width:640px)').matches)restoreSizes();else setStudioBeatHeight(parseInt(getComputedStyle(document.documentElement).getPropertyValue('--beat-height')));syncStudioResizeHandle();});
    document.querySelectorAll('.beatbar-size-btn').forEach(btn=>btn.setAttribute('aria-pressed',btn.dataset.size==='md'));
    document.addEventListener('keydown',event=>{
        if(event.key==='Escape'&&!document.querySelector('dialog[open]')&&!cinematicState.active){if(appState.proFxOpen){studioById('btn-close-fx').click();studioById('btn-pro-fx').focus();}document.querySelectorAll('details[open]').forEach(d=>d.open=false);}
    });
    document.addEventListener('keydown',handleStudioShortcut,true);
    studioById('recent-list').addEventListener('click', event => {
        const button = event.target.closest('[data-recent-id]');
        if (button) openRecentProject(button.dataset.recentId);
    });
    updateRecentSession();updateHistoryControls();updatePlayButtonUI();
    setWorkspaceInert(true);
    // Prevent hidden working controls from receiving focus on the start page.
    studioById('start-new').focus({preventScroll:true});
    initPlayfulStudio();
    refreshHomeStage();
}
