/* The same song and players, with two ways to work. */
let studioExperience = 'immersive';
let studioTheme = document.documentElement.dataset.theme || 'light';
let playfulReady = false;
let proSongView = 'stage';
const studioPanels = { pro: { sounds: true, beats: true }, immersive: { sounds: true, beats: false } };
try { if (localStorage.getItem('sonicstage-experience') === 'pro') studioExperience = 'pro'; } catch (_) {}

function instrumentGlyph(category) {
    const paths = {
        drums: '<ellipse cx="12" cy="7" rx="8" ry="3"/><path d="M4 7v10c0 4 16 4 16 0V7M7 10v8m10-8v8M4 3l6 3m10-3-6 3"/>',
        bass: '<path d="m16 3 4 1-5 10c3 5-1 9-6 7S3 14 8 12l5-7zM9 16 19 4"/><circle cx="10" cy="16" r="1"/>',
        chords: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M7 7v7m5-7v7m5-7v7M8 14v5m8-5v5"/>',
        melody: '<path d="M5 18V8l13-4v11M5 10l13-4"/><ellipse cx="3.5" cy="18" rx="2.5" ry="2"/><ellipse cx="16.5" cy="15" rx="2.5" ry="2"/>',
        strings: '<path d="m15 3 4 1-6 11M14 7c-1-3-5-1-4 2s-1 3-3 4-2 6 1 8 7-1 6-4-1-4 2-5 2-5-2-5zM9 16 19 3M4 5l17 15"/>',
        vocals: '<rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8M9 6h6m-6 3h6"/>'
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">${paths[category] || paths.melody}</svg>`;
}
function orderedStudioSounds() {
    if (studioExperience === 'pro') return INSTRUMENT_PRESETS;
    const groups=Object.keys(CATEGORY_META).map(category=>INSTRUMENT_PRESETS.filter(preset=>preset.category===category));
    return Array.from({length:Math.max(...groups.map(group=>group.length))},(_,index)=>groups.map(group=>group[index]).filter(Boolean)).flat();
}
function themeIcon(theme) {
    return theme === 'light'
        ? '<svg viewBox="-1.53 1.35 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M20 14a8 8 0 0 1-10-10 8.5 8.5 0 1 0 10 10Z"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/></svg>';
}
function setStudioTheme(theme) {
    studioTheme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = studioTheme;
    document.documentElement.classList.toggle('dark', studioTheme === 'dark');
    document.querySelectorAll('.theme-toggle').forEach(button => {
        button.innerHTML = themeIcon(studioTheme);
        button.setAttribute('aria-label', `Switch to ${studioTheme === 'light' ? 'dark' : 'light'} mode`);
        button.title = `Switch to ${studioTheme === 'light' ? 'dark' : 'light'} mode`;
    });
    if (typeof applyStageTheme === 'function') applyStageTheme(studioTheme);
    try { localStorage.setItem('sonicstage-theme', studioTheme); } catch (_) {}
}
function paintStudioPanel(kind, open) {
    const sounds = kind === 'sounds';
    const panel = studioById(sounds ? 'selector-tray-panel' : 'bottom-dock');
    const trigger = studioById(sounds ? 'btn-sounds' : 'btn-beats');
    if (!open && panel.contains(document.activeElement)) trigger?.focus({preventScroll:true});
    if (sounds) appState.paletteCollapsed = !open;
    else appState.timelineVisible = open;
    document.body.classList.toggle(sounds ? 'sounds-collapsed' : 'beats-collapsed', !open);
    panel.inert = !open || !studioStarted;
    panel.setAttribute('aria-hidden', !open);
    trigger?.setAttribute('aria-expanded', open);
    trigger?.setAttribute('aria-pressed', open);
    studioById(sounds ? 'btn-toggle-palette' : 'btn-toggle-timeline').textContent = sounds ? (open ? 'Hide' : 'Show') : (open ? 'Hide beats' : 'Show beats');
    studioById(sounds ? 'btn-toggle-palette' : 'btn-toggle-timeline').setAttribute('aria-expanded', open);
    if (sounds) studioById('library-resize-handle').inert = !open || !studioStarted;
}
function syncStudioPanels() {
    if (!playfulReady) return;
    paintStudioPanel('sounds', !appState.paletteCollapsed);
    paintStudioPanel('beats', appState.timelineVisible);
}
function syncStudioResizeHandle() {
    const handle = studioById('library-resize-handle');
    if (!handle) return;
    const mobile = innerWidth <= 640;
    const immersive = studioExperience === 'immersive';
    const horizontal = immersive || mobile;
    const panel = studioById('selector-tray-panel').getBoundingClientRect();
    handle.setAttribute('aria-orientation', horizontal ? 'horizontal' : 'vertical');
    handle.setAttribute('aria-valuemin', immersive ? 156 : mobile ? 100 : 190);
    handle.setAttribute('aria-valuemax', Math.floor(immersive ? Math.max(156,innerHeight*.42) : mobile ? Math.max(100,Math.min(260,innerHeight*.3)) : Math.max(190,Math.min(420,innerWidth*.4))));
    handle.setAttribute('aria-valuenow', Math.round(horizontal ? panel.height : panel.width));
}
function setStudioPanel(kind, open) {
    if (kind !== 'sounds' && kind !== 'beats') return;
    if (studioExperience === 'immersive' && open) {
        const other = kind === 'sounds' ? 'beats' : 'sounds';
        studioPanels.immersive[other] = false;
        paintStudioPanel(other, false);
    }
    studioPanels[studioExperience][kind] = !!open;
    paintStudioPanel(kind, !!open);
}
function setStudioExperience(mode, persist = true) {
    const next = mode === 'pro' ? 'pro' : 'immersive';
    if (playfulReady && studioExperience === 'pro' && next === 'immersive') proSongView = songState.view;
    studioExperience = next;
    document.body.classList.toggle('immersive-mode', next === 'immersive');
    document.body.dataset.experience = next;
    document.querySelectorAll('[data-experience-option]').forEach(button => button.setAttribute('aria-pressed', button.dataset.experienceOption === next));
    if (next === 'pro') {
        let width = innerWidth <= 640 ? 146 : 256;
        try { width = Number(localStorage.getItem(innerWidth <= 640 ? 'sonicstage-sounds-mobile' : 'sonicstage-sounds-desktop')) || width; } catch (_) {}
        setStudioLibrarySize(width);
    }
    paintStudioPanel('sounds', studioPanels[next].sounds);
    paintStudioPanel('beats', studioPanels[next].beats);
    setSongView(next === 'immersive' ? 'stage' : proSongView);
    renderTokenPalette();renderImmersiveBand();
    syncStudioResizeHandle();
    if (persist) try { localStorage.setItem('sonicstage-experience', next); } catch (_) {}
}
function renderImmersiveBand() {
    if (!playfulReady) return;
    const count = getActiveInstrumentCount();
    const heading = studioById('immersive-heading');
    heading.classList.toggle('is-empty', count === 0);
    studioById('immersive-title').textContent = count ? 'Meet your band.' : 'Who’s playing?';
    studioById('immersive-caption').textContent = count ? `${count} ${count === 1 ? 'player' : 'players'} · Tap a player to make it yours.` : 'Pick a sound. Give it some company.';
    studioById('immersive-add').hidden = count > 0;
}
function initPlayfulStudio() {
    if (playfulReady) return;
    const experience = document.createElement('div');
    experience.className = 'experience-switch'; experience.setAttribute('role','group'); experience.setAttribute('aria-label','Studio experience');
    experience.innerHTML = '<button type="button" data-experience-option="immersive" aria-pressed="true">✦ Immersive</button><button type="button" data-experience-option="pro" aria-pressed="false">Pro</button>';
    const projectBar = document.querySelector('.project-bar');
    projectBar.insertBefore(experience, projectBar.querySelector('.project-actions'));
    experience.querySelectorAll('button').forEach(button => button.addEventListener('click',()=>setStudioExperience(button.dataset.experienceOption)));
    for (const parent of [projectBar, document.querySelector('.start-header')]) {
        const button = document.createElement('button'); button.type='button'; button.className='theme-toggle';
        button.addEventListener('click',()=>setStudioTheme(studioTheme === 'light' ? 'dark' : 'light'));
        parent.append(button);
    }
    const switches = document.createElement('div'); switches.className='panel-switches';
    switches.innerHTML = '<button id="btn-sounds" type="button" aria-controls="selector-tray-panel" aria-expanded="true"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 8v4m5-8v12m5-10v8m4-5v2" stroke-linecap="round"/></svg>Sounds</button><button id="btn-beats" type="button" aria-controls="bottom-dock" aria-expanded="false"><svg viewBox="0 0 20 20" fill="currentColor"><rect x="2" y="3" width="4" height="4" rx="1"/><rect x="8" y="3" width="4" height="4" rx="1"/><rect x="14" y="3" width="4" height="4" rx="1"/><rect x="2" y="11" width="4" height="4" rx="1"/><rect x="8" y="11" width="4" height="4" rx="1"/><rect x="14" y="11" width="4" height="4" rx="1"/></svg>Beats</button>';
    document.querySelector('.control-bar').insertBefore(switches, document.querySelector('.workspace-switch'));
    studioById('btn-sounds').addEventListener('click',()=>setStudioPanel('sounds',appState.paletteCollapsed));
    studioById('btn-beats').addEventListener('click',()=>setStudioPanel('beats',!appState.timelineVisible));
    const heading = document.createElement('section');heading.id='immersive-heading';heading.setAttribute('aria-label','Your band');
    heading.innerHTML='<span class="band-eyebrow"><i></i><i></i><i></i> YOUR SOUND, TOGETHER</span><h1 id="immersive-title">Who’s playing?</h1><p id="immersive-caption">Pick a sound. Give it some company.</p><button id="immersive-add" class="accent-button">＋ Add a sound</button>';
    document.body.append(heading);
    studioById('immersive-add').addEventListener('click',()=>setStudioPanel('sounds',true));
    const originalRefresh = refreshAllUI;
    refreshAllUI = function(...args) { const result=originalRefresh.apply(this,args);renderImmersiveBand();return result; };
    studioById('project-title').addEventListener('input',renderImmersiveBand);
    document.querySelector('.start-version').textContent='Home';
    new ResizeObserver(()=>{
        document.documentElement.style.setProperty('--header-height',`${studioById('transport-header').getBoundingClientRect().height}px`);
    }).observe(studioById('transport-header'));
    playfulReady=true;
    setStudioTheme(studioTheme);
    setStudioExperience(studioExperience,false);
    heading.inert=true;
    document.addEventListener('keydown',event=>{
        if(event.key !== 'Escape' || document.querySelector('dialog[open]') || cinematicState.active || !studioStarted) return;
        if(studioExperience === 'immersive') {
            if(appState.timelineVisible)setStudioPanel('beats',false);
            else if(!appState.paletteCollapsed)setStudioPanel('sounds',false);
        }
    });
}
