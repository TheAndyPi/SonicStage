/***********************************************************************
 * 3. WEB AUDIO SYNTHESIS ENGINE + PER-SLOT CHANNEL MIXER + 90 SOUNDS
 ***********************************************************************/
class StudioAudioEngine {
    constructor() {
        this.ctx = null;
        this.mixBus = null;
        this.mixHeadroom = 1;
        this.masterGain = null;
        this.masterEffectRack = null;
        this.compressor = null;
        this.limiter = null;
        this.analyser = null;
        this.scopeAnalysers = null;
        this.reverbNode = null;
        this.reverbSend = null;
        this.delayNodeL = null;
        this.delayNodeR = null;
        this.delayFeedback = null;
        this.delayWetGain = null;
        this.driveNode = null;
        this.djFilterNode = null;
        this.eqLowNode = null;
        this.eqMidNode = null;
        this.eqHighNode = null;
        this.mediaDest = null;
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.isRecording = false;
        this.noiseBuffer = null;
        this.slotEffectRacks = [];
        this.slotGains = [];
        this.slotPanners = [];
        this.activeBus = null;
        this.activePitchShift = 0;
        this.nextNoteTime = 0;
        this.current16thStep = 0;
        this.timerID = null;
        this.stepQueue = [];
        this.fftData = new Uint8Array(64);
        this.timeDomainData = new Uint8Array(128);
    }

    init() {
        if (this.ctx) {
            if (this.ctx.state === 'suspended') this.ctx.resume();
            return;
        }
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioCtx();

        // 0. Instrument Mix Bus. Every player sums here; its gain backs off as
        // more players join so the master chain sees a similar level at 6 or 100.
        this.mixBus = this.ctx.createGain();
        this.mixBus.gain.setValueAtTime(1, this.ctx.currentTime);
        this.mixHeadroom = 1;

        // 1. Master Dynamics Compressor
        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.setValueAtTime(-16, this.ctx.currentTime);
        this.compressor.knee.setValueAtTime(10, this.ctx.currentTime);
        this.compressor.ratio.setValueAtTime(3.0, this.ctx.currentTime);
        this.compressor.attack.setValueAtTime(0.008, this.ctx.currentTime);
        this.compressor.release.setValueAtTime(0.18, this.ctx.currentTime);

        // 2. Analog Tape Saturation Drive (WaveShaper). A WaveShaper flattens
        // anything outside ±1, so it is fed at half level and its curve spans ±2.
        const driveInput = this.ctx.createGain();
        driveInput.gain.setValueAtTime(0.5, this.ctx.currentTime);
        this.driveNode = this.ctx.createWaveShaper();
        this.driveNode.curve = this.makeDistortionCurve(12);
        this.driveNode.oversample = '2x';
        driveInput.connect(this.driveNode);

        // 3. 3-Band Mastering EQ (Low Shelf 100Hz, Mid Peak 1100Hz, High Shelf 6500Hz)
        this.eqLowNode = this.ctx.createBiquadFilter();
        this.eqLowNode.type = 'lowshelf';
        this.eqLowNode.frequency.setValueAtTime(100, this.ctx.currentTime);
        this.eqLowNode.gain.setValueAtTime(0, this.ctx.currentTime);

        this.eqMidNode = this.ctx.createBiquadFilter();
        this.eqMidNode.type = 'peaking';
        this.eqMidNode.frequency.setValueAtTime(1100, this.ctx.currentTime);
        this.eqMidNode.Q.setValueAtTime(1.0, this.ctx.currentTime);
        this.eqMidNode.gain.setValueAtTime(0, this.ctx.currentTime);

        this.eqHighNode = this.ctx.createBiquadFilter();
        this.eqHighNode.type = 'highshelf';
        this.eqHighNode.frequency.setValueAtTime(6500, this.ctx.currentTime);
        this.eqHighNode.gain.setValueAtTime(0, this.ctx.currentTime);

        // 4. DJ Master Morph Filter (Lowpass <-> Bypass <-> Highpass)
        this.djFilterNode = this.ctx.createBiquadFilter();
        this.djFilterNode.type = 'lowpass';
        this.djFilterNode.frequency.setValueAtTime(20000, this.ctx.currentTime);
        this.djFilterNode.Q.setValueAtTime(1.2, this.ctx.currentTime);

        // 5. Master Output Gain, Brickwall Limiter, Safety Clipper & Analyser
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(0.86, this.ctx.currentTime);

        this.limiter = this.ctx.createDynamicsCompressor();
        this.limiter.threshold.setValueAtTime(-3, this.ctx.currentTime);
        this.limiter.knee.setValueAtTime(0, this.ctx.currentTime);
        this.limiter.ratio.setValueAtTime(20, this.ctx.currentTime);
        this.limiter.attack.setValueAtTime(0.001, this.ctx.currentTime);
        this.limiter.release.setValueAtTime(0.12, this.ctx.currentTime);

        // Rounds off whatever the limiter's attack lets through instead of
        // letting the output hard-clip at full scale.
        const clipInput = this.ctx.createGain();
        clipInput.gain.setValueAtTime(0.5, this.ctx.currentTime);
        const safetyClipper = this.ctx.createWaveShaper();
        safetyClipper.curve = this.makeSaturationCurve(0.9);
        safetyClipper.oversample = '2x';
        clipInput.connect(safetyClipper);

        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 128;
        this.analyser.smoothingTimeConstant = 0.76;
        this.fftData = new Uint8Array(this.analyser.frequencyBinCount);
        this.timeDomainData = new Uint8Array(this.analyser.fftSize);

        // 6. Concert Hall Impulse Reverb
        this.reverbNode = this.ctx.createConvolver();
        this.reverbNode.buffer = this.createImpulseResponse(1.8, 2.7);
        this.reverbSend = this.ctx.createGain();
        this.reverbSend.gain.setValueAtTime(0.26, this.ctx.currentTime);

        // 7. BPM-Synced Stereo Ping-Pong Delay
        this.delayNodeL = this.ctx.createDelay(2.0);
        this.delayNodeR = this.ctx.createDelay(2.0);
        const dotted8th = (60 / Math.max(40, Math.min(240, appState.bpm))) * 0.75;
        this.delayNodeL.delayTime.setValueAtTime(dotted8th, this.ctx.currentTime);
        this.delayNodeR.delayTime.setValueAtTime(dotted8th * 0.666, this.ctx.currentTime);

        this.delayFeedback = this.ctx.createGain();
        this.delayFeedback.gain.setValueAtTime(0.42, this.ctx.currentTime);
        const delayFilter = this.ctx.createBiquadFilter();
        delayFilter.type = 'bandpass';
        delayFilter.frequency.setValueAtTime(1600, this.ctx.currentTime);
        delayFilter.Q.setValueAtTime(0.9, this.ctx.currentTime);

        this.delayWetGain = this.ctx.createGain();
        this.delayWetGain.gain.setValueAtTime(0.0, this.ctx.currentTime);

        this.delayNodeL.connect(delayFilter);
        delayFilter.connect(this.delayNodeR);
        this.delayNodeR.connect(this.delayFeedback);
        this.delayFeedback.connect(this.delayNodeL);
        this.delayNodeL.connect(this.delayWetGain);
        this.delayNodeR.connect(this.delayWetGain);
        this.delayWetGain.connect(this.compressor);

        // 8. Per-Slot Channel Strips (Volume Gain + Stereo Panner)
        // Shared FX sends from the mix bus avoid 200 redundant idle GainNodes at 100 stages
        this.slotGains = [];
        this.slotPanners = [];
        for (let idx = 0; idx < MAX_SLOTS; idx++) {
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(appState.slots[idx].volume, this.ctx.currentTime);

            const panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : this.ctx.createGain();
            if (panner.pan) {
                panner.pan.setValueAtTime(appState.slots[idx].pan || 0, this.ctx.currentTime);
            }

            g.connect(panner);
            panner.connect(this.mixBus);

            this.slotGains.push(g);
            this.slotPanners.push(panner);
        }

        // Single shared Reverb & Delay send from the mix bus. Sends must tap the
        // bus before the compressor: the returns feed the compressor, and
        // tapping after it would loop each effect back into its own input.
        const sharedRevSend = this.ctx.createGain();
        sharedRevSend.gain.setValueAtTime(0.28, this.ctx.currentTime);
        this.mixBus.connect(sharedRevSend);
        sharedRevSend.connect(this.reverbSend);

        const sharedDelSend = this.ctx.createGain();
        sharedDelSend.gain.setValueAtTime(0.32, this.ctx.currentTime);
        this.mixBus.connect(sharedDelSend);
        sharedDelSend.connect(this.delayNodeL);

        this.activeBus = this.mixBus;

        // Connect Master Chain: Mix Bus -> Compressor -> Drive -> 3-Band EQ -> DJ Filter -> Master Inserts -> MasterGain
        // -> Limiter -> Safety Clipper -> Analyser -> Destination
        this.reverbSend.connect(this.reverbNode);
        this.reverbNode.connect(this.compressor);

        this.mixBus.connect(this.compressor);
        this.compressor.connect(driveInput);
        this.driveNode.connect(this.eqLowNode);
        this.eqLowNode.connect(this.eqMidNode);
        this.eqMidNode.connect(this.eqHighNode);
        this.eqHighNode.connect(this.djFilterNode);
        this.djFilterNode.connect(this.masterGain);
        this.masterGain.connect(this.limiter);
        this.limiter.connect(clipInput);
        safetyClipper.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);

        // Hi-res stereo tap for the pro output scope; the stage keeps the coarse analyser above.
        const scopeSplitter = this.ctx.createChannelSplitter(2);
        safetyClipper.connect(scopeSplitter);
        this.scopeAnalysers = [0, 1].map(channel => {
            const node = this.ctx.createAnalyser();
            node.fftSize = 2048;
            node.smoothingTimeConstant = 0.72;
            node.minDecibels = -96;
            node.maxDecibels = -6;
            scopeSplitter.connect(node, channel);
            return node;
        });

        // Live Audio Recording Destination
        if (this.ctx.createMediaStreamDestination) {
            this.mediaDest = this.ctx.createMediaStreamDestination();
            safetyClipper.connect(this.mediaDest);
        }

        this.setMasterEffects(appState.masterEffects);
        this.noiseBuffer = this.createNoiseBuffer();
        this.nextNoteTime = this.ctx.currentTime + 0.05;
        this.startScheduler();
    }

    // Curves are read at half level, so index -1..1 stands for a signal of -2..2.
    // Below the knee the curve is a straight line at unity gain; above it the
    // signal bends smoothly toward ±1 instead of flattening.
    makeSaturationCurve(knee) {
        const nSamples = 4096;
        const curve = new Float32Array(nSamples);
        for (let i = 0; i < nSamples; ++i) {
            const x = ((i * 2) / (nSamples - 1) - 1) * 2;
            const level = Math.abs(x);
            const shaped = level <= knee ? level : knee + (1 - knee) * Math.tanh((level - knee) / (1 - knee));
            curve[i] = Math.sign(x) * shaped;
        }
        return curve;
    }

    makeDistortionCurve(amount = 12) {
        const drive = Math.max(0, Math.min(100, Number(amount) || 0)) / 100;
        return this.makeSaturationCurve(0.9 - drive * 0.7);
    }

    // Spread the summed level of every audible player so a full stage
    // lands near the same loudness as a six-piece band.
    setEnsembleHeadroom(audiblePlayers, time) {
        const headroom = 1 / Math.sqrt(Math.max(1, audiblePlayers / 6));
        if (!this.mixBus || Math.abs(headroom - this.mixHeadroom) < 0.005) return;
        this.mixHeadroom = headroom;
        this.mixBus.gain.setTargetAtTime(headroom, time, 0.06);
    }

    // Rebuild only when the ordered active inserts change. Amount edits reuse nodes.
    setSlotEffects(slotIndex, effects, time = this.ctx?.currentTime || 0, audible = true) {
        if (!this.ctx || !this.slotGains[slotIndex]) return;
        this.slotEffectRacks[slotIndex] = this.routeEffectRack(
            this.slotGains[slotIndex],
            this.slotPanners[slotIndex],
            this.slotEffectRacks[slotIndex],
            effects,
            time,
            audible,
        );
    }

    // All dry players and shared effect returns pass through these inserts before output protection.
    setMasterEffects(effects, time = this.ctx?.currentTime || 0) {
        if (!this.ctx || !this.djFilterNode || !this.masterGain) return;
        this.masterEffectRack = this.routeEffectRack(
            this.djFilterNode,
            this.masterGain,
            this.masterEffectRack,
            effects,
            time,
        );
    }

    routeEffectRack(input, output, previous, effects, time, audible = true) {
        const active = normalizePerformerEffects(effects).filter(effect => effect.enabled);
        const key = active.map(effect => effect.id).join('|');
        if (!previous && !active.length) return null;
        if (previous?.key === key) {
            previous.rack.update(active, time);
            previous.rack.output.gain.setTargetAtTime(audible ? 1 : 0, time, 0.012);
            return previous;
        }
        const rack = new PerformerEffectRack(this, active, time);
        rack.output.gain.value = 0;
        if (!previous) {
            const dryRack = new PerformerEffectRack(this, [], time);
            input.connect(dryRack.input);
            dryRack.output.connect(output);
            input.disconnect(output);
            previous = { key: '', rack: dryRack };
        }
        input.connect(rack.input);
        rack.output.connect(output);
        rack.output.gain.setTargetAtTime(audible ? 1 : 0, time, 0.012);
        previous.rack.output.gain.setTargetAtTime(0, time, 0.012);
        setTimeout(
            () => this.retirePerformerRack(input, previous.rack, time + 0.1),
            Math.max(0, time - this.ctx.currentTime) * 1000 + 120,
        );
        return { key, rack };
    }

    retirePerformerRack(input, rack, afterTime) {
        // Audio time can stop during a suspended cinematic, while wall time keeps going.
        if (this.ctx.state !== 'closed' && (this.ctx.state === 'suspended' || this.ctx.currentTime < afterTime)) {
            setTimeout(() => this.retirePerformerRack(input, rack, afterTime), 120);
            return;
        }
        input.disconnect(rack.input);
        rack.dispose();
    }

    syncPerformerEffects() {
        if (!this.ctx || appState.isPlaying) return;
        const slots = appState.slots;
        slots.forEach(slot => {
            if (slot.effects?.length || this.slotEffectRacks[slot.index])
                this.setSlotEffects(
                    slot.index,
                    slot.preset ? slot.effects : [],
                    this.ctx.currentTime,
                    isSlotAudible(slot, slots),
                );
        });
    }

    setSlotGain(slotIndex, volumeValue) {
        if (appState.isPlaying && songState.playMeasure?.slots !== appState.slots) return;
        if (this.ctx && this.slotGains[slotIndex]) {
            this.slotGains[slotIndex].gain.setTargetAtTime(
                Math.max(0, Math.min(1.2, volumeValue)),
                this.ctx.currentTime,
                0.015,
            );
        }
    }

    setSlotPan(slotIndex, panValue) {
        if (appState.isPlaying && songState.playMeasure?.slots !== appState.slots) return;
        if (this.ctx && this.slotPanners[slotIndex] && this.slotPanners[slotIndex].pan) {
            this.slotPanners[slotIndex].pan.setTargetAtTime(
                Math.max(-1, Math.min(1, Number(panValue) || 0)),
                this.ctx.currentTime,
                0.015,
            );
        }
    }

    updateDelaySync() {
        this.setMasterEffects(appState.masterEffects);
        if (!this.ctx || !this.delayNodeL || !this.delayNodeR) return;
        const clampedBpm = Math.max(40, Math.min(240, appState.bpm));
        const dotted8th = (60 / clampedBpm) * 0.75;
        this.delayNodeL.delayTime.setTargetAtTime(dotted8th, this.ctx.currentTime, 0.03);
        this.delayNodeR.delayTime.setTargetAtTime(dotted8th * 0.666, this.ctx.currentTime, 0.03);
        this.syncPerformerEffects();
    }

    setDJFilter(morphVal, qVal) {
        if (!this.ctx || !this.djFilterNode) return;
        const m = Number(morphVal);
        const q = Number(qVal) || 1.2;
        this.djFilterNode.Q.setTargetAtTime(q, this.ctx.currentTime, 0.02);

        if (m < 48) {
            // Lowpass sweep from 80Hz to 18000Hz
            this.djFilterNode.type = 'lowpass';
            const norm = m / 48;
            const cutoff = 80 * Math.pow(18000 / 80, norm);
            this.djFilterNode.frequency.setTargetAtTime(cutoff, this.ctx.currentTime, 0.02);
        } else if (m > 52) {
            // Highpass sweep from 35Hz to 6500Hz
            this.djFilterNode.type = 'highpass';
            const norm = (m - 52) / 48;
            const cutoff = 35 * Math.pow(6500 / 35, norm);
            this.djFilterNode.frequency.setTargetAtTime(cutoff, this.ctx.currentTime, 0.02);
        } else {
            // Center Bypass
            this.djFilterNode.type = 'lowpass';
            this.djFilterNode.frequency.setTargetAtTime(20000, this.ctx.currentTime, 0.02);
        }
    }

    toggleMasterRecording() {
        this.init();
        if (!this.mediaDest || typeof MediaRecorder === 'undefined') {
            showStageToast('This browser does not support recording', '#f43f5e');
            return false;
        }
        if (!this.isRecording) {
            this.recordedChunks = [];
            this.mediaRecorder = new MediaRecorder(this.mediaDest.stream);
            this.mediaRecorder.ondataavailable = e => {
                if (e.data && e.data.size > 0) this.recordedChunks.push(e.data);
            };
            this.mediaRecorder.onstop = () => {
                const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = `sonicstage-session-${appState.bpm}bpm.webm`;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    URL.revokeObjectURL(url);
                    a.remove();
                }, 1500);
                showStageToast('Audio saved', '#10b981');
            };
            this.mediaRecorder.start();
            this.isRecording = true;
            showStageToast('Recording audio…', '#f43f5e');
            return true;
        } else {
            this.mediaRecorder.stop();
            this.isRecording = false;
            return false;
        }
    }

    getTargetBus() {
        return this.activeBus || this.mixBus;
    }

    createNoiseBuffer() {
        const bufferSize = this.ctx.sampleRate * 2.0;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        return buffer;
    }

    createImpulseResponse(duration, decay) {
        const length = this.ctx.sampleRate * duration;
        const impulse = this.ctx.createBuffer(2, length, this.ctx.sampleRate);
        const left = impulse.getChannelData(0);
        const right = impulse.getChannelData(1);
        for (let i = 0; i < length; i++) {
            const env = Math.pow(1 - i / length, decay);
            left[i] = (Math.random() * 2 - 1) * env;
            right[i] = (Math.random() * 2 - 1) * env;
        }
        return impulse;
    }

    startScheduler() {
        const lookaheadMs = 16.0;
        const scheduleAheadSec = 0.09;
        const tick = () => {
            if (this.ctx && appState.isPlaying) {
                // Guard against extreme computational overload at 1000+ BPM by capping events per tick
                let safetySteps = 0;
                while (
                    !this.songEndScheduled &&
                    this.nextNoteTime < this.ctx.currentTime + scheduleAheadSec &&
                    safetySteps < 24
                ) {
                    this.scheduleStep(this.current16thStep, this.nextNoteTime);
                    this.advanceStep();
                    safetySteps++;
                }
                if (safetySteps >= 24 && this.nextNoteTime < this.ctx.currentTime) {
                    this.nextNoteTime = this.ctx.currentTime + 0.005;
                }
            } else if (this.ctx && !(cinematicState.active && cinematicState.paused)) {
                this.nextNoteTime = this.ctx.currentTime + 0.05;
            }
            this.timerID = setTimeout(tick, lookaheadMs);
        };
        tick();
    }

    advanceStep() {
        const safeBpm = Math.max(1, Math.min(2400, appState.bpm));
        const secondsPerBeat = 60.0 / safeBpm;
        const secondsPer16th = 0.25 * secondsPerBeat;
        // Apply global groove swing from Pro FX rack when BPM <= 260
        const swingRatio = safeBpm > 260 ? 0 : appState.globalSwing;
        this.nextNoteTime +=
            secondsPer16th +
            (this.current16thStep % 2 === 0 ? secondsPer16th * swingRatio : -secondsPer16th * swingRatio);
        this.current16thStep = this.current16thStep + 1 >= getStepsPerBar() ? 0 : this.current16thStep + 1;
        if (this.current16thStep === 0 && songState.audition) {
            songState.playMeasure = songState.measures[songState.selected] || songState.playMeasure;
        } else if (this.current16thStep === 0) {
            const next = songState.measures.indexOf(songState.playMeasure) + 1;
            if (next < songState.measures.length) songState.playMeasure = songState.measures[next];
            else if (songState.loop && !cinematicState.active) songState.playMeasure = songState.measures[0];
            else {
                this.songEndScheduled = true;
                this.stepQueue.push({ end: true, time: this.nextNoteTime });
            }
        }
    }

    applyPitchShiftToStepEvent(stepEvent, pitchShift) {
        if (!pitchShift || stepEvent === null || stepEvent === undefined) return stepEvent;
        if (typeof stepEvent === 'number') return stepEvent + pitchShift;
        if (Array.isArray(stepEvent)) return stepEvent.map(n => (typeof n === 'number' ? n + pitchShift : n));
        if (typeof stepEvent === 'object') {
            const copy = { ...stepEvent };
            if (typeof copy.n === 'number') copy.n += pitchShift;
            if (typeof copy.slide === 'number') copy.slide += pitchShift;
            if (Array.isArray(copy.notes)) copy.notes = copy.notes.map(n => n + pitchShift);
            return copy;
        }
        return stepEvent;
    }

    scheduleStep(stepIndex, time) {
        const measure = songState.playMeasure || songState.measures[0];
        const playbackSlots = measure.slots;
        const triggeredSlots = [];
        const safeBpm = Math.max(1, Math.min(2400, appState.bpm));
        const secondsPer16th = (60.0 / safeBpm) * 0.25;
        const isOffbeat16th = stepIndex % 2 === 1;

        // Collect all audible slots triggering on this step
        const pendingAudioTriggers = [];
        let totalAudibleSlots = 0;

        for (let i = 0; i < MAX_SLOTS; i++) {
            const slot = playbackSlots[i];
            if (!isSlotAudible(slot, playbackSlots)) continue;
            totalAudibleSlots++;
            const stepsArr = getSlotSteps(slot);
            const heightsArr = getSlotHeights(slot);
            const rawStepEvent = stepsArr[stepIndex];
            if (rawStepEvent !== null && rawStepEvent !== undefined) {
                let noteTime = time;
                if (isOffbeat16th && slot.preset.swingAmount && safeBpm <= 260) {
                    noteTime += secondsPer16th * slot.preset.swingAmount;
                }
                const shiftedEvent = this.applyPitchShiftToStepEvent(rawStepEvent, slot.pitchShift || 0);
                pendingAudioTriggers.push({
                    slot,
                    shiftedEvent,
                    noteTime,
                    velocity: this.stepVelocity(heightsArr[stepIndex]),
                });
                triggeredSlots.push({
                    slotIndex: slot.index,
                    intensity: (heightsArr[stepIndex] || 0.85) * (0.35 + slot.volume * 0.65),
                    vowel: rawStepEvent.v || 'A',
                    rawEvent: rawStepEvent,
                });
            }
        }

        // Dynamic ensemble headroom & voice-budgeting so up to 100 simultaneous players never clip or lag Web Audio
        const MAX_VOICES_PER_STEP = 18;
        let selectedTriggers = pendingAudioTriggers;
        if (pendingAudioTriggers.length > MAX_VOICES_PER_STEP) {
            // Prioritize unique synthTypes first, then rotating round-robin slice across the 100 players
            const seenSynths = new Set();
            const uniqueFirst = [];
            const extras = [];
            const rotOffset = (stepIndex * 7) % pendingAudioTriggers.length;
            for (let k = 0; k < pendingAudioTriggers.length; k++) {
                const item = pendingAudioTriggers[(k + rotOffset) % pendingAudioTriggers.length];
                if (!seenSynths.has(item.slot.preset.synthType)) {
                    seenSynths.add(item.slot.preset.synthType);
                    uniqueFirst.push(item);
                } else {
                    extras.push(item);
                }
            }
            selectedTriggers = uniqueFirst.concat(extras).slice(0, MAX_VOICES_PER_STEP);
        }

        measure.slots.forEach(slot => {
            if (slot.effects?.length || this.slotEffectRacks[slot.index])
                this.setSlotEffects(
                    slot.index,
                    slot.preset ? slot.effects : [],
                    time,
                    isSlotAudible(slot, measure.slots),
                );
        });
        this.setEnsembleHeadroom(totalAudibleSlots, time);

        selectedTriggers.forEach(({ slot, shiftedEvent, noteTime, velocity }) => {
            // Bars can set different levels for the same player. Glide rather
            // than jump so a note still ringing from the last bar doesn't click.
            if (this.slotGains[slot.index]) {
                this.slotGains[slot.index].gain.setTargetAtTime(slot.volume, time, 0.008);
            }
            if (this.slotPanners[slot.index]?.pan)
                this.slotPanners[slot.index].pan.setTargetAtTime(slot.pan || 0, time, 0.008);
            const channel = this.slotGains[slot.index] || this.mixBus;
            this.activeBus = velocity < 0.995 ? this.createVelocityBus(channel, velocity) : channel;
            this.triggerInstrument(slot.preset.synthType, shiftedEvent, noteTime, stepIndex);
        });
        this.activeBus = this.mixBus;

        this.stepQueue.push({ step: stepIndex, time: time, triggeredSlots, measure });
    }

    // Step heights double as velocity: accents play at full level and
    // ghost notes sit about 8 dB under them.
    stepVelocity(height) {
        const value = Number(height);
        return 0.25 + 0.75 * (value > 0 ? Math.min(1, value) : 0.85);
    }

    createVelocityBus(destination, velocity) {
        const bus = this.ctx.createGain();
        bus.gain.value = velocity;
        bus.connect(destination);
        return bus;
    }

    triggerPreview(preset, slotIndex = -1, customEvent = null) {
        if (!this.ctx) return;
        const slot = slotIndex >= 0 ? appState.slots[slotIndex] : null;
        if (slot && (!appState.isPlaying || songState.playMeasure?.slots === appState.slots))
            this.setSlotEffects(slotIndex, slot.effects);
        const stepsArr = slot ? getSlotSteps(slot) : preset.steps;
        const firstIdx = stepsArr.findIndex(s => s !== null);
        const evtToPlay = customEvent !== null ? customEvent : firstIdx >= 0 ? stepsArr[firstIdx] : null;
        if (evtToPlay !== null && evtToPlay !== undefined) {
            const pitchShift = slot ? slot.pitchShift || 0 : 0;
            this.activeBus = slotIndex >= 0 && this.slotGains[slotIndex] ? this.slotGains[slotIndex] : this.mixBus;
            this.triggerInstrument(
                preset.synthType,
                this.applyPitchShiftToStepEvent(evtToPlay, pitchShift),
                this.ctx.currentTime + 0.01,
                0,
            );
            this.activeBus = this.mixBus;
        }
    }

    triggerInstrument(synthType, val, time, stepIndex) {
        // Clamp minimum synthesis note duration so ultra-high BPMs (e.g. 1200+ BPM) don't cause zero-duration envelope clicks,
        // and cap maximum sustain at ultra-slow BPMs (e.g. 1–15 BPM) so notes decay naturally without overloading voices.
        const rawStepDur = (60 / Math.max(1, appState.bpm)) * 0.25;
        const stepDur = Math.max(0.022, Math.min(1.6, rawStepDur));
        switch (synthType) {
            case 'boombap':
                if (val === 'K') this.playKick(time, 145, 42, 0.28, 0.85);
                else if (val === 'S') this.playSnare(time, 0.22, 0.65);
                else if (val === 'H') this.playHiHat(time, 0.045, 8500, 0.22);
                break;
            case 'trap808':
                if (val === 'K') this.playKick(time, 165, 34, 0.45, 0.92);
                else if (val === 'S') this.playSnare(time, 0.18, 0.72);
                else if (val === 'H') this.playHiHat(time, 0.035, 9800, 0.22);
                else if (val === 'R') {
                    for (let r = 0; r < 3; r++) this.playHiHat(time + (r * stepDur) / 3, 0.025, 10500, 0.2);
                }
                break;
            case 'breakbeat':
                if (val === 'K') this.playKick(time, 160, 48, 0.22, 0.86);
                else if (val === 'S') this.playSnare(time, 0.16, 0.68);
                else if (val === 'H') this.playHiHat(time, 0.05, 8200, 0.25);
                break;
            case 'taiko':
                if (val === 'T') this.playTaiko(time, 95, 38, 0.36);
                else if (val === 'M') this.playTaiko(time, 148, 68, 0.22);
                else if (val === 'S') this.playShaker(time);
                break;
            case 'synthwave':
                if (val === 'K') this.playKick(time, 155, 44, 0.28, 0.88);
                else if (val === 'G') {
                    this.playSnare(time, 0.32, 0.75);
                    this.playClap(time);
                } else if (val === 'H') this.playHiHat(time, 0.045, 8800, 0.22);
                else if (val === 'T') this.playTaiko(time, 130, 52, 0.25);
                break;
            case 'funkyhats':
                if (val === 'C') this.playHiHat(time, 0.038, 9500, 0.22);
                else if (val === 'O') this.playHiHat(time, 0.18, 7800, 0.28);
                else if (val === 'R') this.playRimClick(time);
                break;
            case 'jazzswing':
                // Authentic "Spang-a-Lang" Jazz Ride Swing:
                // D = Downbeat Ride + Feathered Kick (Beats 1 & 3)
                // C = Ride Ping + Crisp Hi-Hat Foot Chick + Brush Snare (Beat 2)
                // B = Ride Bell + Hi-Hat Foot Chick + Brush Snare (Beat 4)
                // G = "&" 8th-note Ride Ping ("spang-")
                // S = Swung triplet skip Ride note ("-a-")
                // R = Warm Snare Ghost Rim/Brush Comping
                if (val === 'D') {
                    this.playJazzRide(time, 0.34, 0.26, false);
                    this.playKick(time, 108, 48, 0.22, 0.48);
                } else if (val === 'C') {
                    this.playJazzRide(time, 0.3, 0.24, false);
                    this.playHiHat(time, 0.032, 8800, 0.3);
                    this.playShaker(time);
                } else if (val === 'B') {
                    this.playJazzRide(time, 0.36, 0.28, true);
                    this.playHiHat(time, 0.032, 8800, 0.3);
                    this.playShaker(time);
                } else if (val === 'G') {
                    this.playJazzRide(time, 0.28, 0.22, false);
                } else if (val === 'S') {
                    this.playJazzRide(time, 0.19, 0.17, false);
                } else if (val === 'R') {
                    this.playRimClick(time);
                    this.playShaker(time);
                }
                break;
            case 'afroperc':
                if (val === 'L') this.playTaiko(time, 185, 115, 0.19);
                else if (val === 'H') this.playTaiko(time, 290, 210, 0.14);
                else if (val === 'O') this.playRimClick(time);
                else if (val === 'S') this.playShaker(time);
                break;
            case 'house909':
                if (val === 'K') this.playKick(time, 168, 46, 0.3, 0.9);
                else if (val === 'C') this.playHiHat(time, 0.035, 9200, 0.2);
                else if (val === 'O') this.playHiHat(time, 0.16, 7600, 0.28);
                else if (val === 'P') this.playClap(time);
                break;
            case 'ukgarage':
                if (val === 'K') this.playKick(time, 158, 45, 0.24, 0.86);
                else if (val === 'S') this.playSnare(time, 0.14, 0.65);
                else if (val === 'C') this.playHiHat(time, 0.03, 9800, 0.22);
                else if (val === 'O') this.playHiHat(time, 0.14, 8200, 0.26);
                else if (val === 'R') this.playRimClick(time);
                break;
            case 'bossa':
                if (val === 'K') this.playKick(time, 118, 46, 0.24, 0.72);
                else if (val === 'R') this.playRimClick(time);
                else if (val === 'S') this.playShaker(time);
                break;
            case 'industrial':
                if (val === 'K') this.playKick(time, 180, 38, 0.34, 0.94);
                else if (val === 'G') {
                    this.playClap(time);
                    this.playSnare(time, 0.26, 0.72);
                } else if (val === 'M') this.playCowbell(time, 520, 0.09);
                else if (val === 'H') this.playHiHat(time, 0.04, 8600, 0.24);
                break;
            case 'cowbellperc':
                if (val === 'B') this.playCowbell(time, 587, 0.14);
                else if (val === 'H') this.playCowbell(time, 880, 0.11);
                else if (val === 'L') this.playTaiko(time, 160, 75, 0.18);
                else if (val === 'S') this.playShaker(time);
                break;
            case 'slapbass':
                this.playSlapBass(time, midiToFreq(val), stepDur * 1.15);
                break;
            case 'acidbass':
                this.playAcidBass(time, midiToFreq(val), stepDur * 0.95, stepIndex % 3 === 0);
                break;
            case 'reesebass':
                this.playReeseBass(time, midiToFreq(val), stepDur * 2.8);
                break;
            case 'upright':
                this.playUprightBass(time, midiToFreq(val), stepDur * 1.9);
                break;
            case 'moogbass':
                this.playMoogBass(time, midiToFreq(val), stepDur * 0.95);
                break;
            case 'sub808':
                this.playSub808Glide(time, midiToFreq(val), stepDur * 2.4);
                break;
            case 'fmdonk':
                this.playFmDonkBass(time, midiToFreq(val), stepDur * 0.9);
                break;
            case 'wobblebass':
                this.playWobbleBass(time, midiToFreq(val), stepDur * 1.85);
                break;
            case 'fretless':
                this.playFretlessBass(time, midiToFreq(val), stepDur * 1.7);
                break;
            case 'tubabass':
                this.playTubaBass(time, midiToFreq(val), stepDur * 1.6);
                break;
            case 'rhodes':
                this.playRhodesChord(time, val.map(midiToFreq), stepDur * 2.8);
                break;
            case 'wurlitzer':
                this.playRhodesChord(time, val.map(midiToFreq), stepDur * 2.1);
                break;
            case 'clavinet':
                this.playCyberArp(time, val.map(midiToFreq), stepDur * 0.85);
                break;
            case 'grandpiano':
                this.playGrandPiano(time, val.map(midiToFreq), stepDur * 2.6);
                break;
            case 'b3organ':
                this.playB3Organ(time, val.map(midiToFreq), stepDur * 2.2);
                break;
            case 'dubchord':
                this.playDubChord(time, val.map(midiToFreq), stepDur * 2.4);
                break;
            case 'accordion':
                this.playAccordion(time, val.map(midiToFreq), stepDur * 1.5);
                break;
            case 'guitarstrum':
                this.playGuitarStrum(time, val.map(midiToFreq), stepDur * 1.6);
                break;
            case 'brass':
                this.playBrassChord(time, val.map(midiToFreq), stepDur * 1.8);
                break;
            case 'warmpad':
                this.playWarmPad(time, val.map(midiToFreq), stepDur * 7.8);
                break;
            case 'cyberarp':
                this.playCyberArp(time, val.map(midiToFreq), stepDur * 0.9);
                break;
            case 'sax':
                this.playSaxophone(time, midiToFreq(val), stepDur * 1.7);
                break;
            case 'marimba':
                this.playMarimba(time, midiToFreq(val), stepDur * 1.1);
                break;
            case 'kalimba':
                this.playCrystalBell(time, midiToFreq(val), stepDur * 1.4);
                break;
            case 'steeldrum':
                this.playSteelDrum(time, midiToFreq(val), stepDur * 1.3);
                break;
            case 'chiptune':
                this.playChiptuneLead(time, midiToFreq(val), stepDur * 0.9);
                break;
            case 'theremin':
                this.playTheremin(time, midiToFreq(val), stepDur * 2.5);
                break;
            case 'sitar':
                this.playSitarPluck(time, midiToFreq(val), stepDur * 1.45);
                break;
            case 'flute':
                this.playFlute(time, midiToFreq(val), stepDur * 1.8);
                break;
            case 'funkguitar':
                this.playFunkGuitar(time, midiToFreq(val), stepDur * 0.95);
                break;
            case 'crystalbell':
                this.playCrystalBell(time, midiToFreq(val), stepDur * 2.2);
                break;
            case 'cello':
                this.playCelloSolo(time, midiToFreq(val), stepDur * 3.2);
                break;
            case 'violin':
                this.playViolinSolo(time, midiToFreq(val), stepDur * 2.1);
                break;
            case 'spiccato':
                this.playSpiccatoString(time, midiToFreq(val), stepDur * 0.72);
                break;
            case 'frenchhorn':
                this.playBrassChord(time, val.map(midiToFreq), stepDur * 3.4);
                break;
            case 'pizzicato':
                this.playMarimba(time, midiToFreq(val), stepDur * 0.65);
                break;
            case 'brassstab':
                this.playBrassChord(time, val.map(midiToFreq), stepDur * 1.4);
                break;
            case 'harp':
                this.playCrystalBell(time, midiToFreq(val), stepDur * 2.6);
                break;

            // EXPRESSIVE DIPHTHONG VOCALS & BEATBOX
            case 'talkbox':
                this.playDiphthongVocal(time, [midiToFreq(val.n)], val, stepDur * 1.25, 'talkbox');
                break;
            case 'choir':
                this.playDiphthongVocal(time, val.notes.map(midiToFreq), val, stepDur * 6.8, 'choir');
                break;
            case 'gospel':
                this.playDiphthongVocal(
                    time,
                    [midiToFreq(val.n), midiToFreq(val.n + 12)],
                    val,
                    stepDur * 1.75,
                    'gospel',
                );
                break;
            case 'vocalchop':
                this.playDiphthongVocal(time, [midiToFreq(val.n)], val, stepDur * 0.92, 'chop');
                break;
            case 'soprano':
                this.playDiphthongVocal(time, [midiToFreq(val.n)], val, stepDur * 2.9, 'soprano');
                break;
            case 'monks':
                this.playDiphthongVocal(time, val.notes.map(midiToFreq), val, stepDur * 3.8, 'monks');
                break;
            case 'vocoder':
                this.playDiphthongVocal(time, val.notes.map(midiToFreq), val, stepDur * 1.6, 'vocoder');
                break;
            case 'beatbox':
                this.playBeatboxSyllable(time, val.b);
                break;
            case 'whistle':
                this.playHumanWhistle(time, midiToFreq(val), stepDur * 1.85);
                break;

            // 10 UNCONVENTIONAL INSTRUMENTS
            case 'junkyard':
                this.playJunkyardKit(time, val);
                break;
            case 'didgeridoo':
                this.playDidgeridoo(time, midiToFreq(val), stepDur * 1.9);
                break;
            case 'jawharp':
                this.playJawHarp(time, midiToFreq(val), stepDur * 1.1);
                break;
            case 'glassarmonica':
                this.playGlassArmonica(time, val.map(midiToFreq), stepDur * 3.8);
                break;
            case 'singingbowls':
                this.playSingingBowls(time, val.map(midiToFreq), stepDur * 5.2);
                break;
            case 'musicalsaw':
                this.playMusicalSaw(time, midiToFreq(val), stepDur * 2.6);
                break;
            case 'teslacoil':
                this.playTeslaCoil(time, midiToFreq(val), stepDur * 0.88);
                break;
            case 'hurdygurdy':
                this.playHurdyGurdy(time, midiToFreq(val), stepDur * 1.15);
                break;
            case 'waterphone':
                this.playWaterphone(time, midiToFreq(val), stepDur * 3.2);
                break;
            case 'tuvancyborg':
                this.playDiphthongVocal(time, val.notes.map(midiToFreq), val, stepDur * 2.1, 'monks');
                break;
        }
    }

    /**
     * Upgraded Expressive Diphthong Vocal Synthesizer:
     * - Morphs smoothly from Vowel 1 (v) -> Vowel 2 (v2) across F1, F2, F3 formant bandpass filters.
     * - Injects consonant transients ('s', 't', 'k', 'p', 'h') for realistic human articulation.
     * - Supports portamento pitch glides (val.slide) and stereo choir voice detuning.
     */
    playDiphthongVocal(time, freqs, val, dur, mode) {
        const v1 = VOWEL_FORMANTS[val.v || 'A'] || VOWEL_FORMANTS.A;
        const v2 = VOWEL_FORMANTS[val.v2 || val.v || 'O'] || v1;
        const bus = this.getTargetBus();

        const masterVocalGain = this.ctx.createGain();
        const attack = mode === 'choir' || mode === 'monks' ? 0.14 : mode === 'chop' ? 0.008 : 0.025;
        const peakGain = mode === 'choir' || mode === 'monks' ? 0.25 : mode === 'talkbox' ? 0.34 : 0.29;

        masterVocalGain.gain.setValueAtTime(0.001, time);
        masterVocalGain.gain.linearRampToValueAtTime(peakGain / Math.sqrt(freqs.length), time + attack);
        masterVocalGain.gain.setValueAtTime((peakGain * 0.85) / Math.sqrt(freqs.length), time + dur * 0.65);
        masterVocalGain.gain.exponentialRampToValueAtTime(0.001, time + dur);

        // Optional Consonant Burst ('s', 't', 'k', 'p', 'h') at note onset
        if (val.c) {
            const cNoise = this.ctx.createBufferSource();
            cNoise.buffer = this.noiseBuffer;
            const cFilter = this.ctx.createBiquadFilter();
            cFilter.type = val.c === 's' ? 'highpass' : 'bandpass';
            cFilter.frequency.setValueAtTime(val.c === 's' ? 5800 : val.c === 't' ? 4200 : 2200, time);
            cFilter.Q.setValueAtTime(2.5, time);
            const cGain = this.ctx.createGain();
            const cDur = val.c === 's' ? 0.055 : 0.028;
            cGain.gain.setValueAtTime(val.c === 'h' ? 0.08 : 0.16, time);
            cGain.gain.exponentialRampToValueAtTime(0.001, time + cDur);
            cNoise.connect(cFilter);
            cFilter.connect(cGain);
            cGain.connect(bus);
            cNoise.start(time);
            cNoise.stop(time + cDur + 0.01);
        }

        // 3 Parallel Diphthong-Morphing Formant Bandpass Filters
        const formantFilters = v1.f.map((startF, idx) => {
            const endF = v2.f[idx];
            const bp = this.ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.setValueAtTime(startF, time);
            bp.frequency.exponentialRampToValueAtTime(endF, time + dur * 0.78);
            bp.Q.setValueAtTime(mode === 'talkbox' || mode === 'vocoder' ? v1.q[idx] * 1.15 : v1.q[idx], time);

            const fGain = this.ctx.createGain();
            fGain.gain.setValueAtTime(idx === 0 ? 1.0 : idx === 1 ? 0.72 : 0.38, time);
            bp.connect(fGain);
            fGain.connect(masterVocalGain);
            return bp;
        });

        // Glottal Air / Breathiness Layer
        const breathSource = this.ctx.createBufferSource();
        breathSource.buffer = this.noiseBuffer;
        const breathGain = this.ctx.createGain();
        breathGain.gain.setValueAtTime(mode === 'soprano' || mode === 'choir' ? 0.045 : 0.02, time);
        breathGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        breathSource.connect(breathGain);
        formantFilters.forEach(bp => breathGain.connect(bp));
        breathSource.start(time);
        breathSource.stop(time + dur + 0.03);

        // Multi-oscillator Voiced Harmonics per Note
        const detuneOffsets = mode === 'choir' || mode === 'vocoder' || mode === 'monks' ? [-9, 0, 9] : [-4, 4];
        freqs.forEach(f => {
            const targetSlideFreq = val.slide ? midiToFreq(val.slide) : f;
            detuneOffsets.forEach(det => {
                const osc = this.ctx.createOscillator();
                osc.type = mode === 'monks' ? 'sawtooth' : det > 0 ? 'triangle' : 'sawtooth';
                osc.frequency.setValueAtTime(f * (mode === 'chop' ? 0.94 : 0.992), time);
                osc.frequency.exponentialRampToValueAtTime(f, time + 0.035);
                if (val.slide) {
                    osc.frequency.exponentialRampToValueAtTime(targetSlideFreq, time + dur * 0.85);
                }
                osc.detune.setValueAtTime(det, time);

                if (mode !== 'talkbox' && mode !== 'chop') {
                    const vib = this.ctx.createOscillator();
                    const vibGain = this.ctx.createGain();
                    vib.frequency.setValueAtTime(5.6, time);
                    vibGain.gain.setValueAtTime(mode === 'gospel' || mode === 'soprano' ? 5.2 : 3.2, time);
                    vib.connect(vibGain);
                    vibGain.connect(osc.frequency);
                    vib.start(time);
                    vib.stop(time + dur + 0.04);
                }

                formantFilters.forEach(bp => osc.connect(bp));
                osc.start(time);
                osc.stop(time + dur + 0.04);
            });
        });

        masterVocalGain.connect(bus);
    }

    playBeatboxSyllable(time, syllable) {
        if (syllable === 'B') {
            this.playKick(time, 150, 44, 0.24, 0.88);
        } else if (syllable === 'PF') {
            this.playSnare(time, 0.19, 0.72);
        } else if (syllable === 'K') {
            this.playRimClick(time);
        } else {
            this.playHiHat(time, 0.045, 9200, 0.26);
        }
    }

    playKick(time, startFreq, endFreq, dur, gainVal) {
        const bus = this.getTargetBus();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(startFreq, time);
        osc.frequency.exponentialRampToValueAtTime(endFreq, time + dur * 0.65);
        gain.gain.setValueAtTime(gainVal, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.connect(gain);
        gain.connect(bus);
        osc.start(time);
        osc.stop(time + dur + 0.02);
    }

    playSnare(time, dur, gainVal) {
        const bus = this.getTargetBus();
        const bodyOsc = this.ctx.createOscillator();
        const bodyGain = this.ctx.createGain();
        bodyOsc.type = 'triangle';
        bodyOsc.frequency.setValueAtTime(185, time);
        bodyOsc.frequency.exponentialRampToValueAtTime(92, time + 0.09);
        bodyGain.gain.setValueAtTime(gainVal * 0.55, time);
        bodyGain.gain.exponentialRampToValueAtTime(0.001, time + 0.11);
        bodyOsc.connect(bodyGain);
        bodyGain.connect(bus);
        bodyOsc.start(time);
        bodyOsc.stop(time + 0.12);

        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(1100, time);
        const nGain = this.ctx.createGain();
        nGain.gain.setValueAtTime(gainVal * 0.65, time);
        nGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        noise.connect(filter);
        filter.connect(nGain);
        nGain.connect(bus);
        noise.start(time);
        noise.stop(time + dur + 0.02);
    }

    playHiHat(time, dur, cutoff, gainVal) {
        const bus = this.getTargetBus();
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(cutoff, time);
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(gainVal, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(bus);
        noise.start(time);
        noise.stop(time + dur + 0.02);
    }

    playClap(time) {
        const bus = this.getTargetBus();
        [0, 0.011, 0.022].forEach((offset, idx) => {
            const noise = this.ctx.createBufferSource();
            noise.buffer = this.noiseBuffer;
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.setValueAtTime(1350, time + offset);
            filter.Q.setValueAtTime(1.8, time + offset);
            const gain = this.ctx.createGain();
            const tail = idx === 2 ? 0.18 : 0.035;
            gain.gain.setValueAtTime(0.32, time + offset);
            gain.gain.exponentialRampToValueAtTime(0.001, time + offset + tail);
            noise.connect(filter);
            filter.connect(gain);
            gain.connect(bus);
            noise.start(time + offset);
            noise.stop(time + offset + tail + 0.02);
        });
    }

    playRimClick(time) {
        const bus = this.getTargetBus();
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(1480, time);
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1650, time);
        filter.Q.setValueAtTime(4.0, time);
        gain.gain.setValueAtTime(0.28, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.035);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(bus);
        osc.start(time);
        osc.stop(time + 0.045);
    }

    playTaiko(time, startF, endF, dur) {
        const bus = this.getTargetBus();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(startF, time);
        osc.frequency.exponentialRampToValueAtTime(endF, time + dur * 0.8);
        gain.gain.setValueAtTime(0.65, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.connect(gain);
        gain.connect(bus);
        osc.start(time);
        osc.stop(time + dur + 0.02);
    }

    playShaker(time) {
        this.playHiHat(time, 0.055, 6800, 0.16);
    }

    playSlapBass(time, freq, dur) {
        const bus = this.getTargetBus();
        const osc = this.ctx.createOscillator();
        const sub = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, time);
        sub.type = 'sine';
        sub.frequency.setValueAtTime(freq, time);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2800, time);
        filter.frequency.exponentialRampToValueAtTime(260, time + 0.11);
        filter.Q.setValueAtTime(4.2, time);
        gain.gain.setValueAtTime(0.44, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.connect(filter);
        sub.connect(gain);
        filter.connect(gain);
        gain.connect(bus);
        osc.start(time);
        sub.start(time);
        osc.stop(time + dur + 0.02);
        sub.stop(time + dur + 0.02);
    }

    playReeseBass(time, freq, dur) {
        const bus = this.getTargetBus();
        [-10, 10].forEach(det => {
            const osc = this.ctx.createOscillator();
            const filter = this.ctx.createBiquadFilter();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(freq, time);
            osc.detune.setValueAtTime(det, time);
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(340, time);
            filter.Q.setValueAtTime(2.4, time);
            gain.gain.setValueAtTime(0.001, time);
            gain.gain.linearRampToValueAtTime(0.24, time + 0.04);
            gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
            osc.connect(filter);
            filter.connect(gain);
            gain.connect(bus);
            osc.start(time);
            osc.stop(time + dur + 0.03);
        });
    }

    playSub808Glide(time, freq, dur) {
        const bus = this.getTargetBus();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq * 1.45, time);
        osc.frequency.exponentialRampToValueAtTime(freq, time + 0.065);
        gain.gain.setValueAtTime(0.52, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.connect(gain);
        gain.connect(bus);
        osc.start(time);
        osc.stop(time + dur + 0.03);
    }

    playCelloSolo(time, freq, dur) {
        const bus = this.getTargetBus();
        [-5, 5].forEach(det => {
            const osc = this.ctx.createOscillator();
            const filter = this.ctx.createBiquadFilter();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(freq, time);
            osc.detune.setValueAtTime(det, time);
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(980, time);
            filter.Q.setValueAtTime(1.6, time);
            gain.gain.setValueAtTime(0.001, time);
            gain.gain.linearRampToValueAtTime(0.2, time + 0.06);
            gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
            osc.connect(filter);
            filter.connect(gain);
            gain.connect(bus);
            osc.start(time);
            osc.stop(time + dur + 0.03);
        });
    }

    playJazzRide(time, dur, level, isBell = false) {
        const bus = this.getTargetBus();
        // Metallic bronze shimmer wash
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(isBell ? 5400 : 6800, time);
        bp.Q.setValueAtTime(isBell ? 3.2 : 1.8, time);

        const washGain = this.ctx.createGain();
        washGain.gain.setValueAtTime(level * 0.75, time);
        washGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        noise.connect(bp);
        bp.connect(washGain);
        washGain.connect(bus);
        noise.start(time);
        noise.stop(time + dur + 0.02);

        // Wooden stick tip ping & harmonic bronze overtones
        const partials = isBell ? [920, 1480, 2760] : [820, 1340, 3120];
        partials.forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const pGain = this.ctx.createGain();
            osc.type = idx === 0 ? 'triangle' : 'sine';
            osc.frequency.setValueAtTime(freq, time);
            const pDur = isBell ? dur * 0.65 : dur * 0.35;
            pGain.gain.setValueAtTime((level * (isBell ? 0.22 : 0.13)) / (idx + 1), time);
            pGain.gain.exponentialRampToValueAtTime(0.001, time + pDur);
            osc.connect(pGain);
            pGain.connect(bus);
            osc.start(time);
            osc.stop(time + pDur + 0.02);
        });
    }

    playCowbell(time, freq, dur) {
        const bus = this.getTargetBus();
        [1, 1.48].forEach(ratio => {
            const osc = this.ctx.createOscillator();
            const filter = this.ctx.createBiquadFilter();
            const gain = this.ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(freq * ratio, time);
            filter.type = 'bandpass';
            filter.frequency.setValueAtTime(freq * 1.2, time);
            filter.Q.setValueAtTime(3.5, time);
            gain.gain.setValueAtTime(0.22, time);
            gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
            osc.connect(filter);
            filter.connect(gain);
            gain.connect(bus);
            osc.start(time);
            osc.stop(time + dur + 0.02);
        });
    }

    playFmDonkBass(time, freq, dur) {
        const bus = this.getTargetBus();
        const carrier = this.ctx.createOscillator();
        const mod = this.ctx.createOscillator();
        const modGain = this.ctx.createGain();
        const gain = this.ctx.createGain();
        carrier.type = 'sine';
        carrier.frequency.setValueAtTime(freq, time);
        mod.type = 'sine';
        mod.frequency.setValueAtTime(freq * 2.0, time);
        modGain.gain.setValueAtTime(freq * 4.5, time);
        modGain.gain.exponentialRampToValueAtTime(1, time + dur * 0.65);
        gain.gain.setValueAtTime(0.46, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        mod.connect(modGain);
        modGain.connect(carrier.frequency);
        carrier.connect(gain);
        gain.connect(bus);
        carrier.start(time);
        mod.start(time);
        carrier.stop(time + dur + 0.02);
        mod.stop(time + dur + 0.02);
    }

    playWobbleBass(time, freq, dur) {
        const bus = this.getTargetBus();
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, time);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(680, time);
        filter.Q.setValueAtTime(7.0, time);
        lfo.frequency.setValueAtTime((appState.bpm / 60) * 3, time);
        lfoGain.gain.setValueAtTime(520, time);
        lfo.connect(lfoGain);
        lfoGain.connect(filter.frequency);
        gain.gain.setValueAtTime(0.36, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(bus);
        osc.start(time);
        lfo.start(time);
        osc.stop(time + dur + 0.02);
        lfo.stop(time + dur + 0.02);
    }

    playFretlessBass(time, freq, dur) {
        const bus = this.getTargetBus();
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq * 0.96, time);
        osc.frequency.exponentialRampToValueAtTime(freq, time + 0.045);
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(420, time);
        filter.frequency.linearRampToValueAtTime(980, time + 0.09);
        filter.Q.setValueAtTime(3.2, time);
        gain.gain.setValueAtTime(0.001, time);
        gain.gain.linearRampToValueAtTime(0.42, time + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(bus);
        osc.start(time);
        osc.stop(time + dur + 0.02);
    }

    playTubaBass(time, freq, dur) {
        const bus = this.getTargetBus();
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq * 0.98, time);
        osc.frequency.exponentialRampToValueAtTime(freq, time + 0.04);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(220, time);
        filter.frequency.linearRampToValueAtTime(750, time + 0.06);
        filter.frequency.exponentialRampToValueAtTime(280, time + dur);
        filter.Q.setValueAtTime(3.0, time);
        gain.gain.setValueAtTime(0.001, time);
        gain.gain.linearRampToValueAtTime(0.42, time + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(bus);
        osc.start(time);
        osc.stop(time + dur + 0.02);
    }

    playGrandPiano(time, freqs, dur) {
        const bus = this.getTargetBus();
        freqs.forEach((f, idx) => {
            const osc1 = this.ctx.createOscillator();
            const osc2 = this.ctx.createOscillator();
            const filter = this.ctx.createBiquadFilter();
            const gain = this.ctx.createGain();
            osc1.type = 'triangle';
            osc2.type = 'sawtooth';
            osc1.frequency.setValueAtTime(f, time);
            osc2.frequency.setValueAtTime(f, time);
            osc2.detune.setValueAtTime(3.5, time);
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(3800, time);
            filter.frequency.exponentialRampToValueAtTime(620, time + dur * 0.8);
            gain.gain.setValueAtTime(0.001, time);
            gain.gain.linearRampToValueAtTime(0.14 / Math.sqrt(freqs.length), time + 0.006);
            gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
            osc1.connect(filter);
            osc2.connect(filter);
            filter.connect(gain);
            gain.connect(bus);
            osc1.start(time + idx * 0.004);
            osc2.start(time + idx * 0.004);
            osc1.stop(time + dur + 0.02);
            osc2.stop(time + dur + 0.02);
        });
    }

    playB3Organ(time, freqs, dur) {
        const bus = this.getTargetBus();
        const drawbars = [1, 2, 3];
        freqs.forEach(f => {
            drawbars.forEach((harm, hIdx) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(f * harm, time);
                const amp = (hIdx === 0 ? 0.09 : hIdx === 1 ? 0.055 : 0.035) / Math.sqrt(freqs.length);
                gain.gain.setValueAtTime(0.001, time);
                gain.gain.linearRampToValueAtTime(amp, time + 0.015);
                gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
                osc.connect(gain);
                gain.connect(bus);
                osc.start(time);
                osc.stop(time + dur + 0.02);
            });
        });
    }

    playDubChord(time, freqs, dur) {
        const bus = this.getTargetBus();
        // Dotted-16th dub echo repeats
        [0, 0.18, 0.36].forEach((delaySec, tapIdx) => {
            const tapTime = time + delaySec;
            const tapScale = Math.pow(0.55, tapIdx);
            freqs.forEach(f => {
                const osc = this.ctx.createOscillator();
                const filter = this.ctx.createBiquadFilter();
                const gain = this.ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(f, tapTime);
                filter.type = 'bandpass';
                filter.frequency.setValueAtTime(1400 - tapIdx * 280, tapTime);
                filter.Q.setValueAtTime(3.2, tapTime);
                gain.gain.setValueAtTime((0.12 * tapScale) / Math.sqrt(freqs.length), tapTime);
                gain.gain.exponentialRampToValueAtTime(0.001, tapTime + 0.14);
                osc.connect(filter);
                filter.connect(gain);
                gain.connect(bus);
                osc.start(tapTime);
                osc.stop(tapTime + 0.16);
            });
        });
    }

    playAccordion(time, freqs, dur) {
        const bus = this.getTargetBus();
        freqs.forEach(f => {
            [-12, 12].forEach(det => {
                const osc = this.ctx.createOscillator();
                const filter = this.ctx.createBiquadFilter();
                const gain = this.ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(f, time);
                osc.detune.setValueAtTime(det, time);
                filter.type = 'bandpass';
                filter.frequency.setValueAtTime(1450, time);
                filter.Q.setValueAtTime(2.0, time);
                gain.gain.setValueAtTime(0.001, time);
                gain.gain.linearRampToValueAtTime(0.085 / Math.sqrt(freqs.length), time + 0.025);
                gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
                osc.connect(filter);
                filter.connect(gain);
                gain.connect(bus);
                osc.start(time);
                osc.stop(time + dur + 0.02);
            });
        });
    }

    playSteelDrum(time, freq, dur) {
        const bus = this.getTargetBus();
        const carrier = this.ctx.createOscillator();
        const mod = this.ctx.createOscillator();
        const modGain = this.ctx.createGain();
        const gain = this.ctx.createGain();
        carrier.type = 'sine';
        carrier.frequency.setValueAtTime(freq * 0.985, time);
        carrier.frequency.exponentialRampToValueAtTime(freq, time + 0.022);
        mod.type = 'sine';
        mod.frequency.setValueAtTime(freq * 2.98, time);
        modGain.gain.setValueAtTime(freq * 1.4, time);
        modGain.gain.exponentialRampToValueAtTime(1, time + 0.09);
        gain.gain.setValueAtTime(0.28, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        mod.connect(modGain);
        modGain.connect(carrier.frequency);
        carrier.connect(gain);
        gain.connect(bus);
        carrier.start(time);
        mod.start(time);
        carrier.stop(time + dur + 0.02);
        mod.stop(time + dur + 0.02);
    }

    playChiptuneLead(time, freq, dur) {
        const bus = this.getTargetBus();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, time);
        osc.frequency.setValueAtTime(freq * 2, time + 0.018);
        osc.frequency.setValueAtTime(freq, time + 0.036);
        gain.gain.setValueAtTime(0.18, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.connect(gain);
        gain.connect(bus);
        osc.start(time);
        osc.stop(time + dur + 0.02);
    }

    playTheremin(time, freq, dur) {
        const bus = this.getTargetBus();
        const osc = this.ctx.createOscillator();
        const vib = this.ctx.createOscillator();
        const vibGain = this.ctx.createGain();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq * 0.94, time);
        osc.frequency.exponentialRampToValueAtTime(freq, time + 0.08);
        vib.frequency.setValueAtTime(6.4, time);
        vibGain.gain.setValueAtTime(7.5, time);
        vib.connect(vibGain);
        vibGain.connect(osc.frequency);
        gain.gain.setValueAtTime(0.001, time);
        gain.gain.linearRampToValueAtTime(0.24, time + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.connect(gain);
        gain.connect(bus);
        osc.start(time);
        vib.start(time);
        osc.stop(time + dur + 0.02);
        vib.stop(time + dur + 0.02);
    }

    playSitarPluck(time, freq, dur) {
        const bus = this.getTargetBus();
        const osc = this.ctx.createOscillator();
        const mod = this.ctx.createOscillator();
        const modGain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq * 0.97, time);
        osc.frequency.exponentialRampToValueAtTime(freq, time + 0.03);
        mod.type = 'sawtooth';
        mod.frequency.setValueAtTime(freq * 2.5, time);
        modGain.gain.setValueAtTime(freq * 1.8, time);
        modGain.gain.exponentialRampToValueAtTime(1, time + dur * 0.7);
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1850, time);
        filter.Q.setValueAtTime(2.6, time);
        gain.gain.setValueAtTime(0.26, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        mod.connect(modGain);
        modGain.connect(osc.frequency);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(bus);
        osc.start(time);
        mod.start(time);
        osc.stop(time + dur + 0.02);
        mod.stop(time + dur + 0.02);
    }

    playViolinSolo(time, freq, dur) {
        const bus = this.getTargetBus();
        [-4, 4].forEach(det => {
            const osc = this.ctx.createOscillator();
            const vib = this.ctx.createOscillator();
            const vibGain = this.ctx.createGain();
            const filter = this.ctx.createBiquadFilter();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(freq, time);
            osc.detune.setValueAtTime(det, time);
            vib.frequency.setValueAtTime(5.8, time);
            vibGain.gain.setValueAtTime(4.2, time);
            vib.connect(vibGain);
            vibGain.connect(osc.frequency);
            filter.type = 'bandpass';
            filter.frequency.setValueAtTime(1600, time);
            filter.Q.setValueAtTime(1.8, time);
            gain.gain.setValueAtTime(0.001, time);
            gain.gain.linearRampToValueAtTime(0.18, time + 0.045);
            gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
            osc.connect(filter);
            filter.connect(gain);
            gain.connect(bus);
            osc.start(time);
            vib.start(time);
            osc.stop(time + dur + 0.02);
            vib.stop(time + dur + 0.02);
        });
    }

    playSpiccatoString(time, freq, dur) {
        const bus = this.getTargetBus();
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, time);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2800, time);
        filter.frequency.exponentialRampToValueAtTime(650, time + dur);
        gain.gain.setValueAtTime(0.001, time);
        gain.gain.linearRampToValueAtTime(0.24, time + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(bus);
        osc.start(time);
        osc.stop(time + dur + 0.02);
    }

    playHumanWhistle(time, freq, dur) {
        const bus = this.getTargetBus();
        const osc = this.ctx.createOscillator();
        const vib = this.ctx.createOscillator();
        const vibGain = this.ctx.createGain();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq * 0.985, time);
        osc.frequency.exponentialRampToValueAtTime(freq, time + 0.03);
        vib.frequency.setValueAtTime(5.5, time);
        vibGain.gain.setValueAtTime(5.0, time);
        vib.connect(vibGain);
        vibGain.connect(osc.frequency);
        gain.gain.setValueAtTime(0.001, time);
        gain.gain.linearRampToValueAtTime(0.22, time + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.connect(gain);
        gain.connect(bus);
        osc.start(time);
        vib.start(time);
        osc.stop(time + dur + 0.02);
        vib.stop(time + dur + 0.02);
    }

    // ================ 10 UNCONVENTIONAL INSTRUMENT SYNTHESIZERS ================
    playJunkyardKit(time, hitType) {
        const bus = this.getTargetBus();
        if (hitType === 'B') {
            // Oil-Drum Cavernous Boom
            this.playKick(time, 128, 36, 0.34, 0.85);
            this.playTaiko(time, 92, 48, 0.25);
        } else if (hitType === 'A') {
            // Blacksmith Steel Anvil Clang (Inharmonic FM ring)
            [1040, 1780, 2940].forEach((f, idx) => {
                const osc = this.ctx.createOscillator();
                const g = this.ctx.createGain();
                osc.type = idx === 0 ? 'square' : 'triangle';
                osc.frequency.setValueAtTime(f, time);
                g.gain.setValueAtTime(0.22 / (idx + 1), time);
                g.gain.exponentialRampToValueAtTime(0.001, time + 0.24);
                osc.connect(g);
                g.connect(bus);
                osc.start(time);
                osc.stop(time + 0.26);
            });
        } else if (hitType === 'W') {
            // Metallic Wrench Pipe Clank
            this.playCowbell(time, 740, 0.09);
        } else if (hitType === 'S') {
            // Pneumatic Steam Release Hiss
            this.playHiHat(time, 0.16, 4200, 0.28);
        } else {
            this.playHiHat(time, 0.04, 7800, 0.2);
        }
    }

    playDidgeridoo(time, freq, dur) {
        const bus = this.getTargetBus();
        const osc = this.ctx.createOscillator();
        const sub = this.ctx.createOscillator();
        const formant1 = this.ctx.createBiquadFilter();
        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, time);
        sub.type = 'triangle';
        sub.frequency.setValueAtTime(freq * 0.5, time);

        formant1.type = 'bandpass';
        formant1.frequency.setValueAtTime(360, time);
        formant1.Q.setValueAtTime(5.5, time);

        lfo.frequency.setValueAtTime((appState.bpm / 60) * 2, time);
        lfoGain.gain.setValueAtTime(240, time);
        lfo.connect(lfoGain);
        lfoGain.connect(formant1.frequency);

        gain.gain.setValueAtTime(0.001, time);
        gain.gain.linearRampToValueAtTime(0.45, time + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

        osc.connect(formant1);
        sub.connect(formant1);
        formant1.connect(gain);
        gain.connect(bus);
        osc.start(time);
        sub.start(time);
        lfo.start(time);
        osc.stop(time + dur + 0.02);
        sub.stop(time + dur + 0.02);
        lfo.stop(time + dur + 0.02);
    }

    playJawHarp(time, freq, dur) {
        const bus = this.getTargetBus();
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, time);
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(freq * 6, time);
        filter.frequency.exponentialRampToValueAtTime(freq * 2.2, time + dur * 0.8);
        filter.Q.setValueAtTime(9.5, time);
        gain.gain.setValueAtTime(0.42, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(bus);
        osc.start(time);
        osc.stop(time + dur + 0.02);
    }

    playGlassArmonica(time, freqs, dur) {
        const bus = this.getTargetBus();
        freqs.forEach(f => {
            [1, 2.003].forEach((harm, hIdx) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(f * harm, time);
                const amp = (hIdx === 0 ? 0.14 : 0.045) / Math.sqrt(freqs.length);
                gain.gain.setValueAtTime(0.001, time);
                gain.gain.linearRampToValueAtTime(amp, time + dur * 0.28);
                gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
                osc.connect(gain);
                gain.connect(bus);
                osc.start(time);
                osc.stop(time + dur + 0.04);
            });
        });
    }

    playSingingBowls(time, freqs, dur) {
        const bus = this.getTargetBus();
        freqs.forEach(f => {
            // Authentic Tibetan bowl inharmonic partials (1 : 2.71 : 5.15) with slow beating
            [1, 1.004, 2.71].forEach((ratio, rIdx) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(f * ratio, time);
                const amp = (rIdx < 2 ? 0.11 : 0.04) / Math.sqrt(freqs.length);
                gain.gain.setValueAtTime(0.001, time);
                gain.gain.linearRampToValueAtTime(amp, time + 0.025);
                gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
                osc.connect(gain);
                gain.connect(bus);
                osc.start(time);
                osc.stop(time + dur + 0.05);
            });
        });
    }

    playMusicalSaw(time, freq, dur) {
        const bus = this.getTargetBus();
        const osc = this.ctx.createOscillator();
        const vib = this.ctx.createOscillator();
        const vibGain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq * 0.91, time);
        osc.frequency.exponentialRampToValueAtTime(freq, time + 0.11);

        vib.frequency.setValueAtTime(6.8, time);
        vibGain.gain.setValueAtTime(9.5, time);
        vib.connect(vibGain);
        vibGain.connect(osc.frequency);

        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(freq * 1.5, time);
        filter.Q.setValueAtTime(4.2, time);

        gain.gain.setValueAtTime(0.001, time);
        gain.gain.linearRampToValueAtTime(0.28, time + 0.06);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(bus);
        osc.start(time);
        vib.start(time);
        osc.stop(time + dur + 0.02);
        vib.stop(time + dur + 0.02);
    }

    playTeslaCoil(time, freq, dur) {
        const bus = this.getTargetBus();
        const osc = this.ctx.createOscillator();
        const mod = this.ctx.createOscillator();
        const modGain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, time);
        mod.type = 'square';
        mod.frequency.setValueAtTime(120, time); // 120Hz plasma mains buzz
        modGain.gain.setValueAtTime(freq * 0.35, time);

        filter.type = 'highpass';
        filter.frequency.setValueAtTime(520, time);

        gain.gain.setValueAtTime(0.22, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

        mod.connect(modGain);
        modGain.connect(osc.frequency);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(bus);
        osc.start(time);
        mod.start(time);
        osc.stop(time + dur + 0.02);
        mod.stop(time + dur + 0.02);
    }

    playHurdyGurdy(time, freq, dur) {
        const bus = this.getTargetBus();
        // Rosin wheel melody string + fifth drone string
        [1, 0.5].forEach((mult, idx) => {
            const osc = this.ctx.createOscillator();
            const filter = this.ctx.createBiquadFilter();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(freq * mult, time);
            filter.type = 'bandpass';
            filter.frequency.setValueAtTime(idx === 0 ? 1350 : 480, time);
            filter.Q.setValueAtTime(2.8, time);
            gain.gain.setValueAtTime(0.001, time);
            gain.gain.linearRampToValueAtTime(idx === 0 ? 0.22 : 0.11, time + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
            osc.connect(filter);
            filter.connect(gain);
            gain.connect(bus);
            osc.start(time);
            osc.stop(time + dur + 0.02);
        });
    }

    playWaterphone(time, freq, dur) {
        const bus = this.getTargetBus();
        // Inharmonic bronze rods + water slosh pitch bend
        [1, 1.414, 2.236].forEach((ratio, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            const baseF = freq * ratio;
            osc.frequency.setValueAtTime(baseF, time);
            osc.frequency.exponentialRampToValueAtTime(baseF * (idx % 2 === 0 ? 1.07 : 0.94), time + dur * 0.65);
            osc.frequency.exponentialRampToValueAtTime(baseF, time + dur);
            gain.gain.setValueAtTime(0.001, time);
            gain.gain.linearRampToValueAtTime(0.14 / (idx + 1), time + 0.08);
            gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
            osc.connect(gain);
            gain.connect(bus);
            osc.start(time);
            osc.stop(time + dur + 0.03);
        });
    }

    playMoogBass(time, freq, dur) {
        const bus = this.getTargetBus();
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, time);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1900, time);
        filter.frequency.exponentialRampToValueAtTime(220, time + dur * 0.85);
        filter.Q.setValueAtTime(4.5, time);
        gain.gain.setValueAtTime(0.38, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(bus);
        osc.start(time);
        osc.stop(time + dur + 0.02);
    }

    playUprightBass(time, freq, dur) {
        const bus = this.getTargetBus();
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, time);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(680, time);
        filter.frequency.exponentialRampToValueAtTime(210, time + dur * 0.8);
        filter.Q.setValueAtTime(2.0, time);
        gain.gain.setValueAtTime(0.01, time);
        gain.gain.linearRampToValueAtTime(0.45, time + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(bus);
        osc.start(time);
        osc.stop(time + dur + 0.02);
    }

    playAcidBass(time, freq, dur, isAccent) {
        const bus = this.getTargetBus();
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, time);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(isAccent ? 3100 : 1500, time);
        filter.frequency.exponentialRampToValueAtTime(240, time + dur * 0.85);
        filter.Q.setValueAtTime(isAccent ? 10.5 : 6.5, time);
        gain.gain.setValueAtTime(isAccent ? 0.34 : 0.25, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(bus);
        osc.start(time);
        osc.stop(time + dur + 0.02);
    }

    playRhodesChord(time, freqs, dur) {
        const bus = this.getTargetBus();
        freqs.forEach((f, idx) => {
            const carrier = this.ctx.createOscillator();
            const mod = this.ctx.createOscillator();
            const modGain = this.ctx.createGain();
            const gain = this.ctx.createGain();
            carrier.type = 'sine';
            carrier.frequency.setValueAtTime(f, time);
            mod.type = 'sine';
            mod.frequency.setValueAtTime(f * 2, time);
            modGain.gain.setValueAtTime(f * 0.75, time);
            modGain.gain.exponentialRampToValueAtTime(1.0, time + 0.16);
            gain.gain.setValueAtTime(0.001, time);
            gain.gain.linearRampToValueAtTime(0.11 / Math.sqrt(freqs.length), time + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
            mod.connect(modGain);
            modGain.connect(carrier.frequency);
            carrier.connect(gain);
            gain.connect(bus);
            carrier.start(time + idx * 0.006);
            mod.start(time + idx * 0.006);
            carrier.stop(time + dur + 0.03);
            mod.stop(time + dur + 0.03);
        });
    }

    playGuitarStrum(time, freqs, dur) {
        const bus = this.getTargetBus();
        freqs.forEach((f, idx) => {
            const strumTime = time + idx * 0.018;
            const osc = this.ctx.createOscillator();
            const filter = this.ctx.createBiquadFilter();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(f, strumTime);
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(3200, strumTime);
            filter.frequency.exponentialRampToValueAtTime(650, strumTime + dur * 0.75);
            gain.gain.setValueAtTime(0.001, strumTime);
            gain.gain.linearRampToValueAtTime(0.09, strumTime + 0.006);
            gain.gain.exponentialRampToValueAtTime(0.001, strumTime + dur);
            osc.connect(filter);
            filter.connect(gain);
            gain.connect(bus);
            osc.start(strumTime);
            osc.stop(strumTime + dur + 0.03);
        });
    }

    playWarmPad(time, freqs, dur) {
        const bus = this.getTargetBus();
        freqs.forEach(f => {
            [-6, 6].forEach(detuneCents => {
                const osc = this.ctx.createOscillator();
                const filter = this.ctx.createBiquadFilter();
                const gain = this.ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(f, time);
                osc.detune.setValueAtTime(detuneCents, time);
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(420, time);
                filter.frequency.linearRampToValueAtTime(1650, time + dur * 0.45);
                filter.frequency.linearRampToValueAtTime(520, time + dur);
                gain.gain.setValueAtTime(0.001, time);
                gain.gain.linearRampToValueAtTime(0.05, time + dur * 0.25);
                gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
                osc.connect(filter);
                filter.connect(gain);
                gain.connect(bus);
                osc.start(time);
                osc.stop(time + dur + 0.05);
            });
        });
    }

    playBrassChord(time, freqs, dur) {
        const bus = this.getTargetBus();
        freqs.forEach((f, idx) => {
            const osc = this.ctx.createOscillator();
            const filter = this.ctx.createBiquadFilter();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(f * 0.992, time);
            osc.frequency.exponentialRampToValueAtTime(f, time + 0.035);
            osc.detune.setValueAtTime((idx - 1.5) * 4, time);
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(350, time);
            filter.frequency.linearRampToValueAtTime(2400, time + 0.06);
            filter.frequency.exponentialRampToValueAtTime(900, time + dur);
            filter.Q.setValueAtTime(2.5, time);
            gain.gain.setValueAtTime(0.001, time);
            gain.gain.linearRampToValueAtTime(0.095, time + 0.045);
            gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
            osc.connect(filter);
            filter.connect(gain);
            gain.connect(bus);
            osc.start(time);
            osc.stop(time + dur + 0.03);
        });
    }

    playCyberArp(time, freqs, dur) {
        const bus = this.getTargetBus();
        freqs.forEach(f => {
            const osc = this.ctx.createOscillator();
            const filter = this.ctx.createBiquadFilter();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(f, time);
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(3600, time);
            filter.frequency.exponentialRampToValueAtTime(480, time + dur);
            filter.Q.setValueAtTime(3.5, time);
            gain.gain.setValueAtTime(0.18 / freqs.length, time);
            gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
            osc.connect(filter);
            filter.connect(gain);
            gain.connect(bus);
            osc.start(time);
            osc.stop(time + dur + 0.02);
        });
    }

    playSaxophone(time, freq, dur) {
        const bus = this.getTargetBus();
        const osc = this.ctx.createOscillator();
        const vibrato = this.ctx.createOscillator();
        const vibGain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq * 0.985, time);
        osc.frequency.exponentialRampToValueAtTime(freq, time + 0.03);
        vibrato.frequency.setValueAtTime(5.5, time);
        vibGain.gain.setValueAtTime(3.5, time);
        vibrato.connect(vibGain);
        vibGain.connect(osc.frequency);
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1150, time);
        filter.Q.setValueAtTime(1.8, time);
        gain.gain.setValueAtTime(0.001, time);
        gain.gain.linearRampToValueAtTime(0.25, time + 0.035);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(bus);
        osc.start(time);
        vibrato.start(time);
        osc.stop(time + dur + 0.02);
        vibrato.stop(time + dur + 0.02);
    }

    playMarimba(time, freq, dur) {
        const bus = this.getTargetBus();
        const osc = this.ctx.createOscillator();
        const overtone = this.ctx.createOscillator();
        const overGain = this.ctx.createGain();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, time);
        overtone.type = 'sine';
        overtone.frequency.setValueAtTime(freq * 4, time);
        overGain.gain.setValueAtTime(0.12, time);
        overGain.gain.exponentialRampToValueAtTime(0.001, time + 0.045);
        gain.gain.setValueAtTime(0.001, time);
        gain.gain.linearRampToValueAtTime(0.32, time + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.connect(gain);
        overtone.connect(overGain);
        overGain.connect(gain);
        gain.connect(bus);
        osc.start(time);
        overtone.start(time);
        osc.stop(time + dur + 0.02);
        overtone.stop(time + dur + 0.02);
    }

    playFunkGuitar(time, freq, dur) {
        const bus = this.getTargetBus();
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, time);
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(850, time);
        filter.frequency.exponentialRampToValueAtTime(2800, time + 0.04);
        filter.frequency.exponentialRampToValueAtTime(700, time + dur);
        filter.Q.setValueAtTime(3.2, time);
        gain.gain.setValueAtTime(0.001, time);
        gain.gain.linearRampToValueAtTime(0.26, time + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(bus);
        osc.start(time);
        osc.stop(time + dur + 0.02);
    }

    playFlute(time, freq, dur) {
        const bus = this.getTargetBus();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, time);
        const breath = this.ctx.createBufferSource();
        breath.buffer = this.noiseBuffer;
        const bFilter = this.ctx.createBiquadFilter();
        bFilter.type = 'bandpass';
        bFilter.frequency.setValueAtTime(2600, time);
        bFilter.Q.setValueAtTime(3.0, time);
        const bGain = this.ctx.createGain();
        bGain.gain.setValueAtTime(0.035, time);
        bGain.gain.exponentialRampToValueAtTime(0.001, time + dur * 0.7);
        gain.gain.setValueAtTime(0.001, time);
        gain.gain.linearRampToValueAtTime(0.22, time + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.connect(gain);
        breath.connect(bFilter);
        bFilter.connect(bGain);
        bGain.connect(gain);
        gain.connect(bus);
        osc.start(time);
        breath.start(time);
        osc.stop(time + dur + 0.02);
        breath.stop(time + dur + 0.02);
    }

    playCrystalBell(time, freq, dur) {
        const bus = this.getTargetBus();
        const carrier = this.ctx.createOscillator();
        const mod = this.ctx.createOscillator();
        const modGain = this.ctx.createGain();
        const gain = this.ctx.createGain();
        carrier.type = 'sine';
        carrier.frequency.setValueAtTime(freq, time);
        mod.type = 'sine';
        mod.frequency.setValueAtTime(freq * 3.5, time);
        modGain.gain.setValueAtTime(freq * 1.8, time);
        modGain.gain.exponentialRampToValueAtTime(1, time + dur * 0.6);
        gain.gain.setValueAtTime(0.001, time);
        gain.gain.linearRampToValueAtTime(0.24, time + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        mod.connect(modGain);
        modGain.connect(carrier.frequency);
        carrier.connect(gain);
        gain.connect(bus);
        carrier.start(time);
        mod.start(time);
        carrier.stop(time + dur + 0.03);
        mod.stop(time + dur + 0.03);
    }
}

const audioEngine = new StudioAudioEngine();
