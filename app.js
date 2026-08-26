'use strict';

(() => {
  const APP_VERSION = 15;
  const MAX_HISTORY = 80;
  const MIN_ZOOM = 0.03;
  const MAX_ZOOM = 12;
  const TOUCH_LONG_PRESS_MS = 550;
  const TOUCH_MOVE_CANCEL_PX = 10;
  const PK1_WIDTH = 2000;
  const PK1_HEIGHT = 3250;
  const PK1_DISPLAY_WIDTH = 2595;
  const PK1_DISPLAY_HEIGHT = 2134;
  const PK1_BACKGROUND = { builtin: true, name: 'PK1標準マップ', type: 'image/png', src: 'map.png', width: PK1_DISPLAY_WIDTH, height: PK1_DISPLAY_HEIGHT };
  const PK1_CALIBRATION = { topLeft: { x: 0, y: 0 }, bottomRight: { x: PK1_WIDTH, y: PK1_HEIGHT } };
  const SCENARIO_KEYS = ['A', 'B', 'C'];
  const PHASES = ['共通', '第1段階', '第2段階', '第3段階', '予備'];
  const PK1_ROUTE_WORKER_SOURCE = String.raw`
const W=2000,H=3250,N=W*H;
let bitset=null,stationBits=null;
let gScore=new Uint32Array(N),roadScore=new Uint16Array(N),turnScore=new Uint16Array(N),seen=new Uint16Array(N),parentDir=new Uint8Array(N),generation=1;
const dirs=[[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
function bitOn(bits,i){return !!bits&&((bits[i>>3]>>(i&7))&1)!==0}
function basePassable(i){return bitOn(bitset,i)}
function isStationRoad(i){return bitOn(stationBits,i)}
function makeBlocked(gates,ids){const wanted=new Set((ids||[]).map(Number)),out=new Set();if(!wanted.size)return out;for(const g of gates){if(!wanted.has(Number(g.id)))continue;for(let y=Number(g.ymin);y<=Number(g.ymax);y++)for(let x=Number(g.xmin);x<=Number(g.xmax);x++)out.add(y*W+x)}return out}
function heuristic(x,y,gx,gy){return Math.max(Math.abs(x-gx),Math.abs(y-gy))}
function betterHeap(a,b){return a.f<b.f||(a.f===b.f&&(a.r>b.r||(a.r===b.r&&a.t<b.t)))}
class Heap{constructor(){this.a=[]}get length(){return this.a.length}push(v){let p=this.a.length;this.a.push(v);while(p){const q=(p-1)>>1;if(betterHeap(this.a[q],v))break;this.a[p]=this.a[q];p=q}this.a[p]=v}pop(){const n=this.a.length;if(!n)return null;const out=this.a[0],last=this.a.pop();if(n>1){let p=0;while(true){let a=p*2+1;if(a>=n-1)break;let b=a+1,c=b<n-1&&betterHeap(this.a[b],this.a[a])?b:a;if(betterHeap(last,this.a[c]))break;this.a[p]=this.a[c];p=c}this.a[p]=last}return out}}
function bump(){generation++;if(generation>=65535){seen.fill(0);generation=1}}
function route(start,goal,blocked,maxExpand=3000000){
  bump();const[sx,sy]=start,[gx,gy]=goal;
  if(sx<0||sx>=W||sy<0||sy>=H||gx<0||gx>=W||gy<0||gy>=H)return{status:'outside'};
  const sidx=sy*W+sx,gidx=gy*W+gx,can=i=>basePassable(i)&&!blocked.has(i);
  if(!can(sidx))return{status:'start_blocked'};if(!can(gidx))return{status:'goal_blocked'};
  const heap=new Heap();seen[sidx]=generation;gScore[sidx]=0;roadScore[sidx]=isStationRoad(sidx)?1:0;turnScore[sidx]=0;parentDir[sidx]=0;
  heap.push({i:sidx,f:heuristic(sx,sy,gx,gy),g:0,r:roadScore[sidx],t:0});
  let expanded=0,bestGoal=0xffffffff;
  while(heap.length){
    const q=heap.pop(),idx=q.i;
    if(seen[idx]!==generation||gScore[idx]!==q.g||roadScore[idx]!==q.r||turnScore[idx]!==q.t)continue;
    if(q.f>bestGoal)break;
    if(idx===gidx){bestGoal=q.g;continue}
    if(++expanded>maxExpand)return{status:'max_expand',expanded};
    const x=idx%W,y=Math.floor(idx/W),prev=parentDir[idx]-1;
    for(let di=0;di<8;di++){
      const dx=dirs[di][0],dy=dirs[di][1],nx=x+dx,ny=y+dy;if(nx<0||nx>=W||ny<0||ny>=H)continue;
      const ni=ny*W+nx;if(!can(ni))continue;
      const ng=q.g+1,nf=ng+heuristic(nx,ny,gx,gy);if(nf>bestGoal)continue;
      const nr=Math.min(65535,q.r+(isStationRoad(ni)?1:0));
      const nt=Math.min(65535,q.t+((prev>=0&&prev!==di)?1:0));
      const better=seen[ni]!==generation||ng<gScore[ni]||(ng===gScore[ni]&&(nr>roadScore[ni]||(nr===roadScore[ni]&&nt<turnScore[ni])));
      if(better){seen[ni]=generation;gScore[ni]=ng;roadScore[ni]=nr;turnScore[ni]=nt;parentDir[ni]=di+1;heap.push({i:ni,f:nf,g:ng,r:nr,t:nt})}
    }
  }
  if(seen[gidx]!==generation||gScore[gidx]===0xffffffff)return{status:'no_path',expanded};
  const rev=[gidx];let cur=gidx;
  while(cur!==sidx){const code=parentDir[cur]-1;if(code<0)return{status:'parent_error'};const[dx,dy]=dirs[code],x=cur%W,y=Math.floor(cur/W);cur=(y-dy)*W+(x-dx);rev.push(cur)}
  rev.reverse();return{status:'ok',path:rev,steps:rev.length-1,stationCells:roadScore[gidx],turns:turnScore[gidx],expanded};
}
function routeAll(points,blocked,maxExpand){let total=0,station=0,turns=0,expanded=0,full=[],segments=[];for(let k=0;k<points.length-1;k++){const r=route(points[k],points[k+1],blocked,maxExpand);expanded+=r.expanded||0;segments.push({start:points[k],goal:points[k+1],status:r.status,steps:r.steps??null,stationCells:r.stationCells??null,expanded:r.expanded||0});if(r.status!=='ok')return{status:r.status,totalSteps:null,segments,expanded};total+=r.steps;station+=r.stationCells||0;turns+=r.turns||0;full=full.concat(k?r.path.slice(1):r.path)}return{status:'ok',totalSteps:total,stationCells:station,turns,segments,expanded,path:full}}
function requiredSet(points){const s=new Set();for(const p of points||[])s.add(Number(p[1])*W+Number(p[0]));return s}
function blockRouteInterior(path,set,required){if(!path||path.length<3)return;for(let i=1;i<path.length-1;i++){const idx=path[i];if(!required.has(idx))set.add(idx)}}
function blockDiversityWindow(path,set,required,ratio,windowSize=7){if(!path||path.length<5)return;const center=Math.max(1,Math.min(path.length-2,Math.floor((path.length-1)*ratio))),half=Math.floor(windowSize/2);for(let i=Math.max(1,center-half);i<=Math.min(path.length-2,center+half);i++){const idx=path[i];if(!required.has(idx))set.add(idx)}}
function pack(r){return{totalSteps:r.totalSteps,stationCells:r.stationCells,turns:r.turns,expanded:r.expanded,path:new Uint32Array(r.path)}}
self.onmessage=e=>{const m=e.data;if(m.type==='init'){bitset=new Uint8Array(m.buffer);stationBits=new Uint8Array(Math.ceil(N/8));const runs=m.stationRuns?new Uint32Array(m.stationRuns):new Uint32Array(0);for(let k=0;k+1<runs.length;k+=2){const start=runs[k],len=runs[k+1];for(let i=start,end=Math.min(N,start+len);i<end;i++)stationBits[i>>3]|=1<<(i&7)}self.postMessage({type:'ready'});return}if(m.type!=='route')return;try{
  if(!bitset)throw new Error('route data not initialized');const gateBlocked=makeBlocked(m.gates||[],m.blockedGateIds||[]),pts=m.points||[],routeCount=Math.max(1,Math.min(3,Number(m.routeCount)||1)),routes=[];
  const r1=routeAll(pts,gateBlocked,m.maxExpand||3000000);if(r1.status!=='ok'){self.postMessage({type:'result',status:r1.status});return}routes.push(pack(r1));
  if(routeCount>=2){const req=requiredSet(pts),avoid1=new Set(gateBlocked);blockRouteInterior(r1.path,avoid1,req);const r2=routeAll(pts,avoid1,m.maxExpand||3000000);if(r2.status==='ok'){routes.push(pack(r2));if(routeCount>=3){let r3=null;for(const ratio of [.5,.34,.66,.25,.75]){const avoid3=new Set(avoid1);blockDiversityWindow(r2.path,avoid3,req,ratio,7);const trial=routeAll(pts,avoid3,m.maxExpand||3000000);if(trial.status==='ok'){r3=trial;break}}if(r3)routes.push(pack(r3))}}
  }
  const transfers=routes.map(r=>r.path.buffer);self.postMessage({type:'result',status:'ok',routes},transfers)
}catch(err){self.postMessage({type:'result',status:'error',message:String(err&&err.message||err)})}}
`;
  const PK1_DISPLAY_TRANSFORM = { m00:1.3811020352, m01:-1.1998330080000001, m10:0.7361070080000001, m11:0.568297248, tx:2225.7348256, ty:-536.8040288000001, im00:0.34068904150606916, im01:0.7192889969139248, im10:-0.44128946934724644, im11:0.8279581332661488 };

  const TYPE_META = {
    ally:     { name: '自軍',   label: '自軍部隊', color: '#2f80d0', size: 28, lineWidth: 3, symbol: '自' },
    enemy:    { name: '敵軍',   label: '敵軍部隊', color: '#d24f4f', size: 28, lineWidth: 3, symbol: '敵' },
    garrison: { name: '駐屯',   label: '駐屯地点', color: '#2f80d0', size: 30, lineWidth: 3, symbol: '駐' },
    camp:     { name: '幕舎',   label: '幕舎建設', color: '#3aa86d', size: 30, lineWidth: 3, symbol: '幕' },
    fort:     { name: '陣城',   label: '陣城建設', color: '#9267cf', size: 30, lineWidth: 3, symbol: '陣' },
    relocate: { name: '遷城',   label: '遷城予定', color: '#5f7fd8', size: 30, lineWidth: 3, symbol: '遷' },
    castle:   { name: '城',     label: '攻略対象の城', color: '#8b6948', size: 58, lineWidth: 5, symbol: '城' },
    gate:     { name: '関所',   label: '攻略対象の関所', color: '#a15f3e', size: 58, lineWidth: 5, symbol: '関' },
    bridge:   { name: '橋',     label: '攻略対象の橋', color: '#36818b', size: 58, lineWidth: 5, symbol: '橋' },
    station:  { name: '駅路',   label: '攻略対象の駅路', color: '#b17b2f', size: 58, lineWidth: 5, symbol: '駅' },
    arrow:    { name: '侵攻',   label: '侵攻ルート', color: '#2f80d0', size: 24, lineWidth: 5, symbol: '➜' },
    defense:  { name: '防衛線', label: '防衛線', color: '#e05bd8', size: 24, lineWidth: 4, symbol: '防' },
    area:     { name: '範囲',   label: '作戦範囲', color: '#d9a52a', size: 24, lineWidth: 3, symbol: '範' },
    target:   { name: '目標',   label: '攻略目標', color: '#e3563a', size: 32, lineWidth: 3, symbol: '目' },
    text:     { name: 'メモ',   label: '作戦メモ', color: '#f2f4f8', size: 20, lineWidth: 2, symbol: 'T' }
  };

  const refs = {};
  let canvas;
  let ctx;
  let project = createProject();
  let backgroundImage = null;
  let view = { scale: 1, x: 0, y: 0 };
  let activeTool = 'select';
  let selectedId = null;
  let phaseFilter = 'すべて';
  let activeScenario = 'A';
  let history = [];
  let future = [];
  let interaction = null;
  let drawPreview = null;
  let pendingDrawStart = null;
  let routeWorkerReady = false;
  let renderPending = false;
  let dirty = false;
  let spacePressed = false;
  let propertySnapshot = null;
  let toastTimer = null;

  let pk1Cities = [];
  let pk1Gates = [];
  let pk1Regions = [];
  let pk1Land = [];
  let placeLookup = new Map();
  let routeWorker = null;
  let routeBusy = false;
  let contextPlace = null;
  let contextObjectId = null;
  let pk1LabelHitBoxes = [];
  const activeTouchPointers = new Map();
  let pinchGesture = null;
  let longPressState = null;
  let suppressTouchPointerId = null;
  let mobileViewMode = false;
  let mobileFullscreen = false;
  let activeMobileInspectorTab = 'scenario';

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    cacheRefs();
    canvas = refs.mapCanvas;
    ctx = canvas.getContext('2d', { alpha: false });
    bindEvents();
    resizeCanvas();
    setTool('select');
    syncAllUI();
    requestRender();

    const observer = new ResizeObserver(() => {
      const oldCenter = screenToWorld(canvas.clientWidth / 2, canvas.clientHeight / 2, true);
      resizeCanvas();
      if (oldCenter) {
        view.x = canvas.clientWidth / 2 - oldCenter.x * view.scale;
        view.y = canvas.clientHeight / 2 - oldCenter.y * view.scale;
      }
      syncMobileControls();
      requestRender();
    });
    observer.observe(refs.stageWrap);

    loadBackgroundFromProject().then(() => {
      syncAllUI();
      fitView();
    }).catch(error => {
      console.error(error);
      backgroundImage = null;
      syncAllUI();
      showToast('PK1標準マップを読み込めませんでした', true);
    });
    loadPk1Assets().catch(error => {
      console.error(error);
      showToast('PK1経路データを読み込めませんでした。ページを再読み込みしてください。', true);
    });
  }

  function cacheRefs() {
    const ids = [
      'projectName', 'newProjectBtn', 'loadMapBtn', 'saveProjectBtn', 'loadProjectBtn',
      'exportMenuBtn', 'exportMenu', 'exportViewPngBtn', 'exportViewerBtn',
      'helpBtn', 'toggleInspectorBtn', 'closeInspectorBtn', 'mobileModeBtn', 'mobileFullscreenBtn', 'mobileFullscreenExitBtn', 'mapCanvas', 'stageWrap',
      'emptyState', 'emptyLoadMapBtn', 'toast', 'undoBtn', 'redoBtn', 'deleteBtn',
      'mobileSelectionBar', 'mobilePropertyBtn', 'mobileDuplicateBtn', 'mobileFrontBtn', 'mobileDeleteBtn', 'mobileRouteUndoFloat',
      'inspector', 'propertySection', 'propertyForm', 'propLabel', 'propSize', 'propLabelSize',
      'propLineWidth', 'propSymbolVisible', 'symbolVisibleField', 'propPhase', 'duplicateBtn', 'bringFrontBtn',
      'deleteObjectBtn', 'phaseFilter', 'calibrationBtn', 'calibrationSummary', 'layerList',
      'objectCount', 'gamePosition', 'fitBtn', 'zoomOutBtn', 'zoomDisplay',
      'zoomInBtn', 'mapFileInput', 'projectFileInput', 'helpDialog', 'calibrationDialog',
      'calibrationForm', 'calTopLeftX', 'calTopLeftY', 'calBottomRightX', 'calBottomRightY',
      'clearCalibrationBtn', 'saveCalibrationBtn', 'builtinMapBtn', 'emptyBuiltinMapBtn',
      'routeBadge', 'routePoints', 'routeCalculateBtn', 'routeUndoPointBtn', 'routeClearBtn',
      'placeSearch', 'placeSearchList', 'placeCenterBtn', 'placeAddBtn',
      'gateBlockClearBtn', 'gateBlockAllBtn', 'gateFilter', 'gateBlockList',
      'showGateMarkers', 'showCityMarkers', 'showGateLabels', 'showCityLabels', 'routeResult',
      'showAltRoute2', 'showAltRoute3',
      'placeContextMenu', 'placeContextTitle', 'placeContextRouteBtn', 'placeContextCopyBtn', 'placeContextGateBtn', 'placeContextDeleteBtn', 'placeContextBackdrop'
    ];
    for (const id of ids) refs[id] = document.getElementById(id);
    refs.toolButtons = Array.from(document.querySelectorAll('.tool-button[data-tool]'));
    refs.scenarioButtons = Array.from(document.querySelectorAll('.scenario-tab[data-scenario]'));
    refs.mobileInspectorTabButtons = Array.from(document.querySelectorAll('.mobile-inspector-tab[data-mobile-inspector-tab]'));
    refs.mobileInspectorPanels = Array.from(document.querySelectorAll('.panel-section[data-mobile-panel]'));
  }

  function bindEvents() {
    refs.toolButtons.forEach(btn => btn.addEventListener('click', () => setTool(btn.dataset.tool)));

    refs.newProjectBtn.addEventListener('click', newProject);
    refs.builtinMapBtn.addEventListener('click', activateBuiltinMap);
    refs.emptyBuiltinMapBtn.addEventListener('click', activateBuiltinMap);
    if (refs.loadMapBtn && refs.mapFileInput) refs.loadMapBtn.addEventListener('click', () => refs.mapFileInput.click());
    if (refs.emptyLoadMapBtn && refs.mapFileInput) refs.emptyLoadMapBtn.addEventListener('click', () => refs.mapFileInput.click());
    if (refs.mapFileInput) refs.mapFileInput.addEventListener('change', handleMapFile);
    refs.saveProjectBtn.addEventListener('click', saveProjectFile);
    refs.loadProjectBtn.addEventListener('click', () => refs.projectFileInput.click());
    refs.projectFileInput.addEventListener('change', handleProjectFile);

    refs.exportMenuBtn.addEventListener('click', toggleExportMenu);
    refs.exportViewPngBtn.addEventListener('click', () => { closeExportMenu(); exportViewPng(); });
    refs.exportViewerBtn.addEventListener('click', () => { closeExportMenu(); exportViewerHtml(); });
    document.addEventListener('pointerdown', e => {
      if (!refs.exportMenu.hidden && !e.target.closest('.menu-wrap')) closeExportMenu();
    });

    refs.helpBtn.addEventListener('click', () => refs.helpDialog.showModal());
    refs.toggleInspectorBtn.addEventListener('click', () => {
      if (isMobileReadOnly()) return;
      setMobileInspectorTab(activeMobileInspectorTab, true);
    });
    refs.closeInspectorBtn.addEventListener('click', () => refs.inspector.classList.remove('open'));
    refs.mobileModeBtn.addEventListener('click', () => setMobileViewMode(!mobileViewMode));
    refs.mobileFullscreenBtn.addEventListener('click', () => setMobileFullscreen(true));
    refs.mobileFullscreenExitBtn.addEventListener('click', () => setMobileFullscreen(false));
    refs.mobilePropertyBtn.addEventListener('click', () => openSelectedPropertiesMobile());
    refs.mobileDuplicateBtn.addEventListener('click', duplicateSelected);
    refs.mobileFrontBtn.addEventListener('click', bringSelectedToFront);
    refs.mobileDeleteBtn.addEventListener('click', deleteSelected);
    refs.mobileRouteUndoFloat.addEventListener('click', undoRoutePoint);
    refs.mobileInspectorTabButtons.forEach(btn => btn.addEventListener('click', () => setMobileInspectorTab(btn.dataset.mobileInspectorTab, true)));
    refs.placeContextBackdrop.addEventListener('pointerdown', e => { e.preventDefault(); hidePlaceContextMenu(); });

    refs.undoBtn.addEventListener('click', undo);
    refs.redoBtn.addEventListener('click', redo);
    refs.deleteBtn.addEventListener('click', deleteSelected);
    refs.deleteObjectBtn.addEventListener('click', deleteSelected);
    refs.duplicateBtn.addEventListener('click', duplicateSelected);
    refs.bringFrontBtn.addEventListener('click', bringSelectedToFront);

    refs.projectName.addEventListener('focus', () => { propertySnapshot = serializeProject(); });
    refs.projectName.addEventListener('input', () => {
      project.name = refs.projectName.value.trim() || '名称未設定';
      dirty = true;
    });
    refs.projectName.addEventListener('change', finishPropertyEdit);

    bindPropertyForm();

    refs.phaseFilter.addEventListener('change', () => {
      phaseFilter = refs.phaseFilter.value;
      if (selectedId && !isObjectVisible(getSelected())) selectObject(null);
      renderLayerList();
      requestRender();
    });

    if (refs.calibrationBtn) refs.calibrationBtn.addEventListener('click', openCalibrationDialog);
    if (refs.clearCalibrationBtn) refs.clearCalibrationBtn.addEventListener('click', clearCalibration);
    if (refs.calibrationForm) refs.calibrationForm.addEventListener('submit', saveCalibration);

    refs.routeCalculateBtn.addEventListener('click', () => calculateRoute(false));
    refs.routeUndoPointBtn.addEventListener('click', undoRoutePoint);
    refs.routeClearBtn.addEventListener('click', clearRoute);
    refs.routePoints.addEventListener('input', routePointsChanged);
    refs.placeCenterBtn.addEventListener('click', centerSelectedPlace);
    refs.placeAddBtn.addEventListener('click', addSelectedPlaceToRoute);
    refs.gateBlockClearBtn.addEventListener('click', () => setAllGateBlocks(false));
    refs.gateBlockAllBtn.addEventListener('click', () => setAllGateBlocks(true));
    refs.gateFilter.addEventListener('input', filterGateBlocks);
    refs.showGateMarkers.addEventListener('change', routeDisplayChanged);
    refs.showCityMarkers.addEventListener('change', routeDisplayChanged);
    refs.showGateLabels.addEventListener('change', routeDisplayChanged);
    refs.showCityLabels.addEventListener('change', routeDisplayChanged);
    refs.showAltRoute2.addEventListener('change', alternateRouteChanged);
    refs.showAltRoute3.addEventListener('change', alternateRouteChanged);
    refs.scenarioButtons.forEach(btn => btn.addEventListener('click', () => switchScenario(btn.dataset.scenario)));
    refs.placeContextRouteBtn.addEventListener('click', contextAddRoutePoint);
    refs.placeContextCopyBtn.addEventListener('click', contextCopyCoordinate);
    refs.placeContextGateBtn.addEventListener('click', contextToggleGateBlock);
    refs.placeContextDeleteBtn.addEventListener('click', contextDeleteObject);

    refs.fitBtn.addEventListener('click', fitView);
    refs.zoomInBtn.addEventListener('click', () => zoomAt(1.25, canvas.clientWidth / 2, canvas.clientHeight / 2));
    refs.zoomOutBtn.addEventListener('click', () => zoomAt(0.8, canvas.clientWidth / 2, canvas.clientHeight / 2));

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onMapContextMenu);
    canvas.addEventListener('dblclick', onDoubleClick);

    document.addEventListener('pointerdown', e => { if (refs.placeContextMenu && !refs.placeContextMenu.hidden && !e.target.closest('.place-context-menu')) hidePlaceContextMenu(); });
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', e => { if (e.code === 'Space') spacePressed = false; });
    window.addEventListener('beforeunload', e => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  function bindPropertyForm() {
    refs.propertyForm.addEventListener('focusin', () => {
      if (!propertySnapshot) propertySnapshot = serializeProject();
    });
    refs.propertyForm.addEventListener('focusout', e => {
      if (!refs.propertyForm.contains(e.relatedTarget)) finishPropertyEdit();
    });

    const inputs = [
      [refs.propLabel, 'label', v => v],
      [refs.propSize, 'size', v => clampNumber(v, 8, 300, 28)],
      [refs.propLabelSize, 'labelSize', v => clampNumber(v, 8, 120, 10)],
      [refs.propLineWidth, 'lineWidth', v => clampNumber(v, 1, 50, 3)],
      [refs.propPhase, 'phase', v => v]
    ];

    inputs.forEach(([el, key, convert]) => {
      el.addEventListener('input', () => {
        const obj = getSelected();
        if (!obj) return;
        obj[key] = convert(el.value);
        dirty = true;
        renderLayerList();
        requestRender();
      });
      el.addEventListener('change', finishPropertyEdit);
    });

    refs.propSymbolVisible.addEventListener('change', () => {
      const obj = getSelected();
      if (!obj || obj.type === 'text') return;
      if (!propertySnapshot) propertySnapshot = serializeProject();
      obj.symbolVisible = refs.propSymbolVisible.checked;
      dirty = true;
      renderLayerList();
      requestRender();
      finishPropertyEdit();
    });
  }

  function createProject() {
    const now = new Date().toISOString();
    return {
      app: 'shinsen-strategy-map',
      version: APP_VERSION,
      name: '新規作戦',
      createdAt: now,
      updatedAt: now,
      background: { ...PK1_BACKGROUND },
      calibration: JSON.parse(JSON.stringify(PK1_CALIBRATION)),
      routePlanner: defaultRoutePlanner(),
      activeScenario: 'A',
      scenarios: {},
      objects: []
    };
  }

  function createObject(type, data = {}) {
    const meta = TYPE_META[type];
    return {
      id: makeId(),
      type,
      label: meta.label,
      description: '',
      color: meta.color,
      opacity: type === 'area' ? 0.45 : 1,
      size: meta.size,
      labelSize: type === 'text' ? meta.size : 10,
      lineWidth: meta.lineWidth,
      symbolVisible: true,
      phase: '共通',
      hidden: false,
      x: data.x || 0,
      y: data.y || 0,
      x2: data.x2 == null ? data.x || 0 : data.x2,
      y2: data.y2 == null ? data.y || 0 : data.y2
    };
  }

  function makeId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'obj-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  function resizeCanvas() {
    const rect = refs.stageWrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    canvas._dpr = dpr;
  }

  function requestRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => {
      renderPending = false;
      render();
    });
  }

  function render() {
    const dpr = canvas._dpr || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0c0e11';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.scale, view.scale);

    if (backgroundImage) {
      ctx.imageSmoothingEnabled = view.scale < 1;
      ctx.drawImage(backgroundImage, 0, 0);
    } else {
      drawBlankGrid(ctx, 1600, 1000);
    }

    drawPk1ReferenceLayers(ctx);
    drawRouteOverlay(ctx);

    for (const obj of project.objects) {
      if (isObjectVisible(obj)) drawObject(ctx, obj, obj.id === selectedId);
    }

    if (drawPreview) drawObject(ctx, drawPreview, false, true);
    ctx.restore();

    refs.zoomDisplay.textContent = Math.round(view.scale * 100) + '%';
  }

  function drawBlankGrid(context, w, h) {
    context.fillStyle = '#12161b';
    context.fillRect(0, 0, w, h);
    context.strokeStyle = '#252b34';
    context.lineWidth = 1;
    const step = 50;
    context.beginPath();
    for (let x = 0; x <= w; x += step) { context.moveTo(x, 0); context.lineTo(x, h); }
    for (let y = 0; y <= h; y += step) { context.moveTo(0, y); context.lineTo(w, y); }
    context.stroke();
  }

  function objectLabelAnchor(obj) {
    if (obj.type === 'arrow' || obj.type === 'defense' || obj.type === 'area') {
      return { x: (obj.x + obj.x2) / 2, y: (obj.y + obj.y2) / 2 };
    }
    return { x: obj.x, y: obj.y };
  }

  function drawObject(context, obj, selected, preview = false) {
    context.save();
    context.globalAlpha = Math.max(0.05, Math.min(1, obj.opacity == null ? 1 : obj.opacity)) * (preview ? 0.75 : 1);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = obj.color;
    context.fillStyle = obj.color;
    context.lineWidth = obj.lineWidth || 4;

    if (obj.symbolVisible === false && obj.type !== 'text') {
      const anchor = objectLabelAnchor(obj);
      drawLabel(context, obj.label, anchor.x, anchor.y, obj.labelSize || 10);
      if (selected) drawSelection(context, obj);
      context.restore();
      return;
    }

    switch (obj.type) {
      case 'ally':
      case 'enemy':
        drawArmyMarker(context, obj);
        break;
      case 'garrison':
        drawGarrison(context, obj);
        break;
      case 'camp':
        drawCamp(context, obj);
        break;
      case 'fort':
        drawFort(context, obj);
        break;
      case 'relocate':
        drawMapPoint(context, obj);
        break;
      case 'castle':
      case 'gate':
      case 'bridge':
      case 'station':
        drawMapPoint(context, obj);
        break;
      case 'target':
        drawTarget(context, obj);
        break;
      case 'text':
        drawTextNote(context, obj);
        break;
      case 'arrow':
        drawArrow(context, obj);
        break;
      case 'defense':
        drawDefenseLine(context, obj);
        break;
      case 'area':
        drawArea(context, obj);
        break;
    }

    if (selected) drawSelection(context, obj);
    context.restore();
  }

  function drawArmyMarker(context, obj) {
    const r = obj.size / 2;
    context.save();
    context.translate(obj.x, obj.y);
    context.shadowColor = 'rgba(0,0,0,.55)';
    context.shadowBlur = Math.max(4, r * 0.18);
    context.shadowOffsetY = Math.max(2, r * 0.08);
    context.beginPath();
    context.arc(0, 0, r, 0, Math.PI * 2);
    context.fill();
    context.shadowColor = 'transparent';
    context.strokeStyle = 'rgba(255,255,255,.9)';
    context.lineWidth = Math.max(2, obj.lineWidth * 0.55);
    context.stroke();
    context.fillStyle = '#fff';
    context.font = `800 ${Math.max(12, obj.size * 0.35)}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(obj.type === 'ally' ? '自' : '敵', 0, 1);
    context.restore();
    drawLabel(context, obj.label, obj.x, obj.y + r + obj.size * 0.22, obj.labelSize || 10);
  }

  function drawGarrison(context, obj) {
    const s = obj.size;
    context.save();
    context.translate(obj.x, obj.y);
    context.shadowColor = 'rgba(0,0,0,.5)';
    context.shadowBlur = s * 0.12;
    context.beginPath();
    context.moveTo(0, -s * 0.5);
    context.lineTo(s * 0.38, -s * 0.28);
    context.lineTo(s * 0.31, s * 0.22);
    context.quadraticCurveTo(0, s * 0.55, 0, s * 0.55);
    context.quadraticCurveTo(0, s * 0.55, -s * 0.31, s * 0.22);
    context.lineTo(-s * 0.38, -s * 0.28);
    context.closePath();
    context.fill();
    context.shadowColor = 'transparent';
    context.strokeStyle = '#fff';
    context.lineWidth = Math.max(2, obj.lineWidth * 0.5);
    context.stroke();
    context.fillStyle = '#fff';
    context.font = `800 ${s * 0.28}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('駐', 0, 0);
    context.restore();
    drawLabel(context, obj.label, obj.x, obj.y + s * 0.75, obj.labelSize || 10);
  }

  function drawCamp(context, obj) {
    const s = obj.size;
    context.save();
    context.translate(obj.x, obj.y);
    context.shadowColor = 'rgba(0,0,0,.5)';
    context.shadowBlur = s * 0.12;
    context.beginPath();
    context.moveTo(0, -s * 0.5);
    context.lineTo(s * 0.52, s * 0.42);
    context.lineTo(-s * 0.52, s * 0.42);
    context.closePath();
    context.fill();
    context.shadowColor = 'transparent';
    context.strokeStyle = '#fff';
    context.lineWidth = Math.max(2, obj.lineWidth * 0.5);
    context.stroke();
    context.beginPath();
    context.moveTo(0, -s * 0.5);
    context.lineTo(0, s * 0.42);
    context.moveTo(-s * 0.28, s * 0.42);
    context.lineTo(0, -s * 0.5);
    context.lineTo(s * 0.28, s * 0.42);
    context.stroke();
    context.restore();
    drawLabel(context, obj.label, obj.x, obj.y + s * 0.68, obj.labelSize || 10);
  }

  function drawFort(context, obj) {
    const s = obj.size;
    context.save();
    context.translate(obj.x, obj.y);
    context.shadowColor = 'rgba(0,0,0,.5)';
    context.shadowBlur = s * 0.12;
    context.beginPath();
    context.rect(-s * 0.45, -s * 0.25, s * 0.9, s * 0.68);
    context.rect(-s * 0.48, -s * 0.48, s * 0.22, s * 0.28);
    context.rect(-s * 0.11, -s * 0.48, s * 0.22, s * 0.28);
    context.rect(s * 0.26, -s * 0.48, s * 0.22, s * 0.28);
    context.fill();
    context.shadowColor = 'transparent';
    context.strokeStyle = '#fff';
    context.lineWidth = Math.max(2, obj.lineWidth * 0.48);
    context.stroke();
    context.clearRect(-s * 0.1, s * 0.12, s * 0.2, s * 0.31);
    context.strokeRect(-s * 0.1, s * 0.12, s * 0.2, s * 0.31);
    context.restore();
    drawLabel(context, obj.label, obj.x, obj.y + s * 0.72, obj.labelSize || 10);
  }

  function drawMapPoint(context, obj) {
    const s = obj.size;
    const r = s * 0.5;
    const symbol = TYPE_META[obj.type].symbol;
    context.save();
    context.translate(obj.x, obj.y);
    context.shadowColor = 'rgba(0,0,0,.55)';
    context.shadowBlur = s * 0.13;
    context.shadowOffsetY = s * 0.06;
    context.beginPath();
    if (obj.type === 'gate') {
      context.moveTo(0, -r);
      context.lineTo(r, 0);
      context.lineTo(0, r);
      context.lineTo(-r, 0);
      context.closePath();
    } else if (obj.type === 'station') {
      context.moveTo(-r * 0.82, -r);
      context.lineTo(r * 0.82, -r);
      context.lineTo(r, 0);
      context.lineTo(r * 0.82, r);
      context.lineTo(-r * 0.82, r);
      context.lineTo(-r, 0);
      context.closePath();
    } else if (obj.type === 'bridge') {
      roundRect(context, -r, -r * 0.58, s, s * 0.82, s * 0.12);
    } else {
      roundRect(context, -r, -r, s, s, s * 0.12);
    }
    context.fill();
    context.shadowColor = 'transparent';
    context.strokeStyle = '#fff';
    context.lineWidth = Math.max(2, obj.lineWidth * 0.5);
    context.stroke();
    if (obj.type === 'bridge') {
      context.beginPath();
      context.moveTo(-r * 0.72, -r * 0.16);
      context.lineTo(r * 0.72, -r * 0.16);
      context.moveTo(-r * 0.72, r * 0.16);
      context.lineTo(r * 0.72, r * 0.16);
      context.stroke();
    }
    context.fillStyle = '#fff';
    context.font = `800 ${s * 0.34}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(symbol, 0, obj.type === 'bridge' ? -s * 0.02 : 1);
    context.restore();
    drawLabel(context, obj.label, obj.x, obj.y + s * 0.74, obj.labelSize || 10);
  }

  function drawTarget(context, obj) {
    const s = obj.size;
    const r = s * 0.45;
    context.save();
    context.translate(obj.x, obj.y);
    context.shadowColor = 'rgba(0,0,0,.55)';
    context.shadowBlur = s * 0.12;
    context.lineWidth = Math.max(3, obj.lineWidth);
    context.beginPath(); context.arc(0, 0, r, 0, Math.PI * 2); context.stroke();
    context.beginPath(); context.arc(0, 0, r * 0.52, 0, Math.PI * 2); context.stroke();
    context.beginPath();
    context.moveTo(-r * 1.25, 0); context.lineTo(r * 1.25, 0);
    context.moveTo(0, -r * 1.25); context.lineTo(0, r * 1.25);
    context.stroke();
    context.beginPath(); context.arc(0, 0, Math.max(3, r * 0.13), 0, Math.PI * 2); context.fill();
    context.restore();
    drawLabel(context, obj.label, obj.x, obj.y + s * 0.75, obj.labelSize || 10);
  }

  function drawTextNote(context, obj) {
    const fontSize = Math.max(8, obj.labelSize || obj.size);
    context.save();
    context.font = `700 ${fontSize}px sans-serif`;
    context.textAlign = 'left';
    context.textBaseline = 'top';
    const lines = String(obj.label || 'メモ').split(/\n/).slice(0, 6);
    const width = Math.max(...lines.map(line => context.measureText(line || ' ').width)) + fontSize * 0.9;
    const height = lines.length * fontSize * 1.25 + fontSize * 0.55;
    context.fillStyle = 'rgba(10,12,15,.78)';
    roundRect(context, obj.x - fontSize * 0.35, obj.y - fontSize * 0.28, width, height, fontSize * 0.25);
    context.fill();
    context.strokeStyle = obj.color;
    context.lineWidth = Math.max(2, obj.lineWidth);
    context.stroke();
    context.fillStyle = obj.color;
    lines.forEach((line, i) => context.fillText(line, obj.x, obj.y + i * fontSize * 1.25));
    context.restore();
  }

  function drawArrow(context, obj) {
    const dx = obj.x2 - obj.x;
    const dy = obj.y2 - obj.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const ux = dx / len;
    const uy = dy / len;
    const head = Math.min(Math.max(obj.size, obj.lineWidth * 4), len * 0.38);
    const baseX = obj.x2 - ux * head;
    const baseY = obj.y2 - uy * head;
    const px = -uy;
    const py = ux;

    context.save();
    context.shadowColor = 'rgba(0,0,0,.55)';
    context.shadowBlur = Math.max(4, obj.lineWidth * 0.8);
    context.beginPath();
    context.moveTo(obj.x, obj.y);
    context.lineTo(baseX, baseY);
    context.stroke();
    context.beginPath();
    context.moveTo(obj.x2, obj.y2);
    context.lineTo(baseX + px * head * 0.48, baseY + py * head * 0.48);
    context.lineTo(baseX - px * head * 0.48, baseY - py * head * 0.48);
    context.closePath();
    context.fill();
    context.restore();

    drawLabel(context, obj.label, (obj.x + obj.x2) / 2, (obj.y + obj.y2) / 2 - obj.size * 0.48, obj.labelSize || 10);
  }

  function drawDefenseLine(context, obj) {
    const dx = obj.x2 - obj.x;
    const dy = obj.y2 - obj.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    context.save();
    context.shadowColor = 'rgba(0,0,0,.5)';
    context.shadowBlur = Math.max(3, obj.lineWidth * 0.7);
    context.beginPath();
    context.moveTo(obj.x, obj.y);
    context.lineTo(obj.x2, obj.y2);
    context.stroke();
    const interval = Math.max(26, obj.size * 0.72);
    const count = Math.max(2, Math.floor(len / interval));
    context.lineWidth = Math.max(2, obj.lineWidth * 0.72);
    context.beginPath();
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const x = obj.x + dx * t;
      const y = obj.y + dy * t;
      const tick = obj.size * 0.32;
      context.moveTo(x, y);
      context.lineTo(x + px * tick, y + py * tick);
    }
    context.stroke();
    context.restore();
    drawLabel(context, obj.label, (obj.x + obj.x2) / 2 + px * obj.size * 0.58, (obj.y + obj.y2) / 2 + py * obj.size * 0.58, obj.labelSize || 10);
  }

  function drawArea(context, obj) {
    const x = Math.min(obj.x, obj.x2);
    const y = Math.min(obj.y, obj.y2);
    const w = Math.abs(obj.x2 - obj.x);
    const h = Math.abs(obj.y2 - obj.y);
    context.save();
    context.fillStyle = hexWithAlpha(obj.color, 0.28);
    context.fillRect(x, y, w, h);
    context.strokeStyle = obj.color;
    context.lineWidth = obj.lineWidth;
    context.setLineDash([obj.size * 0.34, obj.size * 0.2]);
    context.strokeRect(x, y, w, h);
    context.setLineDash([]);
    drawLabel(context, obj.label, x + w / 2, y + Math.max(obj.size * 0.38, 18), obj.labelSize || 10);
    context.restore();
  }

  function drawLabel(context, text, x, y, fontSize) {
    if (!text) return;
    const value = String(text);
    const fs = Math.max(8, fontSize || 14);
    context.save();
    context.font = `700 ${fs}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const width = context.measureText(value).width + fs * 0.8;
    const height = fs * 1.5;
    context.fillStyle = 'rgba(9,11,14,.82)';
    roundRect(context, x - width / 2, y - height / 2, width, height, fs * 0.28);
    context.fill();
    context.strokeStyle = 'rgba(255,255,255,.2)';
    context.lineWidth = Math.max(1, 1 / view.scale);
    context.stroke();
    context.fillStyle = '#fff';
    context.fillText(value, x, y + fs * 0.03);
    context.restore();
  }

  function selectionHandles(obj) {
    const handles = [];
    if (!obj) return handles;
    if (obj.type === 'arrow' || obj.type === 'defense') {
      handles.push({ kind: 'endpoint-start', x: obj.x, y: obj.y });
      handles.push({ kind: 'endpoint-end', x: obj.x2, y: obj.y2 });
      if (obj.type === 'defense') {
        const dx = obj.x2 - obj.x, dy = obj.y2 - obj.y;
        const len = Math.hypot(dx, dy) || 1;
        const mx = (obj.x + obj.x2) / 2, my = (obj.y + obj.y2) / 2;
        const dist = 34 / view.scale;
        handles.push({ kind: 'rotate', x: mx - (dy / len) * dist, y: my + (dx / len) * dist, mx, my });
      }
      return handles;
    }
    const b = objectBounds(obj);
    handles.push({ kind: 'corner-nw', x: b.x, y: b.y });
    handles.push({ kind: 'corner-ne', x: b.x + b.w, y: b.y });
    handles.push({ kind: 'corner-se', x: b.x + b.w, y: b.y + b.h });
    handles.push({ kind: 'corner-sw', x: b.x, y: b.y + b.h });
    return handles;
  }

  function hitSelectionHandle(x, y) {
    const obj = getSelected();
    if (!obj) return null;
    const radius = 10 / view.scale;
    for (const h of selectionHandles(obj)) {
      if (Math.hypot(x - h.x, y - h.y) <= radius) return h;
    }
    return null;
  }

  function cursorForSelectionHandle(kind) {
    if (kind === 'corner-nw' || kind === 'corner-se') return 'nwse-resize';
    if (kind === 'corner-ne' || kind === 'corner-sw') return 'nesw-resize';
    if (kind === 'rotate') return 'grab';
    if (kind === 'endpoint-start' || kind === 'endpoint-end') return 'move';
    return '';
  }

  function updateHoverCursor(world) {
    if (!world || interaction) return;
    const handle = hitSelectionHandle(world.x, world.y);
    canvas.style.cursor = handle ? cursorForSelectionHandle(handle.kind) : '';
  }

  function drawSelection(context, obj) {
    const b = objectBounds(obj);
    const pad = Math.max(7 / view.scale, 3);
    context.save();
    context.globalAlpha = 1;
    context.strokeStyle = 'rgba(255,255,255,.92)';
    context.lineWidth = 1.5 / view.scale;
    context.setLineDash([6 / view.scale, 4 / view.scale]);
    if (obj.type !== 'arrow' && obj.type !== 'defense') {
      context.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
    }
    context.setLineDash([]);

    const handles = selectionHandles(obj);
    if (obj.type === 'defense') {
      const rot = handles.find(h => h.kind === 'rotate');
      if (rot) {
        context.strokeStyle = 'rgba(120,220,255,.9)';
        context.lineWidth = 1.2 / view.scale;
        context.beginPath(); context.moveTo(rot.mx, rot.my); context.lineTo(rot.x, rot.y); context.stroke();
      }
    }
    const hs = 7 / view.scale;
    for (const h of handles) {
      context.beginPath();
      if (h.kind === 'rotate') {
        context.arc(h.x, h.y, hs * .72, 0, Math.PI * 2);
        context.fillStyle = '#45c8f0';
        context.fill();
        context.strokeStyle = '#08212b';
        context.lineWidth = 1.3 / view.scale;
        context.stroke();
      } else {
        context.rect(h.x - hs / 2, h.y - hs / 2, hs, hs);
        context.fillStyle = '#fff';
        context.fill();
        context.strokeStyle = '#22313d';
        context.lineWidth = 1.2 / view.scale;
        context.stroke();
      }
    }
    context.restore();
  }

  function objectBounds(obj) {
    if (obj.type === 'arrow' || obj.type === 'defense' || obj.type === 'area') {
      return {
        x: Math.min(obj.x, obj.x2),
        y: Math.min(obj.y, obj.y2),
        w: Math.max(1, Math.abs(obj.x2 - obj.x)),
        h: Math.max(1, Math.abs(obj.y2 - obj.y))
      };
    }
    if (obj.type === 'text') {
      const fs = Math.max(8, obj.labelSize || obj.size);
      const width = Math.max(fs * 3.2, String(obj.label || '').length * fs * 0.65);
      return { x: obj.x - fs * 0.4, y: obj.y - fs * 0.35, w: width, h: fs * 1.8 };
    }
    const r = obj.size * 0.72;
    return { x: obj.x - r, y: obj.y - r, w: r * 2, h: r * 2 };
  }

  function roundRect(context, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    context.beginPath();
    context.moveTo(x + radius, y);
    context.arcTo(x + w, y, x + w, y + h, radius);
    context.arcTo(x + w, y + h, x, y + h, radius);
    context.arcTo(x, y + h, x, y, radius);
    context.arcTo(x, y, x + w, y, radius);
    context.closePath();
  }

  function hexWithAlpha(hex, alpha) {
    const value = String(hex).replace('#', '');
    if (value.length !== 6) return `rgba(217,165,42,${alpha})`;
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function setTool(tool) {
    if (isMobileReadOnly() && tool !== 'select') tool = 'select';
    activeTool = tool;
    refs.toolButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tool === tool));
    canvas.dataset.tool = tool;
    pendingDrawStart = null;
    drawPreview = null;
    canvas.style.cursor = '';
    if (isMobileLayout() && tool === 'route' && !mobileViewMode && !mobileFullscreen) setMobileInspectorTab('route', false);
    syncMobileControls();
    requestRender();
  }

  function isMobileLayout() {
    return window.matchMedia('(max-width: 900px)').matches;
  }

  function isMobileReadOnly() {
    return isMobileLayout() && (mobileViewMode || mobileFullscreen);
  }

  function setMobileViewMode(viewOnly) {
    mobileViewMode = !!viewOnly;
    if (mobileViewMode) {
      cancelLongPress();
      interaction = null;
      pendingDrawStart = null;
      drawPreview = null;
      hidePlaceContextMenu();
      refs.inspector.classList.remove('open');
      selectObject(null);
      setTool('select');
      showToast('閲覧モード：1本指は地図移動専用です');
    } else {
      showToast('編集モードに切り替えました');
    }
    syncMobileControls();
    requestRender();
  }

  function setMobileFullscreen(enabled) {
    mobileFullscreen = !!enabled;
    if (mobileFullscreen) {
      cancelLongPress();
      interaction = null;
      pendingDrawStart = null;
      drawPreview = null;
      hidePlaceContextMenu();
      refs.inspector.classList.remove('open');
      selectObject(null);
    }
    syncMobileControls();
    requestAnimationFrame(() => {
      resizeCanvas();
      requestRender();
    });
  }

  function setMobileInspectorTab(key, openInspector = false) {
    const allowed = ['scenario', 'objects', 'route', 'display'];
    if (!allowed.includes(key)) key = 'scenario';
    activeMobileInspectorTab = key;
    refs.mobileInspectorTabButtons.forEach(btn => {
      const active = btn.dataset.mobileInspectorTab === key;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    refs.mobileInspectorPanels.forEach(panel => panel.classList.toggle('mobile-panel-active', panel.dataset.mobilePanel === key));
    if (openInspector && isMobileLayout() && !isMobileReadOnly()) refs.inspector.classList.add('open');
  }

  function openSelectedPropertiesMobile() {
    if (!getSelected() || isMobileReadOnly()) return;
    setMobileInspectorTab('objects', true);
    requestAnimationFrame(() => {
      if (!refs.propertySection.hidden) refs.propertySection.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }

  function syncMobileControls() {
    const mobile = isMobileLayout();
    document.body.classList.toggle('mobile-view-mode', mobile && mobileViewMode);
    document.body.classList.toggle('mobile-map-fullscreen', mobile && mobileFullscreen);
    if (refs.mobileModeBtn) {
      refs.mobileModeBtn.textContent = mobileViewMode ? '閲覧' : '編集';
      refs.mobileModeBtn.classList.toggle('is-view-mode', mobileViewMode);
      refs.mobileModeBtn.setAttribute('aria-pressed', mobileViewMode ? 'true' : 'false');
    }
    if (refs.mobileFullscreenBtn) refs.mobileFullscreenBtn.setAttribute('aria-pressed', mobileFullscreen ? 'true' : 'false');
    if (refs.mobileFullscreenExitBtn) refs.mobileFullscreenExitBtn.hidden = !(mobile && mobileFullscreen);
    if (refs.toggleInspectorBtn) refs.toggleInspectorBtn.disabled = mobile && (mobileViewMode || mobileFullscreen);
    const selected = !!getSelected();
    if (refs.mobileSelectionBar) refs.mobileSelectionBar.hidden = !(mobile && !mobileViewMode && !mobileFullscreen && selected);
    const rp = project ? ensureRoutePlanner() : null;
    if (refs.mobileRouteUndoFloat) refs.mobileRouteUndoFloat.hidden = !(mobile && !mobileViewMode && !mobileFullscreen && activeTool === 'route' && rp && rp.points.length > 0);
    setMobileInspectorTab(activeMobileInspectorTab, false);
  }

  function cancelLongPress(pointerId = null) {
    if (!longPressState) return;
    if (pointerId != null && longPressState.pointerId !== pointerId) return;
    clearTimeout(longPressState.timer);
    longPressState = null;
  }

  function scheduleLongPress(e, screen) {
    cancelLongPress();
    const state = {
      pointerId: e.pointerId,
      startScreen: { x: screen.x, y: screen.y },
      timer: 0
    };
    state.timer = window.setTimeout(() => {
      if (longPressState !== state || pinchGesture || activeTouchPointers.size !== 1) return;
      const current = activeTouchPointers.get(state.pointerId);
      if (!current) return;
      const moved = Math.hypot(current.x - state.startScreen.x, current.y - state.startScreen.y);
      if (moved > TOUCH_MOVE_CANCEL_PX) return;
      const currentWorld = screenToWorld(current.x, current.y, true);
      const objectHit = isMobileReadOnly() ? null : hitTest(currentWorld.x, currentWorld.y);
      const opened = objectHit
        ? openObjectContextMenuAt(objectHit, current.clientX, current.clientY)
        : openPlaceContextMenuAt(current.clientX, current.clientY, { x: current.x, y: current.y });
      if (opened) {
        suppressTouchPointerId = state.pointerId;
        interaction = null;
        canvas.classList.remove('panning');
        canvas.classList.remove('pinching');
        canvas.style.cursor = '';
      }
      longPressState = null;
    }, TOUCH_LONG_PRESS_MS);
    longPressState = state;
  }

  function startPinchGesture() {
    cancelLongPress();
    const entries = Array.from(activeTouchPointers.entries()).slice(0, 2);
    if (entries.length < 2) return;
    const [aId, a] = entries[0], [bId, b] = entries[1];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    pinchGesture = {
      ids: [aId, bId],
      startDistance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      startScale: view.scale,
      anchorWorld: screenToWorld(mid.x, mid.y, true)
    };
    interaction = null;
    canvas.classList.remove('panning');
    canvas.classList.add('pinching');
    canvas.style.cursor = '';
  }

  function updatePinchGesture() {
    if (!pinchGesture) return false;
    const a = activeTouchPointers.get(pinchGesture.ids[0]);
    const b = activeTouchPointers.get(pinchGesture.ids[1]);
    if (!a || !b) return false;
    const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
    const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchGesture.startScale * distance / pinchGesture.startDistance));
    view.scale = next;
    view.x = midX - pinchGesture.anchorWorld.x * next;
    view.y = midY - pinchGesture.anchorWorld.y * next;
    requestRender();
    return true;
  }

  function hitRoutePointAtScreen(sx, sy, touch = false) {
    const rp = ensureRoutePlanner();
    if (!rp.points || !rp.points.length) return -1;
    const threshold = touch ? 24 : 13;
    let best = -1, bestDist = threshold;
    for (let i = rp.points.length - 1; i >= 0; i--) {
      const point = rp.points[i];
      const w = gameToWorld(Number(point[0]) + .5, Number(point[1]) + .5);
      if (!w) continue;
      const px = w.x * view.scale + view.x, py = w.y * view.scale + view.y;
      const d = Math.hypot(px - sx, py - sy);
      if (d <= bestDist) { best = i; bestDist = d; }
    }
    return best;
  }

  function onPointerDown(e) {
    if (!backgroundImage) return;
    if (e.pointerType === 'mouse' && e.button === 2) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const screen = pointerScreen(e);

    if (e.pointerType === 'touch') {
      activeTouchPointers.set(e.pointerId, { x: screen.x, y: screen.y, clientX: e.clientX, clientY: e.clientY });
      if (activeTouchPointers.size >= 2) {
        startPinchGesture();
        return;
      }
      scheduleLongPress(e, screen);
    }

    const world = screenToWorld(screen.x, screen.y, true);
    const forcePan = activeTool === 'pan' || spacePressed || e.button === 1 || (e.pointerType === 'touch' && isMobileReadOnly());
    const routePointIndex = !forcePan ? hitRoutePointAtScreen(screen.x, screen.y, e.pointerType === 'touch') : -1;
    const handle = !forcePan ? hitSelectionHandle(world.x, world.y) : null;
    const hit = !forcePan ? hitTest(world.x, world.y) : null;

    if (routePointIndex >= 0) {
      const rp = ensureRoutePlanner();
      interaction = {
        mode: 'route-point-pending', pointerId: e.pointerId, routePointIndex,
        startScreen: screen, startWorld: world, snapshot: serializeProject(), moved: false,
        originalPoint: rp.points[routePointIndex] ? [...rp.points[routePointIndex]] : null
      };
      return;
    }

    if (handle && selectedId) {
      const obj = getSelected();
      canvas.style.cursor = cursorForSelectionHandle(handle.kind);
      interaction = {
        mode: 'handle-drag', pointerId: e.pointerId, handle: handle.kind,
        startScreen: screen, startWorld: world, snapshot: serializeProject(), objectId: obj.id,
        moved: false,
        original: { x: obj.x, y: obj.y, x2: obj.x2, y2: obj.y2, size: obj.size, bounds: objectBounds(obj) }
      };
      return;
    }

    if (hit) {
      selectObject(hit.id);
      interaction = {
        mode: 'object-pending', pointerId: e.pointerId, startScreen: screen, startWorld: world,
        snapshot: serializeProject(), original: { x: hit.x, y: hit.y, x2: hit.x2, y2: hit.y2 },
        objectId: hit.id, moved: false
      };
      return;
    }

    if (forcePan) {
      canvas.style.cursor = '';
      interaction = { mode: 'pan', pointerId: e.pointerId, startScreen: screen, startView: { ...view }, moved: true };
      canvas.classList.add('panning');
      return;
    }

    interaction = {
      mode: 'background-pending', pointerId: e.pointerId, startScreen: screen, startWorld: world,
      startView: { ...view }, tool: activeTool, moved: false
    };
  }

  function onPointerMove(e) {
    const screen = pointerScreen(e);

    if (e.pointerType === 'touch' && activeTouchPointers.has(e.pointerId)) {
      activeTouchPointers.set(e.pointerId, { x: screen.x, y: screen.y, clientX: e.clientX, clientY: e.clientY });
      if (longPressState && longPressState.pointerId === e.pointerId) {
        const moved = Math.hypot(screen.x - longPressState.startScreen.x, screen.y - longPressState.startScreen.y);
        if (moved > TOUCH_MOVE_CANCEL_PX) cancelLongPress(e.pointerId);
      }
      if (pinchGesture) {
        e.preventDefault();
        updatePinchGesture();
        return;
      }
    }

    const world = screenToWorld(screen.x, screen.y, true);
    updateCursorStatus(world);
    if (!interaction) updateHoverCursor(world);

    if (!interaction && pendingDrawStart && ['arrow','defense','area'].includes(activeTool) && drawPreview) {
      drawPreview.x2 = world.x;
      drawPreview.y2 = world.y;
      requestRender();
    }

    if (!interaction || interaction.pointerId !== e.pointerId) return;
    e.preventDefault();
    const movedPx = Math.hypot(screen.x - interaction.startScreen.x, screen.y - interaction.startScreen.y);

    if (interaction.mode === 'route-point-pending' && movedPx >= 4) {
      if (e.pointerType === 'touch') cancelLongPress(e.pointerId);
      interaction.mode = 'route-point-drag';
      interaction.moved = true;
      canvas.style.cursor = 'move';
    }
    if (interaction.mode === 'object-pending' && movedPx >= 5) {
      if (e.pointerType === 'touch') cancelLongPress(e.pointerId);
      interaction.mode = 'drag';
      interaction.moved = true;
      canvas.style.cursor = 'move';
    }
    if (interaction.mode === 'background-pending' && movedPx >= 5) {
      if (e.pointerType === 'touch') cancelLongPress(e.pointerId);
      interaction.mode = 'pan';
      interaction.moved = true;
      canvas.style.cursor = '';
      canvas.classList.add('panning');
    }

    if (interaction.mode === 'route-point-drag') {
      const game = worldToGame(world.x, world.y);
      if (!game) return;
      const gx = Math.max(0, Math.min(PK1_WIDTH - 1, Math.round(game.x)));
      const gy = Math.max(0, Math.min(PK1_HEIGHT - 1, Math.round(game.y)));
      const rp = ensureRoutePlanner();
      const index = interaction.routePointIndex;
      if (index < 0 || index >= rp.points.length) return;
      const old = rp.points[index];
      if (!old || old[0] !== gx || old[1] !== gy) {
        rp.points[index] = [gx, gy];
        rp.path = []; rp.altPaths = []; rp.result = null;
        dirty = true;
        syncRouteUI();
        requestRender();
      }
      return;
    }

    if (interaction.mode === 'handle-drag') {
      if (movedPx >= 2) {
        interaction.moved = true;
        if (e.pointerType === 'touch') cancelLongPress(e.pointerId);
      }
      const obj = project.objects.find(o => o.id === interaction.objectId);
      if (!obj || !interaction.moved) return;
      const h = interaction.handle;
      const o = interaction.original;
      if (h === 'endpoint-start') {
        obj.x = world.x; obj.y = world.y;
      } else if (h === 'endpoint-end') {
        obj.x2 = world.x; obj.y2 = world.y;
      } else if (h === 'rotate' && obj.type === 'defense') {
        const cx = (o.x + o.x2) / 2, cy = (o.y + o.y2) / 2;
        const half = Math.max(1, Math.hypot(o.x2 - o.x, o.y2 - o.y) / 2);
        const pointerAngle = Math.atan2(world.y - cy, world.x - cx);
        const lineAngle = pointerAngle - Math.PI / 2;
        const vx = Math.cos(lineAngle) * half, vy = Math.sin(lineAngle) * half;
        obj.x = cx - vx; obj.y = cy - vy; obj.x2 = cx + vx; obj.y2 = cy + vy;
      } else if (obj.type === 'area') {
        let left = Math.min(o.x, o.x2), right = Math.max(o.x, o.x2);
        let top = Math.min(o.y, o.y2), bottom = Math.max(o.y, o.y2);
        if (h.includes('w')) left = world.x;
        if (h.includes('e')) right = world.x;
        if (h.includes('n')) top = world.y;
        if (h.includes('s')) bottom = world.y;
        if (left > right) [left, right] = [right, left];
        if (top > bottom) [top, bottom] = [bottom, top];
        obj.x = left; obj.y = top; obj.x2 = right; obj.y2 = bottom;
      } else {
        const radius = Math.max(5, Math.max(Math.abs(world.x - o.x), Math.abs(world.y - o.y)));
        if (obj.type === 'text') obj.labelSize = Math.max(8, Math.min(120, radius / 0.72));
        else obj.size = Math.max(10, Math.min(500, radius / 0.72));
      }
      dirty = true;
      syncSelectionUI();
      requestRender();
      return;
    }

    if (interaction.mode === 'pan') {
      view.x = interaction.startView.x + (screen.x - interaction.startScreen.x);
      view.y = interaction.startView.y + (screen.y - interaction.startScreen.y);
      requestRender();
      return;
    }

    if (interaction.mode === 'drag') {
      const obj = project.objects.find(o => o.id === interaction.objectId);
      if (!obj) return;
      const dx = world.x - interaction.startWorld.x;
      const dy = world.y - interaction.startWorld.y;
      obj.x = interaction.original.x + dx;
      obj.y = interaction.original.y + dy;
      obj.x2 = interaction.original.x2 + dx;
      obj.y2 = interaction.original.y2 + dy;
      dirty = true;
      requestRender();
    }
  }

  function handleBlankMapClick(tool, world) {
    if (tool === 'select' || tool === 'pan') {
      if (tool === 'select') selectObject(null);
      return;
    }

    if (tool === 'route') {
      const game = worldToGame(world.x, world.y);
      if (!game) { showToast('ゲーム座標が設定されていません', true); return; }
      const gx = Math.round(game.x), gy = Math.round(game.y);
      if (gx < 0 || gx >= PK1_WIDTH || gy < 0 || gy >= PK1_HEIGHT) { showToast('PK1マップ範囲外です', true); return; }
      const rp = ensureRoutePlanner();
      rp.points.push([gx, gy]); rp.path = []; rp.altPaths = []; rp.result = null;
      dirty = true; syncRouteUI(); requestRender();
      return;
    }

    if (['arrow','defense','area'].includes(tool)) {
      if (!pendingDrawStart || pendingDrawStart.tool !== tool) {
        pendingDrawStart = { tool, world: { x: world.x, y: world.y } };
        drawPreview = createObject(tool, { x: world.x, y: world.y, x2: world.x, y2: world.y });
        showToast('終点をクリックしてください。ドラッグすると地図を移動できます。');
      } else {
        const start = pendingDrawStart.world;
        const obj = createObject(tool, { x: start.x, y: start.y, x2: world.x, y2: world.y });
        const len = Math.hypot(obj.x2 - obj.x, obj.y2 - obj.y);
        if (len > 4 / view.scale) {
          recordHistory(serializeProject()); project.objects.push(obj); dirty = true; selectObject(obj.id); syncObjectUI();
        }
        pendingDrawStart = null; drawPreview = null;
      }
      requestRender();
      return;
    }

    if (TYPE_META[tool]) {
      recordHistory(serializeProject());
      const obj = createObject(tool, { x: world.x, y: world.y });
      project.objects.push(obj); dirty = true; selectObject(obj.id); syncObjectUI(); requestRender();
      if (tool === 'text') setTimeout(() => { refs.propLabel.focus(); refs.propLabel.select(); }, 0);
    }
  }

  function onPointerUp(e) {
    if (e.pointerType === 'touch') {
      cancelLongPress(e.pointerId);
      activeTouchPointers.delete(e.pointerId);

      if (pinchGesture) {
        const endedPinchPointer = pinchGesture.ids.includes(e.pointerId);
        if (endedPinchPointer || activeTouchPointers.size < 2) {
          pinchGesture = null;
          interaction = null;
          canvas.classList.remove('pinching');
          canvas.classList.remove('panning');
          canvas.style.cursor = '';
          try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignored */ }
          requestRender();
          return;
        }
      }

      if (suppressTouchPointerId === e.pointerId) {
        suppressTouchPointerId = null;
        interaction = null;
        canvas.classList.remove('panning');
        canvas.style.cursor = '';
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignored */ }
        requestRender();
        return;
      }
    }

    if (e.type === 'pointercancel') {
      interaction = null;
      canvas.classList.remove('panning');
      canvas.classList.remove('pinching');
      canvas.style.cursor = '';
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignored */ }
      requestRender();
      return;
    }

    if (!interaction || interaction.pointerId !== e.pointerId) {
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignored */ }
      return;
    }
    e.preventDefault();
    const screen = pointerScreen(e);
    const world = screenToWorld(screen.x, screen.y, true);

    if (interaction.mode === 'route-point-drag' && interaction.moved) {
      recordHistory(interaction.snapshot);
      syncRouteUI();
    } else if ((interaction.mode === 'drag' || interaction.mode === 'handle-drag') && interaction.moved) {
      recordHistory(interaction.snapshot);
      syncObjectUI();
    } else if (interaction.mode === 'background-pending' && !interaction.moved) {
      handleBlankMapClick(interaction.tool, world);
    }

    interaction = null;
    canvas.style.cursor = '';
    canvas.classList.remove('panning');
    updateHoverCursor(world);
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignored */ }
    requestRender();
  }

  function onDoubleClick(e) {
    if (activeTool !== 'select') return;
    const screen = pointerScreen(e);
    const world = screenToWorld(screen.x, screen.y, true);
    const hit = hitTest(world.x, world.y);
    if (!hit) return;
    selectObject(hit.id);
    if (isMobileLayout()) setMobileInspectorTab('objects', true);
    else refs.inspector.classList.add('open');
    refs.propLabel.focus();
    refs.propLabel.select();
  }

  function onWheel(e) {
    if (!backgroundImage) return;
    e.preventDefault();
    const screen = pointerScreen(e);
    const factor = Math.exp(-e.deltaY * 0.0015);
    zoomAt(factor, screen.x, screen.y);
  }

  function zoomAt(factor, screenX, screenY) {
    const before = screenToWorld(screenX, screenY, true);
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.scale * factor));
    view.scale = next;
    view.x = screenX - before.x * next;
    view.y = screenY - before.y * next;
    requestRender();
  }

  function pointerScreen(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function screenToWorld(x, y) {
    return { x: (x - view.x) / view.scale, y: (y - view.y) / view.scale };
  }

  function hitTest(x, y) {
    const tolerance = Math.max(9 / view.scale, 4);
    for (let i = project.objects.length - 1; i >= 0; i--) {
      const obj = project.objects[i];
      if (!isObjectVisible(obj)) continue;
      if (obj.type === 'arrow' || obj.type === 'defense') {
        if (distanceToSegment(x, y, obj.x, obj.y, obj.x2, obj.y2) <= Math.max(tolerance, obj.lineWidth * 1.5)) return obj;
      } else if (obj.type === 'area') {
        const left = Math.min(obj.x, obj.x2), right = Math.max(obj.x, obj.x2);
        const top = Math.min(obj.y, obj.y2), bottom = Math.max(obj.y, obj.y2);
        if (x >= left - tolerance && x <= right + tolerance && y >= top - tolerance && y <= bottom + tolerance) return obj;
      } else {
        const b = objectBounds(obj);
        if (x >= b.x - tolerance && x <= b.x + b.w + tolerance && y >= b.y - tolerance && y <= b.y + b.h + tolerance) return obj;
      }
    }
    return null;
  }

  function distanceToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function translateObject(obj, dx, dy) {
    obj.x += dx; obj.y += dy; obj.x2 += dx; obj.y2 += dy;
  }

  function selectObject(id) {
    selectedId = id;
    syncSelectionUI();
    renderLayerList();
    refs.deleteBtn.disabled = !id;
    requestRender();
  }

  function getSelected() {
    return selectedId ? project.objects.find(o => o.id === selectedId) || null : null;
  }

  function syncSelectionUI() {
    const obj = getSelected();
    refs.propertySection.hidden = !obj;
    refs.inspector.classList.toggle('has-selection', !!obj);
    if (!obj) return;
    refs.propLabel.value = obj.label || '';
    refs.propSize.value = Math.round(obj.size || TYPE_META[obj.type].size);
    refs.propLabelSize.value = Math.round(obj.labelSize || (obj.type === 'text' ? obj.size : 10));
    refs.propLineWidth.value = Math.round(obj.lineWidth || TYPE_META[obj.type].lineWidth);
    refs.propPhase.value = obj.phase || '共通';
    refs.propSymbolVisible.checked = obj.symbolVisible !== false;
    const noSymbol = obj.type === 'text';
    refs.propSymbolVisible.disabled = noSymbol;
    refs.symbolVisibleField.classList.toggle('disabled', noSymbol);
    refs.propSize.disabled = noSymbol;
    syncMobileControls();
  }

  function syncObjectUI() {
    syncSelectionUI();
    renderLayerList();
    updateHistoryButtons();
    requestRender();
  }

  function cloneJson(value) { return JSON.parse(JSON.stringify(value)); }

  function ensureScenarios() {
    if (!project.scenarios || typeof project.scenarios !== 'object') project.scenarios = {};
    if (!SCENARIO_KEYS.includes(activeScenario)) activeScenario = SCENARIO_KEYS.includes(project.activeScenario) ? project.activeScenario : 'A';
    for (const key of SCENARIO_KEYS) {
      if (!project.scenarios[key]) {
        project.scenarios[key] = key === activeScenario ? {
          objects: cloneJson(project.objects || []), routePlanner: cloneJson(ensureRoutePlanner()), phaseFilter
        } : emptyScenarioState();
      }
    }
    project.activeScenario = activeScenario;
  }

  function persistCurrentScenario() {
    ensureScenarios();
    project.scenarios[activeScenario] = {
      objects: cloneJson(project.objects || []),
      routePlanner: cloneJson(ensureRoutePlanner()),
      phaseFilter
    };
    project.activeScenario = activeScenario;
  }

  function switchScenario(key) {
    if (!SCENARIO_KEYS.includes(key) || key === activeScenario) return;
    persistCurrentScenario();
    activeScenario = key;
    const s = normalizeScenarioState(project.scenarios[key] || emptyScenarioState());
    project.objects = cloneJson(s.objects);
    project.routePlanner = normalizeRoutePlanner(s.routePlanner);
    phaseFilter = s.phaseFilter;
    project.activeScenario = key;
    selectedId = null;
    history = []; future = [];
    syncAllUI();
    requestRender();
    showToast(`作戦案${key}に切り替えました`);
  }

  function syncScenarioUI() {
    refs.scenarioButtons.forEach(btn => {
      const active = btn.dataset.scenario === activeScenario;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function syncAllUI() {
    refs.projectName.value = project.name || '新規作戦';
    refs.emptyState.hidden = !!backgroundImage;
    syncSelectionUI();
    renderLayerList();
    if (refs.calibrationSummary) updateCalibrationSummary();
    syncScenarioUI();
    if (refs.phaseFilter) refs.phaseFilter.value = phaseFilter;
    updateHistoryButtons();
    refs.deleteBtn.disabled = !selectedId;
    syncRouteUI();
    syncMobileControls();
  }

  function renderLayerList() {
    refs.objectCount.textContent = String(project.objects.length);
    refs.layerList.textContent = '';
    const objects = project.objects.slice().reverse();
    if (!objects.length) {
      const empty = document.createElement('div');
      empty.className = 'layer-empty';
      empty.textContent = 'まだ記号はありません';
      refs.layerList.appendChild(empty);
      return;
    }

    objects.forEach(obj => {
      const item = document.createElement('div');
      item.className = 'layer-item' + (obj.id === selectedId ? ' selected' : '');
      item.dataset.id = obj.id;
      if (!isObjectVisible(obj)) item.style.opacity = '.5';

      const symbol = document.createElement('span');
      symbol.className = 'layer-symbol';
      symbol.textContent = TYPE_META[obj.type]?.symbol || '?';
      symbol.style.background = obj.type === 'text' || obj.type === 'arrow' || obj.type === 'defense' || obj.type === 'area'
        ? 'transparent' : obj.color;
      symbol.style.color = obj.type === 'text' || obj.type === 'arrow' || obj.type === 'defense' || obj.type === 'area'
        ? obj.color : '#fff';
      symbol.style.border = `1px solid ${obj.color}`;

      const info = document.createElement('span');
      info.className = 'layer-info';
      const name = document.createElement('span');
      name.className = 'layer-name';
      name.textContent = obj.label || TYPE_META[obj.type].name;
      const phase = document.createElement('span');
      phase.className = 'layer-phase';
      phase.textContent = `${TYPE_META[obj.type].name}・${obj.phase || '共通'}`;
      info.append(name, phase);

      const eye = document.createElement('button');
      eye.type = 'button';
      eye.className = 'layer-hide' + (obj.hidden ? ' off' : '');
      eye.textContent = obj.hidden ? '○' : '●';
      eye.title = obj.hidden ? '表示する' : '非表示にする';
      eye.addEventListener('click', ev => {
        ev.stopPropagation();
        recordHistory(serializeProject());
        obj.hidden = !obj.hidden;
        dirty = true;
        if (obj.hidden && selectedId === obj.id) selectObject(null);
        syncObjectUI();
      });

      item.addEventListener('click', () => {
        selectObject(obj.id);
        if (isMobileLayout() && !isMobileReadOnly()) setMobileInspectorTab('objects', true);
      });
      item.append(symbol, info, eye);
      refs.layerList.appendChild(item);
    });
  }

  function isObjectVisible(obj) {
    if (!obj || obj.hidden) return false;
    if (phaseFilter === 'すべて') return true;
    if (phaseFilter === '共通') return obj.phase === '共通';
    return obj.phase === '共通' || obj.phase === phaseFilter;
  }

  function normalizeHex(color, fallback) {
    return /^#[0-9a-f]{6}$/i.test(color || '') ? color : fallback;
  }

  function finishPropertyEdit() {
    if (!propertySnapshot) return;
    const current = serializeProject();
    if (current !== propertySnapshot) recordHistory(propertySnapshot);
    propertySnapshot = null;
    syncObjectUI();
  }

  function deleteSelected() {
    const obj = getSelected();
    if (!obj) return;
    recordHistory(serializeProject());
    project.objects = project.objects.filter(o => o.id !== obj.id);
    selectedId = null;
    dirty = true;
    syncObjectUI();
    showToast('記号を削除しました');
  }

  function duplicateSelected() {
    const obj = getSelected();
    if (!obj) return;
    recordHistory(serializeProject());
    const copy = JSON.parse(JSON.stringify(obj));
    copy.id = makeId();
    copy.label = obj.label + '（複製）';
    translateObject(copy, 24 / view.scale, 24 / view.scale);
    project.objects.push(copy);
    dirty = true;
    selectObject(copy.id);
    syncObjectUI();
  }

  function bringSelectedToFront() {
    const obj = getSelected();
    if (!obj) return;
    const idx = project.objects.indexOf(obj);
    if (idx === project.objects.length - 1) return;
    recordHistory(serializeProject());
    project.objects.splice(idx, 1);
    project.objects.push(obj);
    dirty = true;
    syncObjectUI();
  }

  function recordHistory(snapshot) {
    if (!snapshot) snapshot = serializeProject();
    if (history[history.length - 1] === snapshot) return;
    history.push(snapshot);
    if (history.length > MAX_HISTORY) history.shift();
    future = [];
    updateHistoryButtons();
  }

  function undo() {
    if (!history.length) return;
    future.push(serializeProject());
    const snapshot = history.pop();
    restoreSnapshot(snapshot, false);
    dirty = true;
    updateHistoryButtons();
    showToast('元に戻しました');
  }

  function redo() {
    if (!future.length) return;
    history.push(serializeProject());
    const snapshot = future.pop();
    restoreSnapshot(snapshot, false);
    dirty = true;
    updateHistoryButtons();
    showToast('やり直しました');
  }

  function updateHistoryButtons() {
    refs.undoBtn.disabled = history.length === 0;
    refs.redoBtn.disabled = future.length === 0;
  }

  function serializeProject() {
    persistCurrentScenario();
    project.updatedAt = new Date().toISOString();
    project.name = refs.projectName ? (refs.projectName.value.trim() || project.name || '名称未設定') : project.name;
    return JSON.stringify(project);
  }

  async function restoreSnapshot(snapshot, fit = false) {
    try {
      const parsed = normalizeProject(JSON.parse(snapshot));
      project = parsed;
      activeScenario = SCENARIO_KEYS.includes(project.activeScenario) ? project.activeScenario : 'A';
      const ss = project.scenarios && project.scenarios[activeScenario];
      phaseFilter = ss && ['すべて', ...PHASES].includes(ss.phaseFilter) ? ss.phaseFilter : 'すべて';
      selectedId = null;
      await loadBackgroundFromProject();
      syncAllUI();
      if (fit) fitView(); else requestRender();
    } catch (error) {
      console.error(error);
      showToast('履歴の復元に失敗しました', true);
    }
  }

  function newProject() {
    if (dirty && !confirm('現在の作戦を破棄して、新しい作戦を作成しますか？')) return;
    project = createProject();
    backgroundImage = null;
    selectedId = null;
    history = [];
    future = [];
    view = { scale: 1, x: 0, y: 0 };
    dirty = false;
    if (refs.mapFileInput) refs.mapFileInput.value = '';
    if (refs.projectFileInput) refs.projectFileInput.value = '';
    activeScenario = 'A';
    loadBackgroundFromProject().then(() => { syncAllUI(); fitView(); });
    syncAllUI();
    requestRender();
  }

  function handleMapFile() {
    const file = refs.mapFileInput.files && refs.mapFileInput.files[0];
    if (refs.mapFileInput) refs.mapFileInput.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('画像ファイルを選択してください', true);
      return;
    }
    if (backgroundImage && !confirm('背景マップを置き換えます。配置済みの作戦記号は維持されます。続けますか？')) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const old = serializeProject();
      try {
        const image = await imageFromSource(reader.result);
        recordHistory(old);
        backgroundImage = image;
        project.background = {
          name: file.name,
          type: file.type,
          dataUrl: reader.result,
          width: image.naturalWidth,
          height: image.naturalHeight
        };
        project.calibration = null;
        dirty = true;
        syncAllUI();
        fitView();
        showToast(`マップ画像を読み込みました（${image.naturalWidth} × ${image.naturalHeight}px）`);
      } catch (error) {
        console.error(error);
        showToast('画像を読み込めませんでした', true);
      }
    };
    reader.onerror = () => showToast('画像ファイルの読み込みに失敗しました', true);
    reader.readAsDataURL(file);
  }

  function saveProjectFile() {
    if (!project.background) {
      showToast('先にマップ画像を読み込んでください', true);
      return;
    }
    project.name = refs.projectName.value.trim() || '名称未設定';
    project.updatedAt = new Date().toISOString();
    persistCurrentScenario();
    const json = JSON.stringify(project, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    downloadBlob(blob, safeFilename(project.name) + '.nssmap');
    dirty = false;
    showToast('編集用の作戦ファイルを保存しました');
  }

  function handleProjectFile() {
    const file = refs.projectFileInput.files && refs.projectFileInput.files[0];
    refs.projectFileInput.value = '';
    if (!file) return;
    if (dirty && !confirm('現在の作戦を閉じて、選択した作戦ファイルを読み込みますか？')) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = normalizeProject(JSON.parse(reader.result));
        project = parsed;
        activeScenario = SCENARIO_KEYS.includes(project.activeScenario) ? project.activeScenario : 'A';
        const ss = project.scenarios && project.scenarios[activeScenario];
        phaseFilter = ss && ['すべて', ...PHASES].includes(ss.phaseFilter) ? ss.phaseFilter : 'すべて';
        selectedId = null;
        history = [];
        future = [];
        await loadBackgroundFromProject();
        dirty = false;
        syncAllUI();
        fitView();
        showToast('作戦ファイルを読み込みました');
      } catch (error) {
        console.error(error);
        showToast('作戦ファイルの形式が正しくありません', true);
      }
    };
    reader.onerror = () => showToast('作戦ファイルの読み込みに失敗しました', true);
    reader.readAsText(file, 'utf-8');
  }

  function normalizeObjectList(items) {
    if (!Array.isArray(items)) return [];
    return items.filter(o => o && TYPE_META[o.type]).map(o => {
      const base = createObject(o.type);
      return {
        ...base, ...o,
        id: String(o.id || makeId()),
        label: String(o.label == null ? base.label : o.label),
        description: String(o.description || ''),
        color: normalizeHex(o.color, base.color),
        opacity: clampNumber(o.opacity, 0.05, 1, base.opacity),
        size: clampNumber(o.size, 8, 300, base.size),
        labelSize: clampNumber(o.labelSize, 8, 120, o.type === 'text' ? clampNumber(o.size, 8, 120, base.size) : 10),
        lineWidth: clampNumber(o.lineWidth, 1, 50, base.lineWidth),
        symbolVisible: o.symbolVisible !== false,
        phase: PHASES.includes(o.phase) ? o.phase : '共通',
        hidden: Boolean(o.hidden),
        x: clampNumber(o.x, -1000000, 1000000, 0),
        y: clampNumber(o.y, -1000000, 1000000, 0),
        x2: clampNumber(o.x2, -1000000, 1000000, 0),
        y2: clampNumber(o.y2, -1000000, 1000000, 0)
      };
    });
  }

  function emptyScenarioState() {
    return { objects: [], routePlanner: defaultRoutePlanner(), phaseFilter: 'すべて' };
  }

  function normalizeScenarioState(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    return {
      objects: normalizeObjectList(s.objects),
      routePlanner: normalizeRoutePlanner(s.routePlanner),
      phaseFilter: ['すべて', ...PHASES].includes(s.phaseFilter) ? s.phaseFilter : 'すべて'
    };
  }

  function normalizeProject(data) {
    if (!data || (!Array.isArray(data.objects) && !data.scenarios)) throw new Error('Invalid project');
    const normalized = {
      app: 'shinsen-strategy-map',
      version: Number(data.version) || 1,
      name: String(data.name || '名称未設定'),
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt || new Date().toISOString(),
      background: data.background || { ...PK1_BACKGROUND },
      calibration: data.calibration || JSON.parse(JSON.stringify(PK1_CALIBRATION)),
      routePlanner: normalizeRoutePlanner(data.routePlanner),
      activeScenario: SCENARIO_KEYS.includes(data.activeScenario) ? data.activeScenario : 'A',
      scenarios: {},
      objects: normalizeObjectList(data.objects)
    };
    for (const key of SCENARIO_KEYS) {
      const raw = data.scenarios && data.scenarios[key];
      if (raw) normalized.scenarios[key] = normalizeScenarioState(raw);
      else if (key === normalized.activeScenario) normalized.scenarios[key] = {
        objects: JSON.parse(JSON.stringify(normalized.objects)),
        routePlanner: normalizeRoutePlanner(normalized.routePlanner),
        phaseFilter: 'すべて'
      };
      else normalized.scenarios[key] = emptyScenarioState();
    }
    const active = normalized.scenarios[normalized.activeScenario];
    normalized.objects = JSON.parse(JSON.stringify(active.objects));
    normalized.routePlanner = normalizeRoutePlanner(active.routePlanner);
    return normalized;
  }

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  }

  async function loadBackgroundFromProject() {
    if (!project.background) {
      backgroundImage = null;
      return;
    }
    // Built-in PK1 maps always use the current bundled asset path. This also
    // migrates older .nssmap files that stored data/map.png in background.src.
    const source = project.background.builtin
      ? PK1_BACKGROUND.src
      : (project.background.dataUrl || project.background.src);
    if (!source) { backgroundImage = null; return; }
    backgroundImage = await imageFromSource(source);
    if (project.background.builtin) project.background = { ...PK1_BACKGROUND };
    project.background.width = backgroundImage.naturalWidth;
    project.background.height = backgroundImage.naturalHeight;
  }

  function imageFromSource(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  }

  function fitView() {
    const w = backgroundImage ? backgroundImage.naturalWidth : 1600;
    const h = backgroundImage ? backgroundImage.naturalHeight : 1000;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (!cw || !ch || !w || !h) return;
    const pad = Math.min(42, Math.max(14, Math.min(cw, ch) * 0.04));
    const scale = Math.min((cw - pad * 2) / w, (ch - pad * 2) / h);
    view.scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));
    view.x = (cw - w * view.scale) / 2;
    view.y = (ch - h * view.scale) / 2;
    requestRender();
  }

  function updateCursorStatus(world) {
    if (!world) return;
    const game = worldToGame(world.x, world.y);
    refs.gamePosition.textContent = game ? `${formatCoord(game.x)}, ${formatCoord(game.y)}` : '未設定';
  }

  function worldToGame(x, y) {
    if (project.background?.builtin) {
      const t = PK1_DISPLAY_TRANSFORM;
      const dx = x - t.tx, dy = y - t.ty;
      return { x: t.im00 * dx + t.im01 * dy, y: t.im10 * dx + t.im11 * dy };
    }
    const c = project.calibration;
    if (!c || !project.background) return null;
    const w = project.background.width || backgroundImage?.naturalWidth;
    const h = project.background.height || backgroundImage?.naturalHeight;
    if (!w || !h) return null;
    return { x: c.topLeft.x + (x / w) * (c.bottomRight.x - c.topLeft.x), y: c.topLeft.y + (y / h) * (c.bottomRight.y - c.topLeft.y) };
  }

  function gameToWorld(x, y) {
    if (project.background?.builtin) {
      const t = PK1_DISPLAY_TRANSFORM;
      return { x: t.m00 * x + t.m01 * y + t.tx, y: t.m10 * x + t.m11 * y + t.ty };
    }
    const c = project.calibration;
    if (!c || !project.background) return null;
    const w = project.background.width || backgroundImage?.naturalWidth;
    const h = project.background.height || backgroundImage?.naturalHeight;
    const dx = c.bottomRight.x - c.topLeft.x, dy = c.bottomRight.y - c.topLeft.y;
    if (!w || !h || !dx || !dy) return null;
    return { x: ((x - c.topLeft.x) / dx) * w, y: ((y - c.topLeft.y) / dy) * h };
  }

  function formatCoord(n) {
    return Math.abs(n - Math.round(n)) < 0.04 ? String(Math.round(n)) : n.toFixed(1);
  }

  function openCalibrationDialog() {
    if (project.background?.builtin) {
      showToast('PK1標準マップはゲーム座標 0,0 ～ 2000,3250 で設定済みです');
      return;
    }
    if (!project.background) {
      showToast('先にマップ画像を読み込んでください', true);
      return;
    }
    const c = project.calibration;
    refs.calTopLeftX.value = c ? c.topLeft.x : '';
    refs.calTopLeftY.value = c ? c.topLeft.y : '';
    refs.calBottomRightX.value = c ? c.bottomRight.x : '';
    refs.calBottomRightY.value = c ? c.bottomRight.y : '';
    refs.calibrationDialog.showModal();
  }

  function saveCalibration(e) {
    e.preventDefault();
    if (!refs.calibrationForm.reportValidity()) return;
    const values = [refs.calTopLeftX, refs.calTopLeftY, refs.calBottomRightX, refs.calBottomRightY].map(el => Number(el.value));
    if (!values.every(Number.isFinite)) return;
    recordHistory(serializeProject());
    project.calibration = {
      topLeft: { x: values[0], y: values[1] },
      bottomRight: { x: values[2], y: values[3] }
    };
    dirty = true;
    refs.calibrationDialog.close();
    updateCalibrationSummary();
    showToast('ゲーム座標を設定しました');
  }

  function clearCalibration() {
    if (!project.calibration) {
      refs.calibrationDialog.close();
      return;
    }
    recordHistory(serializeProject());
    project.calibration = null;
    dirty = true;
    refs.calibrationDialog.close();
    updateCalibrationSummary();
    refs.gamePosition.textContent = '未設定';
    showToast('ゲーム座標設定を解除しました');
  }

  function updateCalibrationSummary() {
    const c = project.calibration;
    refs.calibrationSummary.textContent = project.background?.builtin
      ? 'PK1標準：0,0 ～ 2000,3250（設定済み）'
      : (c ? `左上 ${formatCoord(c.topLeft.x)},${formatCoord(c.topLeft.y)} ／ 右下 ${formatCoord(c.bottomRight.x)},${formatCoord(c.bottomRight.y)}` : '未設定');
  }

  function toggleExportMenu() {
    refs.exportMenu.hidden = !refs.exportMenu.hidden;
    refs.exportMenuBtn.setAttribute('aria-expanded', String(!refs.exportMenu.hidden));
  }

  function closeExportMenu() {
    refs.exportMenu.hidden = true;
    refs.exportMenuBtn.setAttribute('aria-expanded', 'false');
  }

  async function exportViewPng() {
    if (!backgroundImage) {
      showToast('先にマップ画像を読み込んでください', true);
      return;
    }
    try {
      const scale = Math.min(2, window.devicePixelRatio || 1.5);
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(canvas.clientWidth * scale));
      out.height = Math.max(1, Math.round(canvas.clientHeight * scale));
      const outCtx = out.getContext('2d');
      outCtx.scale(scale, scale);
      outCtx.fillStyle = '#0c0e11';
      outCtx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      outCtx.save();
      outCtx.translate(view.x, view.y);
      outCtx.scale(view.scale, view.scale);
      outCtx.drawImage(backgroundImage, 0, 0);
      drawPk1ReferenceLayers(outCtx);
      drawRouteOverlay(outCtx);
      for (const obj of project.objects) if (isObjectVisible(obj)) drawObject(outCtx, obj, false);
      outCtx.restore();
      const blob = await canvasToBlob(out, 'image/png');
      downloadBlob(blob, `${safeFilename(project.name)}_表示範囲.png`);
      showToast('現在の表示範囲をPNG出力しました');
    } catch (error) {
      console.error(error);
      showToast('PNG出力に失敗しました', true);
    }
  }

  function canvasToBlob(target, type) {
    return new Promise((resolve, reject) => {
      target.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas export failed')), type);
    });
  }

  async function exportViewerHtml() {
    if (!backgroundImage) {
      showToast('先にマップ画像を読み込んでください', true);
      return;
    }
    try {
      project.name = refs.projectName.value.trim() || '名称未設定';
      project.updatedAt = new Date().toISOString();
      persistCurrentScenario();
      const exportProject = JSON.parse(JSON.stringify(project));
      exportProject.exportPhaseFilter = phaseFilter;
      if (!exportProject.background.dataUrl) {
        const embed = document.createElement('canvas');
        embed.width = backgroundImage.naturalWidth; embed.height = backgroundImage.naturalHeight;
        embed.getContext('2d').drawImage(backgroundImage, 0, 0);
        exportProject.background.dataUrl = embed.toDataURL('image/png');
      }
      const html = buildViewerHtml(exportProject);
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      downloadBlob(blob, safeFilename(project.name) + '_共有用.html');
      showToast('閲覧専用の共有HTMLを出力しました');
    } catch (error) { console.error(error); showToast('共有HTMLの出力に失敗しました', true); }
  }

  function buildViewerHtml(data) {
    const safeProject = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    const referenceData = {
      cities: pk1Cities.map(o => ({ id:o.id, name:o.name, kind:'city', level:o.level, center_x:o.center_x, center_y:o.center_y })),
      gates: pk1Gates.map(o => ({ id:o.id, name:o.name, kind:'gate', level:o.level, center_x:o.center_x, center_y:o.center_y }))
    };
    const safeReference = JSON.stringify(referenceData).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${escapeHtml(data.name)}｜作戦図</title>
<style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0c0e11;color:#eef1f6;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans JP",Meiryo,sans-serif}body{display:grid;grid-template-rows:54px 1fr 30px}header{display:flex;align-items:center;gap:12px;padding:7px 12px;background:#171a20;border-bottom:1px solid #323844}h1{margin:0;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}header .spacer{flex:1}button,select{height:34px;border:1px solid #414957;border-radius:6px;background:#262b35;color:#eef1f6;padding:0 9px;font:inherit;font-size:12px}button{cursor:pointer}.stage{position:relative;min-height:0}canvas{display:block;width:100%;height:100%;touch-action:none;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;cursor:grab}footer{display:flex;align-items:center;gap:12px;padding:0 10px;background:#15181d;border-top:1px solid #323844;color:#aab2c0;font-size:10px}footer .spacer{flex:1}@media(max-width:620px){header{gap:5px;padding:6px}h1{font-size:13px}header select{max-width:120px}header button{padding:0 7px}}
</style></head><body>
<header><h1>${escapeHtml(data.name)}</h1><span class="spacer"></span><select id="phase"><option>すべて</option><option>共通</option><option>第1段階</option><option>第2段階</option><option>第3段階</option><option>予備</option></select><button id="fit">全体表示</button><button id="zin">＋</button><button id="zout">−</button></header>
<div class="stage" id="stage"><canvas id="c"></canvas></div>
<footer><span id="game">ゲーム座標: --</span><span class="spacer"></span><span id="zoom">100%</span></footer>
<script>
'use strict';
const project=${safeProject};
const reference=${safeReference};
const c=document.getElementById('c'),ctx=c.getContext('2d'),stage=document.getElementById('stage');
let img=new Image(),view={s:1,x:0,y:0},drag=null,phase=project.exportPhaseFilter||'すべて';
const T=project.background&&project.background.builtin?{m00:1.3811020352,m01:-1.1998330080000001,m10:0.7361070080000001,m11:0.568297248,tx:2225.7348256,ty:-536.8040288000001,im00:0.34068904150606916,im01:0.7192889969139248,im10:-0.44128946934724644,im11:0.8279581332661488}:null;
const $=id=>document.getElementById(id);
function gw(gx,gy){if(!T)return{x:gx,y:gy};return{x:T.m00*gx+T.m01*gy+T.tx,y:T.m10*gx+T.m11*gy+T.ty}}
function wg(wx,wy){if(!T)return null;let dx=wx-T.tx,dy=wy-T.ty;return{x:T.im00*dx+T.im01*dy,y:T.im10*dx+T.im11*dy}}
function rr(q,a,b,w,h,r){r=Math.min(r,w/2,h/2);q.beginPath();q.moveTo(a+r,b);q.arcTo(a+w,b,a+w,b+h,r);q.arcTo(a+w,b+h,a,b+h,r);q.arcTo(a,b+h,a,b,r);q.arcTo(a,b,a+w,b,r);q.closePath()}
function visible(o){return !o.hidden&&(phase==='すべて'||(phase==='共通'?o.phase==='共通':o.phase==='共通'||o.phase===phase))}
function label(q,text,a,b,fs){if(!text)return;fs=Math.max(8,fs||10);q.save();q.font='700 '+fs+'px sans-serif';q.textAlign='center';q.textBaseline='middle';let w=q.measureText(String(text)).width+fs*.8,h=fs*1.5;q.fillStyle='rgba(9,11,14,.82)';rr(q,a-w/2,b-h/2,w,h,fs*.28);q.fill();q.strokeStyle='rgba(255,255,255,.2)';q.lineWidth=Math.max(1,1/view.s);q.stroke();q.fillStyle='#fff';q.fillText(String(text),a,b);q.restore()}
function labelAnchor(o){if(o.type==='arrow'||o.type==='defense'||o.type==='area')return{x:(o.x+o.x2)/2,y:(o.y+o.y2)/2};return{x:o.x,y:o.y}}
function object(q,o){q.save();q.globalAlpha=Math.max(.05,Math.min(1,o.opacity==null?1:o.opacity));q.lineCap='round';q.lineJoin='round';q.strokeStyle=o.color;q.fillStyle=o.color;q.lineWidth=o.lineWidth||4;let s=o.size||28,r=s/2,dx=o.x2-o.x,dy=o.y2-o.y,l=Math.hypot(dx,dy),ux,uy,px,py,ls=o.labelSize||10;if(o.symbolVisible===false&&o.type!=='text'){let a=labelAnchor(o);label(q,o.label,a.x,a.y,ls);q.restore();return}
if(o.type==='ally'||o.type==='enemy'){q.beginPath();q.arc(o.x,o.y,r,0,Math.PI*2);q.fill();q.strokeStyle='#fff';q.lineWidth=Math.max(2,(o.lineWidth||3)*.55);q.stroke();q.fillStyle='#fff';q.font='800 '+Math.max(12,s*.35)+'px sans-serif';q.textAlign='center';q.textBaseline='middle';q.fillText(o.type==='ally'?'自':'敵',o.x,o.y+1);label(q,o.label,o.x,o.y+r+s*.22,ls)}
else if(o.type==='garrison'){q.translate(o.x,o.y);q.beginPath();q.moveTo(0,-s*.5);q.lineTo(s*.38,-s*.28);q.lineTo(s*.31,s*.22);q.quadraticCurveTo(0,s*.55,0,s*.55);q.quadraticCurveTo(0,s*.55,-s*.31,s*.22);q.lineTo(-s*.38,-s*.28);q.closePath();q.fill();q.strokeStyle='#fff';q.lineWidth=Math.max(2,(o.lineWidth||3)*.5);q.stroke();q.fillStyle='#fff';q.font='800 '+s*.28+'px sans-serif';q.textAlign='center';q.textBaseline='middle';q.fillText('駐',0,0);q.translate(-o.x,-o.y);label(q,o.label,o.x,o.y+s*.75,ls)}
else if(o.type==='camp'){q.translate(o.x,o.y);q.beginPath();q.moveTo(0,-s*.5);q.lineTo(s*.52,s*.42);q.lineTo(-s*.52,s*.42);q.closePath();q.fill();q.strokeStyle='#fff';q.lineWidth=Math.max(2,(o.lineWidth||3)*.5);q.stroke();q.beginPath();q.moveTo(0,-s*.5);q.lineTo(0,s*.42);q.moveTo(-s*.28,s*.42);q.lineTo(0,-s*.5);q.lineTo(s*.28,s*.42);q.stroke();q.translate(-o.x,-o.y);label(q,o.label,o.x,o.y+s*.68,ls)}
else if(o.type==='fort'){q.translate(o.x,o.y);q.beginPath();q.rect(-s*.45,-s*.25,s*.9,s*.68);q.rect(-s*.48,-s*.48,s*.22,s*.28);q.rect(-s*.11,-s*.48,s*.22,s*.28);q.rect(s*.26,-s*.48,s*.22,s*.28);q.fill();q.strokeStyle='#fff';q.lineWidth=Math.max(2,(o.lineWidth||3)*.48);q.stroke();q.translate(-o.x,-o.y);label(q,o.label,o.x,o.y+s*.72,ls)}
else if(o.type==='relocate'||['castle','gate','bridge','station'].includes(o.type)){q.translate(o.x,o.y);r=s*.5;q.beginPath();if(o.type==='gate'){q.moveTo(0,-r);q.lineTo(r,0);q.lineTo(0,r);q.lineTo(-r,0);q.closePath()}else if(o.type==='station'){q.moveTo(-r*.82,-r);q.lineTo(r*.82,-r);q.lineTo(r,0);q.lineTo(r*.82,r);q.lineTo(-r*.82,r);q.lineTo(-r,0);q.closePath()}else if(o.type==='bridge'){rr(q,-r,-r*.58,s,s*.82,s*.12)}else{rr(q,-r,-r,s,s,s*.12)}q.fill();q.strokeStyle='#fff';q.lineWidth=Math.max(2,(o.lineWidth||3)*.5);q.stroke();q.fillStyle='#fff';q.font='800 '+s*.34+'px sans-serif';q.textAlign='center';q.textBaseline='middle';q.fillText(({relocate:'遷',castle:'城',gate:'関',bridge:'橋',station:'駅'})[o.type]||'',0,1);q.translate(-o.x,-o.y);label(q,o.label,o.x,o.y+s*.74,ls)}
else if(o.type==='target'){q.translate(o.x,o.y);r=s*.45;q.lineWidth=Math.max(3,o.lineWidth||3);q.beginPath();q.arc(0,0,r,0,Math.PI*2);q.stroke();q.beginPath();q.arc(0,0,r*.52,0,Math.PI*2);q.stroke();q.beginPath();q.moveTo(-r*1.25,0);q.lineTo(r*1.25,0);q.moveTo(0,-r*1.25);q.lineTo(0,r*1.25);q.stroke();q.translate(-o.x,-o.y);label(q,o.label,o.x,o.y+s*.75,ls)}
else if(o.type==='text'){let fs=Math.max(8,o.labelSize||s),lines=String(o.label||'メモ').split(/\\n/).slice(0,6);q.font='700 '+fs+'px sans-serif';let w=Math.max.apply(null,lines.map(t=>q.measureText(t||' ').width))+fs*.9,h=lines.length*fs*1.25+fs*.55;q.fillStyle='rgba(10,12,15,.78)';rr(q,o.x-fs*.35,o.y-fs*.28,w,h,fs*.25);q.fill();q.strokeStyle=o.color;q.lineWidth=Math.max(2,o.lineWidth||2);q.stroke();q.fillStyle=o.color;q.textAlign='left';q.textBaseline='top';lines.forEach((t,i)=>q.fillText(t,o.x,o.y+i*fs*1.25))}
else if(o.type==='arrow'&&l>1){ux=dx/l;uy=dy/l;let hd=Math.min(Math.max(s,(o.lineWidth||4)*4),l*.38),bx=o.x2-ux*hd,by=o.y2-uy*hd;px=-uy;py=ux;q.beginPath();q.moveTo(o.x,o.y);q.lineTo(bx,by);q.stroke();q.beginPath();q.moveTo(o.x2,o.y2);q.lineTo(bx+px*hd*.48,by+py*hd*.48);q.lineTo(bx-px*hd*.48,by-py*hd*.48);q.closePath();q.fill();label(q,o.label,(o.x+o.x2)/2,(o.y+o.y2)/2-s*.48,ls)}
else if(o.type==='defense'&&l>1){ux=dx/l;uy=dy/l;px=-uy;py=ux;q.beginPath();q.moveTo(o.x,o.y);q.lineTo(o.x2,o.y2);q.stroke();let inter=Math.max(26,s*.72),n=Math.max(2,Math.floor(l/inter));q.lineWidth=Math.max(2,(o.lineWidth||4)*.72);q.beginPath();for(let i=0;i<=n;i++){let t=i/n,a=o.x+dx*t,b=o.y+dy*t,tick=s*.32;q.moveTo(a,b);q.lineTo(a+px*tick,b+py*tick)}q.stroke();label(q,o.label,(o.x+o.x2)/2+px*s*.58,(o.y+o.y2)/2+py*s*.58,ls)}
else if(o.type==='area'){let a=Math.min(o.x,o.x2),b=Math.min(o.y,o.y2),w=Math.abs(dx),h=Math.abs(dy);q.globalAlpha*=.35;q.fillRect(a,b,w,h);q.globalAlpha=Math.max(.05,Math.min(1,o.opacity==null?1:o.opacity));q.setLineDash([s*.34,s*.2]);q.strokeRect(a,b,w,h);q.setLineDash([]);label(q,o.label,a+w/2,b+Math.max(s*.38,18),ls)}q.restore()}
function routeLine(path,color,dash){dash=dash||[];if(!path||path.length<2)return;ctx.save();ctx.strokeStyle=color;ctx.lineWidth=Math.max(1.2,3.2/view.s);ctx.lineJoin='round';ctx.lineCap='round';ctx.setLineDash(dash.map(n=>n/view.s));ctx.beginPath();path.forEach((idx,i)=>{let gx=idx%2000+.5,gy=Math.floor(idx/2000)+.5,p=gw(gx,gy);if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y)});ctx.stroke();ctx.restore()}
function refs(){let rp=project.routePlanner||{},items=[];function marker(o,fill,stroke,rad){let p=gw(Number(o.center_x),Number(o.center_y)),r=Math.max(2.2,rad/view.s);ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle=stroke;ctx.lineWidth=Math.max(.7,1/view.s);ctx.stroke()}if(rp.showGates!==false)(reference.gates||[]).forEach(o=>marker(o,'#f2a51a','#5d3a00',4));if(rp.showCities===true)(reference.cities||[]).forEach(o=>marker(o,'#7b201d','#f3d7ca',3.2));if(rp.showGateLabels!==false)(reference.gates||[]).forEach(o=>items.push({o:o,kind:'gate',priority:2000+Number(o.level||0)}));if(rp.showCityLabels!==false)(reference.cities||[]).forEach(o=>items.push({o:o,kind:'city',priority:1000+Number(o.level||0)}));items.sort((a,b)=>b.priority-a.priority||Number(a.o.id)-Number(b.o.id));let placed=[],cand=[[0,-15],[0,15],[16,0],[-16,0],[15,-13],[-15,-13],[15,13],[-15,13],[0,-28],[0,28]];ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';for(let it of items){let p=gw(Number(it.o.center_x),Number(it.o.center_y)),fs=Math.max(8.5,11/view.s);ctx.font='700 '+fs+'px "Noto Sans JP",sans-serif';let tw=ctx.measureText(it.o.name).width,chosen=null;for(let d of cand){let cx=p.x+d[0]/view.s,cy=p.y+d[1]/view.s,box={l:cx-tw/2-3/view.s,r:cx+tw/2+3/view.s,t:cy-fs*.7,b:cy+fs*.7};if(!placed.some(z=>!(box.r<z.l||box.l>z.r||box.b<z.t||box.t>z.b))){chosen={cx:cx,cy:cy,box:box};break}}if(!chosen)continue;placed.push(chosen.box);ctx.lineJoin='round';ctx.strokeStyle='rgba(12,22,31,.96)';ctx.lineWidth=3.2/view.s;ctx.strokeText(it.o.name,chosen.cx,chosen.cy);ctx.fillStyle=it.kind==='gate'?'#ffd166':'#f8fbff';ctx.fillText(it.o.name,chosen.cx,chosen.cy)}ctx.restore()}
function draw(){let d=c.d||1,w=c.clientWidth,h=c.clientHeight;ctx.setTransform(d,0,0,d,0,0);ctx.fillStyle='#0c0e11';ctx.fillRect(0,0,w,h);ctx.save();ctx.translate(view.x,view.y);ctx.scale(view.s,view.s);ctx.drawImage(img,0,0);refs();let rp=project.routePlanner||{};routeLine(rp.path,'#e43b2e');if(rp.showAlt2&&rp.altPaths&&rp.altPaths[0])routeLine(rp.altPaths[0],'#22b8cf',[8,5]);if(rp.showAlt3&&rp.altPaths&&rp.altPaths[1])routeLine(rp.altPaths[1],'#b86cff',[3,5]);if(rp.points)rp.points.forEach((p,i)=>{let q=gw(p[0]+.5,p[1]+.5);ctx.save();ctx.fillStyle=i===0?'#23b967':(i===rp.points.length-1?'#e13d36':'#ffd54d');ctx.strokeStyle='#fff';ctx.lineWidth=Math.max(1,1.4/view.s);ctx.beginPath();ctx.arc(q.x,q.y,Math.max(3,5.8/view.s),0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore()});project.objects.forEach(o=>{if(visible(o))object(ctx,o)});ctx.restore();$('zoom').textContent=Math.round(view.s*100)+'%'}
function resize(){let r=stage.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2.5);c.width=Math.max(1,Math.floor(r.width*d));c.height=Math.max(1,Math.floor(r.height*d));c.style.width=r.width+'px';c.style.height=r.height+'px';c.d=d}
function fit(){let pad=28,s=Math.min((c.clientWidth-pad*2)/img.naturalWidth,(c.clientHeight-pad*2)/img.naturalHeight);view.s=Math.max(.03,s);view.x=(c.clientWidth-img.naturalWidth*view.s)/2;view.y=(c.clientHeight-img.naturalHeight*view.s)/2;draw()}
function zoom(f,a,b){let wx=(a-view.x)/view.s,wy=(b-view.y)/view.s;view.s=Math.max(.03,Math.min(12,view.s*f));view.x=a-wx*view.s;view.y=b-wy*view.s;draw()}
function pointer(e){let r=c.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
img.onload=()=>{resize();fit();draw()};img.src=project.background.dataUrl||project.background.src;
new ResizeObserver(()=>{resize();draw()}).observe(stage);
let touches=new Map(),pinch=null;
function startPinch(){let a=[...touches.entries()].slice(0,2);if(a.length<2)return;let p=a[0][1],q=a[1][1],mx=(p.x+q.x)/2,my=(p.y+q.y)/2;pinch={ids:[a[0][0],a[1][0]],dist:Math.max(1,Math.hypot(q.x-p.x,q.y-p.y)),scale:view.s,wx:(mx-view.x)/view.s,wy:(my-view.y)/view.s};drag=null}
c.onpointerdown=e=>{e.preventDefault();let p=pointer(e);c.setPointerCapture(e.pointerId);if(e.pointerType==='touch'){touches.set(e.pointerId,p);if(touches.size>=2){startPinch();return}}drag={id:e.pointerId,p:p,v:{s:view.s,x:view.x,y:view.y}};c.style.cursor='grabbing'};
c.onpointermove=e=>{let p=pointer(e);if(e.pointerType==='touch'&&touches.has(e.pointerId)){touches.set(e.pointerId,p);if(pinch){let a=touches.get(pinch.ids[0]),b=touches.get(pinch.ids[1]);if(a&&b){e.preventDefault();let mx=(a.x+b.x)/2,my=(a.y+b.y)/2,d=Math.max(1,Math.hypot(b.x-a.x,b.y-a.y));view.s=Math.max(.03,Math.min(12,pinch.scale*d/pinch.dist));view.x=mx-pinch.wx*view.s;view.y=my-pinch.wy*view.s;draw();return}}}let wx=(p.x-view.x)/view.s,wy=(p.y-view.y)/view.s,g=wg(wx,wy);if(g)$('game').textContent='ゲーム座標: '+g.x.toFixed(1)+', '+g.y.toFixed(1);if(drag&&drag.id===e.pointerId){view.x=drag.v.x+p.x-drag.p.x;view.y=drag.v.y+p.y-drag.p.y;draw()}};
c.onpointerup=e=>{if(e.pointerType==='touch'){touches.delete(e.pointerId);if(pinch&&(pinch.ids.includes(e.pointerId)||touches.size<2)){pinch=null;drag=null;c.style.cursor='grab';return}}if(drag&&drag.id===e.pointerId)drag=null;c.style.cursor='grab'};c.onpointercancel=c.onpointerup;c.onwheel=e=>{e.preventDefault();let p=pointer(e);zoom(Math.exp(-e.deltaY*.0015),p.x,p.y)};
$('fit').onclick=fit;$('zin').onclick=()=>zoom(1.25,c.clientWidth/2,c.clientHeight/2);$('zout').onclick=()=>zoom(.8,c.clientWidth/2,c.clientHeight/2);$('phase').value=phase;$('phase').onchange=e=>{phase=e.target.value;draw()};
</script></body></html>`;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function safeFilename(name) {
    return String(name || '作戦図').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || '作戦図';
  }

  function showToast(message, isError = false) {
    clearTimeout(toastTimer);
    refs.toast.textContent = message;
    refs.toast.classList.toggle('error', isError);
    refs.toast.classList.add('show');
    toastTimer = setTimeout(() => refs.toast.classList.remove('show'), 2800);
  }

  function defaultRoutePlanner() {
    return { points: [], mode: 'land', blockedGates: [], showGates: true, showCities: false, showGateLabels: true, showCityLabels: true,
      showAlt2: false, showAlt3: false, path: [], altPaths: [], result: null };
  }

  function normalizeRoutePlanner(value) {
    const base = defaultRoutePlanner();
    if (!value || typeof value !== 'object') return base;
    const points = Array.isArray(value.points) ? value.points.filter(p => Array.isArray(p) && p.length >= 2).map(p => [Math.round(Number(p[0])), Math.round(Number(p[1]))]).filter(p => p.every(Number.isFinite)) : [];
    const blocked = Array.isArray(value.blockedGates) ? value.blockedGates.map(Number).filter(Number.isFinite) : [];
    const path = Array.isArray(value.path) ? value.path.map(Number).filter(Number.isFinite) : [];
    const altPaths = Array.isArray(value.altPaths) ? value.altPaths.slice(0,2).map(a => Array.isArray(a) ? a.map(Number).filter(Number.isFinite) : []) : [];
    return {
      points, mode: 'land', blockedGates: blocked,
      showGates: value.showGates !== false, showCities: value.showCities === true,
      showGateLabels: value.showGateLabels !== false && value.showLabels !== false,
      showCityLabels: value.showCityLabels !== false && value.showLabels !== false,
      showAlt2: value.showAlt2 === true, showAlt3: value.showAlt3 === true,
      path, altPaths,
      result: value.result && typeof value.result === 'object' ? value.result : null
    };
  }

  function ensureRoutePlanner() {
    if (!project.routePlanner) project.routePlanner = defaultRoutePlanner();
    return project.routePlanner;
  }

  function decodeBase64Bytes(text) {
    const bin = atob(text); const out = new Uint8Array(bin.length);
    for (let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i);
    return out;
  }

  async function loadPk1Assets() {
    const embedded = window.PK1_EMBEDDED || null;
    if (!embedded) throw new Error('PK1 embedded data is missing');

    pk1Cities = embedded.cities || [];
    pk1Gates = embedded.gates || [];
    pk1Regions = embedded.regions || [];
    pk1Land = embedded.land || [];
    populatePlaceSearch();
    populateGateBlockList();

    if (!routeWorker) {
      if (!embedded.passableLandB64) throw new Error('PK1 passable land data is missing');
      const workerSource = PK1_ROUTE_WORKER_SOURCE;
      const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
      routeWorker = new Worker(workerUrl);
      routeWorker.onmessage = event => {
        if (event.data && event.data.type === 'ready') {
          routeWorkerReady = true;
          refs.routeBadge.textContent = 'PK1';
          return;
        }
        handleRouteWorkerMessage(event);
      };
      routeWorker.onerror = event => {
        routeBusy = false;
        routeWorkerReady = false;
        refs.routeCalculateBtn.disabled = false;
        refs.routeResult.innerHTML = '<span class="route-error">経路探索の初期化に失敗しました。</span>';
        console.error(event);
      };
      const bits = decodeBase64Bytes(embedded.passableLandB64);
      const stationRuns = new Uint32Array(Array.isArray(embedded.stationRoadRuns) ? embedded.stationRoadRuns : []);
      routeWorker.postMessage({ type: 'init', buffer: bits.buffer, stationRuns: stationRuns.buffer }, [bits.buffer, stationRuns.buffer]);
    }
    syncRouteUI();
    requestRender();
  }

  function activateBuiltinMap() {
    const doLoad = async () => {
      const old = serializeProject();
      recordHistory(old);
      project.background = { ...PK1_BACKGROUND };
      project.calibration = JSON.parse(JSON.stringify(PK1_CALIBRATION));
      await loadBackgroundFromProject();
      dirty = true;
      syncAllUI();
      fitView();
      showToast('PK1標準マップに切り替えました');
    };
    if (project.background && !project.background.builtin && !confirm('現在の背景画像をPK1標準マップへ戻します。配置済みの作戦記号は維持されます。続けますか？')) return;
    doLoad().catch(err => { console.error(err); showToast('PK1標準マップを読み込めませんでした', true); });
  }

  function routePointsFromText() {
    const out = [];
    for (const line of refs.routePoints.value.split(/\r?\n/)) {
      const t = line.trim(); if (!t) continue;
      const m = t.match(/^\s*(-?\d+)\s*,\s*(-?\d+)\s*$/);
      if (!m) return null;
      out.push([Number(m[1]), Number(m[2])]);
    }
    return out;
  }

  function routePointsChanged() {
    const points = routePointsFromText();
    const rp = ensureRoutePlanner();
    rp.points = points || [];
    rp.path = []; rp.altPaths = []; rp.result = null;
    renderRouteResult();
    dirty = true; syncMobileControls(); requestRender();
  }

  function alternateRouteChanged() {
    const rp = ensureRoutePlanner();
    rp.showAlt2 = refs.showAltRoute2.checked;
    rp.showAlt3 = refs.showAltRoute3.checked;
    dirty = true;
    if (rp.points.length >= 2 && routeWorkerReady) calculateRoute(true);
    else requestRender();
  }

  function routeSettingsChanged() {
    const rp = ensureRoutePlanner();
    rp.mode = 'land';
    rp.showGates = refs.showGateMarkers.checked;
    rp.showCities = refs.showCityMarkers.checked;
    rp.showGateLabels = refs.showGateLabels.checked;
    rp.showCityLabels = refs.showCityLabels.checked;
    rp.path = []; rp.altPaths = []; rp.result = null; dirty = true; requestRender();
  }

  function routeDisplayChanged() {
    const rp = ensureRoutePlanner();
    rp.showGates = refs.showGateMarkers.checked;
    rp.showCities = refs.showCityMarkers.checked;
    rp.showGateLabels = refs.showGateLabels.checked;
    rp.showCityLabels = refs.showCityLabels.checked;
    dirty = true; requestRender();
  }

  function syncRouteUI() {
    if (!refs.routePoints) return;
    const rp = ensureRoutePlanner();
    const text = rp.points.map(p => `${p[0]},${p[1]}`).join('\n');
    if (document.activeElement !== refs.routePoints) refs.routePoints.value = text;
    refs.showGateMarkers.checked = rp.showGates;
    refs.showCityMarkers.checked = rp.showCities;
    refs.showGateLabels.checked = rp.showGateLabels;
    refs.showCityLabels.checked = rp.showCityLabels;
    refs.showAltRoute2.checked = rp.showAlt2;
    refs.showAltRoute3.checked = rp.showAlt3;
    if (pk1Gates.length) {
      for (const cb of refs.gateBlockList.querySelectorAll('input[type="checkbox"]')) cb.checked = rp.blockedGates.includes(Number(cb.dataset.id));
    }
    renderRouteResult();
    syncMobileControls();
  }

  function renderRouteResult() {
    const rp = ensureRoutePlanner();
    if (!rp.result) {
      refs.routeResult.innerHTML = '<span class="route-placeholder">経路を計算すると、ここに最短マス数を表示します。</span>';
      return;
    }
    const r = rp.result;
    if (r.status !== 'ok') {
      const labels = { outside:'マップ範囲外です', start_blocked:'開始点が通行不可です', goal_blocked:'終点が通行不可です', no_path:'到達可能な経路がありません', max_expand:'探索上限に達しました', error:'経路計算エラー' };
      refs.routeResult.innerHTML = `<span class="route-error">${labels[r.status] || r.status}</span>`; return;
    }
    const crossed = (r.crossedGates || []).map(id => pk1Gates.find(g => Number(g.id) === Number(id))?.name || `ID ${id}`);
    const blocked = rp.blockedGates.map(id => pk1Gates.find(g => Number(g.id) === Number(id))?.name || `ID ${id}`);
    const alts = Array.isArray(r.alternatives) ? r.alternatives : [];
    let extra = '';
    if (rp.showAlt2) extra += alts[0]
      ? `<div class="route-alt-summary alt2">候補2 ${alts[0].steps} マス</div>`
      : '<div class="route-alt-summary alt2 unavailable">候補2：経路1と重ならない経路なし</div>';
    if (rp.showAlt3) extra += alts[1]
      ? `<div class="route-alt-summary alt3">候補3 ${alts[1].steps} マス</div>`
      : '<div class="route-alt-summary alt3 unavailable">候補3：経路1と重ならない経路なし</div>';
    refs.routeResult.innerHTML = `<div class="route-ok">最短 ${r.totalSteps} マス</div>${extra}<table>` +
      `<tr><td>通過関所</td><td>${crossed.length ? crossed.join('、') : '-'}</td></tr>` +
      `<tr><td>遮断関所</td><td>${blocked.length ? blocked.join('、') : '-'}</td></tr></table>`;
  }

  function calculateRoute(silent = false) {
    const points = routePointsFromText();
    if (!points) { if (!silent) refs.routeResult.innerHTML = '<span class="route-error">座標は x,y 形式で入力してください。</span>'; return; }
    if (points.length < 2) { if (!silent) refs.routeResult.innerHTML = '<span class="route-error">経路点を2点以上指定してください。</span>'; return; }
    if (points.some(p => p[0] < 0 || p[0] >= PK1_WIDTH || p[1] < 0 || p[1] >= PK1_HEIGHT)) { if (!silent) refs.routeResult.innerHTML = '<span class="route-error">PK1マップ範囲外の座標があります。</span>'; return; }
    if (!routeWorker || !routeWorkerReady) {
      if (!silent) refs.routeResult.innerHTML = '<span class="route-error">経路データを初期化中です。1〜2秒後にもう一度お試しください。</span>';
      return;
    }
    const rp = ensureRoutePlanner(); rp.points = points; rp.mode = 'land'; rp.blockedGates = getBlockedGateIds(); rp.path = []; rp.altPaths = []; rp.result = null;
    routeBusy = true; refs.routeCalculateBtn.disabled = true; refs.routeResult.textContent = '経路を探索中…'; refs.routeBadge.textContent = '探索中';
    const routeCount = rp.showAlt3 ? 3 : (rp.showAlt2 ? 2 : 1);
    routeWorker.postMessage({ type:'route', points:rp.points, blockedGateIds:rp.blockedGates, gates:pk1Gates, routeCount });
    requestRender();
  }

  function handleRouteWorkerMessage(event) {
    routeBusy = false; refs.routeCalculateBtn.disabled = false; refs.routeBadge.textContent = 'PK1';
    const r = event.data || {}; const rp = ensureRoutePlanner();
    if (r.status !== 'ok') { rp.path = []; rp.altPaths = []; rp.result = { status:r.status || 'error' }; renderRouteResult(); requestRender(); return; }
    const routes = Array.isArray(r.routes) ? r.routes : [];
    const first = routes[0] || {};
    rp.path = Array.from(first.path || []);
    rp.altPaths = routes.slice(1,3).map(item => Array.from(item.path || []));
    const crossed = [];
    for (const g of pk1Gates) {
      const xmin=Number(g.xmin),xmax=Number(g.xmax),ymin=Number(g.ymin),ymax=Number(g.ymax);
      if (rp.path.some(idx => { const x=idx%PK1_WIDTH,y=Math.floor(idx/PK1_WIDTH); return x>=xmin&&x<=xmax&&y>=ymin&&y<=ymax; })) crossed.push(Number(g.id));
    }
    rp.result = { status:'ok', totalSteps:Number(first.totalSteps || 0), stationCells:Number(first.stationCells || 0), crossedGates:crossed,
      alternatives: routes.slice(1,3).map(item => ({ steps:Number(item.totalSteps || 0), stationCells:Number(item.stationCells || 0) })) };
    dirty = true; renderRouteResult(); requestRender();
  }

  function undoRoutePoint() {
    const rp = ensureRoutePlanner(); if (!rp.points.length) return; rp.points.pop(); rp.path=[];rp.altPaths=[];rp.result=null;dirty=true;syncRouteUI();requestRender();
  }
  function clearRoute() {
    const rp = ensureRoutePlanner(); rp.points=[];rp.path=[];rp.altPaths=[];rp.result=null;dirty=true;syncRouteUI();requestRender();
  }

  function getBlockedGateIds() {
    return Array.from(refs.gateBlockList.querySelectorAll('input[type="checkbox"]:checked')).map(cb => Number(cb.dataset.id));
  }
  function setAllGateBlocks(value) {
    for (const cb of refs.gateBlockList.querySelectorAll('input[type="checkbox"]')) cb.checked = value;
    const rp=ensureRoutePlanner();rp.blockedGates=getBlockedGateIds();rp.path=[];rp.altPaths=[];rp.result=null;dirty=true;renderRouteResult();requestRender();
  }
  function filterGateBlocks() {
    const q = refs.gateFilter.value.trim().toLowerCase();
    for (const item of refs.gateBlockList.querySelectorAll('.gate-block-item')) {
      const match = !q || item.dataset.label.toLowerCase().includes(q);
      item.style.display = match ? 'flex' : 'none';
    }
  }

  function populatePlaceSearch() {
    placeLookup = new Map(); refs.placeSearchList.textContent = '';
    const add = obj => {
      const label = String(obj.name);
      const op = document.createElement('option');
      op.value = label;
      refs.placeSearchList.appendChild(op);
      placeLookup.set(label, obj);
    };
    pk1Cities.forEach(add); pk1Gates.forEach(add);
  }

  function populateGateBlockList() {
    refs.gateBlockList.textContent='';
    for (const g of pk1Gates) {
      const label=document.createElement('label'); label.className='gate-block-item'; label.dataset.label=`${g.name} ${g.province_names||''}`;
      const cb=document.createElement('input'); cb.type='checkbox'; cb.dataset.id=String(g.id); cb.checked=ensureRoutePlanner().blockedGates.includes(Number(g.id));
      cb.addEventListener('change',()=>{ const rp=ensureRoutePlanner();rp.blockedGates=getBlockedGateIds();rp.path=[];rp.altPaths=[];rp.result=null;dirty=true;renderRouteResult();requestRender(); });
      const sp=document.createElement('span'); sp.textContent=`${g.name} (${Math.round(g.center_x)},${Math.round(g.center_y)})`;
      label.append(cb,sp); refs.gateBlockList.appendChild(label);
    }
    filterGateBlocks();
  }

  function selectedPlace() {
    const text = refs.placeSearch.value.trim();
    if (!text) return null;
    if (placeLookup.has(text)) return placeLookup.get(text);
    const q = text.toLowerCase();
    const all = [...pk1Cities, ...pk1Gates];
    const exact = all.find(o => String(o.name).toLowerCase() === q);
    if (exact) return exact;
    const partial = all.filter(o => String(o.name).toLowerCase().includes(q));
    return partial.length === 1 ? partial[0] : null;
  }
  function centerSelectedPlace() {
    const o=selectedPlace(); if (!o) { showToast('城・関所を選択してください',true);return; }
    const w=gameToWorld(Number(o.center_x),Number(o.center_y)); if(!w){showToast('ゲーム座標が設定されていません',true);return;}
    const target=Math.max(view.scale,0.9);view.scale=Math.min(MAX_ZOOM,target);view.x=canvas.clientWidth/2-w.x*view.scale;view.y=canvas.clientHeight/2-w.y*view.scale;requestRender();
  }
  function addSelectedPlaceToRoute() {
    const o=selectedPlace(); if(!o){showToast('城・関所を選択してください',true);return;}
    const rp=ensureRoutePlanner();rp.points.push([Math.round(Number(o.center_x)),Math.round(Number(o.center_y))]);rp.path=[];rp.altPaths=[];rp.result=null;dirty=true;syncRouteUI();requestRender();
  }

  function hitPk1PlaceAtScreen(sx, sy) {
    for (let i = pk1LabelHitBoxes.length - 1; i >= 0; i--) {
      const b = pk1LabelHitBoxes[i];
      if (sx >= b.l && sx <= b.r && sy >= b.t && sy <= b.b) return b.o;
    }
    let best = null, bestDist = 28;
    const all = [...pk1Gates, ...pk1Cities];
    for (const o of all) {
      const w = gameToWorld(Number(o.center_x), Number(o.center_y)); if (!w) continue;
      const px = w.x * view.scale + view.x, py = w.y * view.scale + view.y;
      const d = Math.hypot(px - sx, py - sy);
      if (d < bestDist) { best = o; bestDist = d; }
    }
    return best;
  }

  function contextTargetAtScreen(sx, sy) {
    const place = hitPk1PlaceAtScreen(sx, sy);
    if (place) return place;
    const world = screenToWorld(sx, sy, true);
    const game = worldToGame(world.x, world.y);
    if (!game) return null;
    const gx = Math.round(game.x), gy = Math.round(game.y);
    if (gx < 0 || gx >= PK1_WIDTH || gy < 0 || gy >= PK1_HEIGHT) return null;
    return { id: null, name: '地点', kind: 'point', center_x: gx, center_y: gy };
  }

  function positionContextMenu(clientX, clientY, fallbackHeight = 150) {
    const rect = refs.stageWrap.getBoundingClientRect();
    refs.placeContextMenu.hidden = false;
    const mobile = isMobileLayout();
    if (refs.placeContextBackdrop) refs.placeContextBackdrop.hidden = !mobile;
    if (mobile) {
      refs.placeContextMenu.style.left = '';
      refs.placeContextMenu.style.top = '';
      return;
    }
    const menuWidth = refs.placeContextMenu.offsetWidth || 202;
    const menuHeight = refs.placeContextMenu.offsetHeight || fallbackHeight;
    refs.placeContextMenu.style.left = `${Math.min(Math.max(8, rect.width - menuWidth - 8), Math.max(8, clientX - rect.left))}px`;
    refs.placeContextMenu.style.top = `${Math.min(Math.max(8, rect.height - menuHeight - 8), Math.max(8, clientY - rect.top))}px`;
  }

  function openObjectContextMenuAt(obj, clientX, clientY) {
    if (!obj) { hidePlaceContextMenu(); return false; }
    contextPlace = null;
    contextObjectId = obj.id;
    selectObject(obj.id);
    refs.placeContextTitle.textContent = obj.label || TYPE_META[obj.type]?.name || '配置済み記号';
    refs.placeContextRouteBtn.hidden = true;
    refs.placeContextCopyBtn.hidden = true;
    refs.placeContextGateBtn.hidden = true;
    refs.placeContextDeleteBtn.hidden = false;
    positionContextMenu(clientX, clientY, 92);
    return true;
  }

  function openPlaceContextMenuAt(clientX, clientY, screen = null) {
    const rect = refs.stageWrap.getBoundingClientRect();
    const s = screen || { x: clientX - rect.left, y: clientY - rect.top };
    const place = contextTargetAtScreen(s.x, s.y);
    if (!place) { hidePlaceContextMenu(); return false; }
    contextPlace = place;
    contextObjectId = null;
    const readOnly = isMobileReadOnly();
    refs.placeContextRouteBtn.hidden = readOnly;
    refs.placeContextCopyBtn.hidden = false;
    refs.placeContextDeleteBtn.hidden = true;
    const gx = Math.round(Number(place.center_x)), gy = Math.round(Number(place.center_y));
    refs.placeContextTitle.textContent = place.kind === 'point' ? `地点  (${gx},${gy})` : `${place.name}  (${gx},${gy})`;
    const isGate = place.kind === 'gate';
    refs.placeContextGateBtn.hidden = readOnly || !isGate;
    if (isGate && !readOnly) {
      const blocked = ensureRoutePlanner().blockedGates.includes(Number(place.id));
      refs.placeContextGateBtn.textContent = blocked ? '通行可能に戻す' : 'この関所を通行不可';
    }
    positionContextMenu(clientX, clientY, 150);
    return true;
  }

  function onMapContextMenu(e) {
    e.preventDefault();
    openPlaceContextMenuAt(e.clientX, e.clientY, pointerScreen(e));
  }

  function hidePlaceContextMenu() {
    if (refs.placeContextMenu) refs.placeContextMenu.hidden = true;
    if (refs.placeContextBackdrop) refs.placeContextBackdrop.hidden = true;
    contextPlace = null;
    contextObjectId = null;
  }
  function contextAddRoutePoint() {
    if (!contextPlace || isMobileReadOnly()) return; const rp=ensureRoutePlanner();
    rp.points.push([Math.round(Number(contextPlace.center_x)),Math.round(Number(contextPlace.center_y))]); rp.path=[];rp.altPaths=[];rp.result=null;dirty=true;syncRouteUI();requestRender();hidePlaceContextMenu();
  }
  async function contextCopyCoordinate() {
    if (!contextPlace) return; const text=`${Math.round(Number(contextPlace.center_x))},${Math.round(Number(contextPlace.center_y))}`;
    try { await navigator.clipboard.writeText(text); showToast(`座標 ${text} をコピーしました`); }
    catch (_) { const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();showToast(`座標 ${text} をコピーしました`); }
    hidePlaceContextMenu();
  }
  function contextToggleGateBlock() {
    if (!contextPlace || contextPlace.kind !== 'gate' || isMobileReadOnly()) return;
    const id=Number(contextPlace.id), rp=ensureRoutePlanner(); const set=new Set(rp.blockedGates.map(Number));
    if(set.has(id)) set.delete(id); else set.add(id); rp.blockedGates=[...set]; rp.path=[];rp.altPaths=[];rp.result=null; dirty=true;
    populateGateBlockList(); syncRouteUI(); requestRender(); hidePlaceContextMenu();
  }

  function contextDeleteObject() {
    if (!contextObjectId || isMobileReadOnly()) return;
    const obj = project.objects.find(o => o.id === contextObjectId);
    if (!obj) { hidePlaceContextMenu(); return; }
    selectObject(obj.id);
    hidePlaceContextMenu();
    deleteSelected();
  }

  function drawPk1ReferenceLayers(context) {
    if (!backgroundImage || !project.calibration) return;
    const rp = ensureRoutePlanner();
    const drawMarker = (o, fill, stroke, rScreen) => {
      const w = gameToWorld(Number(o.center_x), Number(o.center_y));
      if (!w) return;
      const r = Math.max(2.2, rScreen / view.scale);
      context.beginPath(); context.arc(w.x, w.y, r, 0, Math.PI * 2);
      context.fillStyle = fill; context.fill();
      context.strokeStyle = stroke; context.lineWidth = Math.max(.7, 1 / view.scale); context.stroke();
    };
    if (rp.showCities) for (const c of pk1Cities) drawMarker(c, '#7b201d', '#f3d7ca', 3.2);
    if (rp.showGates) for (const g of pk1Gates) drawMarker(g, '#f2a51a', '#5d3a00', 4.0);

    pk1LabelHitBoxes = [];
    const labels = [];
    if (rp.showGateLabels) for (const g of pk1Gates) labels.push({ o: g, kind: 'gate', priority: 2000 + Number(g.level || 0) });
    if (rp.showCityLabels) for (const c of pk1Cities) labels.push({ o: c, kind: 'city', priority: 1000 + Number(c.level || 0) });
    labels.sort((a, b) => b.priority - a.priority || Number(a.o.id) - Number(b.o.id));

    const placed = [];
    const left = -view.x / view.scale, top = -view.y / view.scale;
    const right = left + canvas.clientWidth / view.scale, bottom = top + canvas.clientHeight / view.scale;
    const overlaps = (a, b) => !(a.r < b.l || a.l > b.r || a.b < b.t || a.t > b.b);
    const candidatesPx = [[0,-15],[0,15],[16,0],[-16,0],[15,-13],[-15,-13],[15,13],[-15,13],[0,-28],[0,28]];

    context.save();
    for (const item of labels) {
      const o = item.o;
      const anchor = gameToWorld(Number(o.center_x), Number(o.center_y));
      if (!anchor || anchor.x < left - 100 / view.scale || anchor.x > right + 100 / view.scale || anchor.y < top - 100 / view.scale || anchor.y > bottom + 100 / view.scale) continue;
      const screenFont = item.kind === 'gate' ? 12.5 : 12;
      const fs = screenFont / view.scale;
      context.font = `700 ${fs}px "Noto Sans JP","Yu Gothic UI","Hiragino Sans","Meiryo",sans-serif`;
      context.textAlign = 'center'; context.textBaseline = 'middle';
      const tw = context.measureText(o.name).width;
      const padX = 4.5 / view.scale, padY = 2 / view.scale;
      const w = tw + padX * 2, h = fs * 1.18 + padY * 2;
      let chosen = null;
      for (const [oxPx, oyPx] of candidatesPx) {
        const cx = anchor.x + oxPx / view.scale;
        const cy = anchor.y + oyPx / view.scale;
        const box = { l: cx - w/2, r: cx + w/2, t: cy - h/2, b: cy + h/2, cx, cy };
        if (!placed.some(p => overlaps(box, p))) { chosen = box; break; }
      }
      if (!chosen) continue;
      placed.push(chosen);
      pk1LabelHitBoxes.push({ o, l: chosen.l * view.scale + view.x, r: chosen.r * view.scale + view.x, t: chosen.t * view.scale + view.y, b: chosen.b * view.scale + view.y });

      const dist = Math.hypot(chosen.cx - anchor.x, chosen.cy - anchor.y);
      if (dist > 9 / view.scale) {
        context.strokeStyle = item.kind === 'gate' ? 'rgba(119,76,0,.75)' : 'rgba(25,36,46,.7)';
        context.lineWidth = 1 / view.scale;
        context.beginPath(); context.moveTo(anchor.x, anchor.y); context.lineTo(chosen.cx, chosen.cy); context.stroke();
      }
      context.lineJoin = 'round';
      context.miterLimit = 2;
      context.strokeStyle = 'rgba(12,22,31,.96)';
      context.lineWidth = 3.2 / view.scale;
      context.strokeText(o.name, chosen.cx, chosen.cy);
      context.fillStyle = item.kind === 'gate' ? '#ffd166' : '#f8fbff';
      context.fillText(o.name, chosen.cx, chosen.cy);
    }
    context.restore();
  }

  function drawRoutePath(context, path, color, dash = []) {
    if (!path || path.length < 2) return;
    context.save(); context.strokeStyle=color; context.lineWidth=Math.max(1.25,3.2/view.scale);
    context.lineJoin='round'; context.lineCap='round'; context.setLineDash(dash.map(v => v/view.scale)); context.beginPath();
    for(let i=0;i<path.length;i++){ const idx=path[i],gx=idx%PK1_WIDTH+.5,gy=Math.floor(idx/PK1_WIDTH)+.5,w=gameToWorld(gx,gy); if(!w)continue; if(i)context.lineTo(w.x,w.y);else context.moveTo(w.x,w.y); }
    context.stroke(); context.restore();
  }

  function drawRouteOverlay(context) {
    const rp=ensureRoutePlanner();
    drawRoutePath(context, rp.path, '#e43b2e');
    if (rp.showAlt2 && rp.altPaths?.[0]) drawRoutePath(context, rp.altPaths[0], '#22b8cf', [8,5]);
    if (rp.showAlt3 && rp.altPaths?.[1]) drawRoutePath(context, rp.altPaths[1], '#b86cff', [3,5]);
    if (rp.points) for(let i=0;i<rp.points.length;i++){const [gx,gy]=rp.points[i],w=gameToWorld(gx+.5,gy+.5);if(!w)continue;context.save();context.fillStyle=i===0?'#23b967':(i===rp.points.length-1?'#e13d36':'#ffd54d');context.strokeStyle='#fff';context.lineWidth=Math.max(1,1.4/view.scale);context.beginPath();context.arc(w.x,w.y,Math.max(3,5.8/view.scale),0,Math.PI*2);context.fill();context.stroke();if(view.scale>.55){context.fillStyle='#101216';context.font=`700 ${Math.max(8,11/view.scale)}px "Noto Sans JP",sans-serif`;context.textAlign='center';context.textBaseline='middle';context.fillText(String(i+1),w.x,w.y);}context.restore();}
  }

  function onKeyDown(e) {
    const tag = e.target && e.target.tagName;
    const editing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (e.code === 'Space' && !editing) {
      spacePressed = true;
      e.preventDefault();
    }
    if (editing) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault(); redo();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault(); deleteSelected();
    } else if (e.key.toLowerCase() === 'v') {
      setTool('select');

    } else if (e.key.toLowerCase() === 'r') {
      setTool('route');
    } else if (e.key === 'Escape') {
      hidePlaceContextMenu();
      drawPreview = null;
      interaction = null;
      selectObject(null);
      canvas.classList.remove('panning');
    } else if (selectedId && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const obj = getSelected();
      if (!obj) return;
      const step = (e.shiftKey ? 10 : 1) / view.scale;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      recordHistory(serializeProject());
      translateObject(obj, dx, dy);
      dirty = true;
      requestRender();
    }
  }
})();
