/***********************************************************************
 * 11. INITIALIZATION & UI EVENT BINDINGS
 ***********************************************************************/
window.onload = function () {
    initSongComposer();
    initThreeStage();
    if (songState.restored) {
        reconcileStageCapacity(false);
        pedestalMeshes.forEach((_, i) => rebuildPedestalPerformer(i));
    }
    prepareHomeStage();
    syncStageToMeasure();
    refreshAllUI();
    animateLoop();

    // Category Filter Tabs
    document.querySelectorAll('.cat-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            appState.selectedCategory = tab.dataset.cat;
            document.querySelectorAll('.cat-tab').forEach(t => {
                t.classList.remove('bg-amber-400/20', 'border-amber-400/30', 'text-amber-200');
            });
            tab.classList.add('bg-amber-400/20', 'border-amber-400/30');
            renderTokenPalette();
        });
    });

    document.getElementById('btn-cinematic').addEventListener('click', startCinematic);
    document.getElementById('song-showcase').addEventListener('click', startCinematic);
    document.getElementById('cinema-exit').addEventListener('click', exitCinematic);
    document.getElementById('cinema-replay').addEventListener('click', startCinematic);
    document.getElementById('cinema-pause').addEventListener('click', toggleCinematicPause);
    document.addEventListener('keydown', event => {
        if (!cinematicState.active || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            exitCinematic();
        } else if (
            event.code === 'Space' &&
            !['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)
        ) {
            event.preventDefault();
            toggleCinematicPause();
        }
    });

    // Camera Preset Buttons
    document.querySelectorAll('.cam-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            updateCameraPresetTarget(btn.dataset.cam);
        });
    });

    // Play / Pause Toggle
    document.getElementById('btn-play-toggle').addEventListener('click', () => {
        if (!appState.isPlaying && audioEngine.songEndScheduled) {
            playSongFrom(0);
            return;
        }
        audioEngine.init();
        appState.isPlaying = !appState.isPlaying;
        updatePlayButtonUI();
    });

    // Non-Linear Tempo Slider & Direct Numeric BPM Input (1 BPM to 2400 BPM)
    const bpmSlider = document.getElementById('bpm-slider');
    const bpmNumberInput = document.getElementById('bpm-number-input');

    function applyNewBpm(newBpm, source) {
        const clamped = Math.max(1, Math.min(2400, Math.round(Number(newBpm) || 112)));
        const prevBpm = appState.bpm;
        appState.bpm = clamped;

        if (source !== 'number') {
            bpmNumberInput.value = clamped;
        }
        if (source !== 'slider') {
            bpmSlider.value = bpmToSlider(clamped);
        }

        // If jumping from a very slow BPM (e.g. 1 BPM where nextNoteTime is many seconds in the future)
        // to a faster BPM, resync nextNoteTime immediately so the user doesn't wait for the old beat!
        if (audioEngine.ctx && Math.abs(clamped - prevBpm) > 5) {
            const maxStepWait = (60 / clamped) * 0.25;
            if (audioEngine.nextNoteTime > audioEngine.ctx.currentTime + maxStepWait) {
                audioEngine.nextNoteTime = audioEngine.ctx.currentTime + 0.02;
            }
        }
        audioEngine.updateDelaySync();
        songChanged();
    }

    bpmSlider.value = bpmToSlider(appState.bpm);
    bpmSlider.addEventListener('input', e => {
        applyNewBpm(sliderToBpm(e.target.value), 'slider');
    });

    bpmNumberInput.addEventListener('input', e => {
        if (e.target.value === '') return;
        applyNewBpm(e.target.value, 'number');
    });
    bpmNumberInput.addEventListener('blur', e => {
        applyNewBpm(e.target.value || 112, 'both');
    });

    // Live Audio Recorder Button
    const btnRecord = document.getElementById('btn-record-toggle');
    const recordDot = document.getElementById('record-dot');
    const recordText = document.getElementById('record-status-text');
    btnRecord.addEventListener('click', () => {
        const active = audioEngine.toggleMasterRecording();
        if (active) {
            btnRecord.className =
                'flex items-center gap-1 px-2 py-1 rounded-lg font-mono font-bold text-[10px] sm:text-[11px] bg-rose-500/30 text-rose-200 border border-rose-400/50 transition-colors shrink-0';
            recordDot.className = 'w-2 h-2 rounded-full bg-rose-400 animate-ping';
            recordText.textContent = 'STOP & SAVE';
        } else {
            btnRecord.className =
                'flex items-center gap-1 px-2 py-1 rounded-lg font-mono font-bold text-[10px] sm:text-[11px] bg-white/5 hover:bg-rose-500/20 text-slate-300 hover:text-rose-200 border border-white/10 transition-colors shrink-0';
            recordDot.className = 'w-2 h-2 rounded-full bg-rose-500';
            recordText.textContent = 'REC';
        }
    });

    // Pro Studio FX & Mastering Drawer Toggle
    const proFxDrawer = document.getElementById('pro-fx-drawer');
    const btnProFx = document.getElementById('btn-pro-fx');
    const btnCloseFx = document.getElementById('btn-close-fx');

    function toggleProFxDrawer(forceState) {
        appState.proFxOpen = typeof forceState === 'boolean' ? forceState : !appState.proFxOpen;
        btnProFx.setAttribute('aria-expanded', appState.proFxOpen);
        proFxDrawer.inert = !appState.proFxOpen;
        if (appState.proFxOpen) {
            proFxDrawer.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-2');
            proFxDrawer.classList.add('opacity-100', 'pointer-events-auto', 'translate-y-0');
        } else {
            proFxDrawer.classList.add('opacity-0', 'pointer-events-none', 'translate-y-2');
            proFxDrawer.classList.remove('opacity-100', 'pointer-events-auto', 'translate-y-0');
        }
        if (masterScope.windowOpen) placeScopeWindow();
    }
    btnProFx.addEventListener('click', () => toggleProFxDrawer());
    btnCloseFx.addEventListener('click', () => toggleProFxDrawer(false));

    // Bind Pro FX Rack Sliders
    const bindFxSlider = (id, valId, formatter, onChange) => {
        const el = document.getElementById(id);
        const valEl = document.getElementById(valId);
        if (!el) return;
        el.addEventListener('input', e => {
            audioEngine.init();
            const v = Number(e.target.value);
            if (valEl) valEl.textContent = formatter(v);
            onChange(v);
        });
    };

    bindFxSlider(
        'fx-eq-low',
        'fx-eq-low-val',
        v => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`,
        v => {
            if (audioEngine.eqLowNode) audioEngine.eqLowNode.gain.setTargetAtTime(v, audioEngine.ctx.currentTime, 0.02);
        },
    );
    bindFxSlider(
        'fx-eq-mid',
        'fx-eq-mid-val',
        v => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`,
        v => {
            if (audioEngine.eqMidNode) audioEngine.eqMidNode.gain.setTargetAtTime(v, audioEngine.ctx.currentTime, 0.02);
        },
    );
    bindFxSlider(
        'fx-eq-high',
        'fx-eq-high-val',
        v => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`,
        v => {
            if (audioEngine.eqHighNode)
                audioEngine.eqHighNode.gain.setTargetAtTime(v, audioEngine.ctx.currentTime, 0.02);
        },
    );

    const filterMorphEl = document.getElementById('fx-filter-morph');
    const filterQEl = document.getElementById('fx-filter-q');
    const filterBadge = document.getElementById('fx-filter-mode-badge');
    const updateFilterFromUI = () => {
        audioEngine.init();
        const m = Number(filterMorphEl.value);
        const q = Number(filterQEl.value);
        document.getElementById('fx-filter-q-val').textContent = q.toFixed(1);
        const morphValEl = document.getElementById('fx-filter-morph-val');
        if (m < 48) {
            morphValEl.textContent = `LP ${Math.round((m / 48) * 100)}%`;
            filterBadge.textContent = 'LOWPASS';
        } else if (m > 52) {
            morphValEl.textContent = `HP ${Math.round(((m - 52) / 48) * 100)}%`;
            filterBadge.textContent = 'HIGHPASS';
        } else {
            morphValEl.textContent = 'OPEN';
            filterBadge.textContent = 'BYPASS';
        }
        audioEngine.setDJFilter(m, q);
    };
    filterMorphEl.addEventListener('input', updateFilterFromUI);
    filterQEl.addEventListener('input', updateFilterFromUI);

    bindFxSlider(
        'fx-drive',
        'fx-drive-val',
        v => `${v}%`,
        v => {
            if (audioEngine.driveNode) audioEngine.driveNode.curve = audioEngine.makeDistortionCurve(v);
        },
    );
    bindFxSlider(
        'fx-reverb-mix',
        'fx-reverb-mix-val',
        v => `${v}%`,
        v => {
            if (audioEngine.reverbSend)
                audioEngine.reverbSend.gain.setTargetAtTime((v / 100) * 0.9, audioEngine.ctx.currentTime, 0.02);
        },
    );
    bindFxSlider(
        'fx-delay-mix',
        'fx-delay-mix-val',
        v => `${v}%`,
        v => {
            audioEngine.updateDelaySync();
            if (audioEngine.delayWetGain)
                audioEngine.delayWetGain.gain.setTargetAtTime((v / 100) * 0.75, audioEngine.ctx.currentTime, 0.02);
        },
    );
    bindFxSlider(
        'fx-delay-fb',
        'fx-delay-fb-val',
        v => `${v}%`,
        v => {
            if (audioEngine.delayFeedback)
                audioEngine.delayFeedback.gain.setTargetAtTime(v / 100, audioEngine.ctx.currentTime, 0.02);
        },
    );
    bindFxSlider(
        'fx-global-swing',
        'fx-global-swing-val',
        v => `${v}%`,
        v => {
            appState.globalSwing = v / 100;
            songChanged();
        },
    );
    bindFxSlider(
        'fx-comp-thresh',
        'fx-comp-thresh-val',
        v => `${v}dB`,
        v => {
            if (audioEngine.compressor)
                audioEngine.compressor.threshold.setTargetAtTime(v, audioEngine.ctx.currentTime, 0.02);
        },
    );
    bindFxSlider(
        'fx-master-vol',
        'fx-master-vol-val',
        v => `${v}%`,
        v => {
            if (audioEngine.masterGain)
                audioEngine.masterGain.gain.setTargetAtTime(v / 100, audioEngine.ctx.currentTime, 0.02);
        },
    );

    document.getElementById('btn-reset-fx').addEventListener('click', () => {
        audioEngine.init();
        const defaults = [
            ['fx-eq-low', 0],
            ['fx-eq-mid', 0],
            ['fx-eq-high', 0],
            ['fx-filter-morph', 50],
            ['fx-filter-q', 1.2],
            ['fx-drive', 12],
            ['fx-reverb-mix', 26],
            ['fx-delay-mix', 0],
            ['fx-delay-fb', 42],
            ['fx-global-swing', 4],
            ['fx-comp-thresh', -16],
            ['fx-master-vol', 86],
        ];
        defaults.forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el) {
                el.value = val;
                el.dispatchEvent(new Event('input'));
            }
        });
        showStageToast('FX reset', '#74b7b0');
    });

    // Step Edit Mode Toggle Button (Toggle On/Off vs Cycle Note/Drum Variation)
    const btnStepEditMode = document.getElementById('btn-step-edit-mode');
    btnStepEditMode.addEventListener('click', () => {
        appState.stepEditMode = appState.stepEditMode === 'toggle' ? 'cycle' : 'toggle';
        if (appState.stepEditMode === 'cycle') {
            btnStepEditMode.textContent = 'Edit: Note';
            btnStepEditMode.className =
                'px-1.5 py-0.5 rounded text-[8px] sm:text-[9px] font-mono font-semibold bg-cyan-500/25 hover:bg-cyan-500/35 text-cyan-200 border border-cyan-400/40 transition-colors';
        } else {
            btnStepEditMode.textContent = 'Edit: Toggle';
            btnStepEditMode.className =
                'px-1.5 py-0.5 rounded text-[8px] sm:text-[9px] font-mono font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-400/30 transition-colors';
        }
    });

    // Beat Bar Size Preset Buttons (SM / MD / LG / XL)
    document.querySelectorAll('.beatbar-size-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setBeatBarSize(btn.dataset.size);
        });
    });

    document
        .getElementById('btn-toggle-palette')
        .addEventListener('click', () => setStudioPanel('sounds', appState.paletteCollapsed));

    // Harmonic Root Key & Scale/Mode Selectors
    const keySelect = document.getElementById('key-select');
    const scaleSelect = document.getElementById('scale-select');
    const subtitleKeyInfo = document.getElementById('subtitle-key-info');

    function updateHarmonicHeaderInfo() {
        const keyName = KEY_NAMES[appState.rootKey] || 'C';
        const scaleDef = SCALE_DEFINITIONS[appState.scaleMode] || SCALE_DEFINITIONS.dorian;
        if (subtitleKeyInfo) {
            subtitleKeyInfo.textContent = `${keyName} ${scaleDef.label}`;
        }
        showStageToast(`${keyName} ${scaleDef.label.toLowerCase()}`, '#06b6d4');
        songChanged();
    }

    keySelect.addEventListener('change', e => {
        audioEngine.init();
        appState.rootKey = parseInt(e.target.value, 10) || 0;
        updateHarmonicHeaderInfo();
    });

    scaleSelect.addEventListener('change', e => {
        audioEngine.init();
        appState.scaleMode = e.target.value;
        updateHarmonicHeaderInfo();
    });

    document
        .getElementById('btn-toggle-timeline')
        .addEventListener('click', () => setStudioPanel('beats', !appState.timelineVisible));

    // Auto-Mix Button (5-Stage Ensemble)
    document.getElementById('btn-automix').addEventListener('click', () => {
        triggerAutoMix(5);
    });

    // +EXPAND Button: Continuously steps through the concentric amphitheater tiers (12 -> 24 -> 40 -> 60 -> 80 -> 100)
    document.getElementById('btn-mega12').addEventListener('click', () => {
        const currentCount = getActiveInstrumentCount();
        const nextTargets = [9, 18, 32, 50, 72, 100];
        const nextCount = nextTargets.find(n => n > currentCount) || 12;
        triggerAutoMix(nextCount);
    });

    // 100-STAGE Grand Symphony Button: Spawns all 100 Performers across all 7 concentric rings
    const btnMega100 = document.getElementById('btn-mega100');
    if (btnMega100) {
        btnMega100.addEventListener('click', () => {
            triggerAutoMix(100);
        });
    }

    // Clear Button (Clears all slots and automatically compacts back to 6 stages)
    document.getElementById('btn-clear').addEventListener('click', () => {
        clearAllSlots();
    });

    initStudio();
};
