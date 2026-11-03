// Crops viewport screenshots and stitches them into one canvas per job.
// Lives in an offscreen document because service workers can't make blob URLs,
// and data URLs over ~2 MB fail in chrome.downloads.

const MAX_SIDE = 32767; // Chrome canvas limits
const MAX_AREA = 268_000_000;
const jobs = new Map();

const handlers = {
  async tile(m) {
    const bmp = await createImageBitmap(await (await fetch(m.shot)).blob());
    const ratio = bmp.width / m.vw; // device pixels per CSS pixel, includes page zoom

    let job = jobs.get(m.job);
    if (!job) {
      let k = m.scale === '1x' ? 1 : ratio;
      k = Math.min(k, MAX_SIDE / m.W, MAX_SIDE / m.H, Math.sqrt(MAX_AREA / (m.W * m.H)));
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(m.W * k)), Math.max(1, Math.round(m.H * k)));
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      if (m.format === 'jpeg') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      job = { canvas, ctx, k };
      jobs.set(m.job, job);
    }

    // Round destination edges so neighbouring tiles share a pixel boundary (no seams).
    const { ctx, k } = job;
    const dx = Math.round(m.dx * k);
    const dy = Math.round(m.dy * k);
    const dw = Math.round((m.dx + m.sw) * k) - dx;
    const dh = Math.round((m.dy + m.sh) * k) - dy;
    ctx.drawImage(bmp, m.sx * ratio, m.sy * ratio, m.sw * ratio, m.sh * ratio, dx, dy, dw, dh);
    bmp.close();
    return {};
  },

  async finish(m) {
    const job = jobs.get(m.job);
    if (!job) throw new Error('CAPTURE JOB LOST');
    jobs.delete(m.job);

    const out = {};
    if (m.output !== 'clipboard') {
      const type = m.format === 'jpeg' ? 'image/jpeg' : 'image/png';
      out.url = URL.createObjectURL(await job.canvas.convertToBlob({ type, quality: 0.92 }));
      setTimeout(() => URL.revokeObjectURL(out.url), 120_000);
    }
    if (m.output !== 'file') {
      out.png = await toDataUrl(await job.canvas.convertToBlob({ type: 'image/png' }));
    }
    return out;
  },

  abort(m) {
    jobs.delete(m.job);
    return {};
  },
};

function toDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.target !== 'offscreen' || !handlers[msg.t]) return;
  Promise.resolve()
    .then(() => handlers[msg.t](msg))
    .then(
      (res) => reply({ ok: true, ...res }),
      (err) => reply({ ok: false, error: err.message }),
    );
  return true;
});
