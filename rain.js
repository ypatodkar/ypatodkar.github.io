(function () {
  const canvas = document.getElementById('rain-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const ANGLE  = Math.PI / 10;   // lean: ~18° from vertical
  const adx    = Math.sin(ANGLE);
  const ady    = Math.cos(ANGLE);
  const COUNT  = 280;

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
    drop.len    = Math.random() * 22 + 10;
    drop.speed  = Math.random() * 4.2 + 2.8;
    drop.alpha  = Math.random() * 0.45 + 0.3;
  }

  function init() {
    resize();
    drops.length = 0;
    for (let i = 0; i < COUNT; i++) {
      const d = {};
      spawn(d);
      d.y = Math.random() * H;
      drops.push(d);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    for (const d of drops) {
      const x2 = d.x - adx * d.len;
      const y2 = d.y - ady * d.len;

      // outer glow / border
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(x2, y2);
      ctx.lineWidth   = 2.5;
      ctx.strokeStyle = `rgba(190,220,255,${d.alpha * 0.3})`;
      ctx.stroke();

      // bright core
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(x2, y2);
      ctx.lineWidth   = 1;
      ctx.strokeStyle = `rgba(220,235,255,${d.alpha})`;
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
