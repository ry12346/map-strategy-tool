'use strict';

(() => {
  const APP_VERSION = 1;
  const MAX_HISTORY = 80;
  const MIN_ZOOM = 0.03;
  const MAX_ZOOM = 12;

  const TYPE_META = {
    ally:     { name: '自軍',   label: '自軍部隊', color: '#2f80d0', size: 52, lineWidth: 5, symbol: '自' },
    enemy:    { name: '敵軍',   label: '敵軍部隊', color: '#d24f4f', size: 52, lineWidth: 5, symbol: '敵' },
    garrison: { name: '駐屯',   label: '駐屯地点', color: '#2f80d0', size: 56, lineWidth: 5, symbol: '駐' },
    camp:     { name: '幕舎',   label: '幕舎建設', color: '#3aa86d', size: 58, lineWidth: 5, symbol: '幕' },
    fort:     { name: '陣城',   label: '陣城建設', color: '#9267cf', size: 58, lineWidth: 5, symbol: '陣' },
    castle:   { name: '城',     label: '攻略対象の城', color: '#8b6948', size: 58, lineWidth: 5, symbol: '城' },
    gate:     { name: '関所',   label: '攻略対象の関所', color: '#a15f3e', size: 58, lineWidth: 5, symbol: '関' },
    bridge:   { name: '橋',     label: '攻略対象の橋', color: '#36818b', size: 58, lineWidth: 5, symbol: '橋' },
    station:  { name: '駅路',   label: '攻略対象の駅路', color: '#b17b2f', size: 58, lineWidth: 5, symbol: '駅' },
    arrow:    { name: '侵攻',   label: '侵攻ルート', color: '#2f80d0', size: 44, lineWidth: 9, symbol: '➜' },
    defense:  { name: '防衛線', label: '防衛線', color: '#e0b43c', size: 42, lineWidth: 7, symbol: '防' },
    area:     { name: '範囲',   label: '作戦範囲', color: '#d9a52a', size: 38, lineWidth: 4, symbol: '範' },
    target:   { name: '目標',   label: '攻略目標', color: '#e3563a', size: 60, lineWidth: 5, symbol: '目' },
    text:     { name: 'メモ',   label: '作戦メモ', color: '#f2f4f8', size: 34, lineWidth: 3, symbol: 'T' }
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
  let history = [];
  let future = [];
  let interaction = null;
  let drawPreview = null;
  let renderPending = false;
  let dirty = false;
  let spacePressed = false;
  let propertySnapshot = null;
  let toastTimer = null;

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
      requestRender();
    });
    observer.observe(refs.stageWrap);
  }

  function cacheRefs() {
    const ids = [
      'projectName', 'newProjectBtn', 'loadMapBtn', 'saveProjectBtn', 'loadProjectBtn',
      'exportMenuBtn', 'exportMenu', 'exportPngBtn', 'exportViewPngBtn', 'exportViewerBtn',
      'helpBtn', 'toggleInspectorBtn', 'closeInspectorBtn', 'mapCanvas', 'stageWrap',
      'emptyState', 'emptyLoadMapBtn', 'toast', 'undoBtn', 'redoBtn', 'deleteBtn',
      'inspector', 'noSelection', 'propertyForm', 'propLabel', 'propDescription', 'propColor',
      'propOpacity', 'propSize', 'propLineWidth', 'propPhase', 'duplicateBtn', 'bringFrontBtn',
      'deleteObjectBtn', 'phaseFilter', 'calibrationBtn', 'calibrationSummary', 'layerList',
      'objectCount', 'cursorPosition', 'gamePosition', 'fitBtn', 'zoomOutBtn', 'zoomDisplay',
      'zoomInBtn', 'mapFileInput', 'projectFileInput', 'helpDialog', 'calibrationDialog',
      'calibrationForm', 'calTopLeftX', 'calTopLeftY', 'calBottomRightX', 'calBottomRightY',
      'clearCalibrationBtn', 'saveCalibrationBtn'
    ];
    for (const id of ids) refs[id] = document.getElementById(id);
    refs.toolButtons = Array.from(document.querySelectorAll('.tool-button[data-tool]'));
  }

  function bindEvents() {
    refs.toolButtons.forEach(btn => btn.addEventListener('click', () => setTool(btn.dataset.tool)));

    refs.newProjectBtn.addEventListener('click', newProject);
    refs.loadMapBtn.addEventListener('click', () => refs.mapFileInput.click());
    refs.emptyLoadMapBtn.addEventListener('click', () => refs.mapFileInput.click());
    refs.mapFileInput.addEventListener('change', handleMapFile);
    refs.saveProjectBtn.addEventListener('click', saveProjectFile);
    refs.loadProjectBtn.addEventListener('click', () => refs.projectFileInput.click());
    refs.projectFileInput.addEventListener('change', handleProjectFile);

    refs.exportMenuBtn.addEventListener('click', toggleExportMenu);
    refs.exportPngBtn.addEventListener('click', () => { closeExportMenu(); exportFullPng(); });
    refs.exportViewPngBtn.addEventListener('click', () => { closeExportMenu(); exportViewPng(); });
    refs.exportViewerBtn.addEventListener('click', () => { closeExportMenu(); exportViewerHtml(); });
    document.addEventListener('pointerdown', e => {
      if (!refs.exportMenu.hidden && !e.target.closest('.menu-wrap')) closeExportMenu();
    });

    refs.helpBtn.addEventListener('click', () => refs.helpDialog.showModal());
    refs.toggleInspectorBtn.addEventListener('click', () => refs.inspector.classList.add('open'));
    refs.closeInspectorBtn.addEventListener('click', () => refs.inspector.classList.remove('open'));

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

    refs.calibrationBtn.addEventListener('click', openCalibrationDialog);
    refs.clearCalibrationBtn.addEventListener('click', clearCalibration);
    refs.calibrationForm.addEventListener('submit', saveCalibration);

    refs.fitBtn.addEventListener('click', fitView);
    refs.zoomInBtn.addEventListener('click', () => zoomAt(1.25, canvas.clientWidth / 2, canvas.clientHeight / 2));
    refs.zoomOutBtn.addEventListener('click', () => zoomAt(0.8, canvas.clientWidth / 2, canvas.clientHeight / 2));

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('dblclick', onDoubleClick);

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
      [refs.propDescription, 'description', v => v],
      [refs.propColor, 'color', v => v],
      [refs.propOpacity, 'opacity', v => Number(v) / 100],
      [refs.propSize, 'size', v => Number(v)],
      [refs.propLineWidth, 'lineWidth', v => Number(v)],
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
  }

  function createProject() {
    const now = new Date().toISOString();
    return {
      app: 'shinsen-strategy-map',
      version: APP_VERSION,
      name: '新規作戦',
      createdAt: now,
      updatedAt: now,
      background: null,
      calibration: null,
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
      lineWidth: meta.lineWidth,
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

  function drawObject(context, obj, selected, preview = false) {
    context.save();
    context.globalAlpha = Math.max(0.05, Math.min(1, obj.opacity == null ? 1 : obj.opacity)) * (preview ? 0.75 : 1);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = obj.color;
    context.fillStyle = obj.color;
    context.lineWidth = obj.lineWidth || 4;

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
    drawLabel(context, obj.label, obj.x, obj.y + r + obj.size * 0.22, obj.size * 0.28);
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
    drawLabel(context, obj.label, obj.x, obj.y + s * 0.75, s * 0.27);
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
    drawLabel(context, obj.label, obj.x, obj.y + s * 0.68, s * 0.27);
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
    drawLabel(context, obj.label, obj.x, obj.y + s * 0.72, s * 0.27);
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
    drawLabel(context, obj.label, obj.x, obj.y + s * 0.74, s * 0.27);
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
    drawLabel(context, obj.label, obj.x, obj.y + s * 0.75, s * 0.27);
  }

  function drawTextNote(context, obj) {
    const fontSize = Math.max(12, obj.size);
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

    drawLabel(context, obj.label, (obj.x + obj.x2) / 2, (obj.y + obj.y2) / 2 - obj.size * 0.48, obj.size * 0.3);
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
    drawLabel(context, obj.label, (obj.x + obj.x2) / 2 + px * obj.size * 0.58, (obj.y + obj.y2) / 2 + py * obj.size * 0.58, obj.size * 0.29);
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
    drawLabel(context, obj.label, x + w / 2, y + Math.max(obj.size * 0.38, 18), obj.size * 0.32);
    context.restore();
  }

  function drawLabel(context, text, x, y, fontSize) {
    if (!text) return;
    const value = String(text);
    const fs = Math.max(10, fontSize || 14);
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

  function drawSelection(context, obj) {
    const b = objectBounds(obj);
    const pad = Math.max(8 / view.scale, 4);
    context.save();
    context.globalAlpha = 1;
    context.strokeStyle = '#fff';
    context.lineWidth = 2 / view.scale;
    context.setLineDash([7 / view.scale, 5 / view.scale]);
    context.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
    context.setLineDash([]);
    if (obj.type === 'arrow' || obj.type === 'defense' || obj.type === 'area') {
      context.fillStyle = '#fff';
      const r = 5 / view.scale;
      context.beginPath(); context.arc(obj.x, obj.y, r, 0, Math.PI * 2); context.fill();
      context.beginPath(); context.arc(obj.x2, obj.y2, r, 0, Math.PI * 2); context.fill();
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
      const width = Math.max(obj.size * 3.2, String(obj.label || '').length * obj.size * 0.65);
      return { x: obj.x - obj.size * 0.4, y: obj.y - obj.size * 0.35, w: width, h: obj.size * 1.8 };
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
    activeTool = tool;
    refs.toolButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tool === tool));
    canvas.dataset.tool = tool;
    drawPreview = null;
    requestRender();
  }

  function onPointerDown(e) {
    if (!backgroundImage) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const screen = pointerScreen(e);
    const world = screenToWorld(screen.x, screen.y, true);
    const panGesture = activeTool === 'pan' || spacePressed || e.button === 1 || e.button === 2;

    if (panGesture) {
      interaction = { mode: 'pan', pointerId: e.pointerId, startScreen: screen, startView: { ...view } };
      canvas.classList.add('panning');
      return;
    }

    if (activeTool === 'select') {
      const hit = hitTest(world.x, world.y);
      selectObject(hit ? hit.id : null);
      if (hit) {
        interaction = {
          mode: 'drag', pointerId: e.pointerId, startWorld: world,
          snapshot: serializeProject(), original: { x: hit.x, y: hit.y, x2: hit.x2, y2: hit.y2 },
          objectId: hit.id, moved: false
        };
      }
      return;
    }

    if (activeTool === 'arrow' || activeTool === 'defense' || activeTool === 'area') {
      drawPreview = createObject(activeTool, { x: world.x, y: world.y, x2: world.x, y2: world.y });
      interaction = { mode: 'draw', pointerId: e.pointerId, startWorld: world };
      requestRender();
      return;
    }

    if (TYPE_META[activeTool]) {
      recordHistory(serializeProject());
      const obj = createObject(activeTool, { x: world.x, y: world.y });
      project.objects.push(obj);
      dirty = true;
      selectObject(obj.id);
      syncObjectUI();
      requestRender();
      if (activeTool === 'text') {
        setTimeout(() => { refs.propLabel.focus(); refs.propLabel.select(); }, 0);
      }
    }
  }

  function onPointerMove(e) {
    const screen = pointerScreen(e);
    const world = screenToWorld(screen.x, screen.y, true);
    updateCursorStatus(world);

    if (!interaction || interaction.pointerId !== e.pointerId) return;
    e.preventDefault();

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
      interaction.moved = interaction.moved || Math.hypot(dx, dy) > 1 / view.scale;
      dirty = true;
      requestRender();
      return;
    }

    if (interaction.mode === 'draw' && drawPreview) {
      drawPreview.x2 = world.x;
      drawPreview.y2 = world.y;
      requestRender();
    }
  }

  function onPointerUp(e) {
    if (!interaction || interaction.pointerId !== e.pointerId) return;
    e.preventDefault();

    if (interaction.mode === 'drag' && interaction.moved) {
      recordHistory(interaction.snapshot);
      syncObjectUI();
    }

    if (interaction.mode === 'draw' && drawPreview) {
      const len = Math.hypot(drawPreview.x2 - drawPreview.x, drawPreview.y2 - drawPreview.y);
      if (len > 8 / view.scale) {
        recordHistory(serializeProject());
        project.objects.push(drawPreview);
        dirty = true;
        selectObject(drawPreview.id);
        syncObjectUI();
      }
      drawPreview = null;
    }

    interaction = null;
    canvas.classList.remove('panning');
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
    refs.inspector.classList.add('open');
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
    refs.noSelection.hidden = !!obj;
    refs.propertyForm.hidden = !obj;
    if (!obj) return;
    refs.propLabel.value = obj.label || '';
    refs.propDescription.value = obj.description || '';
    refs.propColor.value = normalizeHex(obj.color, TYPE_META[obj.type].color);
    refs.propOpacity.value = Math.round((obj.opacity == null ? 1 : obj.opacity) * 100);
    refs.propSize.value = obj.size;
    refs.propLineWidth.value = obj.lineWidth;
    refs.propPhase.value = obj.phase || '共通';
  }

  function syncObjectUI() {
    syncSelectionUI();
    renderLayerList();
    updateHistoryButtons();
    requestRender();
  }

  function syncAllUI() {
    refs.projectName.value = project.name || '新規作戦';
    refs.emptyState.hidden = !!backgroundImage;
    syncSelectionUI();
    renderLayerList();
    updateCalibrationSummary();
    updateHistoryButtons();
    refs.deleteBtn.disabled = !selectedId;
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
        if (window.matchMedia('(max-width: 900px)').matches) refs.inspector.classList.add('open');
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
    project.updatedAt = new Date().toISOString();
    project.name = refs.projectName ? (refs.projectName.value.trim() || project.name || '名称未設定') : project.name;
    return JSON.stringify(project);
  }

  async function restoreSnapshot(snapshot, fit = false) {
    try {
      const parsed = normalizeProject(JSON.parse(snapshot));
      project = parsed;
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
    refs.mapFileInput.value = '';
    refs.projectFileInput.value = '';
    syncAllUI();
    requestRender();
  }

  function handleMapFile() {
    const file = refs.mapFileInput.files && refs.mapFileInput.files[0];
    refs.mapFileInput.value = '';
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

  function normalizeProject(data) {
    if (!data || !Array.isArray(data.objects)) throw new Error('Invalid project');
    const normalized = {
      app: 'shinsen-strategy-map',
      version: Number(data.version) || 1,
      name: String(data.name || '名称未設定'),
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt || new Date().toISOString(),
      background: data.background || null,
      calibration: data.calibration || null,
      objects: []
    };

    normalized.objects = data.objects
      .filter(o => o && TYPE_META[o.type])
      .map(o => {
        const base = createObject(o.type);
        return {
          ...base,
          ...o,
          id: String(o.id || makeId()),
          label: String(o.label == null ? base.label : o.label),
          description: String(o.description || ''),
          color: normalizeHex(o.color, base.color),
          opacity: clampNumber(o.opacity, 0.05, 1, base.opacity),
          size: clampNumber(o.size, 8, 300, base.size),
          lineWidth: clampNumber(o.lineWidth, 1, 50, base.lineWidth),
          phase: ['共通', '第1段階', '第2段階', '第3段階', '予備'].includes(o.phase) ? o.phase : '共通',
          hidden: Boolean(o.hidden),
          x: clampNumber(o.x, -1000000, 1000000, 0),
          y: clampNumber(o.y, -1000000, 1000000, 0),
          x2: clampNumber(o.x2, -1000000, 1000000, 0),
          y2: clampNumber(o.y2, -1000000, 1000000, 0)
        };
      });
    return normalized;
  }

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  }

  async function loadBackgroundFromProject() {
    if (!project.background || !project.background.dataUrl) {
      backgroundImage = null;
      return;
    }
    backgroundImage = await imageFromSource(project.background.dataUrl);
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
    refs.cursorPosition.textContent = `画像座標: ${Math.round(world.x)}, ${Math.round(world.y)}`;
    const game = worldToGame(world.x, world.y);
    refs.gamePosition.textContent = game
      ? `ゲーム座標: ${formatCoord(game.x)}, ${formatCoord(game.y)}`
      : 'ゲーム座標: 未設定';
  }

  function worldToGame(x, y) {
    const c = project.calibration;
    if (!c || !project.background) return null;
    const w = project.background.width || backgroundImage?.naturalWidth;
    const h = project.background.height || backgroundImage?.naturalHeight;
    if (!w || !h) return null;
    return {
      x: c.topLeft.x + (x / w) * (c.bottomRight.x - c.topLeft.x),
      y: c.topLeft.y + (y / h) * (c.bottomRight.y - c.topLeft.y)
    };
  }

  function formatCoord(n) {
    return Math.abs(n - Math.round(n)) < 0.04 ? String(Math.round(n)) : n.toFixed(1);
  }

  function openCalibrationDialog() {
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
    refs.gamePosition.textContent = 'ゲーム座標: 未設定';
    showToast('ゲーム座標設定を解除しました');
  }

  function updateCalibrationSummary() {
    const c = project.calibration;
    refs.calibrationSummary.textContent = c
      ? `左上 ${formatCoord(c.topLeft.x)},${formatCoord(c.topLeft.y)} ／ 右下 ${formatCoord(c.bottomRight.x)},${formatCoord(c.bottomRight.y)}`
      : '未設定';
  }

  function toggleExportMenu() {
    refs.exportMenu.hidden = !refs.exportMenu.hidden;
    refs.exportMenuBtn.setAttribute('aria-expanded', String(!refs.exportMenu.hidden));
  }

  function closeExportMenu() {
    refs.exportMenu.hidden = true;
    refs.exportMenuBtn.setAttribute('aria-expanded', 'false');
  }

  async function exportFullPng() {
    if (!backgroundImage) {
      showToast('先にマップ画像を読み込んでください', true);
      return;
    }
    const sourceW = backgroundImage.naturalWidth;
    const sourceH = backgroundImage.naturalHeight;
    const maxSide = 14000;
    const maxPixels = 90000000;
    const outputScale = Math.min(1, maxSide / sourceW, maxSide / sourceH, Math.sqrt(maxPixels / (sourceW * sourceH)));
    const outW = Math.max(1, Math.round(sourceW * outputScale));
    const outH = Math.max(1, Math.round(sourceH * outputScale));

    try {
      const out = document.createElement('canvas');
      out.width = outW;
      out.height = outH;
      const outCtx = out.getContext('2d');
      outCtx.fillStyle = '#111';
      outCtx.fillRect(0, 0, outW, outH);
      outCtx.scale(outputScale, outputScale);
      outCtx.drawImage(backgroundImage, 0, 0);
      for (const obj of project.objects) if (isObjectVisible(obj)) drawObject(outCtx, obj, false);
      const blob = await canvasToBlob(out, 'image/png');
      downloadBlob(blob, `${safeFilename(project.name)}_${safeFilename(phaseFilter)}.png`);
      showToast(outputScale < 1 ? `PNGを縮小出力しました（${outW} × ${outH}px）` : '作戦図をPNG出力しました');
    } catch (error) {
      console.error(error);
      showToast('画像が大きすぎるためPNG出力に失敗しました', true);
    }
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

  function exportViewerHtml() {
    if (!backgroundImage) {
      showToast('先にマップ画像を読み込んでください', true);
      return;
    }
    project.name = refs.projectName.value.trim() || '名称未設定';
    project.updatedAt = new Date().toISOString();
    const html = buildViewerHtml(project);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    downloadBlob(blob, safeFilename(project.name) + '_共有用.html');
    showToast('閲覧専用の共有HTMLを出力しました');
  }

  function buildViewerHtml(data) {
    const safeProject = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${escapeHtml(data.name)}｜作戦図</title>
<style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0c0e11;color:#eef1f6;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans JP",Meiryo,sans-serif}body{display:grid;grid-template-rows:54px 1fr 30px}header{display:flex;align-items:center;gap:12px;padding:7px 12px;background:#171a20;border-bottom:1px solid #323844}h1{margin:0;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}header .spacer{flex:1}button,select{height:34px;border:1px solid #414957;border-radius:6px;background:#262b35;color:#eef1f6;padding:0 9px;font:inherit;font-size:12px}button{cursor:pointer}.stage{position:relative;min-height:0}canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab}.info{display:none;position:absolute;left:14px;bottom:14px;max-width:min(440px,calc(100% - 28px));padding:11px 13px;border:1px solid #4b5564;border-radius:8px;background:rgba(22,26,32,.95);box-shadow:0 12px 35px rgba(0,0,0,.4)}.info.show{display:block}.info strong{font-size:13px}.info p{margin:5px 0 0;color:#b8c0cc;font-size:12px;line-height:1.6;white-space:pre-wrap}.info button{position:absolute;right:5px;top:4px;width:28px;height:28px;padding:0;border:0;background:transparent}footer{display:flex;align-items:center;gap:12px;padding:0 10px;background:#15181d;border-top:1px solid #323844;color:#aab2c0;font-size:10px}footer .spacer{flex:1}@media(max-width:620px){header{gap:5px;padding:6px}h1{font-size:13px}header select{max-width:120px}header button{padding:0 7px}}
</style></head><body>
<header><h1>${escapeHtml(data.name)}</h1><span class="spacer"></span><select id="phase"><option>すべて</option><option>共通</option><option>第1段階</option><option>第2段階</option><option>第3段階</option><option>予備</option></select><button id="fit">全体表示</button><button id="zin">＋</button><button id="zout">−</button></header>
<div class="stage" id="stage"><canvas id="c"></canvas><div class="info" id="info"><button id="close">×</button><strong id="infoTitle"></strong><p id="infoText"></p></div></div>
<footer><span id="coord">画像座標: --, --</span><span id="game">ゲーム座標: --</span><span class="spacer"></span><span id="zoom">100%</span></footer>
<script>
'use strict';
const project=${safeProject};
const c=document.getElementById('c'),x=c.getContext('2d'),stage=document.getElementById('stage');let img=new Image(),v={s:1,x:0,y:0},drag=null,phase='すべて';
const $=id=>document.getElementById(id);img.onload=()=>{resize();fit();draw()};img.src=project.background.dataUrl;
new ResizeObserver(()=>{resize();draw()}).observe(stage);function resize(){let r=stage.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2.5);c.width=Math.max(1,Math.floor(r.width*d));c.height=Math.max(1,Math.floor(r.height*d));c.style.width=r.width+'px';c.style.height=r.height+'px';c.d=d}
function vis(o){return !o.hidden&&(phase==='すべて'||(phase==='共通'?o.phase==='共通':o.phase==='共通'||o.phase===phase))}
function draw(){let d=c.d||1,w=c.clientWidth,h=c.clientHeight;x.setTransform(d,0,0,d,0,0);x.fillStyle='#0c0e11';x.fillRect(0,0,w,h);x.save();x.translate(v.x,v.y);x.scale(v.s,v.s);x.drawImage(img,0,0);project.objects.forEach(o=>{if(vis(o))obj(x,o)});x.restore();$('zoom').textContent=Math.round(v.s*100)+'%'}
function rr(q,a,b,w,h,r){r=Math.min(r,w/2,h/2);q.beginPath();q.moveTo(a+r,b);q.arcTo(a+w,b,a+w,b+h,r);q.arcTo(a+w,b+h,a,b+h,r);q.arcTo(a,b+h,a,b,r);q.arcTo(a,b,a+w,b,r);q.closePath()}
function label(q,t,a,b,fs){if(!t)return;fs=Math.max(10,fs||14);q.save();q.font='700 '+fs+'px sans-serif';q.textAlign='center';q.textBaseline='middle';let w=q.measureText(t).width+fs*.8,h=fs*1.5;q.fillStyle='rgba(9,11,14,.82)';rr(q,a-w/2,b-h/2,w,h,fs*.28);q.fill();q.strokeStyle='rgba(255,255,255,.2)';q.lineWidth=Math.max(1,1/v.s);q.stroke();q.fillStyle='#fff';q.fillText(t,a,b);q.restore()}
function obj(q,o){q.save();q.globalAlpha=Math.max(.05,Math.min(1,o.opacity==null?1:o.opacity));q.lineCap='round';q.lineJoin='round';q.strokeStyle=o.color;q.fillStyle=o.color;q.lineWidth=o.lineWidth||4;let s=o.size,r=s/2,dx=o.x2-o.x,dy=o.y2-o.y,l=Math.hypot(dx,dy),ux,uy,px,py;if(o.type==='ally'||o.type==='enemy'){q.beginPath();q.arc(o.x,o.y,r,0,Math.PI*2);q.fill();q.strokeStyle='#fff';q.lineWidth=Math.max(2,o.lineWidth*.55);q.stroke();q.fillStyle='#fff';q.font='800 '+Math.max(12,s*.35)+'px sans-serif';q.textAlign='center';q.textBaseline='middle';q.fillText(o.type==='ally'?'自':'敵',o.x,o.y+1);label(q,o.label,o.x,o.y+r+s*.22,s*.28)}else if(o.type==='garrison'){q.translate(o.x,o.y);q.beginPath();q.moveTo(0,-s*.5);q.lineTo(s*.38,-s*.28);q.lineTo(s*.31,s*.22);q.quadraticCurveTo(0,s*.55,0,s*.55);q.quadraticCurveTo(0,s*.55,-s*.31,s*.22);q.lineTo(-s*.38,-s*.28);q.closePath();q.fill();q.strokeStyle='#fff';q.lineWidth=Math.max(2,o.lineWidth*.5);q.stroke();q.fillStyle='#fff';q.font='800 '+s*.28+'px sans-serif';q.textAlign='center';q.textBaseline='middle';q.fillText('駐',0,0);q.translate(-o.x,-o.y);label(q,o.label,o.x,o.y+s*.75,s*.27)}else if(o.type==='camp'){q.translate(o.x,o.y);q.beginPath();q.moveTo(0,-s*.5);q.lineTo(s*.52,s*.42);q.lineTo(-s*.52,s*.42);q.closePath();q.fill();q.strokeStyle='#fff';q.lineWidth=Math.max(2,o.lineWidth*.5);q.stroke();q.beginPath();q.moveTo(0,-s*.5);q.lineTo(0,s*.42);q.moveTo(-s*.28,s*.42);q.lineTo(0,-s*.5);q.lineTo(s*.28,s*.42);q.stroke();q.translate(-o.x,-o.y);label(q,o.label,o.x,o.y+s*.68,s*.27)}else if(o.type==='fort'){q.translate(o.x,o.y);q.beginPath();q.rect(-s*.45,-s*.25,s*.9,s*.68);q.rect(-s*.48,-s*.48,s*.22,s*.28);q.rect(-s*.11,-s*.48,s*.22,s*.28);q.rect(s*.26,-s*.48,s*.22,s*.28);q.fill();q.strokeStyle='#fff';q.lineWidth=Math.max(2,o.lineWidth*.48);q.stroke();q.translate(-o.x,-o.y);label(q,o.label,o.x,o.y+s*.72,s*.27)}else if(o.type==='target'){q.translate(o.x,o.y);r=s*.45;q.lineWidth=Math.max(3,o.lineWidth);q.beginPath();q.arc(0,0,r,0,Math.PI*2);q.stroke();q.beginPath();q.arc(0,0,r*.52,0,Math.PI*2);q.stroke();q.beginPath();q.moveTo(-r*1.25,0);q.lineTo(r*1.25,0);q.moveTo(0,-r*1.25);q.lineTo(0,r*1.25);q.stroke();q.translate(-o.x,-o.y);label(q,o.label,o.x,o.y+s*.75,s*.27)}else if(['castle','gate','bridge','station'].includes(o.type)){q.translate(o.x,o.y);r=s*.5;q.beginPath();if(o.type==='gate'){q.moveTo(0,-r);q.lineTo(r,0);q.lineTo(0,r);q.lineTo(-r,0);q.closePath()}else if(o.type==='station'){q.moveTo(-r*.82,-r);q.lineTo(r*.82,-r);q.lineTo(r,0);q.lineTo(r*.82,r);q.lineTo(-r*.82,r);q.lineTo(-r,0);q.closePath()}else if(o.type==='bridge'){rr(q,-r,-r*.58,s,s*.82,s*.12)}else{rr(q,-r,-r,s,s,s*.12)}q.fill();q.strokeStyle='#fff';q.lineWidth=Math.max(2,o.lineWidth*.5);q.stroke();if(o.type==='bridge'){q.beginPath();q.moveTo(-r*.72,-r*.16);q.lineTo(r*.72,-r*.16);q.moveTo(-r*.72,r*.16);q.lineTo(r*.72,r*.16);q.stroke()}q.fillStyle='#fff';q.font='800 '+s*.34+'px sans-serif';q.textAlign='center';q.textBaseline='middle';q.fillText(({castle:'城',gate:'関',bridge:'橋',station:'駅'})[o.type],0,o.type==='bridge'?-s*.02:1);q.translate(-o.x,-o.y);label(q,o.label,o.x,o.y+s*.74,s*.27)}else if(o.type==='text'){let fs=Math.max(12,s),lines=String(o.label||'メモ').split(/\\n/).slice(0,6);q.font='700 '+fs+'px sans-serif';let w=Math.max(...lines.map(t=>q.measureText(t||' ').width))+fs*.9,h=lines.length*fs*1.25+fs*.55;q.fillStyle='rgba(10,12,15,.78)';rr(q,o.x-fs*.35,o.y-fs*.28,w,h,fs*.25);q.fill();q.strokeStyle=o.color;q.lineWidth=Math.max(2,o.lineWidth);q.stroke();q.fillStyle=o.color;q.textAlign='left';q.textBaseline='top';lines.forEach((t,i)=>q.fillText(t,o.x,o.y+i*fs*1.25))}else if(o.type==='arrow'&&l>1){ux=dx/l;uy=dy/l;let hd=Math.min(Math.max(s,o.lineWidth*4),l*.38),bx=o.x2-ux*hd,by=o.y2-uy*hd;px=-uy;py=ux;q.beginPath();q.moveTo(o.x,o.y);q.lineTo(bx,by);q.stroke();q.beginPath();q.moveTo(o.x2,o.y2);q.lineTo(bx+px*hd*.48,by+py*hd*.48);q.lineTo(bx-px*hd*.48,by-py*hd*.48);q.closePath();q.fill();label(q,o.label,(o.x+o.x2)/2,(o.y+o.y2)/2-s*.48,s*.3)}else if(o.type==='defense'&&l>1){ux=dx/l;uy=dy/l;px=-uy;py=ux;q.beginPath();q.moveTo(o.x,o.y);q.lineTo(o.x2,o.y2);q.stroke();let inter=Math.max(26,s*.72),n=Math.max(2,Math.floor(l/inter));q.lineWidth=Math.max(2,o.lineWidth*.72);q.beginPath();for(let i=0;i<=n;i++){let t=i/n,a=o.x+dx*t,b=o.y+dy*t,tick=s*.32;q.moveTo(a,b);q.lineTo(a+px*tick,b+py*tick)}q.stroke();label(q,o.label,(o.x+o.x2)/2+px*s*.58,(o.y+o.y2)/2+py*s*.58,s*.29)}else if(o.type==='area'){let a=Math.min(o.x,o.x2),b=Math.min(o.y,o.y2),w=Math.abs(dx),h=Math.abs(dy);q.globalAlpha*=.35;q.fillRect(a,b,w,h);q.globalAlpha=Math.max(.05,Math.min(1,o.opacity==null?1:o.opacity));q.setLineDash([s*.34,s*.2]);q.strokeRect(a,b,w,h);q.setLineDash([]);label(q,o.label,a+w/2,b+Math.max(s*.38,18),s*.32)}q.restore()}
function fit(){let p=28,s=Math.min((c.clientWidth-p*2)/img.naturalWidth,(c.clientHeight-p*2)/img.naturalHeight);v.s=Math.max(.03,s);v.x=(c.clientWidth-img.naturalWidth*v.s)/2;v.y=(c.clientHeight-img.naturalHeight*v.s)/2;draw()}
function zoom(f,a,b){let wx=(a-v.x)/v.s,wy=(b-v.y)/v.s;v.s=Math.max(.03,Math.min(12,v.s*f));v.x=a-wx*v.s;v.y=b-wy*v.s;draw()}
function pt(e){let r=c.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
c.onpointerdown=e=>{e.preventDefault();let p=pt(e);drag={id:e.pointerId,p,v:{...v}};c.setPointerCapture(e.pointerId);c.style.cursor='grabbing'};c.onpointermove=e=>{let p=pt(e),wx=(p.x-v.x)/v.s,wy=(p.y-v.y)/v.s;$('coord').textContent='画像座標: '+Math.round(wx)+', '+Math.round(wy);if(project.calibration){let z=project.calibration,gx=z.topLeft.x+wx/img.naturalWidth*(z.bottomRight.x-z.topLeft.x),gy=z.topLeft.y+wy/img.naturalHeight*(z.bottomRight.y-z.topLeft.y);$('game').textContent='ゲーム座標: '+gx.toFixed(1)+', '+gy.toFixed(1)}if(drag&&drag.id===e.pointerId){v.x=drag.v.x+p.x-drag.p.x;v.y=drag.v.y+p.y-drag.p.y;draw()}};c.onpointerup=e=>{drag=null;c.style.cursor='grab'};c.onwheel=e=>{e.preventDefault();let p=pt(e);zoom(Math.exp(-e.deltaY*.0015),p.x,p.y)};
function bounds(o){if(['arrow','defense','area'].includes(o.type))return{x:Math.min(o.x,o.x2),y:Math.min(o.y,o.y2),w:Math.abs(o.x2-o.x),h:Math.abs(o.y2-o.y)};let r=o.size*.8;return{x:o.x-r,y:o.y-r,w:r*2,h:r*2}}
c.onclick=e=>{if(drag)return;let p=pt(e),wx=(p.x-v.x)/v.s,wy=(p.y-v.y)/v.s;for(let i=project.objects.length-1;i>=0;i--){let o=project.objects[i],b=bounds(o);if(vis(o)&&wx>=b.x&&wx<=b.x+b.w&&wy>=b.y&&wy<=b.y+b.h){$('infoTitle').textContent=o.label||'';$('infoText').textContent=o.description||'';$('info').classList.add('show');break}}};
$('close').onclick=()=>$('info').classList.remove('show');$('fit').onclick=fit;$('zin').onclick=()=>zoom(1.25,c.clientWidth/2,c.clientHeight/2);$('zout').onclick=()=>zoom(.8,c.clientWidth/2,c.clientHeight/2);$('phase').onchange=e=>{phase=e.target.value;draw()};
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
    } else if (e.key.toLowerCase() === 'h') {
      setTool('pan');
    } else if (e.key === 'Escape') {
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
