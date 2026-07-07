// ── Theme toggle (default: light) ────────────────────────────
(function () {
  const root   = document.documentElement;
  const btn    = document.getElementById('theme-toggle');
  const moon   = document.getElementById('icon-moon');
  const sun    = document.getElementById('icon-sun');

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    if (moon && sun) {
      moon.style.display = theme === 'dark' ? 'none'  : 'block';
      sun.style.display  = theme === 'dark' ? 'block' : 'none';
    }
    localStorage.setItem('theme', theme);
  }

  applyTheme('light');

  if (btn) btn.addEventListener('click', () =>
    applyTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark')
  );
})();

// ── Model-viewer: free drag any direction, axis corrects after 1s
const mv = document.querySelector('model-viewer');
if (mv) {
  let azimuthDeg   = 0;
  let defaultPolar = 75;
  let currentPolar = 75;
  let radiusM      = null;
  let isDragging   = false;
  let correcting   = false;
  let correctTimer = null;
  let lastX        = 0;
  let lastY        = 0;
  let lastTime     = null;
  const SPIN       = 22; // degrees per second when idle

  mv.addEventListener('load', () => {
    const o      = mv.getCameraOrbit();
    azimuthDeg   = o.theta * 180 / Math.PI;
    defaultPolar = o.phi   * 180 / Math.PI;
    currentPolar = defaultPolar;
    radiusM      = o.radius;
    requestAnimationFrame(spinLoop);
  });

  mv.addEventListener('pointerdown', e => {
    isDragging   = true;
    correcting   = false;
    lastX        = e.clientX;
    lastY        = e.clientY;
    clearTimeout(correctTimer);
  });

  window.addEventListener('pointermove', e => {
    if (!isDragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    azimuthDeg  += dx * 0.5;
    currentPolar = Math.max(10, Math.min(170, currentPolar + dy * 0.4));
    lastX = e.clientX;
    lastY = e.clientY;
  });

  window.addEventListener('pointerup', () => {
    if (!isDragging) return;
    isDragging   = false;
    correctTimer = setTimeout(() => { correcting = true; }, 1000);
  });

  function spinLoop(ts) {
    if (lastTime !== null && radiusM !== null) {
      const dt = (ts - lastTime) / 1000;

      // Auto-spin only when not dragging
      if (!isDragging) azimuthDeg += SPIN * dt;

      // Smoothly lerp polar back to upright after 1s
      if (correcting) {
        currentPolar += (defaultPolar - currentPolar) * Math.min(1, dt * 2);
        if (Math.abs(currentPolar - defaultPolar) < 0.05) {
          currentPolar = defaultPolar;
          correcting   = false;
        }
      }

      mv.cameraOrbit = `${azimuthDeg}deg ${currentPolar}deg ${radiusM}m`;
    }
    lastTime = ts;
    requestAnimationFrame(spinLoop);
  }
}

// ── Scroll reveal ────────────────────────────────────────────
const ro = new IntersectionObserver(entries => {
  entries.forEach(e => {
    e.target.classList.toggle('in', e.isIntersecting);
  });
}, { threshold: 0.06 });
document.querySelectorAll('.r').forEach(el => ro.observe(el));

let scrollTick = false;

// ── Sketch visibility (show after experience reaches top 25%) ─
const sketchCanvas = document.getElementById('sketch-canvas');
const expSection   = document.getElementById('experience');

function updateSketchVisibility() {
  if (!sketchCanvas || !expSection) return;
  const expTop    = expSection.getBoundingClientRect().top;
  const threshold = window.innerHeight * 0.25;
  sketchCanvas.classList.toggle('sketch-visible', expTop <= threshold);
}

// ── Timeline line growth ─────────────────────────────────────
function updateTimelineLines() {
  document.querySelectorAll('.timeline').forEach(tl => {
    const line = tl.querySelector('.tl-line');
    if (!line) return;
    const rect = tl.getBoundingClientRect();
    const viewH = window.innerHeight;
    // Grow the line as the timeline scrolls into view
    const progress = Math.max(0, Math.min(1, (viewH * 0.75 - rect.top) / rect.height));
    line.style.height = (progress * rect.height) + 'px';
  });
}

window.addEventListener('scroll', () => {
  if (!scrollTick) {
    requestAnimationFrame(() => {
      updateTimelineLines();
      updateSketchVisibility();
      scrollTick = false;
    });
    scrollTick = true;
  }
}, { passive: true });

// Run once on load
updateTimelineLines();
updateSketchVisibility();

// ── Nav scroll spy ───────────────────────────────────────────
document.querySelectorAll('section[id]').forEach(s => {
  new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting)
        document.querySelectorAll('.nav-links a[href^="#"]').forEach(a => {
          a.style.fontWeight = a.getAttribute('href') === '#' + e.target.id ? '700' : '';
        });
    });
  }, { rootMargin: '-40% 0px -55% 0px' }).observe(s);
});
