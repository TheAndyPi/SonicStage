/***********************************************************************
 * 4. ADAPTIVE STUDIO STAGE (UP TO 100 PERFORMERS)
 ***********************************************************************/
let scene, camera, renderer, controls, raycaster, mouseNDC;
let sharedStudioMaterials = null;
let sharedCategoryMaterials = {};
let sharedPerformerGeometries = null;
let centerCoreGroup = null;
let mainArenaDeckMesh = null;
let outerBrassRimMesh = null;
const tierRiserGroups = [];
let bokehParticles = null;
let floorEQInstancedMesh = null;
const floorEQBars = [];
const lightPillars = [];
const pedestalMeshes = [];
const pedestalHitProxies = [];
const hudBadgeElements = [];
let sharedPedestalGeometries = null;
let stepLedsInstancedMesh = null;
let stageTheme = 'light';
const stageThemeSurfaces = {};
const stageThemeLights = {};
const stageSpectrumColors = [];
const _tempDummy = new THREE.Object3D();
const _tempColor = new THREE.Color();
const _tempVec3 = new THREE.Vector3();

const cameraTargetPos = new THREE.Vector3(0, 7.4, 12.8);
const cameraLookAtTarget = new THREE.Vector3(0, 0.5, 0);
let isTransitioningCamera = false;
const stageMotionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const compactStageDevice = window.matchMedia('(max-width: 760px), (pointer: coarse)').matches;

function stageColor(hex) {
    return new THREE.Color(hex).convertSRGBToLinear();
}

function getStageSpectrumColor(index) {
    return (
        stageSpectrumColors[Math.floor((index / 64) * stageSpectrumColors.length) % stageSpectrumColors.length] ||
        _tempColor.setHex(0xffffff)
    );
}

// Retheme pooled materials in place; existing performers and animations keep their identity.
function applyStageTheme(theme = 'light') {
    stageTheme = theme === 'dark' ? 'dark' : 'light';
    if (!scene || !renderer || !sharedStudioMaterials) return stageTheme;
    const light = stageTheme === 'light';
    const neutral = hex => stageColor(hex);
    scene.background = light ? new THREE.Color(2.1, 2.1, 2.1) : neutral(0x171717);
    if (scene.fog) {
        scene.fog.color.copy(scene.background);
        scene.fog.density = light ? 0.0045 : 0.009;
    }
    renderer.toneMappingExposure = light ? 1.08 : 0.96;
    const recolor = (material, hex) => {
        if (material?.color) material.color.copy(neutral(hex));
    };
    const surfaceColors = light
        ? { floor: 0xf2f2f2, inner: 0xffffff, riser: 0xececec, seam: 0xa7a7a7 }
        : { floor: 0x111111, inner: 0x292929, riser: 0x222222, seam: 0x535353 };
    Object.entries(surfaceColors).forEach(([key, hex]) => recolor(stageThemeSurfaces[key], hex));
    recolor(sharedStudioMaterials.obsidianDeck, light ? 0xe9e9e9 : 0x202020);
    sharedStudioMaterials.obsidianDeck.map = null;
    sharedStudioMaterials.obsidianDeck.needsUpdate = true;
    ['inner', 'riser'].forEach(key => {
        const material = stageThemeSurfaces[key];
        if (material) {
            material.map = null;
            material.needsUpdate = true;
        }
    });
    recolor(sharedStudioMaterials.stageTrim, light ? 0x5f646d : 0x51535a);
    recolor(sharedStudioMaterials.inactiveRing, light ? 0x6c7079 : 0x42454b);
    recolor(sharedStudioMaterials.mutedRing, light ? 0x7c8089 : 0x4b4e55);
    recolor(sharedStudioMaterials.matteBlack, light ? 0x25262b : 0x191a1f);
    recolor(sharedStudioMaterials.chrome, light ? 0xbec2ca : 0xc8ccd4);
    recolor(sharedStudioMaterials.brushedAluminum, light ? 0x737883 : 0x888e99);
    recolor(sharedPedestalGeometries?.baseMat, light ? 0x9a9ea7 : 0x303136);
    if (bokehParticles) {
        bokehParticles.material.color.copy(neutral(light ? 0x8c83cc : 0xc8c3e7));
        bokehParticles.material.opacity = light ? 0.1 : 0.18;
    }
    if (stageThemeLights.hemi) {
        stageThemeLights.hemi.color.setHex(0xffffff);
        stageThemeLights.hemi.groundColor.copy(neutral(light ? 0xd4d4d4 : 0x141414));
        stageThemeLights.hemi.intensity = light ? 0.62 : 0.36;
        stageThemeLights.key.color.setHex(0xffffff);
        stageThemeLights.key.intensity = light ? 1.1 : 1.0;
        stageThemeLights.left.color.copy(neutral(0xa3b6ff));
        stageThemeLights.right.color.copy(neutral(0xffabc8));
        stageThemeLights.left.intensity = light ? 0.18 : 0.26;
        stageThemeLights.right.intensity = light ? 0.15 : 0.22;
    }
    const categories = Object.keys(CATEGORY_META);
    stageSpectrumColors.length = 0;
    categories.forEach(category => {
        const color = neutral(CATEGORY_META[category].hex);
        stageSpectrumColors.push(color);
        const materials = sharedCategoryMaterials[category];
        if (!materials) return;
        materials.accent.color.copy(color);
        materials.accent.emissive.copy(color);
        materials.accent.emissiveIntensity = light ? 0.025 : 0.1;
        materials.jacket.color.copy(color).multiplyScalar(light ? 0.65 : 0.48);
        materials.activeRing.color.copy(color);
        materials.activeRing.emissive.copy(color);
        materials.activeRing.emissiveIntensity = light ? 0.16 : 0.42;
        materials.wave.color.copy(color);
    });
    if (centerCoreGroup) {
        const { crystalMesh, gyroRing1, gyroRing2 } = centerCoreGroup.userData;
        recolor(crystalMesh.material, 0xe0b448);
        crystalMesh.material.emissive.copy(neutral(0x9a6a14));
        recolor(gyroRing1.material, 0xd9dce1);
        recolor(gyroRing2.material, 0x3b82f6);
    }
    lightPillars.forEach((pillar, index) => {
        const color = stageSpectrumColors[index % stageSpectrumColors.length];
        pillar.stripMat.color.copy(color);
        pillar.beamCone.material.color.copy(color);
        pillar.beamCone.material.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
        pillar.beamCone.material.needsUpdate = true;
    });
    if (floorEQInstancedMesh) {
        for (let index = 0; index < 64; index++) floorEQInstancedMesh.setColorAt(index, getStageSpectrumColor(index));
        floorEQInstancedMesh.instanceColor.needsUpdate = true;
    }
    return stageTheme;
}
window.applyStageTheme = applyStageTheme;

function getStageViewport() {
    const container = document.getElementById('canvas-container');
    const rect = container.getBoundingClientRect();
    const clear = cinematicState.active ? rect : document.getElementById('pedestal-hud-layer').getBoundingClientRect();
    return {
        left: rect.left,
        top: rect.top,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        clearLeft: clear.left - rect.left,
        clearTop: clear.top - rect.top,
        clearWidth: clear.width,
        clearHeight: clear.height,
    };
}

// Extend the camera frustum behind the panels without moving the band underneath them.
function frameStageViewport(viewport) {
    const clearWidth = Math.max(160, viewport.clearWidth);
    const clearHeight = Math.max(120, viewport.clearHeight);
    camera.setViewOffset(
        clearWidth,
        clearHeight,
        -viewport.clearLeft,
        -viewport.clearTop,
        viewport.width,
        viewport.height,
    );
}

function stageFraming(aspect) {
    return Math.min(6, Math.max(1, 1.25 / aspect));
}

function updateStageCameraRange() {
    const distance = Math.max(
        camera.position.distanceTo(controls.target),
        cameraTargetPos.distanceTo(cameraLookAtTarget),
    );
    controls.maxDistance = Math.max(85, distance * 1.25);
    camera.far = Math.max(120, distance + getActiveTierConfig().outerR * 4 + 30);
}

function setStagePointer(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouseNDC.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
}

// A shared bevel gives the miniature hardware a machined edge without external assets.
function createBeveledBoxGeometry(width, height, depth, radius = 0.015) {
    const shape = new THREE.Shape();
    const x = -width / 2 + radius,
        y = -height / 2 + radius;
    const w = width - radius * 2,
        h = height - radius * 2;
    shape.moveTo(x, y);
    shape.lineTo(x + w, y);
    shape.lineTo(x + w, y + h);
    shape.lineTo(x, y + h);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: Math.max(0.004, depth - radius * 2),
        bevelEnabled: true,
        bevelSegments: 2,
        steps: 1,
        bevelSize: radius,
        bevelThickness: radius,
    });
    geometry.translate(0, 0, -Math.max(0.004, depth - radius * 2) / 2);
    return geometry;
}

function createInstrumentBodyGeometry(kind) {
    const shape = new THREE.Shape();
    if (kind === 'bass') {
        shape.moveTo(0.1, 0.035);
        shape.bezierCurveTo(0.17, 0.08, 0.17, 0.18, 0.08, 0.16);
        shape.bezierCurveTo(0.01, 0.14, 0.03, 0.08, -0.04, 0.1);
        shape.bezierCurveTo(-0.23, 0.2, -0.27, -0.12, -0.08, -0.15);
        shape.bezierCurveTo(0.05, -0.19, 0.18, -0.12, 0.11, -0.04);
        shape.bezierCurveTo(0.08, -0.02, 0.08, 0.01, 0.1, 0.035);
    } else {
        shape.moveTo(0, 0.31);
        shape.bezierCurveTo(0.2, 0.33, 0.22, 0.14, 0.1, 0.08);
        shape.bezierCurveTo(0.075, 0.04, 0.075, -0.015, 0.15, -0.05);
        shape.bezierCurveTo(0.31, -0.14, 0.23, -0.37, 0, -0.36);
        shape.bezierCurveTo(-0.23, -0.37, -0.31, -0.14, -0.15, -0.05);
        shape.bezierCurveTo(-0.075, -0.015, -0.075, 0.04, -0.1, 0.08);
        shape.bezierCurveTo(-0.22, 0.14, -0.2, 0.33, 0, 0.31);
    }
    shape.closePath();
    const depth = kind === 'bass' ? 0.055 : 0.085;
    const geometry = new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: true,
        bevelSegments: 2,
        steps: 1,
        bevelSize: 0.012,
        bevelThickness: 0.01,
        curveSegments: 10,
    });
    geometry.translate(0, 0, -depth / 2);
    return geometry;
}

function createStageTexture(kind) {
    const canvas = document.createElement('canvas');
    canvas.width = kind === 'deck' ? 512 : 64;
    canvas.height = canvas.width;
    const ctx = canvas.getContext('2d');
    if (kind === 'glow') {
        const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        glow.addColorStop(0, 'rgba(255,255,255,1)');
        glow.addColorStop(0.22, 'rgba(255,255,255,0.6)');
        glow.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, 64, 64);
    } else if (kind === 'beam') {
        const fade = ctx.createLinearGradient(0, 0, 0, 64);
        fade.addColorStop(0, 'rgba(255,255,255,0.85)');
        fade.addColorStop(0.65, 'rgba(255,255,255,0.28)');
        fade.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = fade;
        ctx.fillRect(0, 0, 64, 64);
    } else {
        ctx.fillStyle = kind === 'deck' ? '#888782' : '#a2a29d';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const spacing = kind === 'deck' ? 64 : 4;
        ctx.strokeStyle = kind === 'deck' ? '#747570' : '#60625e';
        ctx.lineWidth = kind === 'deck' ? 1 : 0.7;
        for (let p = 0; p <= canvas.width; p += spacing) {
            ctx.beginPath();
            ctx.moveTo(p, 0);
            ctx.lineTo(p, canvas.height);
            ctx.stroke();
            if (kind !== 'deck') {
                ctx.beginPath();
                ctx.moveTo(0, p);
                ctx.lineTo(canvas.width, p);
                ctx.stroke();
            }
        }
    }
    const texture = new THREE.CanvasTexture(canvas);
    if (kind === 'deck' || kind === 'fabric') {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(kind === 'deck' ? 6 : 3, kind === 'deck' ? 6 : 3);
    }
    return texture;
}

function createProceduralConcertEnvironment(rendererInstance) {
    const pmremGenerator = new THREE.PMREMGenerator(rendererInstance);
    pmremGenerator.compileEquirectangularShader();

    const envScene = new THREE.Scene();
    envScene.background = stageColor(0x121212);

    // Warm gold overhead concert rig reflection
    const topSoftbox = new THREE.Mesh(
        new THREE.PlaneGeometry(22, 22),
        new THREE.MeshBasicMaterial({ color: stageColor(0xe1e1e1) }),
    );
    topSoftbox.position.set(0, 12, 0);
    topSoftbox.rotation.x = Math.PI / 2;
    envScene.add(topSoftbox);

    // Broad softboxes keep the instruments readable at every camera angle.
    const leftStrip = new THREE.Mesh(
        new THREE.PlaneGeometry(16, 8),
        new THREE.MeshBasicMaterial({ color: stageColor(0xb5c3ee) }),
    );
    leftStrip.position.set(-14, 5, 0);
    leftStrip.rotation.y = Math.PI / 2;
    envScene.add(leftStrip);

    // Warm edge reflection across brushed metal and lacquer.
    const rightStrip = new THREE.Mesh(
        new THREE.PlaneGeometry(16, 8),
        new THREE.MeshBasicMaterial({ color: stageColor(0xeac0d1) }),
    );
    rightStrip.position.set(14, 5, 0);
    rightStrip.rotation.y = -Math.PI / 2;
    envScene.add(rightStrip);

    const envMap = pmremGenerator.fromScene(envScene, 0.04).texture;
    pmremGenerator.dispose();
    envScene.traverse(object => {
        if (object.isMesh) {
            object.geometry.dispose();
            object.material.dispose();
        }
    });
    return envMap;
}

function createWoodTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#6e3b1e';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 64; i++) {
        ctx.fillStyle = i % 2 === 0 ? 'rgba(38, 18, 8, 0.22)' : 'rgba(168, 98, 48, 0.14)';
        ctx.fillRect(0, (i * 4.1) % 256, 256, 2 + (i % 3));
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
}

function initSharedMaterials() {
    const woodTex = createWoodTexture();
    const fabricTex = createStageTexture('fabric');
    const deckTex = createStageTexture('deck');
    sharedStudioMaterials = {
        chrome: new THREE.MeshStandardMaterial({
            color: 0xe2e8f0,
            metalness: 0.92,
            roughness: 0.14,
        }),
        brushedAluminum: new THREE.MeshStandardMaterial({
            color: 0xaaa99f,
            metalness: 0.82,
            roughness: 0.28,
        }),
        brass: new THREE.MeshStandardMaterial({
            color: 0xc59b58,
            metalness: 0.88,
            roughness: 0.27,
        }),
        stageTrim: new THREE.MeshStandardMaterial({
            color: 0x9b9da3,
            metalness: 0.45,
            roughness: 0.43,
        }),
        walnutWood: new THREE.MeshStandardMaterial({
            color: 0xb97c48,
            map: woodTex,
            bumpMap: woodTex,
            bumpScale: 0.008,
            metalness: 0.1,
            roughness: 0.42,
        }),
        mapleWood: new THREE.MeshStandardMaterial({
            color: 0xd6a874,
            metalness: 0.06,
            roughness: 0.36,
        }),
        matteBlack: new THREE.MeshStandardMaterial({
            color: 0x171b1c,
            metalness: 0.2,
            roughness: 0.72,
        }),
        obsidianDeck: new THREE.MeshStandardMaterial({
            color: 0x202622,
            map: deckTex,
            bumpMap: deckTex,
            bumpScale: 0.012,
            metalness: 0.08,
            roughness: 0.84,
        }),
        charcoalFabric: new THREE.MeshStandardMaterial({
            color: 0x353b38,
            map: fabricTex,
            bumpMap: fabricTex,
            bumpScale: 0.009,
            metalness: 0.08,
            roughness: 0.82,
        }),
        skinClay: new THREE.MeshStandardMaterial({
            color: 0xc9b3a1,
            metalness: 0.04,
            roughness: 0.52,
        }),
        drumheadWhite: new THREE.MeshStandardMaterial({
            color: 0xf1f5f9,
            metalness: 0.06,
            roughness: 0.4,
        }),
        ebonyKey: new THREE.MeshStandardMaterial({
            color: 0x090d16,
            metalness: 0.25,
            roughness: 0.22,
        }),
        ivoryKey: new THREE.MeshStandardMaterial({
            color: 0xf8fafc,
            metalness: 0.08,
            roughness: 0.18,
        }),
        inactiveRing: new THREE.MeshStandardMaterial({
            color: 0x3e4844,
            roughness: 0.3,
            metalness: 0.4,
        }),
        mutedRing: new THREE.MeshStandardMaterial({
            color: 0x334155,
            roughness: 0.3,
            metalness: 0.4,
        }),
        popFilterDark: new THREE.MeshBasicMaterial({
            color: 0x070913,
            transparent: true,
            opacity: 0.65,
            side: THREE.DoubleSide,
        }),
        hitProxyMat: new THREE.MeshBasicMaterial({
            visible: false,
        }),
    };

    const jacketColors = {
        drums: 0x403b33,
        bass: 0x263b37,
        chords: 0x41403a,
        melody: 0x314338,
        strings: 0x503831,
        vocals: 0x393936,
    };
    Object.keys(CATEGORY_META).forEach(cat => {
        const hex = CATEGORY_META[cat].hex;
        sharedCategoryMaterials[cat] = {
            accent: new THREE.MeshStandardMaterial({
                color: hex,
                emissive: hex,
                emissiveIntensity: 0.07,
                roughness: 0.3,
                metalness: 0.3,
            }),
            jacket: new THREE.MeshStandardMaterial({
                color: jacketColors[cat] || 0x1e293b,
                roughness: 0.84,
                metalness: 0.04,
            }),
            activeRing: new THREE.MeshStandardMaterial({
                color: hex,
                emissive: hex,
                emissiveIntensity: 0.32,
                roughness: 0.3,
                metalness: 0.4,
            }),
            wave: new THREE.MeshBasicMaterial({
                color: hex,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.0,
            }),
        };
    });

    // Shared Performer & Instrument Geometries (Allocated once, reused across all 100 performers)
    sharedPerformerGeometries = {
        leg: new THREE.CylinderGeometry(0.065, 0.055, 0.42, 10),
        torso: new THREE.LatheGeometry(
            [
                new THREE.Vector2(0.145, -0.25),
                new THREE.Vector2(0.17, -0.23),
                new THREE.Vector2(0.18, 0.04),
                new THREE.Vector2(0.22, 0.17),
                new THREE.Vector2(0.19, 0.22),
                new THREE.Vector2(0.11, 0.25),
            ],
            16,
        ),
        collar: new THREE.CylinderGeometry(0.12, 0.12, 0.06, 12),
        cranium: new THREE.SphereGeometry(0.18, 20, 16),
        jaw: new THREE.SphereGeometry(0.12, 16, 12),
        shoe: createBeveledBoxGeometry(0.13, 0.085, 0.23, 0.025),
        shirt: createBeveledBoxGeometry(0.075, 0.3, 0.018, 0.006),
        visor: createBeveledBoxGeometry(0.27, 0.065, 0.12, 0.018),
        visorRim: new THREE.BoxGeometry(0.28, 0.018, 0.125),
        headband: new THREE.TorusGeometry(0.195, 0.02, 8, 20, Math.PI),
        earcup: new THREE.CylinderGeometry(0.065, 0.065, 0.05, 12),
        cupRing: new THREE.CylinderGeometry(0.045, 0.045, 0.055, 12),
        armSleeve: new THREE.CylinderGeometry(0.052, 0.044, 0.36, 8),
        hand: new THREE.SphereGeometry(0.048, 8, 8),
        socketCap: new THREE.CylinderGeometry(0.16, 0.18, 0.04, 16),
        // Drums
        kickShell: new THREE.CylinderGeometry(0.27, 0.27, 0.34, 28),
        kickHoop: new THREE.TorusGeometry(0.275, 0.018, 8, 20),
        kickHead: new THREE.CircleGeometry(0.265, 18),
        kickLogo: new THREE.RingGeometry(0.06, 0.12, 16),
        snareStand: new THREE.CylinderGeometry(0.02, 0.02, 0.52, 8),
        snareShell: new THREE.CylinderGeometry(0.17, 0.17, 0.11, 16),
        snareHead: new THREE.CylinderGeometry(0.164, 0.164, 0.008, 24),
        cymbalStand: new THREE.CylinderGeometry(0.018, 0.018, 0.85, 8),
        cymbalDisc: new THREE.LatheGeometry(
            [
                new THREE.Vector2(0.012, 0.035),
                new THREE.Vector2(0.035, 0.035),
                new THREE.Vector2(0.055, 0.012),
                new THREE.Vector2(0.12, 0.003),
                new THREE.Vector2(0.235, -0.006),
                new THREE.Vector2(0.24, -0.012),
            ],
            32,
        ),
        drumstick: new THREE.CylinderGeometry(0.01, 0.014, 0.34, 6),
        drumLug: new THREE.CylinderGeometry(0.012, 0.012, 0.28, 6),
        // Bass
        ampCab: createBeveledBoxGeometry(0.68, 0.82, 0.36, 0.035),
        ampHead: createBeveledBoxGeometry(0.64, 0.18, 0.34, 0.02),
        ampGrille: createBeveledBoxGeometry(0.59, 0.72, 0.012, 0.014),
        vuMeter: new THREE.BoxGeometry(0.22, 0.06, 0.02),
        wooferSurround: new THREE.TorusGeometry(0.14, 0.02, 8, 18),
        wooferCap: new THREE.SphereGeometry(0.08, 10, 10),
        guitarBody: createInstrumentBodyGeometry('bass'),
        pickguard: createBeveledBoxGeometry(0.13, 0.16, 0.008, 0.024),
        guitarNeck: new THREE.BoxGeometry(0.48, 0.05, 0.03),
        headstock: createBeveledBoxGeometry(0.13, 0.08, 0.03, 0.01),
        bridge: new THREE.BoxGeometry(0.026, 0.082, 0.018),
        tuningPeg: new THREE.SphereGeometry(0.013, 8, 6),
        // Chords
        synthLeg: new THREE.CylinderGeometry(0.02, 0.02, 0.66, 8),
        synthChassis: createBeveledBoxGeometry(0.84, 0.08, 0.32, 0.018),
        synthCheek: createBeveledBoxGeometry(0.04, 0.1, 0.34, 0.012),
        controlKnob: new THREE.CylinderGeometry(0.014, 0.018, 0.026, 10),
        synthDisplay: new THREE.BoxGeometry(0.12, 0.006, 0.055),
        synthStrip: new THREE.BoxGeometry(0.82, 0.022, 0.02),
        whiteKey: new THREE.BoxGeometry(0.072, 0.025, 0.18),
        blackKey: new THREE.BoxGeometry(0.044, 0.035, 0.11),
        // Melody
        saxBody: new THREE.CylinderGeometry(0.032, 0.058, 0.46, 12),
        saxBow: new THREE.TorusGeometry(0.075, 0.045, 10, 16, Math.PI),
        saxBell: new THREE.LatheGeometry(
            [
                new THREE.Vector2(0.03, -0.12),
                new THREE.Vector2(0.04, -0.05),
                new THREE.Vector2(0.06, 0.045),
                new THREE.Vector2(0.095, 0.1),
                new THREE.Vector2(0.13, 0.12),
                new THREE.Vector2(0.132, 0.125),
            ],
            24,
        ),
        saxNeck: new THREE.CylinderGeometry(0.016, 0.026, 0.18, 8),
        saxKey: new THREE.CylinderGeometry(0.015, 0.015, 0.012, 8),
        // Strings
        celloBody: createInstrumentBodyGeometry('cello'),
        upperBout: new THREE.CylinderGeometry(0.16, 0.19, 0.08, 16),
        lowerBout: new THREE.CylinderGeometry(0.22, 0.21, 0.085, 16),
        fingerboard: new THREE.BoxGeometry(0.045, 0.56, 0.03),
        endpin: new THREE.CylinderGeometry(0.01, 0.01, 0.28, 6),
        bowRod: new THREE.CylinderGeometry(0.008, 0.01, 0.52, 6),
        celloBridge: createBeveledBoxGeometry(0.075, 0.045, 0.018, 0.008),
        // Vocals
        micBase: new THREE.CylinderGeometry(0.16, 0.18, 0.03, 16),
        micPole: new THREE.CylinderGeometry(0.016, 0.016, 0.96, 8),
        shockRing: new THREE.TorusGeometry(0.075, 0.01, 8, 16),
        micBody: new THREE.CylinderGeometry(0.036, 0.036, 0.14, 12),
        micGrille: new THREE.SphereGeometry(0.042, 12, 12),
        popRim: new THREE.TorusGeometry(0.085, 0.008, 8, 18),
        popScreen: new THREE.CircleGeometry(0.082, 16),
    };
    // Fine strings and frets stay a single geometry per instrument.
    const stringPositions = [],
        fretPositions = [],
        celloStrings = [];
    for (let i = 0; i < 4; i++) {
        const offset = (i - 1.5) * 0.012;
        stringPositions.push(-0.16, 0.025 + offset, 0.044, 0.58, 0.025 + offset, 0.044);
        celloStrings.push(offset, -0.29, 0.068, offset, 0.53, 0.068);
    }
    for (let i = 1; i < 12; i++) {
        const x = 0.06 + (0.44 * (1 - Math.pow(0.94, i))) / (1 - Math.pow(0.94, 12));
        fretPositions.push(x, -0.003, 0.019, x, 0.059, 0.019);
    }
    sharedPerformerGeometries.bassStrings = new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.Float32BufferAttribute(stringPositions, 3),
    );
    sharedPerformerGeometries.bassFrets = new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.Float32BufferAttribute(fretPositions, 3),
    );
    sharedPerformerGeometries.celloStrings = new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.Float32BufferAttribute(celloStrings, 3),
    );
    sharedStudioMaterials.instrumentWire = new THREE.LineBasicMaterial({
        color: 0xd9cfb4,
        transparent: true,
        opacity: 0.8,
    });
    // r128 expects linear material colors when the renderer outputs sRGB.
    // Decode the palette once so charcoal stays charcoal under the concert rig.
    Object.values(sharedStudioMaterials).forEach(material => {
        if (material.color) material.color.convertSRGBToLinear();
        if (material.emissive) material.emissive.convertSRGBToLinear();
        if ('envMapIntensity' in material) material.envMapIntensity = 0.32;
    });
    Object.values(sharedCategoryMaterials).forEach(palette =>
        Object.values(palette).forEach(material => {
            material.color.convertSRGBToLinear();
            if (material.emissive) material.emissive.convertSRGBToLinear();
            if ('envMapIntensity' in material) material.envMapIntensity = 0.32;
        }),
    );
}

function initThreeStage() {
    const container = document.getElementById('canvas-container');
    const viewport = getStageViewport();
    scene = new THREE.Scene();
    scene.background = stageColor(0x141a16);
    scene.fog = new THREE.FogExp2(stageColor(0x141a16), 0.009);

    camera = new THREE.PerspectiveCamera(40, viewport.width / viewport.height, 0.1, 120);
    frameStageViewport(viewport);
    camera.position.set(0, 7.4, 12.8);
    camera.position.multiplyScalar(stageFraming(camera.aspect));
    cameraTargetPos.copy(camera.position);

    renderer = new THREE.WebGLRenderer({ antialias: !compactStageDevice, powerPreference: 'high-performance' });
    renderer.setSize(viewport.width, viewport.height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, compactStageDevice ? 1.5 : 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.94;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    scene.environment = createProceduralConcertEnvironment(renderer);
    initSharedMaterials();

    // OrbitControls centered on (0, 0.5, 0)
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.minPolarAngle = 0.18;
    controls.minDistance = 6.0;
    controls.maxDistance = 85.0;
    controls.target.set(0, 0.5, 0);
    controls.addEventListener('start', () => {
        isTransitioningCamera = false;
    });

    raycaster = new THREE.Raycaster();
    mouseNDC = new THREE.Vector2();
    // ---------------- GRAND 360° CIRCULAR STAGE DECK (DYNAMICALLY SCALES UP TO 100 STAGES) ----------------
    // Deep Midnight Surrounding Arena Floor
    const subFloor = new THREE.Mesh(
        new THREE.CircleGeometry(95, 64),
        new THREE.MeshStandardMaterial({
            color: stageColor(0x0c100e),
            roughness: 0.97,
            metalness: 0.02,
            envMapIntensity: 0.12,
        }),
    );
    subFloor.rotation.x = -Math.PI / 2;
    subFloor.position.y = -0.32;
    subFloor.receiveShadow = true;
    stageThemeSurfaces.floor = subFloor.material;
    scene.add(subFloor);

    // Main Grand Circular Stage Platform (Base Radius = 11.4, scales smoothly as tiers 3..7 unlock)
    mainArenaDeckMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(11.4, 11.7, 0.28, 96),
        sharedStudioMaterials.obsidianDeck,
    );
    mainArenaDeckMesh.position.set(0, -0.18, 0);
    mainArenaDeckMesh.receiveShadow = true;
    scene.add(mainArenaDeckMesh);

    // Outer Brushed Brass Perimeter Ring (Encloses all active stage rings!)
    outerBrassRimMesh = new THREE.Mesh(new THREE.TorusGeometry(11.45, 0.08, 16, 128), sharedStudioMaterials.stageTrim);
    outerBrassRimMesh.rotation.x = Math.PI / 2;
    outerBrassRimMesh.position.set(0, -0.04, 0);
    scene.add(outerBrassRimMesh);

    // Inner 6-Stage Platform Riser (Tier 1, Radius = 6.0)
    const innerStageDeck = new THREE.Mesh(
        new THREE.CylinderGeometry(5.9, 6.05, 0.1, 72),
        new THREE.MeshStandardMaterial({
            color: stageColor(0x262d27),
            map: sharedStudioMaterials.obsidianDeck.map,
            roughness: 0.84,
            metalness: 0.06,
            envMapIntensity: 0.16,
        }),
    );
    innerStageDeck.position.set(0, -0.03, 0);
    innerStageDeck.receiveShadow = true;
    stageThemeSurfaces.inner = innerStageDeck.material;
    scene.add(innerStageDeck);

    const innerBrassRim = new THREE.Mesh(new THREE.TorusGeometry(5.95, 0.045, 16, 96), sharedStudioMaterials.stageTrim);
    innerBrassRim.rotation.x = Math.PI / 2;
    innerBrassRim.position.set(0, 0.02, 0);
    scene.add(innerBrassRim);

    // Stepped Concentric Amphitheater Risers for Tiers 2..7 (Elevate smoothly as capacity expands up to 100!)
    const riserRingMat = new THREE.MeshStandardMaterial({
        color: stageColor(0x252b25),
        map: sharedStudioMaterials.obsidianDeck.map,
        roughness: 0.86,
        metalness: 0.06,
        envMapIntensity: 0.16,
        side: THREE.DoubleSide,
    });
    stageThemeSurfaces.riser = riserRingMat;

    STAGE_TIERS.slice(1).forEach(tCfg => {
        const rGroup = new THREE.Group();
        rGroup.position.set(0, -4.5, 0);

        const ringSurface = new THREE.Mesh(new THREE.RingGeometry(tCfg.innerR, tCfg.outerR, 80), riserRingMat);
        ringSurface.rotation.x = -Math.PI / 2;
        ringSurface.position.y = tCfg.elev - 0.04;
        ringSurface.receiveShadow = true;
        rGroup.add(ringSurface);

        const innerTrim = new THREE.Mesh(
            new THREE.TorusGeometry(tCfg.innerR + 0.02, 0.038, 10, 80),
            sharedStudioMaterials.stageTrim,
        );
        innerTrim.rotation.x = Math.PI / 2;
        innerTrim.position.y = tCfg.elev - 0.03;
        rGroup.add(innerTrim);

        const outerTrim = new THREE.Mesh(
            new THREE.TorusGeometry(tCfg.outerR, 0.042, 10, 80),
            sharedStudioMaterials.stageTrim,
        );
        outerTrim.rotation.x = Math.PI / 2;
        outerTrim.position.y = tCfg.elev - 0.03;
        rGroup.add(outerTrim);

        rGroup.userData = { tierConfig: tCfg };
        scene.add(rGroup);
        tierRiserGroups.push(rGroup);
    });

    // ---------------- 64 RADIAL AUDIO-REACTIVE FLOOR EQ BARS ----------------
    const eqBarGeo = new THREE.BoxGeometry(0.1, 0.04, 0.42);
    floorEQInstancedMesh = new THREE.InstancedMesh(eqBarGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), 64);
    floorEQInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < 64; i++) {
        const angle = (i / 64) * Math.PI * 2;
        const r = 6.38;
        floorEQBars.push({ angle, radius: r, value: 0.04 });
        _tempDummy.position.set(Math.sin(angle) * r, 0.01, Math.cos(angle) * r);
        _tempDummy.rotation.set(0, angle, 0);
        _tempDummy.scale.set(1, 1, 1);
        _tempDummy.updateMatrix();
        floorEQInstancedMesh.setMatrixAt(i, _tempDummy.matrix);
        const category = Object.keys(CATEGORY_META)[Math.floor((i / 64) * 6)];
        floorEQInstancedMesh.setColorAt(i, _tempColor.copy(stageColor(CATEGORY_META[category].hex)));
    }
    scene.add(floorEQInstancedMesh);

    // Recessed radial seams and footlights give the room a deliberate architectural scale.
    const seamVertices = [];
    for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        seamVertices.push(Math.sin(a) * 1.5, 0.027, Math.cos(a) * 1.5, Math.sin(a) * 5.84, 0.027, Math.cos(a) * 5.84);
    }
    const seamMaterial = new THREE.LineBasicMaterial({ color: 0x687269, transparent: true, opacity: 0.18 });
    stageThemeSurfaces.seam = seamMaterial;
    scene.add(
        new THREE.LineSegments(
            new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(seamVertices, 3)),
            seamMaterial,
        ),
    );

    // ---------------- CENTRAL HARMONIC GYROSCOPE CORE AT (0, 0, 0) ----------------
    centerCoreGroup = new THREE.Group();
    centerCoreGroup.position.set(0, 0.02, 0);

    const coreBase = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.35, 0.14, 36), sharedStudioMaterials.matteBlack);
    centerCoreGroup.add(coreBase);

    const coreBrassRing = new THREE.Mesh(new THREE.TorusGeometry(1.22, 0.035, 12, 48), sharedStudioMaterials.stageTrim);
    coreBrassRing.rotation.x = Math.PI / 2;
    coreBrassRing.position.y = 0.06;
    centerCoreGroup.add(coreBrassRing);

    const crystalMat = new THREE.MeshStandardMaterial({
        color: stageColor(0xe0b448),
        emissive: stageColor(0x9a6a14),
        emissiveIntensity: 0.18,
        envMapIntensity: 0.32,
        metalness: 0.7,
        roughness: 0.15,
    });
    const crystalMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1), crystalMat);
    crystalMesh.position.y = 0.9;
    centerCoreGroup.add(crystalMesh);

    const gyroRing1 = new THREE.Mesh(
        new THREE.TorusGeometry(0.58, 0.02, 12, 48),
        new THREE.MeshStandardMaterial({
            color: stageColor(0xd9dce1),
            roughness: 0.4,
            metalness: 0.3,
            envMapIntensity: 0.3,
        }),
    );
    gyroRing1.position.y = 0.9;
    gyroRing1.rotation.x = 0.75;
    centerCoreGroup.add(gyroRing1);

    const gyroRing2 = new THREE.Mesh(
        new THREE.TorusGeometry(0.74, 0.018, 12, 48),
        new THREE.MeshStandardMaterial({
            color: stageColor(0x3b82f6),
            roughness: 0.4,
            metalness: 0.3,
            envMapIntensity: 0.3,
        }),
    );
    gyroRing2.position.y = 0.9;
    gyroRing2.rotation.x = -0.6;
    centerCoreGroup.add(gyroRing2);

    centerCoreGroup.userData = { crystalMesh, gyroRing1, gyroRing2 };
    scene.add(centerCoreGroup);

    // Shared truss and lens hardware keeps the eight light towers inexpensive.
    const trussRailGeometry = new THREE.CylinderGeometry(0.025, 0.025, 6.2, 8);
    const trussBraceGeometry = new THREE.CylinderGeometry(0.012, 0.012, 0.57, 6);
    const fixtureGeometry = createBeveledBoxGeometry(0.36, 0.26, 0.38, 0.045);
    const lensGeometry = new THREE.CircleGeometry(0.105, 16);
    const beamTexture = createStageTexture('beam');
    for (let t = 0; t < 8; t++) {
        const tAngle = (t / 8) * Math.PI * 2 + Math.PI / 8;
        const tRadius = 12.6;
        const tx = Math.sin(tAngle) * tRadius;
        const tz = Math.cos(tAngle) * tRadius;

        const towerGroup = new THREE.Group();
        towerGroup.position.set(tx, -0.2, tz);
        towerGroup.rotation.y = tAngle + Math.PI;

        const truss = new THREE.InstancedMesh(trussRailGeometry, sharedStudioMaterials.brushedAluminum, 3);
        for (let rail = 0; rail < 3; rail++) {
            const a = (rail / 3) * Math.PI * 2;
            _tempDummy.position.set(Math.sin(a) * 0.14, 3.1, Math.cos(a) * 0.14);
            _tempDummy.rotation.set(0, 0, 0);
            _tempDummy.scale.setScalar(1);
            _tempDummy.updateMatrix();
            truss.setMatrixAt(rail, _tempDummy.matrix);
        }
        towerGroup.add(truss);
        const braces = new THREE.InstancedMesh(trussBraceGeometry, sharedStudioMaterials.brushedAluminum, 10);
        for (let brace = 0; brace < 10; brace++) {
            _tempDummy.position.set(0, 0.35 + brace * 0.59, 0.08);
            _tempDummy.rotation.set(0, 0, brace % 2 ? -0.48 : 0.48);
            _tempDummy.updateMatrix();
            braces.setMatrixAt(brace, _tempDummy.matrix);
        }
        towerGroup.add(braces);

        // Each tower repeats one instrument color.
        const stripMat = new THREE.MeshBasicMaterial({
            color: stageColor(CATEGORY_META[Object.keys(CATEGORY_META)[t % 6]].hex),
        });
        const ledStrip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 5.2, 0.04), stripMat);
        ledStrip.position.set(0, 3.1, 0.14);
        towerGroup.add(ledStrip);

        const fixture = new THREE.Mesh(fixtureGeometry, sharedStudioMaterials.matteBlack);
        fixture.position.set(0, 6.18, 0.18);
        fixture.rotation.x = -0.58;
        towerGroup.add(fixture);
        const lens = new THREE.Mesh(lensGeometry, stripMat);
        lens.position.set(0, 6.28, 0.35);
        lens.rotation.x = -0.58;
        towerGroup.add(lens);

        const beamMat = new THREE.MeshBasicMaterial({
            color: stageColor(CATEGORY_META[Object.keys(CATEGORY_META)[t % 6]].hex),
            map: beamTexture,
            transparent: true,
            opacity: 0.045,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });
        const beamCone = new THREE.Mesh(new THREE.ConeGeometry(2.4, 7.5, 24, 1, true), beamMat);
        beamCone.position.set(0, 3.2, 2.2);
        beamCone.rotation.x = -0.58;
        beamCone.visible = !compactStageDevice && !stageMotionPreference.matches;
        towerGroup.add(beamCone);

        scene.add(towerGroup);
        lightPillars.push({ towerGroup, beamCone, stripMat, baseAngle: tAngle });
    }

    // ---------------- FLOATING STAGE BOKEH DUST PARTICLES ----------------
    const particleCount = compactStageDevice ? 60 : 140;
    const pGeo = new THREE.BufferGeometry();
    const pPositions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
        const r = 1.5 + Math.random() * 11.5;
        const theta = Math.random() * Math.PI * 2;
        pPositions[i * 3] = Math.cos(theta) * r;
        pPositions[i * 3 + 1] = 0.3 + Math.random() * 6.5;
        pPositions[i * 3 + 2] = Math.sin(theta) * r;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
    const pMat = new THREE.PointsMaterial({
        color: 0xd9ccad,
        map: createStageTexture('glow'),
        size: 0.055,
        transparent: true,
        depthWrite: false,
        opacity: 0.22,
    });
    bokehParticles = new THREE.Points(pGeo, pMat);
    scene.add(bokehParticles);

    // ---------------- STUDIO LIGHTING RIG ----------------
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x141414, 0.36);
    hemiLight.position.set(0, 18, 0);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
    keyLight.position.set(8, 16, 12);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 45;
    const d = 14;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.035;
    scene.add(keyLight);

    const rimLightCyan = new THREE.DirectionalLight(0xa3b6ff, 0.24);
    rimLightCyan.position.set(-14, 8, -10);
    scene.add(rimLightCyan);

    const rimLightRose = new THREE.DirectionalLight(0xffabc8, 0.22);
    rimLightRose.position.set(14, 7, -10);
    scene.add(rimLightRose);
    Object.assign(stageThemeLights, { hemi: hemiLight, key: keyLight, left: rimLightCyan, right: rimLightRose });

    // ---------------- LAZY-BUILT CONCENTRIC PEDESTALS (UP TO 100 STAGES) ----------------
    sharedPedestalGeometries = {
        baseCyl: new THREE.CylinderGeometry(0.95, 1.05, 0.28, 32),
        brassCollar: new THREE.TorusGeometry(0.98, 0.022, 8, 24),
        topPad: new THREE.CylinderGeometry(0.88, 0.9, 0.04, 20),
        ringTorus: new THREE.TorusGeometry(0.91, 0.026, 8, 24),
        segBox: new THREE.BoxGeometry(0.08, 0.02, 0.035),
        waveRing: new THREE.RingGeometry(0.98, 1.12, 24),
        hitProxyCyl: new THREE.CylinderGeometry(1.0, 1.0, 1.85, 12),
        baseMat: new THREE.MeshStandardMaterial({
            color: stageColor(0x303731),
            roughness: 0.66,
            metalness: 0.28,
            envMapIntensity: 0.25,
        }),
    };

    // Single InstancedMesh for all 100 * 16 = 1,600 circular step LEDs (1 draw call total!)
    const ledInstMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    stepLedsInstancedMesh = new THREE.InstancedMesh(sharedPedestalGeometries.segBox, ledInstMat, MAX_SLOTS * 16);
    stepLedsInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const defaultLedColor = new THREE.Color(0x161f33);
    for (let i = 0; i < MAX_SLOTS * 16; i++) {
        _tempDummy.position.set(0, -10, 0);
        _tempDummy.updateMatrix();
        stepLedsInstancedMesh.setMatrixAt(i, _tempDummy.matrix);
        stepLedsInstancedMesh.setColorAt(i, defaultLedColor);
    }
    stepLedsInstancedMesh.instanceMatrix.needsUpdate = true;
    if (stepLedsInstancedMesh.instanceColor) stepLedsInstancedMesh.instanceColor.needsUpdate = true;
    scene.add(stepLedsInstancedMesh);

    initPedestalHUDLayer();
    ensurePedestalsUpTo(12);

    window.addEventListener('pointermove', onStagePointerMove);
    renderer.domElement.addEventListener('pointerdown', onStagePointerDown);
    window.addEventListener('pointerup', onStagePointerUp);
    window.addEventListener('pointercancel', () => finishPlayerDrag(false));
    window.addEventListener('resize', onWindowResize);
    const viewportObserver = new ResizeObserver(onWindowResize);
    viewportObserver.observe(container);
    viewportObserver.observe(document.getElementById('pedestal-hud-layer'));
    onWindowResize();
}

function updatePedestalInstancedLEDPositions(idx, pedY) {
    if (!stepLedsInstancedMesh) return;
    const ped = pedestalMeshes[idx];
    if (!ped) return;
    const basePos = ped.rootGroup.position;
    const pScale = ped.baseScale;
    const rotY = ped.rootGroup.rotation.y;

    for (let s = 0; s < 16; s++) {
        const instanceIdx = idx * 16 + s;
        if (pedY <= -4.0) {
            _tempDummy.position.set(0, -10, 0);
            _tempDummy.scale.set(0.001, 0.001, 0.001);
        } else {
            const sAngle = (s / 16) * Math.PI * 2 + rotY;
            const r = 1.02 * pScale;
            _tempDummy.position.set(
                basePos.x + Math.sin(sAngle) * r,
                pedY + 0.065 * pScale,
                basePos.z + Math.cos(sAngle) * r,
            );
            _tempDummy.rotation.set(0, sAngle, 0);
            _tempDummy.scale.set(pScale, pScale, pScale);
        }
        _tempDummy.updateMatrix();
        stepLedsInstancedMesh.setMatrixAt(instanceIdx, _tempDummy.matrix);
    }
    stepLedsInstancedMesh.instanceMatrix.needsUpdate = true;
}

function updateAllInstancedLEDColors() {
    if (!stepLedsInstancedMesh) return;
    const curStep = stageState.step;
    for (let idx = 0; idx < pedestalMeshes.length; idx++) {
        const slot = stageState.slots[idx];
        const audible = idx < stageState.unlockedSlots && slot.preset && isSlotAudible(slot, stageState.slots);
        const catHex = audible ? CATEGORY_META[slot.preset.category].hex : 0x161f33;
        const stepsArr = audible ? getSlotSteps(slot) : null;

        for (let s = 0; s < 16; s++) {
            const instanceIdx = idx * 16 + s;
            if (!audible) {
                _tempColor.setHex(0x161f33);
            } else if (s === curStep) {
                _tempColor.setHex(0xffffff);
            } else if (stepsArr && stepsArr[s] !== null && stepsArr[s] !== undefined) {
                _tempColor.setHex(catHex);
            } else {
                _tempColor.setHex(0x161f33);
            }
            stepLedsInstancedMesh.setColorAt(instanceIdx, _tempColor);
        }
    }
    if (stepLedsInstancedMesh.instanceColor) {
        stepLedsInstancedMesh.instanceColor.needsUpdate = true;
    }
}

function createPedestalAtSlot(idx) {
    if (pedestalMeshes[idx]) return pedestalMeshes[idx];
    const tCfg = getSlotTierConfig(idx);
    const ringIdx = idx - tCfg.start;
    const angle = ringIdx * ((Math.PI * 2) / tCfg.count) + tCfg.angleOffset;
    const radius = tCfg.radius;

    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    const initialY = idx < 6 ? tCfg.elev : -4.5;

    const rootGroup = new THREE.Group();
    rootGroup.position.set(x, initialY, z);
    // Slightly scale down outer stadium pedestals so 20-pedestal rings have generous breathing room
    const pScale = tCfg.tier <= 2 ? 1.0 : tCfg.tier <= 4 ? 0.9 : 0.82;
    rootGroup.scale.set(pScale, pScale, pScale);
    rootGroup.rotation.y = Math.atan2(-x, -z + 12.0) * 0.55;
    rootGroup.userData = { slotIndex: idx };

    const baseCyl = new THREE.Mesh(sharedPedestalGeometries.baseCyl, sharedPedestalGeometries.baseMat);
    baseCyl.position.y = -0.08;
    baseCyl.castShadow = idx < 12;
    baseCyl.receiveShadow = idx < 24;
    baseCyl.userData = { slotIndex: idx };
    rootGroup.add(baseCyl);

    const brassCollar = new THREE.Mesh(sharedPedestalGeometries.brassCollar, sharedStudioMaterials.stageTrim);
    brassCollar.rotation.x = Math.PI / 2;
    brassCollar.position.y = 0.02;
    rootGroup.add(brassCollar);

    const topPad = new THREE.Mesh(sharedPedestalGeometries.topPad, sharedStudioMaterials.matteBlack);
    topPad.position.y = 0.07;
    topPad.receiveShadow = idx < 24;
    topPad.userData = { slotIndex: idx };
    rootGroup.add(topPad);

    const ringMesh = new THREE.Mesh(sharedPedestalGeometries.ringTorus, sharedStudioMaterials.inactiveRing);
    ringMesh.rotation.x = Math.PI / 2;
    ringMesh.position.y = 0.075;
    rootGroup.add(ringMesh);

    // Fast raycast hit proxy cylinder (avoids raycasting 4,500 child instrument meshes!)
    const hitProxy = new THREE.Mesh(sharedPedestalGeometries.hitProxyCyl, sharedStudioMaterials.hitProxyMat);
    hitProxy.position.y = 0.75;
    hitProxy.userData = { slotIndex: idx };
    rootGroup.add(hitProxy);
    pedestalHitProxies[idx] = hitProxy;

    const waveMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.0,
    });
    const waveMesh = new THREE.Mesh(sharedPedestalGeometries.waveRing, waveMat);
    waveMesh.rotation.x = -Math.PI / 2;
    waveMesh.position.y = 0.06;
    rootGroup.add(waveMesh);

    const performerGroup = new THREE.Group();
    performerGroup.position.y = 0.09;
    rootGroup.add(performerGroup);

    scene.add(rootGroup);

    const pedObj = {
        index: idx,
        tierConfig: tCfg,
        baseScale: pScale,
        lastInstancedY: -999,
        rootGroup,
        baseCyl,
        topPad,
        ringMesh,
        waveMesh,
        performerGroup,
        rig: null,
        departingPerformers: [],
    };
    pedestalMeshes[idx] = pedObj;
    updatePedestalInstancedLEDPositions(idx, initialY);
    createPedestalHUDBadge(idx);
    rebuildPedestalPerformer(idx);
    return pedObj;
}

function ensurePedestalsUpTo(targetCount) {
    if (!scene || !sharedPedestalGeometries) return;
    const limit = Math.min(MAX_SLOTS, targetCount);
    for (let i = 0; i < limit; i++) {
        if (!pedestalMeshes[i]) {
            createPedestalAtSlot(i);
        }
    }
    // Dynamically tune WebGL pixelRatio in massive 40..100 stage modes to guarantee 60fps
    if (renderer) {
        const maxPR = limit > 24 ? 1.0 : Math.min(window.devicePixelRatio, compactStageDevice ? 1.5 : 2);
        if (renderer.getPixelRatio() !== maxPR) {
            renderer.setPixelRatio(maxPR);
        }
    }
}

function tagHierarchyWithSlot(obj, slotIndex) {
    const enableShadow = slotIndex < 12;
    obj.traverse(child => {
        if (child.isMesh) {
            child.userData.slotIndex = slotIndex;
            child.castShadow = enableShadow;
            child.receiveShadow = enableShadow;
        }
    });
}
