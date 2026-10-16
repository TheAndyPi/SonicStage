/***********************************************************************
 * 2. APPLICATION STATE & CONTINUOUS 7-TIER STAGE SCALING (6 UP TO 100)
 ***********************************************************************/
const MAX_SLOTS = 100;

// 7 Concentric Amphitheater Tiers totaling 100 Performers:
// Tier 1: 6  (Slots 0..5)   -> Cumulative 6
// Tier 2: 6  (Slots 6..11)  -> Cumulative 12
// Tier 3: 12 (Slots 12..23) -> Cumulative 24
// Tier 4: 16 (Slots 24..39) -> Cumulative 40
// Tier 5: 20 (Slots 40..59) -> Cumulative 60
// Tier 6: 20 (Slots 60..79) -> Cumulative 80
// Tier 7: 20 (Slots 80..99) -> Cumulative 100
const STAGE_TIERS = [
    {
        tier: 1,
        start: 0,
        count: 6,
        cumSlots: 6,
        radius: 4.4,
        innerR: 1.5,
        outerR: 5.95,
        elev: 0.04,
        angleOffset: Math.PI / 6,
    },
    { tier: 2, start: 6, count: 6, cumSlots: 12, radius: 8.2, innerR: 6.7, outerR: 9.8, elev: 0.42, angleOffset: 0 },
    {
        tier: 3,
        start: 12,
        count: 12,
        cumSlots: 24,
        radius: 12.2,
        innerR: 10.2,
        outerR: 13.8,
        elev: 0.84,
        angleOffset: Math.PI / 12,
    },
    {
        tier: 4,
        start: 24,
        count: 16,
        cumSlots: 40,
        radius: 16.4,
        innerR: 14.2,
        outerR: 18.0,
        elev: 1.3,
        angleOffset: 0,
    },
    {
        tier: 5,
        start: 40,
        count: 20,
        cumSlots: 60,
        radius: 20.8,
        innerR: 18.4,
        outerR: 22.4,
        elev: 1.8,
        angleOffset: Math.PI / 20,
    },
    {
        tier: 6,
        start: 60,
        count: 20,
        cumSlots: 80,
        radius: 25.4,
        innerR: 22.8,
        outerR: 27.0,
        elev: 2.34,
        angleOffset: 0,
    },
    {
        tier: 7,
        start: 80,
        count: 20,
        cumSlots: 100,
        radius: 30.2,
        innerR: 27.4,
        outerR: 32.0,
        elev: 2.92,
        angleOffset: Math.PI / 20,
    },
];

function getSlotTierConfig(slotIndex) {
    for (let i = 0; i < STAGE_TIERS.length; i++) {
        const t = STAGE_TIERS[i];
        if (slotIndex >= t.start && slotIndex < t.start + t.count) return t;
    }
    return STAGE_TIERS[STAGE_TIERS.length - 1];
}

function getActiveTierConfig() {
    return STAGE_TIERS.find(t => t.cumSlots === stageState.unlockedSlots) || STAGE_TIERS[0];
}

const BEATBAR_SIZES = {
    sm: { wrapperMaxH: '74px', stepCellPx: '14px', rowPadPx: '2px' },
    md: { wrapperMaxH: '124px', stepCellPx: '20px', rowPadPx: '4px' },
    lg: { wrapperMaxH: '210px', stepCellPx: '28px', rowPadPx: '6px' },
    xl: { wrapperMaxH: '320px', stepCellPx: '36px', rowPadPx: '8px' },
};

const appState = {
    isPlaying: false,
    bpm: 112,
    rootKey: 0, // 0 = C, 1 = C#, ..., 11 = B
    scaleMode: 'dorian', // 'dorian', 'minor', 'major', 'harmonicMinor', 'phrygian', 'lydian', 'mixolydian'
    currentStep: 0,
    selectedCategory: 'all',
    unlockedSlots: 6, // Dynamically scales across 6 -> 12 -> 24 -> 40 -> 60 -> 80 -> 100!
    timelineVisible: true,
    paletteCollapsed: false,
    beatBarSize: 'md', // 'sm', 'md', 'lg', 'xl'
    stepEditMode: 'toggle', // 'toggle' (On/Off) or 'cycle' (Cycle Pitch / Drum Hit / Off)
    proFxOpen: false,
    globalSwing: 0.04, // Global 16th-note shuffle (0.0 to 0.65)
    cameraMode: 'stage',
    slots: Array.from({ length: MAX_SLOTS }, (_, i) => ({
        index: i,
        tier: getSlotTierConfig(i).tier,
        preset: null,
        customSteps: null, // Editable 16-step sequence per slot
        customHeights: null, // Editable 16-step visual heights per slot
        volume: 0.85, // Individual player volume (0.0 to 1.0)
        pan: 0.0, // Stereo pan (-1.0 Left to +1.0 Right)
        pitchShift: 0, // Octave/Semitone offset (-12, 0, +12)
        muted: false,
        solo: false,
        energy: 0,
        hitCount: 0,
        vowelState: 'A',
    })),
    draggedPresetId: null,
    hoveredSlotIndex: -1,
};

function cloneStepValue(val) {
    if (val === null || val === undefined) return null;
    if (Array.isArray(val)) return [...val];
    if (typeof val === 'object') return { ...val };
    return val;
}

function initSlotSequenceFromPreset(slot, preset) {
    if (!preset) {
        slot.customSteps = null;
        slot.customHeights = null;
        return;
    }
    slot.customSteps = preset.steps.map(cloneStepValue);
    slot.customHeights = [...preset.visualHeights];
}

function getSlotSteps(slot) {
    if (!slot || !slot.preset) return [];
    if (!slot.customSteps) initSlotSequenceFromPreset(slot, slot.preset);
    return slot.customSteps;
}

function getSlotHeights(slot) {
    if (!slot || !slot.preset) return [];
    if (!slot.customHeights) initSlotSequenceFromPreset(slot, slot.preset);
    return slot.customHeights;
}

function getActiveInstrumentCount() {
    return appState.slots.filter(s => s.preset !== null).length;
}

function isSlotAudible(slot, slots = appState.slots) {
    if (!slot.preset || slot.muted || slot.volume <= 0.001) return false;
    const anySolo = slots.some(s => s.preset && s.solo);
    if (anySolo && !slot.solo) return false;
    return true;
}
