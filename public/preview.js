'use strict';

// ── Preview mode ─────────────────────────────────────────────────────────────
// Plays a chapter's dialogue slides in sequence (image + text + effects + auto
// advance), approximating the in-game narrative. Not pixel-identical to Godot,
// but faithful for checking flow, timing, image order, and effect direction.

const Preview = (() => {
  let chapter = null;
  let idx = 0;
  let autoTimer = null;
  let els = null;

  function el(id) { return document.getElementById(id); }

  function init() {
    els = {
      overlay: el('previewOverlay'),
      stage: el('previewStage'),
      image: el('previewImage'),
      fx: el('previewFx'),
      text: el('previewText'),
      counter: el('previewCounter'),
      prev: el('previewPrev'),
      next: el('previewNext'),
      replay: el('previewReplay'),
      auto: el('previewAuto'),
      close: el('previewClose'),
    };
    els.prev.addEventListener('click', () => go(idx - 1));
    els.next.addEventListener('click', () => go(idx + 1));
    els.replay.addEventListener('click', () => go(0));
    els.close.addEventListener('click', close);
    els.auto.addEventListener('change', () => { if (els.auto.checked) scheduleAuto(); else clearTimeout(autoTimer); });
    els.overlay.addEventListener('click', (e) => { if (e.target === els.overlay) close(); });
    document.addEventListener('keydown', (e) => {
      if (els.overlay.hidden) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' || e.key === ' ') go(idx + 1);
      else if (e.key === 'ArrowLeft') go(idx - 1);
    });
  }

  function open(ch) {
    chapter = ch;
    idx = 0;
    els.overlay.hidden = false;
    go(0);
  }

  function close() {
    clearTimeout(autoTimer);
    els.overlay.hidden = true;
    els.fx.innerHTML = '';
  }

  function slides() {
    const d = (chapter && chapter.dialogue && chapter.dialogue.length) ? chapter.dialogue : [{ text: '' }];
    return d;
  }

  function go(n) {
    const list = slides();
    if (n < 0) n = 0;
    if (n >= list.length) { clearTimeout(autoTimer); return; } // end: stop
    idx = n;
    render(list[idx]);
    els.counter.textContent = `${idx + 1} / ${list.length}`;
    els.prev.disabled = idx === 0;
    if (els.auto.checked) scheduleAuto();
  }

  function scheduleAuto() {
    clearTimeout(autoTimer);
    const s = slides()[idx];
    const dur = (typeof s.duration === 'number' ? s.duration : 4) * 1000;
    autoTimer = setTimeout(() => go(idx + 1), Math.max(500, dur));
  }

  function imageNameFor(slide) {
    return slide.image || (chapter && chapter.image) || '';
  }

  function render(slide) {
    // Image (fall back to chapter image; blank if none)
    const name = imageNameFor(slide);
    els.image.style.opacity = name ? '1' : '0';
    if (name) els.image.src = `/img/story/${encodeURIComponent(name)}?t=${Date.now()}`;

    // Text
    els.text.textContent = slide.text || '';

    // Effects — rebuild the fx layer each slide
    els.fx.innerHTML = '';
    els.image.style.animation = '';
    (slide.effects || []).forEach((fx) => applyEffect(fx));
  }

  // ── Effect renderers (browser approximations of the engine) ────────────────
  function applyEffect(fx) {
    switch (fx.type) {
      case 'screen_flash': return fxFlash(fx);
      case 'background_tint': return fxFade(fx, hexToRgb(fx.color || '#3355ff'));
      case 'background_dim': return fxFade(fx, [0, 0, 0]);
      case 'vignette': return fxVignette(fx);
      case 'progressive_brightness': return fxBrightness(fx);
      case 'camera_shake': return fxShake(fx);
      case 'particle_burst': return fxParticles(fx);
      default: return;
    }
  }

  function mkOverlay() {
    const d = document.createElement('div');
    d.className = 'pv-overlay';
    els.fx.appendChild(d);
    return d;
  }

  // start/end strength support (from/to), else fade 0→strength/intensity
  function fromTo(fx, def) {
    const to = (fx.to !== undefined) ? fx.to
             : (fx.strength !== undefined) ? fx.strength
             : (fx.intensity !== undefined) ? fx.intensity : def;
    const from = (fx.from !== undefined) ? fx.from : 0;
    return { from: clamp01(from), to: clamp01(to) };
  }

  function fxFade(fx, rgb) {
    const { from, to } = fromTo(fx, 0.3);
    const o = mkOverlay();
    o.style.background = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},1)`;
    animateOpacity(o, from, to, dur(fx, 1.0));
  }

  function fxFlash(fx) {
    const rgb = hexToRgb(fx.color || '#ffffff');
    const peak = clamp01(fx.intensity !== undefined ? fx.intensity : 1);
    const total = dur(fx, 0.3);
    const o = mkOverlay();
    o.style.background = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},1)`;
    o.style.opacity = '0';
    const rise = Math.min(0.08, total * 0.3);
    const hold = Math.max(0.1, total * 0.35);
    o.style.transition = `opacity ${rise}s linear`;
    requestAnimationFrame(() => {
      o.style.opacity = String(peak);
      setTimeout(() => {
        o.style.transition = `opacity ${Math.max(0.08, total - rise - hold)}s linear`;
        o.style.opacity = '0';
      }, (rise + hold) * 1000);
    });
  }

  function fxVignette(fx) {
    const { from, to } = fromTo(fx, 0.5);
    const o = document.createElement('div');
    o.className = 'pv-vignette';
    els.fx.appendChild(o);
    animateOpacity(o, from, to, dur(fx, 0.6));
  }

  function fxBrightness(fx) {
    const from = clamp01(fx.start !== undefined ? fx.start : 0);
    const to = clamp01(fx.end !== undefined ? fx.end : 0.7);
    const o = mkOverlay();
    o.style.background = 'rgba(255,255,255,1)';
    animateOpacity(o, from, to, dur(fx, 1.5));
  }

  function fxShake(fx) {
    const mag = fx.magnitude !== undefined ? fx.magnitude : 4;
    const d = dur(fx, 0.4);
    els.image.style.setProperty('--sx', `${mag}px`);
    els.image.style.setProperty('--sy', `${mag}px`);
    els.image.style.animation = `pv-shake ${Math.min(0.2, d)}s linear ${Math.ceil(d / 0.2)}`;
  }

  function fxParticles(fx) {
    const count = Math.min(120, fx.count || 20);
    const life = dur(fx, 1.2);
    const type = fx.particle_type || 'spark';
    const color = type === 'petal' ? '#ff99cc' : type === 'star' ? '#ffe64d' : '#ffd24d';
    const cx = els.stage.clientWidth / 2;
    const cy = els.stage.clientHeight / 2;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'pv-particle';
      p.style.background = color;
      p.style.left = cx + 'px';
      p.style.top = cy + 'px';
      els.fx.appendChild(p);
      const ang = Math.random() * Math.PI * 2;
      const dist = 60 + Math.random() * 180;
      const dx = Math.cos(ang) * dist;
      const dy = Math.sin(ang) * dist + 80; // slight gravity bias
      p.style.transition = `transform ${life}s ease-out, opacity ${life}s ease-out`;
      requestAnimationFrame(() => {
        p.style.transform = `translate(${dx}px, ${dy}px) scale(${0.5 + Math.random()})`;
        p.style.opacity = '0';
      });
      setTimeout(() => p.remove(), life * 1000 + 100);
    }
  }

  // ── helpers ──
  function animateOpacity(node, from, to, seconds) {
    node.style.opacity = String(from);
    node.style.transition = `opacity ${Math.max(0.05, seconds)}s linear`;
    requestAnimationFrame(() => { node.style.opacity = String(to); });
  }
  function dur(fx, def) { return (typeof fx.duration === 'number' ? fx.duration : def); }
  function clamp01(v) { v = Number(v); return isNaN(v) ? 0 : Math.max(0, Math.min(1, v)); }
  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).replace('#', '#'));
    if (!m) return [51, 85, 255];
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  }

  return { init, open, close };
})();
