'use strict';

// ── WorldMap placement editor ────────────────────────────────────────────────
// Lets the author set a chapter's world-map background + fallback colour and
// drag the level marker into position on a 720 x 900 base canvas (the same
// coordinate space WorldMap.gd uses per chapter).

const MapEditor = (() => {
  const MAP_W = 720, MAP_H = 900;
  let chapter = null;
  let onChange = null;  // called after any edit (to trigger autosave)
  let els = null;
  let dragging = false;

  function el(id) { return document.getElementById(id); }

  function init(changeCb) {
    onChange = changeCb || function () {};
    els = {
      overlay: el('mapOverlay'),
      title: el('mapTitle'),
      close: el('mapClose'),
      bgDrop: document.querySelector('.map-bg-drop'),
      bgInput: document.querySelector('.map-bg-input'),
      bgPreview: document.querySelector('.map-bg-preview'),
      bgPlaceholder: document.querySelector('.map-bg-drop .image-placeholder'),
      bgClear: el('mapBgClear'),
      color: el('mapColor'),
      stage: el('mapStage'),
      stageBg: el('mapStageBg'),
      stageFallback: el('mapStageFallback'),
      node: el('mapNode'),
      coords: el('mapCoords'),
    };

    els.close.addEventListener('click', close);
    els.overlay.addEventListener('click', (e) => { if (e.target === els.overlay) close(); });
    document.addEventListener('keydown', (e) => {
      if (!els.overlay.hidden && e.key === 'Escape') close();
    });

    // Background upload / drag-drop / clear
    els.bgDrop.addEventListener('click', () => els.bgInput.click());
    els.bgInput.addEventListener('change', () => uploadBg(els.bgInput.files[0]));
    setupDrop(els.bgDrop);
    els.bgClear.addEventListener('click', () => { chapter.mapBackground = ''; refreshBg(); onChange(); });

    // Fallback colour
    els.color.addEventListener('input', () => {
      chapter.mapThemeColor = els.color.value;
      els.stageFallback.style.background = els.color.value;
      onChange();
    });

    // Dragging is handled per-marker (created in renderNodes). Global move/up.
    window.addEventListener('pointermove', onDrag);
    window.addEventListener('pointerup', endDrag);
  }

  function open(ch, index) {
    chapter = ch;
    if (!Array.isArray(chapter.levels)) chapter.levels = [];
    // Ensure every level has a map position; spread new ones across the canvas.
    chapter.levels.forEach((lv, i) => {
      if (!lv.mapNode || typeof lv.mapNode.x !== 'number') {
        lv.mapNode = {
          x: Math.round(MAP_W * ((i + 1) / (chapter.levels.length + 1))),
          y: Math.round(MAP_H / 2),
        };
      }
    });
    if (!chapter.mapThemeColor) chapter.mapThemeColor = '#3D5A80';
    els.title.textContent = `World-map — Chapter ${index + 1} (${chapter.levels.length} level${chapter.levels.length === 1 ? '' : 's'})`;
    els.color.value = toHex6(chapter.mapThemeColor);
    els.stageFallback.style.background = els.color.value;
    refreshBg();
    els.overlay.hidden = false;
    requestAnimationFrame(renderNodes);
  }

  function close() { els.overlay.hidden = true; }

  function refreshBg() {
    const b = chapter.mapBackground || '';
    // Local uploaded image (basename) -> serve from story image folder.
    if (b && !/^(res:\/\/|https?:)/.test(b)) {
      const url = (typeof window.__SB_IMG_URL === 'function')
        ? window.__SB_IMG_URL('story', b)
        : `/img/story/${encodeURIComponent(b)}?t=${Date.now()}`;
      els.stageBg.src = url; els.stageBg.hidden = false;
      els.bgPreview.src = url; els.bgPreview.hidden = false;
      if (els.bgPlaceholder) els.bgPlaceholder.hidden = true;
      els.bgClear.hidden = false;
    } else if (b) {
      // res:// or http path — can't preview directly; show colour, keep clear btn
      els.stageBg.hidden = true;
      els.bgPreview.hidden = true;
      if (els.bgPlaceholder) { els.bgPlaceholder.hidden = false; els.bgPlaceholder.textContent = 'Custom path'; }
      els.bgClear.hidden = false;
    } else {
      els.stageBg.hidden = true;
      els.bgPreview.hidden = true;
      if (els.bgPlaceholder) { els.bgPlaceholder.hidden = false; els.bgPlaceholder.textContent = 'Map background'; }
      els.bgClear.hidden = true;
    }
  }

  async function uploadBg(file) {
    if (!file) return;
    els.bgDrop.classList.add('uploading');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload?kind=story', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.name) { chapter.mapBackground = data.name; refreshBg(); onChange(); }
    } finally {
      els.bgDrop.classList.remove('uploading');
    }
  }

  function setupDrop(node) {
    ['dragenter', 'dragover'].forEach((ev) => node.addEventListener(ev, (e) => {
      e.preventDefault(); node.classList.add('dragover');
    }));
    ['dragleave', 'drop'].forEach((ev) => node.addEventListener(ev, (e) => {
      e.preventDefault(); node.classList.remove('dragover');
    }));
    node.addEventListener('drop', (e) => {
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) uploadBg(f);
    });
  }

  // ── Markers (one per level) ──
  let activeLevel = null;  // level object currently being dragged

  function renderNodes() {
    const rect = els.stage.getBoundingClientRect();
    // Remove old markers (keep the static #mapNode hidden — we build our own).
    els.stage.querySelectorAll('.map-node.dyn').forEach((n) => n.remove());
    if (els.node) els.node.style.display = 'none';
    chapter.levels.forEach((lv, i) => {
      const m = document.createElement('div');
      m.className = 'map-node dyn';
      m.textContent = String(i + 1);
      m.style.left = (lv.mapNode.x / MAP_W) * rect.width + 'px';
      m.style.top = (lv.mapNode.y / MAP_H) * rect.height + 'px';
      m.addEventListener('pointerdown', (e) => startDrag(e, lv, m));
      els.stage.appendChild(m);
    });
    els.coords.textContent = `${chapter.levels.length} level marker(s) — drag to place (canvas ${MAP_W} × ${MAP_H})`;
  }

  function startDrag(e, lv, marker) {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    activeLevel = lv;
    activeMarker = marker;
    marker.classList.add('dragging');
    marker.setPointerCapture && marker.setPointerCapture(e.pointerId);
  }
  let activeMarker = null;
  function onDrag(e) {
    if (!dragging || !activeLevel) return;
    const rect = els.stage.getBoundingClientRect();
    let px = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    let py = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    activeLevel.mapNode = { x: Math.round(px * MAP_W), y: Math.round(py * MAP_H) };
    if (activeMarker) {
      activeMarker.style.left = px * rect.width + 'px';
      activeMarker.style.top = py * rect.height + 'px';
    }
  }
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    if (activeMarker) activeMarker.classList.remove('dragging');
    activeMarker = null; activeLevel = null;
    onChange();
  }

  function toHex6(v) {
    if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) return v;
    if (typeof v === 'string' && v.startsWith('#')) return v.slice(0, 7);
    return '#3D5A80';
  }

  return { init, open, close };
})();
