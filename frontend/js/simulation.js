const FOOTFALL_CLUSTERS = [
  // Food court — heaviest cluster (near Brewpoint, Golden Fork, Mesa, Lotus)
  { zone: "Z7", center: {x: 0, z: 20}, count: 18, radius: 15 },
  // Jewelry perimeter — near Aurel and Karat
  { zone: "Z6", center: {x: -20, z: 5}, count: 10, radius: 10 },
  // Electronics — near Apex Tech and Circuit World
  { zone: "Z5", center: {x: -30, z: -35}, count: 8, radius: 10 },
  // West wing fashion — general browsing
  { zone: "Z2", center: {x: -35, z: -25}, count: 7, radius: 12 },
  // North entrance — arriving shoppers
  { zone: "Z1", center: {x: 0, z: -38}, count: 5, radius: 8 },
  // South center — passing through
  { zone: "Z4", center: {x: 10, z: 28}, count: 6, radius: 10 },
  // Near outdoor screens north — people outside arriving
  { zone: "exterior_north", center: {x: 0, z: -48}, count: 4, radius: 6 },
];

const ZONE_SCREEN_MAP = {
  "Z7": ["AD-FL2-SW", "AD-FL2-SE"],
  "Z6": ["AD-FL2-NE", "AD-FL2-SE"],
  "Z5": ["AD-FL2-NW", "AD-FL2-SW"],
  "Z2": ["AD-ENT-N1", "AD-FL2-NW"],
  "Z3": ["AD-ENT-N2", "AD-FL2-NE", "AD-CIN-01", "AD-CIN-02", "AD-PRK-NEW"],
  "Z4": ["AD-ENT-S1", "AD-ENT-S2"],
  "Z1": ["AD-ENT-N1", "AD-ENT-N2"],
  "Z8": ["AD-FL2-NW", "AD-FL2-NE"],
  "cinema": ["AD-PRK-NEW"],
};
window.ZONE_SCREEN_MAP = ZONE_SCREEN_MAP;

class PulseMallSimulation {
    constructor() {
        this.canvas = document.getElementById("pulseCanvas");
        this.engine = new BABYLON.Engine(this.canvas, true, { adaptiveDeviceRatio: true });
        this.scene = new BABYLON.Scene(this.engine);
        this.scene.clearColor = new BABYLON.Color4(0.04, 0.06, 0.10, 1.0);
        
        this.stores = {};
        this.adScreens = {};
        this.shoppers = [];
        this.cars = [];
        this.streetlights = [];
        const utc = new Date().getTime() + new Date().getTimezoneOffset() * 60000;
        const dallasDate = new Date(utc + (3600000 * -5)); // UTC-5 for Dallas (Central Daylight Time)
        this.timeOfDay = dallasDate.getHours() + dallasDate.getMinutes() / 60.0;
        this.heatmapVisible = true;
        this.highlightLayer = new BABYLON.HighlightLayer("hl1", this.scene);
        
        this.approvalRings = {};
        this.approvalTexts = {};
        this.approvalIntervals = {};
        this.adCycleInterval = null;
        this.activeCampaignCreatives = [];
        this.adCycleIndex = 0;
        
        this.defaultCameraSettings = {
            alpha: -Math.PI / 2,
            beta: Math.PI / 3.5,
            radius: 170, // Increased radius for bigger mall
            target: new BABYLON.Vector3(0, 4, 0)
        };
        
        this.init();
    }

    async init() {
        this.showLoadingBar();
        this.setupPhysicsAndCamera();
        this.setupLighting();
        
        // Fetch configs with cache-busters to prevent browser caching
        const layoutRes = await fetch(`/assets/mall_layout.json?cb=${Date.now()}`);
        this.layout = await layoutRes.json();
        
        const tenantRes = await fetch(`/assets/tenants.json?cb=${Date.now()}`);
        this.tenants = await tenantRes.json();
        
        this.buildMallGeometry();
        this.buildCityEnvironment();
        this.buildStores();

        // Build tenant color map for screen rendering
        this.tenantColorMap = {};
        if (this.tenants && Array.isArray(this.tenants)) {
            this.tenants.forEach(t => {
                this.tenantColorMap[t.id] = {
                    name: t.name,
                    initials: t.brand_initials || t.name.substring(0,2).toUpperCase(),
                    primary: (t.brand_colors && t.brand_colors.primary) || '#1E2A38',
                    secondary: (t.brand_colors && t.brand_colors.secondary) || '#00E5FF',
                    category: t.category || 'RETAIL'
                };
            });
            console.log('[PULSE] tenantColorMap built:', Object.keys(this.tenantColorMap).length, 'tenants');
        } else {
            console.warn('[PULSE] tenants not loaded for colorMap');
        }

        this.buildAdScreens();
        
        // ── BUILD PARKING SCREEN FROM SCRATCH ──
        this._buildParkingScreen();
        
        this.buildCinema();
        this.buildHeatmapPlanes();
        this.spawnShoppers();
        this.spawnCars();
        this.connectWebSocket();

        // Let left-click on any store box target and focus the camera on it
        this.scene.onPointerDown = (evt, pickResult) => {
            if (pickResult.hit && pickResult.pickedMesh) {
                let name = pickResult.pickedMesh.name;
                // If clicked a child mesh (like glass facade or sign), get the parent
                if (pickResult.pickedMesh.parent && pickResult.pickedMesh.parent.name.startsWith("storeBox_")) {
                    name = pickResult.pickedMesh.parent.name;
                }
                if (name.startsWith("storeBox_")) {
                    const storeId = name.split("_")[1];
                    this.focusStore(storeId);
                }
            }
        };

        this.engine.runRenderLoop(() => {
            const dt = this.engine.getDeltaTime() / 1000.0;
            if (!this.isPausedForApproval) {
                this.updateShoppers();
                this.updateCars(dt);
                this.updateTimeOfDay(dt);
            }
            this.animateAdScreens();
            this.scene.render();
        });

        window.addEventListener("resize", () => this.engine.resize());
        this.hideLoadingBar();
        
        // Expose public API
        window.pulseSimulation = this;
        window.dispatchEvent(new CustomEvent("simulationReady"));
    }

    showLoadingBar() {
        const loader = document.createElement("div");
        loader.id = "sim-loader";
        loader.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;background:#080C10;display:flex;justify-content:center;align-items:center;z-index:99;font-family:'Rajdhani',sans-serif;color:#00E5FF;font-size:24px;letter-spacing:2px;";
        loader.innerHTML = `<div>LOADING PULSE 3D SIMULATOR<div style="width:120px;height:4px;background:#1E2A38;margin:10px auto;position:relative;overflow:hidden;"><div style="position:absolute;width:40px;height:100%;background:#00E5FF;animation:load-slide 1.5s infinite linear;"></div></div></div>`;
        
        const style = document.createElement("style");
        style.innerHTML = `@keyframes load-slide { 0% { left: -40px; } 100% { left: 120px; } }`;
        document.head.appendChild(style);
        this.canvas.parentNode.appendChild(loader);
    }

    hideLoadingBar() {
        const loader = document.getElementById("sim-loader");
        if (loader) loader.parentNode.removeChild(loader);
    }

    setupPhysicsAndCamera() {
        this.scene.gravity = new BABYLON.Vector3(0, -9.81, 0);
        
        this.camera = new BABYLON.ArcRotateCamera(
            "mallCam",
            this.defaultCameraSettings.alpha,
            this.defaultCameraSettings.beta,
            this.defaultCameraSettings.radius,
            this.defaultCameraSettings.target,
            this.scene
        );
        this.camera.attachControl(this.canvas, true);
        
        // Enable right-click drag camera panning
        this.camera.panningSensibility = 1000;
        this.camera.useInputToRegisterPreventDefault = false;
        
        this.camera.lowerRadiusLimit = 20;
        this.camera.upperRadiusLimit = 250;
        this.camera.lowerBetaLimit = 0.1;
        this.camera.upperBetaLimit = Math.PI / 2.1;
    }

    setupLighting() {
        this.ambientLight = new BABYLON.HemisphericLight("ambient", new BABYLON.Vector3(0, 1, 0), this.scene);
        this.ambientLight.intensity = 0.8;
        this.ambientLight.groundColor = new BABYLON.Color3(0.85, 0.85, 0.85);
        
        // corner point lights (warm golden ambient glow)
        const corners = [
            { x: -50, z: -35 }, { x: 50, z: -35 },
            { x: -50, z: 35 }, { x: 50, z: 35 }
        ];
        corners.forEach((c, idx) => {
            const pl = new BABYLON.PointLight(`atriumCorner_${idx}`, new BABYLON.Vector3(c.x, 8, c.z), this.scene);
            pl.intensity = 0.4;
            pl.diffuse = new BABYLON.Color3(0.95, 0.8, 0.6);
            pl.range = 40;
        });

        // Food court spotlight
        const fcLight = new BABYLON.PointLight("foodCourtLight", new BABYLON.Vector3(0, 12, 25), this.scene);
        fcLight.intensity = 0.55;
        fcLight.diffuse = new BABYLON.Color3(1.0, 0.92, 0.8);
        fcLight.range = 45;
    }

    buildMallGeometry() {
        // Ground Floor (Scaled up from 120x80 to 140x100 for spaciousness)
        const groundMat = new BABYLON.StandardMaterial("groundMat", this.scene);
        groundMat.diffuseColor = new BABYLON.Color3(0.93, 0.88, 0.8);
        groundMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
        
        const ground = BABYLON.MeshBuilder.CreateBox("groundFloor", { width: 140, height: 0.5, depth: 100 }, this.scene);
        ground.position = new BABYLON.Vector3(0, -0.25, 0);
        ground.material = groundMat;
        ground.freezeWorldMatrix();
        
        // Upper floor strips (scaled up spacing)
        const upperMat = new BABYLON.StandardMaterial("upperMat", this.scene);
        upperMat.diffuseColor = new BABYLON.Color3(0.93, 0.88, 0.8);
        
        const northStrip = BABYLON.MeshBuilder.CreateBox("northStrip", { width: 140, height: 0.5, depth: 20 }, this.scene);
        northStrip.position = new BABYLON.Vector3(0, 10.25, -40);
        northStrip.material = upperMat;
        northStrip.freezeWorldMatrix();
        
        const westStrip = BABYLON.MeshBuilder.CreateBox("westStrip", { width: 18, height: 0.5, depth: 40 }, this.scene);
        westStrip.position = new BABYLON.Vector3(-61, 10.25, -10);
        westStrip.material = upperMat;
        westStrip.freezeWorldMatrix();

        const eastStrip = BABYLON.MeshBuilder.CreateBox("eastStrip", { width: 18, height: 0.5, depth: 40 }, this.scene);
        eastStrip.position = new BABYLON.Vector3(61, 10.25, -10);
        eastStrip.material = upperMat;
        eastStrip.freezeWorldMatrix();

        const southStrip = BABYLON.MeshBuilder.CreateBox("southStrip", { width: 140, height: 0.5, depth: 36 }, this.scene);
        southStrip.position = new BABYLON.Vector3(0, 10.25, 32);
        southStrip.material = upperMat;
        southStrip.freezeWorldMatrix();

        // Atrium glass railing (soft teal glass)
        const glassMat = new BABYLON.StandardMaterial("glassRailingMat", this.scene);
        glassMat.diffuseColor = new BABYLON.Color3(0.2, 0.7, 0.8);
        glassMat.alpha = 0.25;
        glassMat.specularColor = new BABYLON.Color3(0.9, 0.9, 0.9);
        
        const railingN = BABYLON.MeshBuilder.CreateBox("railingN", { width: 104, height: 1.2, depth: 0.2 }, this.scene);
        railingN.position = new BABYLON.Vector3(0, 11.1, -30);
        railingN.material = glassMat;
        railingN.freezeWorldMatrix();
        
        // Atrium Supporting Pillars (Warm oak columns)
        const pillarMat = new BABYLON.StandardMaterial("pillarMat", this.scene);
        pillarMat.diffuseColor = new BABYLON.Color3(0.85, 0.8, 0.72);
        
        const pillarPositions = [
            { x: -15, z: -30 }, { x: 15, z: -30 },
            { x: -60, z: -30 }, { x: 60, z: -30 },
            { x: -15, z: 14 }, { x: 15, z: 14 }
        ];
        
        pillarPositions.forEach((pos, idx) => {
            const pillar = BABYLON.MeshBuilder.CreateCylinder(`pillar_${idx}`, { height: 10.5, diameter: 0.6 }, this.scene);
            pillar.position = new BABYLON.Vector3(pos.x, 5.25, pos.z);
            pillar.material = pillarMat;
            pillar.freezeWorldMatrix();
        });
        
        // Proper Entrance Arches (North at Z=-50, South at Z=50)
        const archMat = new BABYLON.StandardMaterial("archMat", this.scene);
        archMat.diffuseColor = new BABYLON.Color3(0.8, 0.76, 0.7);
        
        const entrances = [
            { x: 0, z: -50, name: "NORTH ENTRANCE" },
            { x: 0, z: 50, name: "SOUTH ENTRANCE" }
        ];
        entrances.forEach(ent => {
            // Left pillar
            const lPill = BABYLON.MeshBuilder.CreateBox(`${ent.name}_lp`, { width: 1.5, height: 6.0, depth: 1.5 }, this.scene);
            lPill.position = new BABYLON.Vector3(ent.x - 8.0, 3.0, ent.z);
            lPill.material = archMat;
            lPill.freezeWorldMatrix();
            
            // Right pillar
            const rPill = BABYLON.MeshBuilder.CreateBox(`${ent.name}_rp`, { width: 1.5, height: 6.0, depth: 1.5 }, this.scene);
            rPill.position = new BABYLON.Vector3(ent.x + 8.0, 3.0, ent.z);
            rPill.material = archMat;
            rPill.freezeWorldMatrix();
            
            // Arch top beam
            const beam = BABYLON.MeshBuilder.CreateBox(`${ent.name}_beam`, { width: 17.5, height: 1.0, depth: 1.5 }, this.scene);
            beam.position = new BABYLON.Vector3(ent.x, 6.5, ent.z);
            beam.material = archMat;
            beam.freezeWorldMatrix();

            if (ent.name === "NORTH ENTRANCE") {
                // Large "MALL" entrance sign board
                const signBase = BABYLON.MeshBuilder.CreateBox("mallSign", { width: 16, height: 3, depth: 0.5 }, this.scene);
                signBase.position = new BABYLON.Vector3(ent.x, 8.5, ent.z);
                
                const signTex = new BABYLON.DynamicTexture("signTex", { width: 512, height: 128 }, this.scene);
                const signMat = new BABYLON.StandardMaterial("signMat", this.scene);
                signMat.diffuseTexture = signTex;
                signMat.emissiveTexture = signTex; // glowing self-lit text
                signBase.material = signMat;
                
                const ctx = signTex.getContext();
                ctx.fillStyle = "#111520";
                ctx.fillRect(0, 0, 512, 128);
                ctx.fillStyle = "#FFB800"; // Rich comfy golden yellow
                ctx.font = "bold 80px Outfit, Rajdhani, sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("MALL", 256, 64);
                signTex.update();
                signBase.freezeWorldMatrix();
            }
        });
        
        // Escalator structural ramps (realigned to corridor spacing X=±20 and Z=-20.91, connecting to North floor strip Z=-30)
        const escMat = new BABYLON.StandardMaterial("escMat", this.scene);
        escMat.diffuseColor = new BABYLON.Color3(0.16, 0.2, 0.28);
        
        // Depth 21.0 connecting Y=0 to Y=10.5 tilted at 30 degrees (Math.PI / 6)
        const escW = BABYLON.MeshBuilder.CreateBox("escW", { width: 3, height: 0.3, depth: 21 }, this.scene);
        escW.position = new BABYLON.Vector3(-20, 5.25, -20.91);
        escW.rotation.x = Math.PI / 6;
        escW.material = escMat;
        
        // Add side glass handrails to west escalator
        const railWL = BABYLON.MeshBuilder.CreateBox("railWL", { width: 0.1, height: 1.2, depth: 21 }, this.scene);
        railWL.position = new BABYLON.Vector3(-1.45, 0.6, 0);
        railWL.material = glassMat;
        railWL.parent = escW;
        
        const railWR = BABYLON.MeshBuilder.CreateBox("railWR", { width: 0.1, height: 1.2, depth: 21 }, this.scene);
        railWR.position = new BABYLON.Vector3(1.45, 0.6, 0);
        railWR.material = glassMat;
        railWR.parent = escW;

        escW.freezeWorldMatrix();

        const escE = BABYLON.MeshBuilder.CreateBox("escE", { width: 3, height: 0.3, depth: 21 }, this.scene);
        escE.position = new BABYLON.Vector3(20, 5.25, -20.91);
        escE.rotation.x = Math.PI / 6;
        escE.material = escMat;
        
        // Add side glass handrails to east escalator
        const railEL = BABYLON.MeshBuilder.CreateBox("railEL", { width: 0.1, height: 1.2, depth: 21 }, this.scene);
        railEL.position = new BABYLON.Vector3(-1.45, 0.6, 0);
        railEL.material = glassMat;
        railEL.parent = escE;
        
        const railER = BABYLON.MeshBuilder.CreateBox("railER", { width: 0.1, height: 1.2, depth: 21 }, this.scene);
        railER.position = new BABYLON.Vector3(1.45, 0.6, 0);
        railER.material = glassMat;
        railER.parent = escE;

        escE.freezeWorldMatrix();

        // Outer Transparent Glass Walls for the Mall (Tall modern atrium envelope)
        const outerGlassMat = new BABYLON.StandardMaterial("outerGlassMat", this.scene);
        outerGlassMat.diffuseColor = new BABYLON.Color3(0.65, 0.85, 0.95);
        outerGlassMat.alpha = 0.22; // very clear outer glass
        outerGlassMat.specularColor = new BABYLON.Color3(1.0, 1.0, 1.0);
        outerGlassMat.backFaceCulling = false; // Render both sides of the glass

        // West Wall (Enclosing second floor stores, height 17)
        const wallW = BABYLON.MeshBuilder.CreateBox("outerWallW", { width: 0.1, height: 17.0, depth: 100 }, this.scene);
        wallW.position = new BABYLON.Vector3(-70, 8.5, 0);
        wallW.material = outerGlassMat;
        wallW.freezeWorldMatrix();

        // East Wall (split to accommodate cinema block at Z = -25 to +25)
        const wallEN = BABYLON.MeshBuilder.CreateBox("outerWallEN", { width: 0.1, height: 17.0, depth: 25 }, this.scene);
        wallEN.position = new BABYLON.Vector3(70, 8.5, -37.5);
        wallEN.material = outerGlassMat;
        wallEN.freezeWorldMatrix();

        const wallES = BABYLON.MeshBuilder.CreateBox("outerWallES", { width: 0.1, height: 17.0, depth: 25 }, this.scene);
        wallES.position = new BABYLON.Vector3(70, 8.5, 37.5);
        wallES.material = outerGlassMat;
        wallES.freezeWorldMatrix();

        // North Walls (split for entrance)
        const wallNL = BABYLON.MeshBuilder.CreateBox("outerWallNL", { width: 62, height: 17.0, depth: 0.1 }, this.scene);
        wallNL.position = new BABYLON.Vector3(-39, 8.5, -50);
        wallNL.material = outerGlassMat;
        wallNL.freezeWorldMatrix();

        const wallNR = BABYLON.MeshBuilder.CreateBox("outerWallNR", { width: 62, height: 17.0, depth: 0.1 }, this.scene);
        wallNR.position = new BABYLON.Vector3(39, 8.5, -50);
        wallNR.material = outerGlassMat;
        wallNR.freezeWorldMatrix();

        // South Walls (split for entrance)
        const wallSL = BABYLON.MeshBuilder.CreateBox("outerWallSL", { width: 62, height: 17.0, depth: 0.1 }, this.scene);
        wallSL.position = new BABYLON.Vector3(-39, 8.5, 50);
        wallSL.material = outerGlassMat;
        wallSL.freezeWorldMatrix();

        const wallSR = BABYLON.MeshBuilder.CreateBox("outerWallSR", { width: 62, height: 17.0, depth: 0.1 }, this.scene);
        wallSR.position = new BABYLON.Vector3(39, 8.5, 50);
        wallSR.material = outerGlassMat;
        wallSR.freezeWorldMatrix();

        // Mall Roof Structure (Concrete borders with a large central glass skylight at Y = 17)
        const roofBorderMat = new BABYLON.StandardMaterial("roofBorderMat", this.scene);
        roofBorderMat.diffuseColor = new BABYLON.Color3(0.9, 0.86, 0.8); // Matches cream color palette

        // North border
        const rBorderN = BABYLON.MeshBuilder.CreateBox("rBorderN", { width: 140, height: 0.3, depth: 15 }, this.scene);
        rBorderN.position = new BABYLON.Vector3(0, 17.0, -42.5);
        rBorderN.material = roofBorderMat;
        rBorderN.freezeWorldMatrix();

        // South border
        const rBorderS = BABYLON.MeshBuilder.CreateBox("rBorderS", { width: 140, height: 0.3, depth: 15 }, this.scene);
        rBorderS.position = new BABYLON.Vector3(0, 17.0, 42.5);
        rBorderS.material = roofBorderMat;
        rBorderS.freezeWorldMatrix();

        // West border
        const rBorderW = BABYLON.MeshBuilder.CreateBox("rBorderW", { width: 15, height: 0.3, depth: 70 }, this.scene);
        rBorderW.position = new BABYLON.Vector3(-62.5, 17.0, 0);
        rBorderW.material = roofBorderMat;
        rBorderW.freezeWorldMatrix();

        // East border
        const rBorderE = BABYLON.MeshBuilder.CreateBox("rBorderE", { width: 15, height: 0.3, depth: 70 }, this.scene);
        rBorderE.position = new BABYLON.Vector3(62.5, 17.0, 0);
        rBorderE.material = roofBorderMat;
        rBorderE.freezeWorldMatrix();

        // Central Glass Skylight Roof panel
        const skylight = BABYLON.MeshBuilder.CreateBox("skylight", { width: 110, height: 0.1, depth: 70 }, this.scene);
        skylight.position = new BABYLON.Vector3(0, 17.1, 0);
        skylight.material = outerGlassMat;
        skylight.freezeWorldMatrix();
    }

    buildStores() {
        this.tenants.forEach(store => {
            const h = 4.0;
            const y = store.floor === 1 ? h/2 : 10.5 + (h/2);
            
            // Adjust store dimensions to make the mall feel much more spacious (scale down by 0.8)
            const w = store.size.w * 0.8;
            const d = store.size.d * 0.8;
            const wallThickness = 0.25;

            // Scale store coordinates dynamically by 1.15 to spread them out on the expanded floor size
            const storeX = store.position.x * 1.15;
            const storeZ = store.position.z * 1.15;

            // Determine storefront orientation based on location
            const isNorth = storeZ < 0;
            const isWest = storeX < -30;
            const isEast = storeX > 30;
            
            let rotationY = 0;
            if (isWest) rotationY = Math.PI / 2; // face east
            else if (isEast) rotationY = -Math.PI / 2; // face west
            else if (!isNorth) rotationY = Math.PI; // face north
            
            // Create separate wall components and merge them to construct a hollow room mesh
            const leftWall = BABYLON.MeshBuilder.CreateBox("lWall", { width: wallThickness, height: h, depth: d }, this.scene);
            leftWall.position = new BABYLON.Vector3(-w/2, 0, 0);
            
            const rightWall = BABYLON.MeshBuilder.CreateBox("rWall", { width: wallThickness, height: h, depth: d }, this.scene);
            rightWall.position = new BABYLON.Vector3(w/2, 0, 0);
            
            const backWall = BABYLON.MeshBuilder.CreateBox("bWall", { width: w, height: h, depth: wallThickness }, this.scene);
            backWall.position = new BABYLON.Vector3(0, 0, -d/2);
            
            const storeFloor = BABYLON.MeshBuilder.CreateBox("sFloor", { width: w, height: 0.05, depth: d }, this.scene);
            storeFloor.position = new BABYLON.Vector3(0, -h/2 + 0.025, 0);
            
            // Merge walls & floor into a single hollow room mesh
            const hollowRoom = BABYLON.Mesh.MergeMeshes([leftWall, rightWall, backWall, storeFloor], true, true, undefined, false, true);
            hollowRoom.name = `storeBox_${store.id}`;
            hollowRoom.position = new BABYLON.Vector3(storeX, y, storeZ);
            hollowRoom.rotation.y = rotationY;
            
            const mat = new BABYLON.StandardMaterial(`storeMat_${store.id}`, this.scene);
            mat.diffuseColor = new BABYLON.Color3(0.96, 0.95, 0.90); // Cream/Beige walls
            mat.emissiveColor = new BABYLON.Color3(0.05, 0.05, 0.05); // Comfy faint backlight glow
            hollowRoom.material = mat;

            // Build Glass storefront facade
            const glass = BABYLON.MeshBuilder.CreateBox(`storeGlass_${store.id}`, {
                width: w - 0.4,
                height: h - 0.4,
                depth: 0.05
            }, this.scene);
            glass.position = new BABYLON.Vector3(0, 0, d/2);
            glass.parent = hollowRoom;
            
            const glassMat = new BABYLON.StandardMaterial(`storeGlassMat_${store.id}`, this.scene);
            glassMat.diffuseColor = new BABYLON.Color3(0.0, 0.8, 1.0);
            glassMat.alpha = 0.15;
            glassMat.specularColor = new BABYLON.Color3(0.8, 0.9, 1.0);
            glass.material = glassMat;
            
            // Add interior counter block display inside the hollow room
            const counter = BABYLON.MeshBuilder.CreateBox(`counter_${store.id}`, {
                width: w * 0.3,
                height: 0.8,
                depth: d * 0.2
            }, this.scene);
            counter.position = new BABYLON.Vector3(0, -h/2 + 0.4, 0.3); // centered inside
            counter.parent = hollowRoom;
            
            const counterMat = new BABYLON.StandardMaterial(`counterMat_${store.id}`, this.scene);
            counterMat.diffuseColor = new BABYLON.Color3(0.15, 0.2, 0.25);
            counter.material = counterMat;

            // Add sign backing plate
            const sign = BABYLON.MeshBuilder.CreateBox(`storeSign_${store.id}`, {
                width: w - 1.0,
                height: 0.6,
                depth: 0.1
            }, this.scene);
            sign.position = new BABYLON.Vector3(0, (h / 2) - 0.4, d/2);
            sign.parent = hollowRoom;
            
            const signMat = new BABYLON.StandardMaterial(`storeSignMat_${store.id}`, this.scene);
            signMat.diffuseColor = new BABYLON.Color3(0.15, 0.2, 0.3);
            sign.material = signMat;
            
            hollowRoom.freezeWorldMatrix();
            
            this.stores[store.id] = {
                mesh: hollowRoom,
                material: mat,
                baseEmissive: mat.emissiveColor.clone(),
                tenant: store,
                state: "idle"
            };

            this._createStoreLogo(store.id, { x: storeX, y, z: storeZ }, w);
        });

        // Spawn Food Court seating area (Tables & Chairs)
        const fcTableMat = new BABYLON.StandardMaterial("fcTableMat", this.scene);
        fcTableMat.diffuseColor = new BABYLON.Color3(0.18, 0.14, 0.1);
        
        const chairMat = new BABYLON.StandardMaterial("chairMat", this.scene);
        chairMat.diffuseColor = new BABYLON.Color3(0.1, 0.12, 0.15);

        const tablePositions = [
            { x: -5, z: 32 }, { x: 5, z: 32 },
            { x: -12, z: 34 }, { x: 12, z: 34 },
            { x: 0, z: 35 }
        ];

        tablePositions.forEach((pos, idx) => {
            // Table top disc
            const top = BABYLON.MeshBuilder.CreateCylinder(`fcTableTop_${idx}`, { height: 0.1, diameter: 2.2 }, this.scene);
            top.position = new BABYLON.Vector3(pos.x, 11.4, pos.z);
            top.material = fcTableMat;
            
            // Table stand leg
            const leg = BABYLON.MeshBuilder.CreateCylinder(`fcTableLeg_${idx}`, { height: 0.9, diameter: 0.15 }, this.scene);
            leg.position = new BABYLON.Vector3(pos.x, 10.95, pos.z);
            leg.material = fcTableMat;
            
            // Spawn 4 chairs clustered around the table
            const offsets = [
                { x: -0.9, z: 0 }, { x: 0.9, z: 0 },
                { x: 0, z: -0.9 }, { x: 0, z: 0.9 }
            ];
            offsets.forEach((off, cIdx) => {
                const chair = BABYLON.MeshBuilder.CreateBox(`fcChair_${idx}_${cIdx}`, { width: 0.5, height: 0.45, depth: 0.5 }, this.scene);
                chair.position = new BABYLON.Vector3(pos.x + off.x, 10.725, pos.z + off.z);
                chair.material = chairMat;
                chair.freezeWorldMatrix();
            });
            
            top.freezeWorldMatrix();
            leg.freezeWorldMatrix();
        });
    }

    drawIdleScreen(tex, screenId, offset = 0) {
        const ctx = tex.getContext();
        const w = tex.getSize().width;
        const h = tex.getSize().height;
        
        // 1. Dark panel background #080C10
        ctx.fillStyle = "#080C10";
        ctx.fillRect(0, 0, w, h);
        
        // 2. PULSE watermark: small "PULSE" text centered on idle screens
        ctx.fillStyle = "rgba(0, 229, 255, 0.15)";
        ctx.font = "bold 40px Rajdhani, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("PULSE", w / 2, h / 2);
        
        // Add screen ID watermark underneath
        ctx.fillStyle = "rgba(0, 229, 255, 0.08)";
        ctx.font = "16px JetBrains Mono, sans-serif";
        ctx.fillText(screenId, w / 2, h / 2 + 35);
        
        // 3. Scan line animation: subtle horizontal lines scrolling, very low opacity
        ctx.strokeStyle = "rgba(0, 229, 255, 0.03)";
        ctx.lineWidth = 2;
        const scanlineSpacing = 12;
        const startY = offset % scanlineSpacing;
        for (let y = startY; y < h; y += scanlineSpacing) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }
        
        tex.update();
    }

    buildAdScreens() {
        this.layout.ad_screens.forEach(screen => {
            const screenId = screen.id;
            // Build a visual physical frame/hoarding screen border stand
            // Frame: thin 0.1 unit border mesh around screen, color #1E2A38
            const frame = BABYLON.MeshBuilder.CreateBox(`screenFrame_${screenId}`, {
                width: screen.size.w + 0.2,
                height: screen.size.h + 0.2,
                depth: 0.1
            }, this.scene);
            frame.position = new BABYLON.Vector3(screen.position.x, screen.position.y, screen.position.z);
            
            const frameMat = new BABYLON.StandardMaterial(`frameMat_${screenId}`, this.scene);
            frameMat.diffuseColor = BABYLON.Color3.FromHexString("#1E2A38");
            frameMat.emissiveColor = new BABYLON.Color3(0, 0, 0);
            frame.material = frameMat;
            
            // Actual screen surface plane
            const plane = BABYLON.MeshBuilder.CreatePlane(`screen_${screenId}`, {
                width: screen.size.w,
                height: screen.size.h
            }, this.scene);
            
            console.log(`[PULSE] Screen plane ${screenId} size:`, 
                screen.size.w, 'x', screen.size.h,
                '| plane dims:', plane.getBoundingInfo().boundingBox.extendSize);
            
            plane.position = new BABYLON.Vector3(0, 0, 0.06); // offset slightly in front of frame
            plane.parent = frame;
            
            // Rotation values for facing direction
            if (screen.faces === "east") frame.rotation.y = Math.PI / 2;
            else if (screen.faces === "west") frame.rotation.y = -Math.PI / 2;
            else if (screen.faces === "south") frame.rotation.y = Math.PI;
            else if (screen.faces === "north") frame.rotation.y = 0;
            
            // PointLight directly in front of the screen
            const pointLight = new BABYLON.PointLight(`screenGlow_${screenId}`, new BABYLON.Vector3(0, 0, 1.0), this.scene);
            pointLight.parent = frame;
            pointLight.intensity = 0.0;
            pointLight.range = 12;

            plane.frameMesh = frame;
            plane.frameMaterial = frameMat;
            plane.pointLight = pointLight;
            plane.state = "idle";
            plane.scanlineOffset = 0;
            plane.screenId = screenId;

            this.adScreens[screenId] = plane;

            const idleMat = new BABYLON.StandardMaterial(`mat_${screenId}`, this.scene);
            const idleTex = new BABYLON.DynamicTexture(
                `tex_${screenId}`,
                { width: 1024, height: 576 },
                this.scene,
                false
            );
            const idleCtx = idleTex.getContext();
            // Dark idle state
            idleCtx.fillStyle = '#080C10';
            idleCtx.fillRect(0, 0, 1024, 576);
            idleCtx.fillStyle = 'rgba(0,229,255,0.12)';
            idleCtx.fillRect(0, 0, 1024, 2);
            idleCtx.fillRect(0, 574, 1024, 2);
            idleCtx.fillStyle = 'rgba(0,229,255,0.15)';
            idleCtx.font = 'bold 60px Arial';
            idleCtx.textAlign = 'center';
            idleCtx.textBaseline = 'middle';
            idleCtx.fillText('PULSE', 512, 288);
            idleCtx.fillStyle = 'rgba(0,229,255,0.07)';
            idleCtx.font = '16px monospace';
            idleCtx.fillText('AD SCREEN READY', 512, 340);
            idleTex.update(false);

            idleMat.diffuseTexture = idleTex;
            idleMat.emissiveTexture = idleTex;
            idleMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
            idleMat.disableLighting = true;
            plane.material = idleMat;
            plane.texture = idleTex;
        });
        console.log('[PULSE] Ad screens registered:', Object.keys(this.adScreens));
    }

    _buildParkingScreen() {
        const screenId = 'AD-PRK-NEW';
        
        // Remove old one if exists
        const existing = this.adScreens[screenId];
        if (existing) {
            if (existing.parent) existing.parent.dispose();
            else existing.dispose();
            delete this.adScreens[screenId];
        }
        
        const W = 11.2;
        const H = 6.3;
        
        // Create frame box
        const frame = BABYLON.MeshBuilder.CreateBox(
            `screenFrame_${screenId}`,
            { width: W + 0.3, height: H + 0.3, depth: 0.15 },
            this.scene
        );
        frame.position = new BABYLON.Vector3(80, 6, -28);
        frame.rotation.y = 0;  // faces north
        
        const frameMat = new BABYLON.StandardMaterial(
            `frameMat_${screenId}`, this.scene
        );
        frameMat.diffuseColor = BABYLON.Color3.FromHexString('#1E2A38');
        frameMat.emissiveColor = new BABYLON.Color3(0.02, 0.02, 0.02);
        frame.material = frameMat;
        
        // Create screen plane as INDEPENDENT mesh — NOT child of frame
        // This avoids any parent transform issues
        const plane = BABYLON.MeshBuilder.CreatePlane(
            `screen_${screenId}`,
            { width: W, height: H, sideOrientation: BABYLON.Mesh.DOUBLESIDE },
            this.scene
        );
        
        // Position plane independently at same location
        // Offset slightly in front of frame in the west-facing direction
        // West facing means screen face points toward -X
        // So offset in -X direction from frame position
        plane.position = new BABYLON.Vector3(80, 6, -28.15);
        plane.rotation.y = 0;
        
        // Create DynamicTexture 1024x576 (16:9)
        const dynTex = new BABYLON.DynamicTexture(
            `tex_${screenId}`,
            { width: 1024, height: 576 },
            this.scene,
            false
        );
        
        // Draw idle state
        const ctx = dynTex.getContext();
        ctx.fillStyle = '#080C10';
        ctx.fillRect(0, 0, 1024, 576);
        ctx.fillStyle = 'rgba(0,229,255,0.5)';
        ctx.font = 'bold 80px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('PULSE', 512, 288);
        ctx.fillStyle = 'rgba(0,229,255,0.3)';
        ctx.font = '20px monospace';
        ctx.fillText('PARKING SCREEN', 512, 380);
        dynTex.update(true);
        
        // Apply texture to plane material
        const planeMat = new BABYLON.StandardMaterial(
            `mat_${screenId}`, this.scene
        );
        planeMat.diffuseTexture = dynTex;
        planeMat.emissiveTexture = dynTex;
        planeMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
        planeMat.disableLighting = true;
        planeMat.backFaceCulling = false;
        // Fix mirror inversion
        dynTex.uScale = 1;
        plane.material = planeMat;
        
        // Store texture reference on plane for updateAdScreen
        plane.texture = dynTex;
        
        // Add point light in front of screen
        const light = new BABYLON.PointLight(
            `screenGlow_${screenId}`,
            new BABYLON.Vector3(80, 6, -30),
            this.scene
        );
        light.intensity = 0.0;
        light.range = 15;
        plane.pointLight = light;
        
        // Register in adScreens
        this.adScreens[screenId] = plane;
        
        console.log('[PULSE] Parking screen built from scratch:', screenId,
            '| pos:', plane.position.toString(),
            '| rotation y:', plane.rotation.y.toFixed(3));
    }

    buildHeatmapPlanes() {
        // Ground heatmap plane (Scaled up for expanded floor)
        const gHeat = BABYLON.MeshBuilder.CreatePlane("gHeat", { width: 140, height: 100 }, this.scene);
        gHeat.position = new BABYLON.Vector3(0, 0.05, 0);
        gHeat.rotation.x = Math.PI / 2;
        
        const gHeatTex = new BABYLON.DynamicTexture("gHeatTex", { width: 512, height: 256 }, this.scene);
        const gHeatMat = new BABYLON.StandardMaterial("gHeatMat", this.scene);
        gHeatMat.diffuseTexture = gHeatTex;
        gHeatMat.alpha = 0.35;
        gHeat.material = gHeatMat;
        this.gHeatTex = gHeatTex;
        
        this.redrawHeatmap();
    }

    redrawHeatmap() {
        const ctx = this.gHeatTex.getContext();
        ctx.fillStyle = "rgba(0, 50, 100, 0.1)";
        ctx.fillRect(0, 0, 512, 256);
        
        // draw circular hotspots dynamically representing high footfall zones
        const grad = ctx.createRadialGradient(256, 128, 10, 256, 128, 120);
        grad.addColorStop(0, "rgba(255, 0, 0, 0.7)");
        grad.addColorStop(0.5, "rgba(255, 180, 0, 0.4)");
        grad.addColorStop(1, "rgba(0, 229, 255, 0.0)");
        
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(256, 128, 120, 0, Math.PI * 2);
        ctx.fill();
        this.gHeatTex.update();
    }

    spawnShoppers() {
        // Build base mesh humanoid mannequin geometry (cylinder body + sphere head)
        const shopperBody = BABYLON.MeshBuilder.CreateCylinder("shopperBody", { height: 1.2, diameter: 0.5 }, this.scene);
        const shopperHead = BABYLON.MeshBuilder.CreateSphere("shopperHead", { segments: 4, diameter: 0.45 }, this.scene);
        shopperHead.position.y = 0.75;
        
        // Merge into a single humanoid model mesh
        const shopperBase = BABYLON.Mesh.MergeMeshes([shopperBody, shopperHead], true, true, undefined, false, true);
        shopperBase.name = "shopperBase";
        shopperBase.isVisible = false;
        
        // Cozy pastel peach/coral shopper material
        const shopperMat = new BABYLON.StandardMaterial("shopperMat", this.scene);
        shopperMat.diffuseColor = new BABYLON.Color3(0.9, 0.58, 0.52);
        shopperBase.material = shopperMat;
        this.shopperBase = shopperBase; // Keep reference to base mesh for dynamically spawned shoppers
        
        let shopperIdx = 0;
        FOOTFALL_CLUSTERS.forEach(cluster => {
            for (let i = 0; i < cluster.count; i++) {
                const instance = shopperBase.createInstance(`shopper_${shopperIdx++}`);
                
                // Spawn within cluster radius
                const angle = Math.random() * Math.PI * 2;
                const distance = Math.random() * cluster.radius;
                const posX = cluster.center.x + Math.cos(angle) * distance;
                const posZ = cluster.center.z + Math.sin(angle) * distance;
                
                // Floor logic: Z5, Z6, Z7 are floor 2, others floor 1 (or based on zone)
                const isFloor2 = (cluster.zone === "Z5" || cluster.zone === "Z6" || cluster.zone === "Z7");
                const y = isFloor2 ? 11.1 : 0.6;
                
                instance.position = new BABYLON.Vector3(posX, y, posZ);
                instance.floor = isFloor2 ? 2 : 1;
                instance.speed = 1.5 + Math.random() * 1.5;
                instance.cluster = cluster;
                
                // Set initial waypoint
                instance.waypoint = this.getRandomClusterWaypoint(cluster, instance.floor);
                this.shoppers.push(instance);
            }
        });
    }

    getRandomClusterWaypoint(cluster, floor) {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * cluster.radius;
        const posX = cluster.center.x + Math.cos(angle) * distance;
        const posZ = cluster.center.z + Math.sin(angle) * distance;
        const y = floor === 2 ? 11.1 : 0.6;
        return new BABYLON.Vector3(posX, y, posZ);
    }

    updateShoppers() {
        const dt = this.engine.getDeltaTime() / 1000.0;
        this.shoppers.forEach(s => {
            const dir = s.waypoint.subtract(s.position);
            dir.y = 0; // maintain height
            
            if (dir.length() < 1.0) {
                if (s.isExitingCinema) {
                    if (s.exitPath && s.exitPath.length > 0) {
                        s.waypoint = s.exitPath.shift();
                    } else {
                        s.isExitingCinema = false;
                        // Put in a random cluster
                        s.cluster = FOOTFALL_CLUSTERS[Math.floor(Math.random() * FOOTFALL_CLUSTERS.length)];
                        s.waypoint = this.getRandomClusterWaypoint(s.cluster, s.floor);
                    }
                } else if (s.attractedToStore) {
                    // Wandering near store box
                    const targetStorePos = s.attractedToStore.position;
                    const offsetX = (Math.random() - 0.5) * 8;
                    const offsetZ = (Math.random() - 0.5) * 8;
                    s.waypoint = new BABYLON.Vector3(targetStorePos.x + offsetX, s.position.y, targetStorePos.z + offsetZ);
                } else {
                    // Wander within its cluster
                    s.waypoint = this.getRandomClusterWaypoint(s.cluster, s.floor);
                }
            } else {
                dir.normalize();
                s.position.addInPlace(dir.scale(s.speed * dt));
            }
        });
    }

    animateAdScreens() {
        const t = performance.now() / 1000.0;
        // Subtle screen flicker animation and scanline animation
        Object.values(this.adScreens).forEach(screen => {
            if (screen.state === "idle") {
                // Since it's idle and using 1024x576 static dynamic texture, we can leave it or draw scrolling scanlines.
                // We'll keep drawing the scrolling scanlines using the drawIdleScreen method.
                screen.scanlineOffset = (screen.scanlineOffset + 0.5) % 12;
                this.drawIdleScreen(screen.texture, screen.screenId, screen.scanlineOffset);
            } else {
                // Active screen flicker
                if (screen.material) {
                    const flicker = Math.sin(t * 8) * 0.015;
                    screen.material.emissiveColor = new BABYLON.Color3(0.9 + flicker, 0.9 + flicker, 0.9 + flicker);
                }
            }
        });
        
        // Pulse credits signs
        if (this.screeningRooms) {
            this.screeningRooms.forEach(room => {
                if (room.state === "credits") {
                    const factor = 0.5 + 0.5 * Math.sin(performance.now() / 200.0);
                    room.signMat.emissiveColor = new BABYLON.Color3(1.0 * factor, 0.5 * factor, 0.0);
                }
            });
        }
    }

    _createStoreLogo(storeId, storePos, storeWidth) {
        const planeW = Math.min(storeWidth * 0.75, 5.0);
        const planeH = planeW * 0.5;

        const logoPlane = BABYLON.MeshBuilder.CreatePlane(`logo_${storeId}`, {
            width: planeW,
            height: planeH
        }, this.scene);

        logoPlane.position = new BABYLON.Vector3(storePos.x, storePos.y + 5.5, storePos.z);
        logoPlane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        logoPlane.isPickable = false;

        const logoTex = new BABYLON.Texture(`/assets/logos/${storeId}.png`, this.scene, false, true);
        logoTex.hasAlpha = true;

        const logoMat = new BABYLON.StandardMaterial(`logoMat_${storeId}`, this.scene);
        logoMat.diffuseTexture = logoTex;
        logoMat.emissiveTexture = logoTex;
        logoMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
        logoMat.disableLighting = true;
        logoMat.backFaceCulling = false;

        logoPlane.material = logoMat;

        if (this.stores[storeId]) {
            this.stores[storeId]._logoPlane = logoPlane;
            this.stores[storeId]._logoMat = logoMat;
        }
    }

    getCategoryIcon(cat) {
        if (cat === "FASHION") return "🛍";
        if (cat === "FB") return "🍔";
        if (cat === "ELECTRONICS") return "📱";
        if (cat === "SPORTING") return "⚽";
        if (cat === "BEAUTY") return "💄";
        return "💎";
    }

    connectWebSocket() {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
        this.socket = new WebSocket(wsUrl);
        
        this.socket.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                this.handleEvent(msg);
            } catch (e) {}
        };
    }



    handleEvent(msg) {
        switch (msg.type) {
            case "screen_activated":
                console.log('[PULSE] screen_activated:', msg.screen_id, msg.creative_url);
                if (msg.screen_id && msg.creative_url) {
                    this.updateAdScreen(msg.screen_id, msg.creative_url);
                }
                break;
            case "campaign_fired":
                console.log('[PULSE] campaign_fired received:', msg);
                
                const cData = msg.data || {};
                const tenantIds = msg.tenant_ids || cData.tenant_ids || (cData.primary_tenant ? [cData.primary_tenant] : []);
                const excludedIds = msg.excluded_tenant_ids || cData.excluded_tenant_ids || [];
                const creatives = msg.creatives || cData.creatives || [];
                
                // Set store states
                // Delay campaign_active state to allow pending_approval 
                // red glow animation to complete its 5-second window first
                if (tenantIds) {
                    tenantIds.forEach(id => {
                        const mappedId = id.toUpperCase();
                        const store = this.stores[mappedId];
                        
                        // If store has an active approval animation running,
                        // let it complete naturally — the pending_approval 
                        // setTimeout will call setStoreState itself after 6s
                        if (store && store._approvalPulseInterval) {
                            console.log(`[PULSE] Deferring campaign_active for ${mappedId} — approval animation running`);
                            // Store the pending state so it applies after approval completes
                            store._pendingCampaignActive = true;
                        } else {
                            // No approval animation — apply immediately
                            this.setStoreState(mappedId, 'campaign_active');
                        }
                    });
                }
                if (excludedIds) {
                    excludedIds.forEach(id => {
                        const mappedId = id.toUpperCase();
                        this.setStoreState(mappedId, 'excluded');
                    });
                }
                
                // Update ad screens from creatives array
                if (creatives && Array.isArray(creatives) && creatives.length > 0) {
                    this.startAdCycling(creatives);
                }
                break;
            case "investigating":
                const investigatingIds = (msg.data && msg.data.tenant_ids) || msg.tenant_ids || [];
                investigatingIds.forEach(id => {
                    const mappedId = id.toUpperCase();
                    if (this.stores[mappedId]) {
                        this.setStoreState(mappedId, "investigating");
                    }
                });
                break;
            case "awaiting_approval_1":
            case "awaiting_approval_2":
                console.log(`[PULSE] ${msg.type} received:`, msg.type);
                // Camera sweep toward relevant stores if tenant data present
                if (msg.data && msg.data.top_5) {
                    const ids = msg.data.top_5.map(t => t.tenant_id.toUpperCase());
                    setTimeout(() => this.sweepCameraAcrossStores(ids), 500);
                }
                break;
            case "pending_approval":
                console.log('[PULSE] pending_approval received:', msg.tenant_ids);
                this.stopAdCycling();
                const pendingIds = msg.tenant_ids || [];
                
                // Clear previous highlights
                this.highlightLayer.removeAllMeshes();
                if (typeof this.clearApprovalAnimations === 'function') {
                    this.clearApprovalAnimations();
                }
                
                pendingIds.forEach(tenantId => {
                    const key = tenantId.toUpperCase();
                    const store = this.stores[key] || this.stores[tenantId];
                    
                    if (!store) {
                        console.warn('[PULSE] Store not found for pending_approval:', key,
                            'Available:', Object.keys(this.stores).slice(0,5));
                        return;
                    }
                    
                    console.log('[PULSE] Applying RED glow to:', key);
                    
                    // Clear investigating state and reset emissive to neutral
                    if (store._investigatingInterval) {
                        clearInterval(store._investigatingInterval);
                        store._investigatingInterval = null;
                    }
                    try { this.highlightLayer.removeMesh(store.mesh); } catch(e) {}
                    if (store.mesh) {
                        store.mesh.getChildMeshes(false).forEach(m => {
                            try { this.highlightLayer.removeMesh(m); } catch(e) {}
                        });
                    }
                    const neutralColor = new BABYLON.Color3(0.04, 0.04, 0.04);
                    if (store.material) store.material.emissiveColor = neutralColor.clone();
                    if (store.mesh && store.mesh.material) {
                        store.mesh.material.emissiveColor = neutralColor.clone();
                    }
                    store.mesh && store.mesh.getChildMeshes(false).forEach(m => {
                        if (m.material) m.material.emissiveColor = neutralColor.clone();
                    });
                    
                    // Collect parent mesh + ALL child meshes
                    let intensity = 0;
                    let growing = true;
                    const meshesToGlow = [];
                    
                    if (store.mesh) {
                        // Only add children — NOT the parent mesh
                        // Adding parent + children simultaneously causes GPU highlight conflict
                        const children = store.mesh.getChildMeshes(false);
                        if (children.length > 0) {
                            children.forEach(c => meshesToGlow.push(c));
                        } else {
                            // No children — fall back to parent only
                            meshesToGlow.push(store.mesh);
                        }
                    }
                    console.log('[PULSE] Meshes to glow (children only):', meshesToGlow.map(m => m.name));
                    
                    // Add ALL meshes to highlight layer with RED color
                    meshesToGlow.forEach(m => {
                        try {
                            if (m.isVisible !== false && m.getTotalVertices && m.getTotalVertices() > 0) {
                                this.highlightLayer.addMesh(m, new BABYLON.Color3(1, 0, 0));
                                console.log('[PULSE] HL added:', m.name);
                            }
                        } catch(e) {
                            console.warn('[PULSE] HL skip:', m.name, e.message);
                        }
                    });
                    
                    // Pulse red emissive on ALL mesh materials
                    const pulseInterval = setInterval(() => {
                        intensity += growing ? 0.08 : -0.08;
                        if (intensity >= 1) growing = false;
                        if (intensity <= 0) growing = true;
                        const red = new BABYLON.Color3(intensity * 0.9, 0, 0);
                        meshesToGlow.forEach(m => {
                            if (m.material) m.material.emissiveColor = red.clone();
                        });
                        if (store.material) store.material.emissiveColor = red.clone();
                        if (store._logoMat) store._logoMat.emissiveColor = new BABYLON.Color3(1.0, intensity * 0.2, intensity * 0.2);
                    }, 40);
                    
                    if (!this.approvalIntervals) this.approvalIntervals = {};
                    this.approvalIntervals[key] = pulseInterval;
                    store._approvalPulseInterval = pulseInterval;
                    store._meshesToGlow = meshesToGlow;
                    
                    // Floating "Awaiting Approval" text sign above store
                    const storePos = store.mesh
                        ? store.mesh.getAbsolutePosition()
                        : new BABYLON.Vector3(0, 5, 0);
                    
                    const signTex = new BABYLON.DynamicTexture(
                        "signTex_" + key,
                        { width: 512, height: 128 },
                        this.scene,
                        false
                    );
                    signTex.hasAlpha = false;

                    const signMat = new BABYLON.StandardMaterial(
                        "signMat_" + key,
                        this.scene
                    );
                    signMat.diffuseTexture = signTex;
                    signMat.emissiveTexture = signTex;
                    signMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
                    signMat.disableLighting = true;
                    signMat.backFaceCulling = false;

                    const signPlane = BABYLON.MeshBuilder.CreatePlane(
                        "sign_" + key,
                        { width: 6, height: 1.5 },
                        this.scene
                    );
                    signPlane.position = new BABYLON.Vector3(
                        storePos.x,
                        storePos.y + 8,
                        storePos.z
                    );
                    signPlane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
                    signPlane.isPickable = false;
                    signPlane.material = signMat;

                    const drawSign = (text, color) => {
                        const sCtx = signTex.getContext();
                        sCtx.clearRect(0, 0, 512, 128);

                        // Background
                        sCtx.fillStyle = 'rgba(0, 0, 0, 0.92)';
                        sCtx.fillRect(0, 0, 512, 128);

                        // Border
                        sCtx.strokeStyle = color;
                        sCtx.lineWidth = 4;
                        sCtx.strokeRect(3, 3, 506, 122);

                        // Text — drawn normally, no flip
                        // Billboard handles orientation
                        sCtx.fillStyle = color;
                        sCtx.font = 'bold 32px Arial';
                        sCtx.textAlign = 'center';
                        sCtx.textBaseline = 'middle';
                        sCtx.fillText(text, 256, 64);

                        // Force texture update
                        signTex.update(true);
                    };

                    // Draw initial state
                    drawSign('⏳ Awaiting Manager Approval', '#FFD700');
                    store._approvalSign = signPlane;
                    
                    // After 5 seconds — cleanup red, show green, go cyan
                    setTimeout(() => {
                        // Stop pulse interval
                        if (store._approvalPulseInterval) {
                            clearInterval(store._approvalPulseInterval);
                            store._approvalPulseInterval = null;
                        }
                        
                        // Remove red highlights from all child meshes
                        const glowMeshes = store._meshesToGlow || meshesToGlow;
                        glowMeshes.forEach(m => {
                            try { this.highlightLayer.removeMesh(m); } catch(e) {}
                            if (m.material) m.material.emissiveColor = new BABYLON.Color3(0, 0, 0);
                        });
                        if (store.material) store.material.emissiveColor = new BABYLON.Color3(0, 0, 0);
                        if (store._logoMat) store._logoMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
                        
                        // Show green approved text
                        drawSign('✓ Manager Approved!', '#00FF88');
                        
                        // After 1 second: remove sign and go campaign_active
                        setTimeout(() => {
                            if (store._approvalSign) {
                                store._approvalSign.dispose();
                                store._approvalSign = null;
                            }
                            store._pendingCampaignActive = false;
                            store._approvalHandled = true;  // ← ADD THIS
                            this.setStoreState(key, 'campaign_active');
                            
                            // Reset flag after a moment
                            setTimeout(() => { store._approvalHandled = false; }, 1000);
                        }, 1000);
                        
                    }, 5000);
                });
                
                // Camera sweep across all 5 stores
                setTimeout(() => {
                    const upperIds = pendingIds.map(id => id.toUpperCase());
                    if (typeof this.sweepCameraAcrossStores === 'function') {
                        this.sweepCameraAcrossStores(upperIds);
                    }
                }, 500);
                break;
            case "cinema_room_state":
                this.setCinemaRoomState(msg.room_id, msg.state);
                if (msg.state === "emptying") {
                    setTimeout(() => {
                        this.triggerCinemaExit(msg.room_id, msg.crowd_size || 50);
                    }, 30000);
                }
                break;
            case "cinema_campaign_fired":
                if (msg.creative_url && msg.screen_ids) {
                    msg.screen_ids.forEach(screenId => {
                        this.updateAdScreen(screenId, msg.creative_url, "CINEMA");
                    });
                }
                const z3Stores = ["S04", "S05", "S07"];
                z3Stores.forEach(storeId => {
                    this.setStoreState(storeId, "campaign_active");
                });
                this.triggerCorridorSweep();
                break;
        }
    }

    clearApprovalAnimations() {
        if (this.approvalIntervals) {
            Object.values(this.approvalIntervals).forEach(intervalId => {
                clearInterval(intervalId);
            });
        }
        this.approvalIntervals = {};

        if (this.approvalRings) {
            Object.values(this.approvalRings).forEach(mesh => {
                if (mesh) mesh.dispose();
            });
        }
        this.approvalRings = {};

        if (this.approvalTexts) {
            Object.values(this.approvalTexts).forEach(mesh => {
                if (mesh) mesh.dispose();
            });
        }
        this.approvalTexts = {};
    }

    sweepCameraAcrossStores(tenantIds) {
        const validStores = tenantIds.map(id => this.stores[id]).filter(s => !!s);
        if (validStores.length === 0) return;
        
        const frameRate = 30;
        const transitionFrames = 20; // ~0.66 seconds between stores
        const holdFrames = 25; // ~0.83 seconds hold
        
        let currentIdx = 0;
        
        const sweepNext = () => {
            if (currentIdx >= validStores.length) {
                const animTarget = new BABYLON.Animation("camTargetBack", "target", frameRate, BABYLON.Animation.ANIMATIONTYPE_VECTOR3, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
                const keysTarget = [
                    { frame: 0, value: this.camera.target.clone() },
                    { frame: transitionFrames, value: this.defaultCameraSettings.target }
                ];
                animTarget.setKeys(keysTarget);
                
                const animRadius = new BABYLON.Animation("camRadiusBack", "radius", frameRate, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
                const keysRadius = [
                    { frame: 0, value: this.camera.radius },
                    { frame: transitionFrames, value: this.defaultCameraSettings.radius }
                ];
                animRadius.setKeys(keysRadius);
                
                const ease = new BABYLON.QuadraticEase();
                ease.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEINOUT);
                animTarget.setEasingFunction(ease);
                animRadius.setEasingFunction(ease);
                
                this.scene.beginDirectAnimation(this.camera, [animTarget, animRadius], 0, transitionFrames, false);
                return;
            }
            
            const store = validStores[currentIdx];
            const storePos = store.mesh.position;
            const newTarget = new BABYLON.Vector3(storePos.x, storePos.y, storePos.z);
            const newRadius = 45;
            
            const animTarget = new BABYLON.Animation("camTargetSweep", "target", frameRate, BABYLON.Animation.ANIMATIONTYPE_VECTOR3, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
            const keysTarget = [
                { frame: 0, value: this.camera.target.clone() },
                { frame: transitionFrames, value: newTarget }
            ];
            animTarget.setKeys(keysTarget);
            
            const animRadius = new BABYLON.Animation("camRadiusSweep", "radius", frameRate, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
            const keysRadius = [
                { frame: 0, value: this.camera.radius },
                { frame: transitionFrames, value: newRadius }
            ];
            animRadius.setKeys(keysRadius);
            
            const ease = new BABYLON.QuadraticEase();
            ease.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEINOUT);
            animTarget.setEasingFunction(ease);
            animRadius.setEasingFunction(ease);
            
            this.scene.beginDirectAnimation(this.camera, [animTarget, animRadius], 0, transitionFrames, false, 1.0, () => {
                setTimeout(() => {
                    currentIdx++;
                    sweepNext();
                }, (holdFrames / frameRate) * 1000);
            });
        };
        
        sweepNext();
    }

    // Public API Methods
    setStoreState(tenantId, state) {
        const store = this.stores[tenantId];
        if (!store) return;
        
        // Clean up any pending approval pulse interval or signs for this store
        const key = tenantId.toUpperCase();
        if (store._approvalPulseInterval) {
            clearInterval(store._approvalPulseInterval);
            delete this.approvalIntervals[key];
            store._approvalPulseInterval = null;
        }
        if (store._approvalSign) {
            store._approvalSign.dispose();
            delete this.approvalTexts[key];
            store._approvalSign = null;
        }

        store.state = state;
        const mat = store.material;
        
        if (state === "campaign_active") {
            mat.emissiveColor = new BABYLON.Color3(0, 0.9, 1.0); // Cyan
            this.highlightLayer.addMesh(store.mesh, new BABYLON.Color3(0, 0.9, 1.0));
            if (store._logoMat) store._logoMat.emissiveColor = new BABYLON.Color3(0.0, 0.9, 1.0);

            // Attract shoppers in nearby clusters (distance < 45)
            const storePos = store.mesh.position;
            this.shoppers.forEach(s => {
                if (s.cluster) {
                    const dist = BABYLON.Vector3.Distance(new BABYLON.Vector3(s.cluster.center.x, s.position.y, s.cluster.center.z), storePos);
                    if (dist < 45.0) {
                        s.attractedToStore = store.mesh;
                        const offsetX = (Math.random() - 0.5) * 8;
                        const offsetZ = (Math.random() - 0.5) * 8;
                        s.waypoint = new BABYLON.Vector3(storePos.x + offsetX, s.position.y, storePos.z + offsetZ);
                    }
                }
            });
        } else if (state === "investigating") {
            mat.emissiveColor = new BABYLON.Color3(1.0, 0.72, 0.0); // Amber
            this.highlightLayer.addMesh(store.mesh, new BABYLON.Color3(1.0, 0.72, 0.0));
        } else if (state === "performing") {
            mat.emissiveColor = new BABYLON.Color3(0, 1.0, 0.53); // Neon Green
            this.highlightLayer.addMesh(store.mesh, new BABYLON.Color3(0, 1.0, 0.53));
        } else {
            mat.emissiveColor = store.baseEmissive;
            this.highlightLayer.removeMesh(store.mesh);
            if (store._logoMat) store._logoMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
            this.shoppers.forEach(s => {
                if (s.attractedToStore === store.mesh) {
                    s.attractedToStore = null;
                }
            });
        }
    }

    updateAdScreen(screenId, creativeUrl) {
        console.debug(`[PULSE] updateAdScreen called: ${screenId} → ${creativeUrl}`);
        const screen = this.adScreens[screenId];
        if (!screen) {
            console.warn(`[PULSE] Screen ${screenId} not found.`);
            return;
        }

        // Extract tenant ID from URL — handles both .html and .png formats
        let tenantId = null;
        
        // Try .html format: /assets/premade_ads/S22.html → S22
        const htmlMatch = creativeUrl ? creativeUrl.match(/\/([A-Z]\d+)\.html/) : null;
        if (htmlMatch) tenantId = htmlMatch[1];
        
        // Try .png format: /assets/creatives/S17_campaign.png → S17
        if (!tenantId) {
            const pngMatch = creativeUrl ? creativeUrl.match(/\/([A-Z]\d+)[_.]/) : null;
            if (pngMatch) tenantId = pngMatch[1];
        }

        const tenantData = (tenantId && this.tenantColorMap)
            ? this.tenantColorMap[tenantId]
            : null;

        console.debug(`[PULSE] Tenant: ${tenantId}`, tenantData ? tenantData.name : 'generic');

        // Check if this is a real image file (.png, .jpg, .webp, or external image URL)
        const isImageFile = creativeUrl && (
            creativeUrl.endsWith('.png') ||
            creativeUrl.endsWith('.jpg') ||
            creativeUrl.endsWith('.webp') ||
            (creativeUrl.startsWith('https://') &&
             creativeUrl.includes('image'))
        );

        if (isImageFile) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = 1024;
                canvas.height = 576;
                const ctx = canvas.getContext('2d');

                // Fill black background
                ctx.fillStyle = '#000000';
                ctx.fillRect(0, 0, 1024, 576);

                // Flip horizontally to correct mirror inversion
                ctx.save();
                ctx.scale(-1, 1);
                ctx.translate(-1024, 0);

                // Draw scaled to fit
                const imgW = img.naturalWidth;
                const imgH = img.naturalHeight;
                const fitScale = Math.min(1024 / imgW, 576 / imgH);
                const destW = Math.floor(imgW * fitScale);
                const destH = Math.floor(imgH * fitScale);
                const destX = Math.floor((1024 - destW) / 2);
                const destY = Math.floor((576 - destH) / 2);
                ctx.drawImage(img, 0, 0, imgW, imgH, destX, destY, destW, destH);

                ctx.restore();

                this._applyCanvasToScreen(screen, screenId, canvas);
            };
            
            img.onerror = () => {
                console.warn(`[PULSE] Image failed: ${creativeUrl} — using branded fallback`);
                const canvas = document.createElement('canvas');
                canvas.width = 1024;
                canvas.height = 576;
                const ctx = canvas.getContext('2d');
                if (tenantData) {
                    this._renderBrandedAd(ctx, 1024, 576, tenantData, screenId);
                } else {
                    this._renderGenericAd(ctx, 1024, 576, screenId);
                }
                this._applyCanvasToScreen(screen, screenId, canvas);
            };
            
            img.src = creativeUrl;
            
        } else {
            // HTML or unknown — render branded canvas
            const canvas = document.createElement('canvas');
            canvas.width = 1024;
            canvas.height = 576;
            const ctx = canvas.getContext('2d');
            if (tenantData) {
                this._renderBrandedAd(ctx, 1024, 576, tenantData, screenId);
            } else {
                this._renderGenericAd(ctx, 1024, 576, screenId);
            }
            this._applyCanvasToScreen(screen, screenId, canvas);
        }
    }

    // Helper: apply a canvas element to a screen mesh's DynamicTexture
    _applyCanvasToScreen(screen, screenId, canvas) {
        // Get existing texture
        let dynTex = screen.texture;
        
        if (!dynTex) {
            dynTex = new BABYLON.DynamicTexture(
                `tex_${screenId}`,
                { width: 1024, height: 576 },
                this.scene,
                false
            );
            screen.texture = dynTex;
            if (!screen.material) {
                screen.material = new BABYLON.StandardMaterial(
                    `mat_${screenId}`, this.scene
                );
            }
            screen.material.diffuseTexture = dynTex;
            screen.material.emissiveTexture = dynTex;
            dynTex.uScale = 1;
        }
        
        // Force correct material every time
        if (screen.material) {
            screen.material.emissiveColor = new BABYLON.Color3(1, 1, 1);
            screen.material.disableLighting = true;
            screen.material.backFaceCulling = false;
        }
        
        // Get the DynamicTexture's internal canvas size
        const texSize = dynTex.getSize();
        console.log(`[PULSE] Texture size: ${texSize.width}x${texSize.height}`);
        console.log(`[PULSE] Canvas size: ${canvas.width}x${canvas.height}`);
        
        // Draw canvas onto texture
        const texCtx = dynTex.getContext();
        
        // Clear texture canvas first
        texCtx.clearRect(0, 0, texSize.width, texSize.height);
        
        // Draw our canvas scaled to fit texture dimensions exactly
        texCtx.drawImage(
            canvas,
            0, 0, canvas.width, canvas.height,  // source: full canvas
            0, 0, texSize.width, texSize.height  // dest: full texture
        );
        
        // Force GPU upload
        dynTex.update(true);
        
        // Activate point light
        if (screen.pointLight) {
            screen.pointLight.intensity = 1.0;
        }
        
        screen.isVisible = true;
        screen.setEnabled(true);
        screen.state = 'active';
        
        console.log(`[PULSE] Screen ${screenId} — texture applied`);
    }

    startAdCycling(creatives) {
        // Stop any existing cycle first
        if (this.adCycleInterval) {
            clearTimeout(this.adCycleInterval);
            this.adCycleInterval = null;
        }

        if (!creatives || creatives.length === 0) return;

        // Sort by rank to ensure correct order
        const sorted = [...creatives].sort((a, b) => 
            (a.rank || 0) - (b.rank || 0)
        );

        this.activeCampaignCreatives = sorted;
        this.adCycleIndex = 0;

        const allScreenIds = Object.keys(this.adScreens);

        console.log('[PULSE] Ad cycling started:', 
            sorted.map(c => c.tenant_name), 
            '| Screens:', allScreenIds.length);

        const showNext = () => {
            // Safety check — stop if cycling was cancelled
            if (!this.activeCampaignCreatives || 
                this.activeCampaignCreatives.length === 0) return;

            const creative = this.activeCampaignCreatives[this.adCycleIndex];
            if (!creative) return;

            const url = creative.url || 
                `/assets/premade_ads/${creative.tenant_id}.html`;

            // Duration: 6s for rank 1 and 2, 3s for rank 3, 4, 5
            const rank = creative.rank || (this.adCycleIndex + 1);
            const duration = rank <= 2 ? 6000 : 3000;

            console.log(`[PULSE] Cycling → ${creative.tenant_name} ` +
                `(rank ${rank}, ${duration/1000}s)`);

            // Update ALL screens with this creative simultaneously
            allScreenIds.forEach(screenId => {
                this.updateAdScreen(screenId, url);
            });

            // Advance index for next cycle
            this.adCycleIndex = 
                (this.adCycleIndex + 1) % this.activeCampaignCreatives.length;

            // Schedule next ad
            this.adCycleInterval = setTimeout(showNext, duration);
        };

        // Start after 2 second delay to let initial render settle
        this.adCycleInterval = setTimeout(showNext, 2000);
    }

    stopAdCycling() {
        if (this.adCycleInterval) {
            clearTimeout(this.adCycleInterval);
            this.adCycleInterval = null;
        }
        this.activeCampaignCreatives = [];
        this.adCycleIndex = 0;
        console.log('[PULSE] Ad cycling stopped');
    }

    _renderBrandedAd(ctx, w, h, tenantData, screenId) {
        // Flip canvas horizontally to correct mirror inversion
        ctx.save();
        ctx.scale(-1, 1);
        ctx.translate(-w, 0);

        const primary = tenantData.primary || '#1E2A38';
        const secondary = tenantData.secondary || '#00E5FF';
        
        // Parse hex to rgb for gradient
        const hexToRgb = (hex) => {
            const h = hex.replace('#','');
            return {
                r: parseInt(h.substr(0,2),16),
                g: parseInt(h.substr(2,2),16),
                b: parseInt(h.substr(4,2),16)
            };
        };
        
        const rgb = hexToRgb(primary.startsWith('#') ? primary : '#1E2A38');
        const isDark = (rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114) < 128;
        const textColor = isDark ? '#FFFFFF' : '#111111';
        
        // Background
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, primary);
        grad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0.75)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        
        // Diagonal pattern overlay
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 1;
        for (let i = -h; i < w + h; i += 50) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i + h, h);
            ctx.stroke();
        }
        
        // Top accent bar
        ctx.fillStyle = secondary;
        ctx.fillRect(0, 0, w, 8);
        
        // Bottom accent bar
        ctx.fillRect(0, h - 8, w, 8);
        
        // Corner L-marks
        const cm = 24, cp = 16;
        ctx.strokeStyle = secondary;
        ctx.lineWidth = 3;
        // TL
        ctx.beginPath(); ctx.moveTo(cp,cp+cm); ctx.lineTo(cp,cp); ctx.lineTo(cp+cm,cp); ctx.stroke();
        // TR
        ctx.beginPath(); ctx.moveTo(w-cp-cm,cp); ctx.lineTo(w-cp,cp); ctx.lineTo(w-cp,cp+cm); ctx.stroke();
        // BL
        ctx.beginPath(); ctx.moveTo(cp,h-cp-cm); ctx.lineTo(cp,h-cp); ctx.lineTo(cp+cm,h-cp); ctx.stroke();
        // BR
        ctx.beginPath(); ctx.moveTo(w-cp-cm,h-cp); ctx.lineTo(w-cp,h-cp); ctx.lineTo(w-cp,h-cp-cm); ctx.stroke();
        
        // Logo circle (initials)
        const cx = w * 0.5, cy = h * 0.35, cr = Math.min(w,h) * 0.12;
        ctx.beginPath();
        ctx.arc(cx, cy, cr, 0, Math.PI*2);
        ctx.fillStyle = secondary;
        ctx.fill();
        
        // Initials in circle
        ctx.fillStyle = isDark ? '#000000' : '#FFFFFF';
        if (primary === '#FFFFFF' || primary === '#FAFAFA' || primary === '#E5E7EB') {
            ctx.fillStyle = '#111111';
        }
        ctx.font = `bold ${Math.floor(cr * 0.9)}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tenantData.initials || '??', cx, cy);
        
        // Store name
        ctx.fillStyle = textColor;
        ctx.font = `bold ${Math.floor(h * 0.07)}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const nameY = h * 0.55;
        ctx.fillText(tenantData.name.toUpperCase(), w/2, nameY);
        
        // Category
        const catColors = {
            'FB':'#FF6B35','FASHION':'#E91E8C','SPORTING':'#00BCD4',
            'ELECTRONICS':'#2196F3','BEAUTY':'#9C27B0',
            'JEWELRY':'#FFD700','ENTERTAINMENT':'#4CAF50'
        };
        ctx.fillStyle = catColors[tenantData.category] || secondary;
        ctx.font = `500 ${Math.floor(h * 0.04)}px Arial`;
        ctx.fillText(tenantData.category, w/2, h * 0.70);
        
        // PULSE branding
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = `${Math.floor(h * 0.032)}px monospace`;
        ctx.fillText('PULSE CAMPAIGN ACTIVE', w/2, h * 0.87);
        
        // Scan lines
        for (let y = 0; y < h; y += 4) {
            ctx.fillStyle = 'rgba(0,0,0,0.035)';
            ctx.fillRect(0, y, w, 1);
        }
        ctx.restore();
    }

    _renderGenericAd(ctx, w, h, screenId) {
        // Flip canvas horizontally to correct mirror inversion
        ctx.save();
        ctx.scale(-1, 1);
        ctx.translate(-w, 0);

        ctx.fillStyle = '#080C10';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#00E5FF';
        ctx.fillRect(0, 0, w, 3);
        ctx.fillRect(0, h-3, w, 3);
        ctx.fillStyle = 'rgba(0,229,255,0.6)';
        ctx.font = `bold ${Math.floor(h * 0.15)}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('PULSE', w/2, h/2);
        ctx.fillStyle = 'rgba(0,229,255,0.3)';
        ctx.font = `${Math.floor(h * 0.04)}px monospace`;
        ctx.fillText('CAMPAIGN ACTIVE', w/2, h*0.65);
        ctx.restore();
    }

    _activateScreenLight(screenId, tenantData) {
        // Remove existing light for this screen
        const existingLight = this.scene.getLightByName(`screenLight_${screenId}`);
        if (existingLight) existingLight.dispose();
        
        const screen = this.adScreens[screenId];
        if (!screen) return;
        
        const screenPos = screen.position;
        const light = new BABYLON.PointLight(
            `screenLight_${screenId}`,
            new BABYLON.Vector3(screenPos.x, screenPos.y, screenPos.z + 2),
            this.scene
        );
        
        // Color based on category
        const catColors = {
            'FB': new BABYLON.Color3(1, 0.42, 0.21),
            'FASHION': new BABYLON.Color3(0.91, 0.12, 0.55),
            'JEWELRY': new BABYLON.Color3(1, 0.85, 0),
            'ELECTRONICS': new BABYLON.Color3(0.13, 0.59, 0.95),
            'BEAUTY': new BABYLON.Color3(0.61, 0.15, 0.69),
            'SPORTING': new BABYLON.Color3(0, 0.74, 0.83),
            'ENTERTAINMENT': new BABYLON.Color3(0.3, 0.69, 0.31),
        };
        
        light.diffuse = tenantData 
            ? (catColors[tenantData.category] || new BABYLON.Color3(0, 0.9, 1))
            : new BABYLON.Color3(0, 0.9, 1);
        light.intensity = 0.7;
        light.range = 15;

        // Change frame color to #00E5FF with emissive glow
        if (screen.frameMaterial) {
            screen.frameMaterial.diffuseColor = BABYLON.Color3.FromHexString('#00E5FF');
            screen.frameMaterial.emissiveColor = BABYLON.Color3.FromHexString('#00E5FF').scale(0.8);
        }
    }

    triggerParticleBurst(position) {
        const particleSystem = new BABYLON.ParticleSystem("particles", 100, this.scene);
        particleSystem.particleTexture = new BABYLON.Texture("https://raw.githubusercontent.com/OrlyK/BabylonJS-Particles/master/flare.png", this.scene);
        
        particleSystem.emitter = position;
        particleSystem.minEmitBox = new BABYLON.Vector3(-0.5, -0.5, -0.5);
        particleSystem.maxEmitBox = new BABYLON.Vector3(0.5, 0.5, 0.5);
        
        particleSystem.color1 = new BABYLON.Color4(0.0, 0.9, 1.0, 1.0);
        particleSystem.color2 = new BABYLON.Color4(0.0, 0.5, 1.0, 1.0);
        particleSystem.colorDead = new BABYLON.Color4(0, 0, 0, 0.0);
        
        particleSystem.minSize = 0.1;
        particleSystem.maxSize = 0.5;
        particleSystem.minLifeTime = 0.2;
        particleSystem.maxLifeTime = 0.8;
        particleSystem.emitRate = 100;
        
        particleSystem.direction1 = new BABYLON.Vector3(-2, 2, -2);
        particleSystem.direction2 = new BABYLON.Vector3(2, 4, 2);
        
        particleSystem.minEmitPower = 1;
        particleSystem.maxEmitPower = 3;
        particleSystem.updateSpeed = 0.02;
        
        particleSystem.targetStopDuration = 0.4;
        particleSystem.disposeOnStop = true;
        
        particleSystem.start();
    }

    focusOnStoreForCreative(tenantId, durationMs = 3000) {
        const store = this.stores[tenantId];
        if (!store) return;
        
        const storePos = store.mesh.position;
        const newTarget = new BABYLON.Vector3(storePos.x, storePos.y, storePos.z);
        const newRadius = 40;
        
        const frameRate = 30;
        const transitionFrames = 30; // 1.0 second
        
        const animTarget = new BABYLON.Animation("camTarget", "target", frameRate, BABYLON.Animation.ANIMATIONTYPE_VECTOR3, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
        const keysTarget = [
            { frame: 0, value: this.camera.target.clone() },
            { frame: transitionFrames, value: newTarget }
        ];
        animTarget.setKeys(keysTarget);
        
        const animRadius = new BABYLON.Animation("camRadius", "radius", frameRate, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
        const keysRadius = [
            { frame: 0, value: this.camera.radius },
            { frame: transitionFrames, value: newRadius }
        ];
        animRadius.setKeys(keysRadius);
        
        const ease = new BABYLON.QuadraticEase();
        ease.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEINOUT);
        animTarget.setEasingFunction(ease);
        animRadius.setEasingFunction(ease);
        
        this.scene.beginDirectAnimation(this.camera, [animTarget, animRadius], 0, transitionFrames, false, 1.0, () => {
            setTimeout(() => {
                const animTargetBack = new BABYLON.Animation("camTargetBack", "target", frameRate, BABYLON.Animation.ANIMATIONTYPE_VECTOR3, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
                const keysTargetBack = [
                    { frame: 0, value: this.camera.target.clone() },
                    { frame: transitionFrames, value: this.defaultCameraSettings.target }
                ];
                animTargetBack.setKeys(keysTargetBack);
                
                const animRadiusBack = new BABYLON.Animation("camRadiusBack", "radius", frameRate, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
                const keysRadiusBack = [
                    { frame: 0, value: this.camera.radius },
                    { frame: transitionFrames, value: this.defaultCameraSettings.radius }
                ];
                animRadiusBack.setKeys(keysRadiusBack);
                
                animTargetBack.setEasingFunction(ease);
                animRadiusBack.setEasingFunction(ease);
                
                this.scene.beginDirectAnimation(this.camera, [animTargetBack, animRadiusBack], 0, transitionFrames, false);
            }, durationMs);
        });
    }

    pauseForApproval(approvalId) {
        this.isPausedForApproval = true;
        
        if (!this.approvalOverlay) {
            const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("ApprovalUI", true, this.scene);
            this.advancedTextureApproval = advancedTexture;
            
            const rect = new BABYLON.GUI.Rectangle();
            rect.width = "100%";
            rect.height = "100%";
            rect.background = "rgba(0,0,0,0.3)";
            rect.thickness = 0;
            advancedTexture.addControl(rect);
            this.approvalOverlay = rect;
            
            const txt = new BABYLON.GUI.TextBlock();
            txt.text = "Awaiting GM approval...";
            txt.color = "#00E5FF";
            txt.fontFamily = "Rajdhani";
            txt.fontSize = 32;
            txt.fontWeight = "bold";
            advancedTexture.addControl(txt);
            this.approvalText = txt;
        } else {
            this.approvalOverlay.isVisible = true;
            this.approvalText.isVisible = true;
        }
    }

    resumeFromApproval(approvalId) {
        this.isPausedForApproval = false;
        if (this.approvalOverlay) {
            this.approvalOverlay.isVisible = false;
            this.approvalText.isVisible = false;
        }
        this.clearApprovalAnimations();
        if (this.highlightLayer) {
            this.highlightLayer.removeAllMeshes();
        }
    }

    toggleHeatmap() {
        this.heatmapVisible = !this.heatmapVisible;
        const gHeat = this.scene.getMeshByName("gHeat");
        if (gHeat) gHeat.setEnabled(this.heatmapVisible);
    }

    buildCityEnvironment() {
        // Large grass/terrain base
        const cityBase = BABYLON.MeshBuilder.CreateBox("cityBase", { width: 400, height: 0.5, depth: 300 }, this.scene);
        cityBase.position = new BABYLON.Vector3(0, -0.5, 0);
        const baseMat = new BABYLON.StandardMaterial("cityBaseMat", this.scene);
        baseMat.diffuseColor = new BABYLON.Color3(0.38, 0.45, 0.35); // Comfy warm sage green
        cityBase.material = baseMat;
        cityBase.freezeWorldMatrix();

        // Sidewalk around the mall base
        const sidewalk = BABYLON.MeshBuilder.CreateBox("sidewalk", { width: 160, height: 0.2, depth: 120 }, this.scene);
        sidewalk.position = new BABYLON.Vector3(0, -0.15, 0);
        const sidewalkMat = new BABYLON.StandardMaterial("sidewalkMat", this.scene);
        sidewalkMat.diffuseColor = new BABYLON.Color3(0.72, 0.72, 0.70); // Concrete
        sidewalk.material = sidewalkMat;
        sidewalk.freezeWorldMatrix();

        // Asphalt Road Loop
        const roadMat = new BABYLON.StandardMaterial("roadMat", this.scene);
        roadMat.diffuseColor = new BABYLON.Color3(0.18, 0.19, 0.21); // Dark asphalt
        roadMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);

        const roadN = BABYLON.MeshBuilder.CreateBox("roadN", { width: 222, height: 0.05, depth: 12 }, this.scene);
        roadN.position = new BABYLON.Vector3(0, -0.24, -75);
        roadN.material = roadMat;
        roadN.freezeWorldMatrix();

        const roadS = BABYLON.MeshBuilder.CreateBox("roadS", { width: 222, height: 0.05, depth: 12 }, this.scene);
        roadS.position = new BABYLON.Vector3(0, -0.24, 75);
        roadS.material = roadMat;
        roadS.freezeWorldMatrix();

        const roadW = BABYLON.MeshBuilder.CreateBox("roadW", { width: 12, height: 0.05, depth: 162 }, this.scene);
        roadW.position = new BABYLON.Vector3(-105, -0.24, 0);
        roadW.material = roadMat;
        roadW.freezeWorldMatrix();

        const roadE = BABYLON.MeshBuilder.CreateBox("roadE", { width: 12, height: 0.05, depth: 162 }, this.scene);
        roadE.position = new BABYLON.Vector3(105, -0.24, 0);
        roadE.material = roadMat;
        roadE.freezeWorldMatrix();

        // Yellow Dividers
        const lineMat = new BABYLON.StandardMaterial("lineMat", this.scene);
        lineMat.diffuseColor = new BABYLON.Color3(0.9, 0.75, 0.2);
        lineMat.emissiveColor = new BABYLON.Color3(0.2, 0.15, 0.05);

        const createDashedDivider = (startX, startZ, endX, endZ, steps, isVertical) => {
            const dx = (endX - startX) / steps;
            const dz = (endZ - startZ) / steps;
            for (let i = 0; i <= steps; i++) {
                if (i % 2 === 0) {
                    const dash = BABYLON.MeshBuilder.CreateBox(`dash_${startX}_${startZ}_${i}`, {
                        width: isVertical ? 0.15 : 1.5,
                        height: 0.01,
                        depth: isVertical ? 1.5 : 0.15
                    }, this.scene);
                    dash.position = new BABYLON.Vector3(startX + dx * i, -0.21, startZ + dz * i);
                    dash.material = lineMat;
                    dash.freezeWorldMatrix();
                }
            }
        };

        createDashedDivider(-105, -75, 105, -75, 30, false);
        createDashedDivider(-105, 75, 105, 75, 30, false);
        createDashedDivider(-105, -75, -105, 75, 24, true);
        createDashedDivider(105, -75, 105, 75, 24, true);

        // Streetlights
        const createStreetlight = (x, z, rotationY) => {
            const group = new BABYLON.TransformNode("streetlight_group", this.scene);
            
            const pole = BABYLON.MeshBuilder.CreateCylinder("pole", { height: 7.0, diameter: 0.15 }, this.scene);
            pole.position.y = 3.5;
            pole.parent = group;
            
            const poleMat = new BABYLON.StandardMaterial("poleMat", this.scene);
            poleMat.diffuseColor = new BABYLON.Color3(0.3, 0.33, 0.35);
            poleMat.specularColor = new BABYLON.Color3(0.5, 0.5, 0.5);
            pole.material = poleMat;
            
            const arm = BABYLON.MeshBuilder.CreateCylinder("arm", { height: 1.5, diameter: 0.1 }, this.scene);
            arm.rotation.z = Math.PI / 2.5;
            arm.position.y = 6.8;
            arm.position.x = 0.5;
            arm.parent = group;
            arm.material = poleMat;
            
            const lantern = BABYLON.MeshBuilder.CreateBox("lantern", { width: 0.4, height: 0.15, depth: 0.3 }, this.scene);
            lantern.position.y = 6.6;
            lantern.position.x = 1.1;
            lantern.parent = group;
            
            const lanternMat = new BABYLON.StandardMaterial("lanternMat", this.scene);
            lanternMat.diffuseColor = new BABYLON.Color3(0.95, 0.9, 0.6);
            lanternMat.emissiveColor = new BABYLON.Color3(0.95, 0.8, 0.3);
            lantern.material = lanternMat;
            
            group.position = new BABYLON.Vector3(x, -0.25, z);
            group.rotation.y = rotationY;
            
            this.streetlights.push({ group, lanternMat });
        };

        // Spawn Streetlights facing the roads
        // North Side (facing South / negative Z)
        [-80, -40, 0, 40, 80].forEach(x => createStreetlight(x, -83, -Math.PI / 2));
        // South Side (facing North / positive Z)
        [-80, -40, 0, 40, 80].forEach(x => createStreetlight(x, 83, Math.PI / 2));
        // West Side (facing East / positive X)
        [-50, -20, 10, 40].forEach(z => createStreetlight(-113, z, 0));
        // East Side (facing West / negative X)
        [-50, -20, 10, 40].forEach(z => createStreetlight(113, z, Math.PI));

        // Parking block on the East side (between sidewalk and road)
        const parkingLot = BABYLON.MeshBuilder.CreateBox("parkingLot", { width: 14, height: 0.05, depth: 80 }, this.scene);
        parkingLot.position = new BABYLON.Vector3(88, -0.24, 0);
        const parkingMat = new BABYLON.StandardMaterial("parkingMat", this.scene);
        parkingMat.diffuseColor = new BABYLON.Color3(0.22, 0.23, 0.25);
        parkingLot.material = parkingMat;
        parkingLot.freezeWorldMatrix();

        // Parking lines (white markers)
        const whiteLineMat = new BABYLON.StandardMaterial("whiteLineMat", this.scene);
        whiteLineMat.diffuseColor = new BABYLON.Color3(0.9, 0.9, 0.9);
        
        for (let z = -36; z <= 36; z += 6) {
            const line = BABYLON.MeshBuilder.CreateBox(`parkingLine_${z}`, { width: 13, height: 0.01, depth: 0.15 }, this.scene);
            line.position = new BABYLON.Vector3(88, -0.21, z);
            line.material = whiteLineMat;
            line.freezeWorldMatrix();
        }

        // Spawn 4 static parked cars in the bays
        const carColors = [
            new BABYLON.Color3(0.9, 0.2, 0.2), // red
            new BABYLON.Color3(0.1, 0.5, 0.9), // blue
            new BABYLON.Color3(0.95, 0.95, 0.95), // white
            new BABYLON.Color3(0.2, 0.2, 0.2) // dark grey
        ];
        const parkedZ = [-30, -12, 12, 24];
        parkedZ.forEach((zVal, idx) => {
            const parkedCar = BABYLON.MeshBuilder.CreateBox(`parkedCar_${idx}`, { width: 4.2, height: 1.0, depth: 2.0 }, this.scene);
            parkedCar.position = new BABYLON.Vector3(88, 0.3, zVal);
            
            const carMat = new BABYLON.StandardMaterial(`parkedCarMat_${idx}`, this.scene);
            carMat.diffuseColor = carColors[idx];
            parkedCar.material = carMat;
            parkedCar.freezeWorldMatrix();
        });
    }

    spawnCars() {
        const colors = [
            new BABYLON.Color3(0.95, 0.95, 0.95), // Pearl White
            new BABYLON.Color3(0.2, 0.6, 0.8),    // Electric Blue
            new BABYLON.Color3(0.85, 0.4, 0.15),   // Solar Orange
            new BABYLON.Color3(0.7, 0.72, 0.75),  // Silver Metallic
            new BABYLON.Color3(0.1, 0.8, 0.5),    // Eco Green
            new BABYLON.Color3(0.9, 0.2, 0.3)     // Crimson Red
        ];

        const createCarMesh = (name, color) => {
            const carNode = new BABYLON.TransformNode(name, this.scene);
            
            // Chassis
            const chassis = BABYLON.MeshBuilder.CreateBox("chassis", { width: 1.6, height: 0.6, depth: 3.2 }, this.scene);
            chassis.position.y = 0.45;
            chassis.parent = carNode;
            
            const chassisMat = new BABYLON.StandardMaterial("chassisMat", this.scene);
            chassisMat.diffuseColor = color;
            chassis.material = chassisMat;
            
            // Cabin
            const cabin = BABYLON.MeshBuilder.CreateBox("cabin", { width: 1.3, height: 0.5, depth: 1.8 }, this.scene);
            cabin.position.y = 0.95;
            cabin.position.z = -0.2;
            cabin.parent = carNode;
            
            const cabinMat = new BABYLON.StandardMaterial("cabinMat", this.scene);
            cabinMat.diffuseColor = new BABYLON.Color3(0.1, 0.15, 0.2);
            cabinMat.alpha = 0.6;
            cabin.material = cabinMat;
            
            // Autonomous LIDAR Dome
            const lidarStand = BABYLON.MeshBuilder.CreateCylinder("lidarStand", { height: 0.15, diameter: 0.2 }, this.scene);
            lidarStand.position.y = 1.25;
            lidarStand.parent = carNode;
            const darkMat = new BABYLON.StandardMaterial("darkMat", this.scene);
            darkMat.diffuseColor = new BABYLON.Color3(0.1, 0.1, 0.1);
            lidarStand.material = darkMat;
            
            const lidarDome = BABYLON.MeshBuilder.CreateCylinder("lidarDome", { height: 0.1, diameter: 0.4 }, this.scene);
            lidarDome.position.y = 1.35;
            lidarDome.parent = carNode;
            
            const lidarMat = new BABYLON.StandardMaterial("lidarMat", this.scene);
            lidarMat.diffuseColor = new BABYLON.Color3(0.0, 0.9, 1.0);
            lidarMat.emissiveColor = new BABYLON.Color3(0.0, 0.6, 0.8);
            lidarDome.material = lidarMat;
            
            // Wheels
            const wheelPositions = [
                { x: -0.85, y: 0.2, z: 1.0 },
                { x: 0.85, y: 0.2, z: 1.0 },
                { x: -0.85, y: 0.2, z: -1.0 },
                { x: 0.85, y: 0.2, z: -1.0 }
            ];
            wheelPositions.forEach((pos, idx) => {
                const wheel = BABYLON.MeshBuilder.CreateCylinder(`wheel_${idx}`, { height: 0.35, diameter: 0.55 }, this.scene);
                wheel.rotation.z = Math.PI / 2;
                wheel.position = new BABYLON.Vector3(pos.x, pos.y, pos.z);
                wheel.parent = carNode;
                wheel.material = darkMat;
            });

            // Headlights
            const headlightL = BABYLON.MeshBuilder.CreateSphere("headlightL", { diameter: 0.15 }, this.scene);
            headlightL.position = new BABYLON.Vector3(-0.6, 0.45, 1.6);
            headlightL.parent = carNode;
            
            const headlightR = headlightL.clone("headlightR");
            headlightR.position.x = 0.6;
            headlightR.parent = carNode;
            
            const lightMat = new BABYLON.StandardMaterial("lightMat", this.scene);
            lightMat.diffuseColor = new BABYLON.Color3(1.0, 0.95, 0.8);
            lightMat.emissiveColor = new BABYLON.Color3(1.0, 0.9, 0.6);
            headlightL.material = lightMat;
            headlightR.material = lightMat;
            
            return { carNode, lidarDome, lightMat, lidarMat };
        };

        // Clockwise Loop Waypoints (Inner Lane)
        const pathCW = [
            new BABYLON.Vector3(-102.5, -0.14, -72.5),
            new BABYLON.Vector3(102.5, -0.14, -72.5),
            new BABYLON.Vector3(102.5, -0.14, 72.5),
            new BABYLON.Vector3(-102.5, -0.14, 72.5)
        ];

        // Counter-Clockwise Loop Waypoints (Outer Lane)
        const pathCCW = [
            new BABYLON.Vector3(-107.5, -0.14, -77.5),
            new BABYLON.Vector3(-107.5, -0.14, 77.5),
            new BABYLON.Vector3(107.5, -0.14, 77.5),
            new BABYLON.Vector3(107.5, -0.14, -77.5)
        ];

        // Spawn 3 CW cars
        for (let i = 0; i < 3; i++) {
            const carData = createCarMesh(`car_cw_${i}`, colors[i % colors.length]);
            carData.carNode.position = pathCW[i].clone();
            
            this.cars.push({
                mesh: carData.carNode,
                lidarMesh: carData.lidarDome,
                lightMat: carData.lightMat,
                lidarMat: carData.lidarMat,
                path: pathCW,
                currentWaypointIdx: (i + 1) % pathCW.length,
                speed: 16.0 + Math.random() * 6.0
            });
        }

        // Spawn 3 CCW cars
        for (let i = 0; i < 3; i++) {
            const carData = createCarMesh(`car_ccw_${i}`, colors[(i + 3) % colors.length]);
            carData.carNode.position = pathCCW[i].clone();
            
            this.cars.push({
                mesh: carData.carNode,
                lidarMesh: carData.lidarDome,
                lightMat: carData.lightMat,
                lidarMat: carData.lidarMat,
                path: pathCCW,
                currentWaypointIdx: (i + 1) % pathCCW.length,
                speed: 16.0 + Math.random() * 6.0
            });
        }
    }

    updateCars(dt) {
        const t = performance.now() / 1000.0;
        this.cars.forEach(car => {
            if (car.lidarMesh) {
                car.lidarMesh.rotation.y = t * 6.0; // Spin lidar sensor
            }
            
            const target = car.path[car.currentWaypointIdx];
            const currentPos = car.mesh.position;
            const dir = target.subtract(currentPos);
            dir.y = 0;
            
            const dist = dir.length();
            const moveDist = car.speed * dt;
            
            if (dist <= moveDist) {
                car.mesh.position.x = target.x;
                car.mesh.position.z = target.z;
                car.currentWaypointIdx = (car.currentWaypointIdx + 1) % car.path.length;
                
                const nextTarget = car.path[car.currentWaypointIdx];
                const nextDir = nextTarget.subtract(car.mesh.position);
                nextDir.y = 0;
                nextDir.normalize();
                const angle = Math.atan2(nextDir.x, nextDir.z);
                car.mesh.rotation.y = angle;
            } else {
                dir.normalize();
                car.mesh.position.addInPlace(dir.scale(moveDist));
                const angle = Math.atan2(dir.x, dir.z);
                car.mesh.rotation.y = angle;
            }
        });
    }

    updateTimeOfDay(dt) {
        const utc = new Date().getTime() + new Date().getTimezoneOffset() * 60000;
        const dallasDate = new Date(utc + (3600000 * -5)); // Dallas CDT (UTC-5)
        this.timeOfDay = dallasDate.getHours() + dallasDate.getMinutes() / 60.0 + dallasDate.getSeconds() / 3600.0;
        
        let intensity = 1.0;
        let isNight = false;

        if (this.timeOfDay >= 17 && this.timeOfDay < 19.5) {
            const factor = (this.timeOfDay - 17) / 2.5;
            intensity = 1.0 - factor * 0.85;
        } else if (this.timeOfDay >= 19.5 || this.timeOfDay < 5) {
            intensity = 0.15;
            isNight = true;
        } else if (this.timeOfDay >= 5 && this.timeOfDay < 8) {
            const factor = (this.timeOfDay - 5) / 3.0;
            intensity = 0.15 + factor * 0.85;
        }

        if (this.ambientLight) {
            // Clamp to 0.5 minimum so mall interior stays visible at night
            this.ambientLight.intensity = Math.max(0.5, intensity * 0.85);
        }
        
        const emissiveFactor = isNight ? 1.0 : 0.05;
        
        // Update Streetlights
        this.streetlights.forEach(sl => {
            sl.lanternMat.emissiveColor = new BABYLON.Color3(0.95 * emissiveFactor, 0.8 * emissiveFactor, 0.3 * emissiveFactor);
        });
        
        // Update Cars
        this.cars.forEach(car => {
            car.lightMat.emissiveColor = new BABYLON.Color3(1.0 * emissiveFactor, 0.9 * emissiveFactor, 0.6 * emissiveFactor);
            car.lidarMat.emissiveColor = new BABYLON.Color3(0.0, 0.6 * emissiveFactor, 0.8 * (isNight ? 1.0 : 0.25));
        });

        // Dynamic Sky/ClearColor — fixed dark navy regardless of time
        this.scene.clearColor = new BABYLON.Color4(0.04, 0.06, 0.10, 1.0);
    }

    buildCinema() {
        const cinemaExtMat = new BABYLON.StandardMaterial("cinemaExtMat", this.scene);
        cinemaExtMat.diffuseColor = BABYLON.Color3.FromHexString("#0A0E16");
        
        const ribTexture = new BABYLON.DynamicTexture("ribTexture", {width: 16, height: 128}, this.scene);
        const ribCtx = ribTexture.getContext();
        ribCtx.fillStyle = "#0A0E16";
        ribCtx.fillRect(0, 0, 16, 128);
        ribCtx.fillStyle = "#161D2A";
        for (let y = 0; y < 128; y += 16) {
            ribCtx.fillRect(0, y, 16, 2);
        }
        ribTexture.update();
        cinemaExtMat.emissiveTexture = ribTexture;
        cinemaExtMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);

        // North Wall
        const cWallN = BABYLON.MeshBuilder.CreateBox("cinemaWallN", { width: 40, height: 14, depth: 0.2 }, this.scene);
        cWallN.position = new BABYLON.Vector3(80, 7.0, -25);
        cWallN.material = cinemaExtMat;
        cWallN.freezeWorldMatrix();

        // South Wall
        const cWallS = BABYLON.MeshBuilder.CreateBox("cinemaWallS", { width: 40, height: 14, depth: 0.2 }, this.scene);
        cWallS.position = new BABYLON.Vector3(80, 7.0, 25);
        cWallS.material = cinemaExtMat;
        cWallS.freezeWorldMatrix();

        // East Wall
        const cWallE = BABYLON.MeshBuilder.CreateBox("cinemaWallE", { width: 0.2, height: 14, depth: 50 }, this.scene);
        cWallE.position = new BABYLON.Vector3(100, 7.0, 0);
        cWallE.material = cinemaExtMat;
        cWallE.freezeWorldMatrix();

        // West Wall panels
        const cWallWN = BABYLON.MeshBuilder.CreateBox("cinemaWallWN", { width: 0.2, height: 14, depth: 19 }, this.scene);
        cWallWN.position = new BABYLON.Vector3(60, 7.0, -15.5);
        cWallWN.material = cinemaExtMat;
        cWallWN.freezeWorldMatrix();

        const cWallWS = BABYLON.MeshBuilder.CreateBox("cinemaWallWS", { width: 0.2, height: 14, depth: 19 }, this.scene);
        cWallWS.position = new BABYLON.Vector3(60, 7.0, 15.5);
        cWallWS.material = cinemaExtMat;
        cWallWS.freezeWorldMatrix();

        const cWallWAbove = BABYLON.MeshBuilder.CreateBox("cinemaWallWAbove", { width: 0.2, height: 8, depth: 12 }, this.scene);
        cWallWAbove.position = new BABYLON.Vector3(60, 10.0, 0);
        cWallWAbove.material = cinemaExtMat;
        cWallWAbove.freezeWorldMatrix();

        // Roof
        const cRoofMat = new BABYLON.StandardMaterial("cinemaRoofMat", this.scene);
        cRoofMat.diffuseColor = BABYLON.Color3.FromHexString("#060810");
        const cRoof = BABYLON.MeshBuilder.CreateBox("cinemaRoof", { width: 40, height: 0.4, depth: 53 }, this.scene);
        cRoof.position = new BABYLON.Vector3(80, 14.2, 0);
        cRoof.material = cRoofMat;
        cRoof.freezeWorldMatrix();

        // North Entrance Canopy & pillars
        const canopy = BABYLON.MeshBuilder.CreateBox("cinemaCanopy", { width: 20, height: 0.2, depth: 5 }, this.scene);
        canopy.position = new BABYLON.Vector3(80, 4.0, -27.5);
        canopy.material = cinemaExtMat;
        canopy.freezeWorldMatrix();

        const pillarMat = new BABYLON.StandardMaterial("canopyPillarMat", this.scene);
        pillarMat.diffuseColor = new BABYLON.Color3(0.3, 0.33, 0.35);
        const pillar1 = BABYLON.MeshBuilder.CreateCylinder("canopyPillar1", { height: 4, diameter: 0.2 }, this.scene);
        pillar1.position = new BABYLON.Vector3(71, 2.0, -29.9);
        pillar1.material = pillarMat;
        pillar1.freezeWorldMatrix();

        const pillar2 = BABYLON.MeshBuilder.CreateCylinder("canopyPillar2", { height: 4, diameter: 0.2 }, this.scene);
        pillar2.position = new BABYLON.Vector3(89, 2.0, -29.9);
        pillar2.material = pillarMat;
        pillar2.freezeWorldMatrix();

        // Exterior Accent lights (vertically on North & East faces)
        const accentMat = new BABYLON.StandardMaterial("cinemaAccentMat", this.scene);
        accentMat.emissiveColor = new BABYLON.Color3(0, 0.215, 0.24); // #00E5FF @ 0.15 intensity
        accentMat.diffuseColor = new BABYLON.Color3(0, 0.9, 1.0);
        
        const accentN1 = BABYLON.MeshBuilder.CreateBox("accentN1", { width: 0.15, height: 14, depth: 0.1 }, this.scene);
        accentN1.position = new BABYLON.Vector3(65, 7, -25.1);
        accentN1.material = accentMat;
        accentN1.freezeWorldMatrix();

        const accentN2 = BABYLON.MeshBuilder.CreateBox("accentN2", { width: 0.15, height: 14, depth: 0.1 }, this.scene);
        accentN2.position = new BABYLON.Vector3(95, 7, -25.1);
        accentN2.material = accentMat;
        accentN2.freezeWorldMatrix();

        const accentE = BABYLON.MeshBuilder.CreateBox("accentE", { width: 0.1, height: 14, depth: 0.15 }, this.scene);
        accentE.position = new BABYLON.Vector3(100.1, 7, 0);
        accentE.material = accentMat;
        accentE.freezeWorldMatrix();

        // Floors: lobby, back section, and transitional corridor
        const cinemaLobbyFloorMat = new BABYLON.StandardMaterial("cinemaLobbyFloorMat", this.scene);
        cinemaLobbyFloorMat.diffuseColor = BABYLON.Color3.FromHexString("#1A1614");
        cinemaLobbyFloorMat.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3);

        const lobbyFloor = BABYLON.MeshBuilder.CreateBox("lobbyFloor", { width: 16, height: 0.02, depth: 50 }, this.scene);
        lobbyFloor.position = new BABYLON.Vector3(72, 0.01, 0);
        lobbyFloor.material = cinemaLobbyFloorMat;
        lobbyFloor.freezeWorldMatrix();

        const backFloor = BABYLON.MeshBuilder.CreateBox("backFloor", { width: 20, height: 0.02, depth: 50 }, this.scene);
        backFloor.position = new BABYLON.Vector3(90, 0.01, 0);
        backFloor.material = cinemaLobbyFloorMat;
        backFloor.freezeWorldMatrix();

        const corridorFloor = BABYLON.MeshBuilder.CreateBox("corridorFloor", { width: 4, height: 0.02, depth: 12 }, this.scene);
        corridorFloor.position = new BABYLON.Vector3(62, 0.01, 0);
        
        const gradTex = new BABYLON.DynamicTexture("gradTex", {width: 128, height: 16}, this.scene);
        const gradCtx = gradTex.getContext();
        const gradient = gradCtx.createLinearGradient(0, 0, 128, 0);
        gradient.addColorStop(0, "#ECDDC5"); // mall floor color
        gradient.addColorStop(1, "#1A1614"); // cinema lobby floor
        gradCtx.fillStyle = gradient;
        gradCtx.fillRect(0, 0, 128, 16);
        gradTex.update();
        const corridorFloorMat = new BABYLON.StandardMaterial("corridorFloorMat", this.scene);
        corridorFloorMat.diffuseTexture = gradTex;
        corridorFloor.material = corridorFloorMat;
        corridorFloor.freezeWorldMatrix();

        // Concession Counter & Menu Board
        const concessionMat = new BABYLON.StandardMaterial("concessionMat", this.scene);
        concessionMat.diffuseColor = BABYLON.Color3.FromHexString("#1E1A14");
        
        const counter = BABYLON.MeshBuilder.CreateBox("cinemaConcession", { width: 4, height: 2, depth: 16 }, this.scene);
        counter.position = new BABYLON.Vector3(72, 1.0, 0);
        counter.material = concessionMat;
        counter.freezeWorldMatrix();

        const strip = BABYLON.MeshBuilder.CreateBox("concessionStrip", { width: 0.05, height: 0.2, depth: 15.6 }, this.scene);
        strip.position = new BABYLON.Vector3(-2.01, 0.5, 0);
        strip.parent = counter;
        const stripMat = new BABYLON.StandardMaterial("concessionStripMat", this.scene);
        stripMat.emissiveColor = new BABYLON.Color3(1.0, 0.5, 0.0);
        strip.material = stripMat;

        const menuTex = new BABYLON.DynamicTexture("menuTex", {width: 256, height: 64}, this.scene);
        const menuCtx = menuTex.getContext();
        menuCtx.fillStyle = "#0C0908";
        menuCtx.fillRect(0, 0, 256, 64);
        menuCtx.fillStyle = "#FFB800";
        menuCtx.font = "bold 18px Rajdhani, sans-serif";
        menuCtx.textAlign = "center";
        menuCtx.textBaseline = "middle";
        menuCtx.fillText("POPCORN  SODA  NACHOS", 128, 32);
        menuTex.update();
        const menuMat = new BABYLON.StandardMaterial("menuMat", this.scene);
        menuMat.diffuseTexture = menuTex;
        menuMat.emissiveTexture = menuTex;
        
        const menuBoard = BABYLON.MeshBuilder.CreatePlane("menuBoard", { width: 15.6, height: 1.2 }, this.scene);
        menuBoard.position = new BABYLON.Vector3(69.95, 2.5, 0);
        menuBoard.rotation.y = -Math.PI / 2;
        menuBoard.material = menuMat;
        menuBoard.freezeWorldMatrix();

        // Ticketing desk
        const ticketDesk = BABYLON.MeshBuilder.CreateBox("ticketDesk", { width: 3, height: 1.5, depth: 6 }, this.scene);
        ticketDesk.position = new BABYLON.Vector3(66, 0.75, -8);
        ticketDesk.material = concessionMat;
        ticketDesk.freezeWorldMatrix();

        // Waiting Area Seats
        const seatMat = new BABYLON.StandardMaterial("cinemaSeatMat", this.scene);
        seatMat.diffuseColor = BABYLON.Color3.FromHexString("#2C2621");
        const seatPositions = [{ x: 67, z: 8 }, { x: 69, z: 12 }, { x: 67, z: 16 }, { x: 70, z: 19 }];
        seatPositions.forEach((pos, idx) => {
            const seat = BABYLON.MeshBuilder.CreateCylinder(`cinemaSeat_${idx}`, { height: 0.5, diameter: 1.2 }, this.scene);
            seat.position = new BABYLON.Vector3(pos.x, 0.25, pos.z);
            seat.material = seatMat;
            seat.freezeWorldMatrix();
        });

        // Mezzanine level floor and glass railing
        const mezzFloor = BABYLON.MeshBuilder.CreateBox("mezzFloor", { width: 16, height: 0.2, depth: 8 }, this.scene);
        mezzFloor.position = new BABYLON.Vector3(72, 7.0, -21);
        mezzFloor.material = cinemaLobbyFloorMat;
        mezzFloor.freezeWorldMatrix();

        const glassMat = this.scene.getMaterialByName("glassRailingMat");
        const mezzRailing = BABYLON.MeshBuilder.CreateBox("mezzRailing", { width: 16, height: 1.2, depth: 0.1 }, this.scene);
        mezzRailing.position = new BABYLON.Vector3(72, 7.7, -17);
        if (glassMat) mezzRailing.material = glassMat;
        mezzRailing.freezeWorldMatrix();

        // 3 Screening Rooms
        const screenRoomMat = new BABYLON.StandardMaterial("screenRoomMat", this.scene);
        screenRoomMat.diffuseColor = BABYLON.Color3.FromHexString("#080808");
        screenRoomMat.specularColor = new BABYLON.Color3(0, 0, 0);

        this.screeningRooms = [];
        const roomData = [
            { id: 1, center: new BABYLON.Vector3(89, 7, -15), size: { w: 16, d: 24, h: 12 } },
            { id: 2, center: new BABYLON.Vector3(89, 7, 0), size: { w: 16, d: 24, h: 12 } },
            { id: 3, center: new BABYLON.Vector3(89, 7, 15), size: { w: 16, d: 24, h: 12 } }
        ];

        roomData.forEach(room => {
            const box = BABYLON.MeshBuilder.CreateBox(`screenRoom_${room.id}`, {
                width: room.size.w,
                height: room.size.h,
                depth: room.size.d
            }, this.scene);
            box.position = room.center;
            box.material = screenRoomMat;

            // Recessed Door
            const door = BABYLON.MeshBuilder.CreateBox(`door_${room.id}`, { width: 0.1, height: 4, depth: 3 }, this.scene);
            door.position = new BABYLON.Vector3(-room.size.w/2 - 0.02, -room.size.h/2 + 2, 0);
            door.parent = box;
            const doorMat = new BABYLON.StandardMaterial(`doorMat_${room.id}`, this.scene);
            doorMat.diffuseColor = new BABYLON.Color3(0.02, 0.02, 0.02);
            door.material = doorMat;

            // Emissive State Sign Above Door
            const sign = BABYLON.MeshBuilder.CreatePlane(`sign_${room.id}`, { width: 2, height: 0.6 }, this.scene);
            sign.position = new BABYLON.Vector3(-room.size.w/2 - 0.05, -room.size.h/2 + 4.8, 0);
            sign.rotation.y = -Math.PI / 2;
            sign.parent = box;

            const signMat = new BABYLON.StandardMaterial(`signMat_${room.id}`, this.scene);
            const defaultState = (room.id === 3) ? "intermission" : "showing";
            const glowColor = (defaultState === "showing") ? new BABYLON.Color3(1.0, 0.5, 0) : new BABYLON.Color3(0, 0.5, 1.0);
            signMat.emissiveColor = glowColor;
            signMat.diffuseColor = glowColor;
            sign.material = signMat;

            box.freezeWorldMatrix();

            this.screeningRooms.push({
                id: room.id,
                mesh: box,
                signMat: signMat,
                state: defaultState
            });
        });

        // Large North Exterior Sign
        const mainSignPlate = BABYLON.MeshBuilder.CreatePlane("cineplexMainSign", { width: 24, height: 3 }, this.scene);
        mainSignPlate.position = new BABYLON.Vector3(80, 10, -25.15);
        mainSignPlate.rotation.y = Math.PI;

        const signPlateTex = new BABYLON.DynamicTexture("cineplexPlateTex", { width: 512, height: 128 }, this.scene);
        const signPlateMat = new BABYLON.StandardMaterial("cineplexPlateMat", this.scene);
        signPlateMat.diffuseTexture = signPlateTex;
        signPlateMat.emissiveTexture = signPlateTex;
        mainSignPlate.material = mainSignPlate; // wait, mainSignPlate.material = signPlateMat
        mainSignPlate.material = signPlateMat;

        const spCtx = signPlateTex.getContext();
        spCtx.fillStyle = "rgba(10, 14, 22, 0.85)";
        spCtx.fillRect(0, 0, 512, 128);
        spCtx.fillStyle = "#00E5FF";
        spCtx.font = "bold 56px Rajdhani, sans-serif";
        spCtx.shadowColor = "#00E5FF";
        spCtx.shadowBlur = 15;
        spCtx.textAlign = "center";
        spCtx.textBaseline = "middle";
        spCtx.fillText("CINEPLEX GRAND", 256, 64);
        signPlateTex.update();
        mainSignPlate.freezeWorldMatrix();

        // Smaller Corridor Mall Interior Sign
        const innerSignPlate = BABYLON.MeshBuilder.CreatePlane("cineplexInnerSign", { width: 8, height: 1.5 }, this.scene);
        innerSignPlate.position = new BABYLON.Vector3(59.9, 5, 0);
        innerSignPlate.rotation.y = Math.PI / 2;

        const innerPlateTex = new BABYLON.DynamicTexture("cineplexInnerTex", { width: 256, height: 64 }, this.scene);
        const innerPlateMat = new BABYLON.StandardMaterial("cineplexInnerMat", this.scene);
        innerPlateMat.diffuseTexture = innerPlateTex;
        innerPlateMat.emissiveTexture = innerPlateTex;
        innerSignPlate.material = innerPlateMat;

        const ipCtx = innerPlateTex.getContext();
        ipCtx.fillStyle = "#111520";
        ipCtx.fillRect(0, 0, 256, 64);
        ipCtx.fillStyle = "#00E5FF";
        ipCtx.font = "bold 24px Rajdhani, sans-serif";
        ipCtx.textAlign = "center";
        ipCtx.textBaseline = "middle";
        ipCtx.fillText("CINEPLEX GRAND →", 128, 32);
        innerPlateTex.update();
        innerSignPlate.freezeWorldMatrix();

        // Setup default movie poster on AD-PRK-01
        setTimeout(() => {
            const screen = this.adScreens["AD-PRK-01"];
            if (screen) {
                const posterTex = new BABYLON.DynamicTexture("posterTex", { width: 256, height: 128 }, this.scene);
                const posterCtx = posterTex.getContext();
                posterCtx.fillStyle = "#080B10";
                posterCtx.fillRect(0, 0, 256, 128);
                posterCtx.fillStyle = "#E0E6ED";
                posterCtx.font = "bold 20px Rajdhani, sans-serif";
                posterCtx.textAlign = "center";
                posterCtx.textBaseline = "middle";
                posterCtx.fillText("NOW SHOWING", 128, 40);
                posterCtx.fillStyle = "#00E5FF";
                posterCtx.fillText("COSMIC HORIZON", 128, 80);
                posterTex.update();
                screen.material.diffuseTexture = posterTex;
                screen.material.emissiveTexture = posterTex;
            }
        }, 100);
    }

    CINEMA_EXIT_PATH = {
        origins: [
            {x: 80, z: -15},
            {x: 80, z: 0},
            {x: 80, z: 15}
        ],
        corridor_waypoint: {x: 62, z: 0},
        mall_entry_waypoint: {x: 55, z: 0},
        disperse_zone: "Z3"
    };

    triggerCinemaExit(screenRoomId, crowdSize) {
        const origin = this.CINEMA_EXIT_PATH.origins[screenRoomId - 1] || this.CINEMA_EXIT_PATH.origins[0];
        
        this.triggerCinemaExitCameraPan();
        
        for (let i = 0; i < crowdSize; i++) {
            const id = `shopper_cinema_${Date.now()}_${i}_${Math.random()}`;
            const instance = this.shopperBase.createInstance(id);
            instance.position = new BABYLON.Vector3(origin.x, 0.6, origin.z);
            instance.floor = 1;
            instance.speed = 2.5 + Math.random() * 1.5;
            
            instance.exitPath = [
                new BABYLON.Vector3(this.CINEMA_EXIT_PATH.corridor_waypoint.x, 0.6, this.CINEMA_EXIT_PATH.corridor_waypoint.z),
                new BABYLON.Vector3(this.CINEMA_EXIT_PATH.mall_entry_waypoint.x, 0.6, this.CINEMA_EXIT_PATH.mall_entry_waypoint.z)
            ];
            instance.waypoint = instance.exitPath.shift();
            instance.isExitingCinema = true;
            
            this.shoppers.push(instance);
        }
    }

    setCinemaRoomState(roomId, state) {
        const room = this.screeningRooms.find(r => r.id === roomId);
        if (!room) return;
        
        room.state = state;
        const mat = room.signMat;
        
        if (state === "showing") {
            mat.emissiveColor = new BABYLON.Color3(1.0, 0.5, 0.0);
            mat.diffuseColor = new BABYLON.Color3(1.0, 0.5, 0.0);
        } else if (state === "intermission") {
            mat.emissiveColor = new BABYLON.Color3(0.0, 0.5, 1.0);
            mat.diffuseColor = new BABYLON.Color3(0.0, 0.5, 1.0);
        } else if (state === "credits") {
            mat.emissiveColor = new BABYLON.Color3(1.0, 0.5, 0.0);
            mat.diffuseColor = new BABYLON.Color3(1.0, 0.5, 0.0);
        } else if (state === "emptying") {
            mat.emissiveColor = new BABYLON.Color3(1.0, 1.0, 1.0);
            mat.diffuseColor = new BABYLON.Color3(1.0, 1.0, 1.0);
        }
    }

    triggerCorridorSweep() {
        const sweepPlane = BABYLON.MeshBuilder.CreatePlane("corridorSweep", { width: 12, height: 6 }, this.scene);
        sweepPlane.position = new BABYLON.Vector3(64, 3, 0);
        sweepPlane.rotation.y = Math.PI / 2;
        
        const sweepMat = new BABYLON.StandardMaterial("sweepMat", this.scene);
        sweepMat.diffuseColor = new BABYLON.Color3(0, 0.9, 1.0);
        sweepMat.emissiveColor = new BABYLON.Color3(0, 0.9, 1.0);
        sweepMat.alpha = 0.5;
        sweepPlane.material = sweepMat;
        
        const start = performance.now();
        const duration = 1500;
        
        const anim = () => {
            const elapsed = performance.now() - start;
            const progress = Math.min(elapsed / duration, 1.0);
            sweepPlane.position.x = 64 - progress * 4;
            sweepMat.alpha = 0.5 * (1.0 - progress);
            
            if (progress < 1.0) {
                requestAnimationFrame(anim);
            } else {
                sweepPlane.dispose();
            }
        };
        requestAnimationFrame(anim);
    }

    setCinemaView() {
        this.camera.alpha = -Math.PI / 4;
        this.camera.beta = Math.PI / 3.8;
        this.camera.radius = 100;
        this.camera.target = new BABYLON.Vector3(75, 4, 0);
    }

    triggerCinemaExitCameraPan() {
        const prevAlpha = this.camera.alpha;
        const prevBeta = this.camera.beta;
        const prevRadius = this.camera.radius;
        const prevTarget = this.camera.target.clone();
        
        this.setCinemaView();
        
        setTimeout(() => {
            this.camera.alpha = prevAlpha;
            this.camera.beta = prevBeta;
            this.camera.radius = prevRadius;
            this.camera.target = prevTarget;
        }, 5000);
    }
}

// Auto-boot simulation
window.addEventListener("DOMContentLoaded", () => {
    new PulseMallSimulation();
});
