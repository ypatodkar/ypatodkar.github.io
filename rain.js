(function () {
  const canvas = document.getElementById('rain-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const ANGLE  = Math.PI / 10;   // lean: ~18° from vertical
  const adx    = Math.sin(ANGLE);
  const ady    = Math.cos(ANGLE);
  const COUNT  = 160;

  let W = 0, H = 0;
  const drops = [];

  function resize() {
    W = canvas.offsetWidth;
    H = canvas.offsetHeight;
    canvas.width  = W;
    canvas.height = H;
  }

  function spawn(drop) {
    drop.x      = Math.random() * (W + 100) - 50;
    drop.y      = -Math.random() * H;
    drop.len    = Math.random() * 18 + 8;
    drop.speed  = Math.random() * 6 + 4;
    drop.alpha  = Math.random() * 0.35 + 0.1;
  }

  function init() {
    resize();
    drops.length = 0;
    for (let i = 0; i < COUNT; i++) {
      const d = {};
      spawn(d);
      d.y = Math.random() * H; // spread on first load
      drops.push(d);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1;

    for (const d of drops) {
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - adx * d.len, d.y - ady * d.len);
      ctx.strokeStyle = `rgba(190,220,255,${d.alpha})`;
      ctx.stroke();

      d.x += adx * d.speed;
      d.y += ady * d.speed;

      if (d.y - d.len > H || d.x - d.len > W) spawn(d);
    }

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', () => { resize(); });
  init();
  draw();
})();
