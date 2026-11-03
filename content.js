// Injected on demand. Runs the element picker, scrolls the page into position
// for each screenshot tile, and reports crop rectangles to the background.

(() => {
  if (window.__elementSnap?.alive()) return;
  window.__elementSnap = { alive: () => !!chrome.runtime?.id };

  const DEFAULTS = { format: 'png', scale: 'device', padding: 0, output: 'file' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const settle = async () => {
    await frames();
    await sleep(60);
  };

  // ---------- overlay ----------

  const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  const HEAVY = '"Arial Black", Helvetica, sans-serif';
  const CSS = `
    * { box-sizing: border-box; margin: 0; }
    [hidden] { display: none !important; }
    .box { position: fixed; border: 3px solid #000; outline: 3px solid #00a98f; background: rgba(0, 169, 143, .18); }
    .label {
      position: absolute; left: -6px; bottom: 100%; margin-bottom: 3px;
      background: #000; color: #00a98f; padding: 5px 7px; white-space: nowrap; font: 700 11px/1 ${MONO};
    }
    .label.inside { bottom: auto; top: 0; left: 0; margin: 0; }
    .label b { color: #fff; margin-left: 10px; }
    .mark { position: fixed; border: 3px dashed #000; outline: 3px solid #00a98f; }
    .mark span { position: absolute; top: 0; left: 0; background: #000; color: #00a98f; padding: 4px 6px; font: 900 12px/1 ${HEAVY}; }

    .bar {
      position: fixed; left: 12px; right: 12px; bottom: 12px; pointer-events: auto;
      display: grid; gap: 10px; padding: 10px 12px;
      background: #00a98f; color: #000; border: 3px solid #000; box-shadow: 6px 6px 0 #000;
      font: 700 11px/1.2 ${MONO}; text-transform: uppercase; letter-spacing: .4px;
    }
    .bar.top { bottom: auto; top: 12px; }
    .row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
    .bar strong { font: 900 16px/1 ${HEAVY}; letter-spacing: -.5px; white-space: nowrap; }
    .bar button {
      font: inherit; color: #000; background: #fff; border: 3px solid #000; padding: 5px 9px;
      cursor: pointer; text-transform: inherit; letter-spacing: inherit;
    }
    .bar button:hover { background: #000; color: #00a98f; }
    .bar button:focus { outline: none; }
    .bar button:focus-visible { outline: 3px solid #000; outline-offset: 2px; }
    .bar button:disabled { background: transparent; color: #005e50; border-color: #005e50; cursor: default; }
    .sel {
      flex: 1 1 220px; min-width: 160px; font: 700 12px/1 ${MONO}; color: #000; background: #fff;
      border: 3px solid #000; padding: 6px 8px; outline: none;
    }
    .sel:focus { box-shadow: 4px 4px 0 #000; }
    .sel.bad { background: #ff3b00; }
    .go { box-shadow: 4px 4px 0 #000; }
    .go:active { transform: translate(4px, 4px); box-shadow: none; }
    .end { margin-left: auto; display: flex; gap: 6px; }
    .opt { display: flex; align-items: center; gap: 6px; }
    .seg { display: flex; }
    .seg button + button { margin-left: -3px; }
    .seg button[aria-pressed="true"] { background: #000; color: #00a98f; }
    .padv { min-width: 34px; text-align: center; background: #fff; border: 3px solid #000; border-width: 3px 0; padding: 5px 2px; }
    .keys { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-left: auto; }
    kbd { font: inherit; background: #000; color: #00a98f; padding: 2px 5px; margin-right: 4px; }

    .toast {
      position: fixed; top: 12px; right: 12px; max-width: 380px;
      background: #000; color: #00a98f; border: 3px solid #000; box-shadow: 6px 6px 0 #00a98f;
      padding: 12px 14px; text-transform: uppercase; font: 700 12px/1.3 ${MONO};
    }
    .bar.top ~ .toast { top: auto; bottom: 12px; }
    .toast.err { background: #ff3b00; color: #000; box-shadow: 6px 6px 0 #000; }

    .preview {
      position: fixed; right: 12px; min-width: 200px; max-width: 320px;
      background: #000; border: 3px solid #000; box-shadow: 6px 6px 0 #000;
      font: 700 11px/1.2 ${MONO}; text-transform: uppercase; letter-spacing: .4px;
    }
    .preview.left { right: auto; left: 12px; }
    .ph { display: flex; justify-content: space-between; gap: 16px; background: #000; color: #00a98f; padding: 5px 8px; }
    .ph span { color: #fff; }
    /* The image sits edge to edge; any leftover space (narrow elements) gets a dark checkerboard. */
    .pbody {
      display: grid; place-items: center;
      background: repeating-conic-gradient(#161616 0 25%, #232323 0 50%) 0 0 / 12px 12px;
    }
    .preview canvas { display: block; }
    .pnote { background: #00a98f; color: #000; padding: 5px 8px; border-top: 3px solid #000; }
  `;

  // Leftover hosts come from a previous injection whose extension context was reloaded.
  document.querySelectorAll('element-snap').forEach((n) => n.remove());

  const host = document.createElement('element-snap');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>${CSS}</style>
    <div class="marks"></div>
    <div class="box" hidden><div class="label"></div></div>
    <div class="bar" hidden>
      <div class="row">
        <strong>ELEMENT SNAP</strong>
        <input class="sel" placeholder="CSS selector, e.g. .card, main img" spellcheck="false" autocomplete="off" />
        <button class="go" disabled>SNAP QUEUE · 0</button>
        <div class="end">
          <button class="move" title="Move bar">&#8645;</button>
          <button class="close" title="Exit (Esc)">&#10005;</button>
        </div>
      </div>
      <div class="row">
        <div class="opt">FMT <div class="seg" data-key="format"><button data-v="png">PNG</button><button data-v="jpeg">JPG</button></div></div>
        <div class="opt">SCALE <div class="seg" data-key="scale"><button data-v="device">RETINA</button><button data-v="1x">1&times;</button></div></div>
        <div class="opt">TO <div class="seg" data-key="output"><button data-v="file">FILE</button><button data-v="clipboard">CLIP</button><button data-v="both">BOTH</button></div></div>
        <div class="opt">PAD <div class="seg"><button data-step="-4">&minus;</button><span class="padv">0</span><button data-step="4">+</button></div></div>
        <div class="keys">
          <span><kbd>CLICK</kbd>SNAP</span>
          <span><kbd>&#8679;CLICK</kbd>QUEUE</span>
          <span><kbd>&uarr;&darr;</kbd>PARENT/CHILD</span>
          <span><kbd>ENTER</kbd>SNAP QUEUE</span>
          <span><kbd>ESC</kbd>EXIT</span>
        </div>
      </div>
    </div>
    <div class="toast" hidden></div>
    <div class="preview" hidden>
      <div class="ph">PREVIEW <span class="pdim"></span></div>
      <div class="pbody"><canvas></canvas></div>
      <div class="pnote" hidden></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const box = $('.box');
  const label = $('.label');
  const bar = $('.bar');
  const sel = $('.sel');
  const go = $('.go');
  const padv = $('.padv');
  const marks = $('.marks');
  const toastEl = $('.toast');
  const preview = $('.preview');
  const pcanvas = $('.preview canvas');
  const pdim = $('.pdim');
  const pnote = $('.pnote');

  function mount() {
    if (!host.isConnected) document.documentElement.append(host);
  }

  function showOverlay(on) {
    host.style.setProperty('display', on ? 'block' : 'none', 'important');
  }

  let toastTimer = 0;
  function toast(text, kind = '') {
    mount();
    clearTimeout(toastTimer);
    toastEl.textContent = text;
    toastEl.className = `toast ${kind}`;
    toastEl.hidden = false;
    if (kind !== 'busy') toastTimer = setTimeout(() => (toastEl.hidden = true), kind === 'err' ? 5000 : 2500);
  }

  function describe(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const cls = [...el.classList].slice(0, 2);
    if (cls.length) s += `.${cls.join('.')}`;
    return s.length > 48 ? `${s.slice(0, 47)}…` : s;
  }

  function place(node, rect) {
    node.style.left = `${rect.left}px`;
    node.style.top = `${rect.top}px`;
    node.style.width = `${rect.width}px`;
    node.style.height = `${rect.height}px`;
  }

  // ---------- bar controls ----------

  function press(seg, value) {
    for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === value));
  }

  let settings = { ...DEFAULTS }; // mirror of storage, so the preview can react without a round trip

  function setSetting(key, value) {
    settings[key] = value;
    chrome.storage.sync.set({ [key]: value });
  }

  async function loadSettings() {
    settings = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
    for (const seg of root.querySelectorAll('.seg[data-key]')) press(seg, settings[seg.dataset.key]);
    padv.textContent = settings.padding;
  }

  for (const seg of root.querySelectorAll('.seg[data-key]')) {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      press(seg, b.dataset.v);
      setSetting(seg.dataset.key, b.dataset.v);
    });
  }

  for (const b of root.querySelectorAll('[data-step]')) {
    b.addEventListener('click', () => {
      const padding = Math.min(400, Math.max(0, Number(padv.textContent) + Number(b.dataset.step)));
      padv.textContent = padding;
      setSetting('padding', padding);
    });
  }

  let selTimer = 0;
  sel.addEventListener('input', () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      const q = sel.value.trim();
      const els = q ? query(q) : [];
      sel.classList.toggle('bad', !els);
      setQueue(els || []);
    }, 120);
  });

  sel.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') snapQueue();
    if (e.key === 'Escape') sel.blur();
  });

  go.addEventListener('click', snapQueue);
  $('.move').addEventListener('click', () => bar.classList.toggle('top'));
  $('.close').addEventListener('click', stopPicker);

  // Keep typing in the bar away from the page's own shortcuts.
  for (const type of ['keydown', 'keyup', 'keypress']) bar.addEventListener(type, (e) => e.stopPropagation());

  // ---------- picker ----------

  let picking = false;
  let busy = false;
  let current = null;
  let trail = []; // children we walked up from, so ArrowDown retraces the path
  let queue = [];
  let raf = 0;

  function block(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  // Events from inside the bar arrive retargeted to the host; let them through.
  const ours = (e) => e.target === host;

  let pointer = null; // last cursor position, to re-pick after the page scrolls under it

  function onMove(e) {
    pointer = [e.clientX, e.clientY];
    if (busy) return;
    if (ours(e)) {
      current = null;
      trail = [];
      return;
    }
    const t = e.composedPath()[0];
    if (!(t instanceof Element)) return;
    if (t !== current && !current?.contains(t)) trail = [];
    if (!trail.length) current = t;
  }

  function onClick(e) {
    if (ours(e)) return;
    block(e);
    if (busy) return;
    const t = e.composedPath()[0];
    const el = current?.contains(t) ? current : t;
    if (!(el instanceof Element)) return;
    if (e.shiftKey) toggleQueue(el);
    else snap([el]);
  }

  function onKey(e) {
    if (ours(e)) return;
    if (busy) return block(e);
    if (e.key === 'Escape') {
      block(e);
      stopPicker();
    } else if (e.key === 'ArrowUp' && current?.parentElement && current.parentElement !== document.documentElement) {
      block(e);
      trail.push(current);
      current = current.parentElement;
    } else if (e.key === 'ArrowDown' && current) {
      block(e);
      current = trail.pop() || current.firstElementChild || current;
    } else if (e.key === ' ' && current) {
      block(e);
      toggleQueue(current);
    } else if (e.key === 'Enter') {
      block(e);
      if (queue.length) snapQueue();
      else if (current) snap([current]);
    }
  }

  function guard(e) {
    if (!ours(e)) block(e);
  }

  function setQueue(list) {
    queue = list;
    go.textContent = `SNAP QUEUE · ${queue.length}`;
    go.disabled = !queue.length;
  }

  function toggleQueue(el) {
    setQueue(queue.includes(el) ? queue.filter((q) => q !== el) : [...queue, el]);
  }

  function snapQueue() {
    const list = queue;
    setQueue([]);
    sel.value = '';
    sel.classList.remove('bad');
    snap(list);
  }

  // ---------- live preview ----------
  // One clean screenshot of the viewport (overlay hidden) is kept, and the hovered element is
  // cropped out of it, so hovering costs no captures. It's retaken once scrolling or resizing stops.

  const SHOT_GAP = 650; // matches the background's throttle for captureVisibleTab
  const PREVIEW_W = 280;
  const PREVIEW_H = 200;
  let frame = null; // { bmp, k: device pixels per CSS pixel, id }
  let frameJob = null;
  let frameTimer = 0;
  let frameCount = 0;
  let viewVersion = 0;
  let lastShotAt = 0;
  let previewKey = '';

  function dropFrame() {
    frame?.bmp.close();
    frame = null;
  }

  function scheduleFrame(delay = 250) {
    clearTimeout(frameTimer);
    frameTimer = setTimeout(() => {
      if (picking && !busy) refreshFrame();
    }, delay);
  }

  function onViewportChange() {
    if (busy) return;
    viewVersion++;
    dropFrame();
    scheduleFrame();
    if (pointer && !trail.length) {
      const t = document.elementFromPoint(...pointer);
      current = t && t !== host ? t : null;
    }
  }

  function refreshFrame() {
    frameJob ??= (async () => {
      // Wait out the rate limit before hiding the overlay, so it blinks as briefly as possible.
      const wait = lastShotAt + SHOT_GAP - Date.now();
      if (wait > 0) await sleep(wait);
      if (!picking || busy) return;
      const version = viewVersion;
      showOverlay(false);
      try {
        await frames();
        const { shot } = await send({ t: 'frame' });
        const bmp = await createImageBitmap(dataUrlToBlob(shot));
        dropFrame();
        if (version === viewVersion) frame = { bmp, k: bmp.width / innerWidth, id: ++frameCount };
        else bmp.close();
      } catch {
        dropFrame(); // no preview is better than a wrong one
      } finally {
        showOverlay(true);
        frameJob = null;
      }
    })();
    return frameJob;
  }

  const overlaps = (a, b) =>
    a.left < b.left + b.width && b.left < a.right && a.top < b.top + b.height && b.top < a.bottom;

  function drawPreview() {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const r = current?.isConnected && grow(current.getBoundingClientRect(), Number(settings.padding) || 0);
    const vis = r && clipToViewport(r, vw, vh);
    if (!frame || !vis || vis.width < 1 || vis.height < 1) {
      preview.hidden = true;
      previewKey = '';
      return;
    }
    const onTop = bar.classList.contains('top');
    const key = [frame.id, r.left, r.top, r.width, r.height, settings.scale, settings.format, onTop].join();
    if (key === previewKey) return;
    previewKey = key;

    const s = Math.min(PREVIEW_W / vis.width, PREVIEW_H / vis.height, 3);
    const w = Math.max(1, Math.round(vis.width * s));
    const h = Math.max(1, Math.round(vis.height * s));
    pcanvas.style.width = `${w}px`;
    pcanvas.style.height = `${h}px`;
    pcanvas.width = Math.round(w * devicePixelRatio);
    pcanvas.height = Math.round(h * devicePixelRatio);
    const ctx = pcanvas.getContext('2d');
    ctx.imageSmoothingEnabled = s <= 1; // keep tiny elements (icons) crisp when blown up
    ctx.imageSmoothingQuality = 'high';
    const { bmp, k } = frame;
    ctx.drawImage(bmp, vis.left * k, vis.top * k, vis.width * k, vis.height * k, 0, 0, pcanvas.width, pcanvas.height);

    const out = settings.scale === '1x' ? 1 : k;
    pdim.textContent = `${Math.round(r.width * out)}×${Math.round(r.height * out)} ${settings.format === 'jpeg' ? 'JPG' : 'PNG'}`;
    const bigger = r.width > vw || r.height > vh;
    const cut = vis.width < r.width - 0.5 || vis.height < r.height - 0.5;
    pnote.hidden = !cut;
    pnote.textContent = bigger ? 'BIGGER THAN SCREEN · STITCHED ON SAVE' : 'PARTLY OFF SCREEN · SCROLLED IN ON SAVE';

    // Sit next to the bar, on whichever side doesn't cover the element.
    const br = bar.getBoundingClientRect();
    preview.style.top = onTop ? `${br.bottom + 12}px` : '';
    preview.style.bottom = onTop ? '' : `${innerHeight - br.top + 12}px`;
    preview.hidden = false;
    preview.classList.remove('left');
    if (overlaps(preview.getBoundingClientRect(), r)) {
      preview.classList.add('left');
      if (overlaps(preview.getBoundingClientRect(), r)) preview.classList.remove('left');
    }
  }

  const LISTENERS = [
    ['mousemove', onMove],
    ['click', onClick],
    ['keydown', onKey],
    ['scroll', onViewportChange], // capture phase also catches nested scroll boxes
    ['resize', onViewportChange],
    ...['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'auxclick', 'contextmenu'].map((t) => [t, guard]),
  ];

  function draw() {
    raf = requestAnimationFrame(draw);
    if (busy) return;

    if (current?.isConnected) {
      const r = current.getBoundingClientRect();
      place(box, r);
      label.innerHTML = '';
      label.append(describe(current), Object.assign(document.createElement('b'), {
        textContent: `${Math.round(r.width)}×${Math.round(r.height)}`,
      }));
      label.classList.toggle('inside', r.top < 26);
      box.hidden = false;
    } else {
      box.hidden = true;
    }
    drawPreview();

    if (queue.some((el) => !el.isConnected)) setQueue(queue.filter((el) => el.isConnected));
    while (marks.children.length > queue.length) marks.lastChild.remove();
    while (marks.children.length < queue.length) {
      const m = document.createElement('div');
      m.className = 'mark';
      m.append(document.createElement('span'));
      marks.append(m);
    }
    queue.forEach((el, i) => {
      place(marks.children[i], el.getBoundingClientRect());
      marks.children[i].firstChild.textContent = String(i + 1).padStart(2, '0');
    });
  }

  function startPicker() {
    mount();
    if (picking) return;
    picking = true;
    bar.hidden = false;
    setQueue([]);
    loadSettings();
    for (const [type, fn] of LISTENERS) addEventListener(type, fn, true);
    draw();
    scheduleFrame(100);
  }

  function stopPicker() {
    picking = false;
    current = null;
    trail = [];
    setQueue([]);
    sel.value = '';
    sel.classList.remove('bad');
    cancelAnimationFrame(raf);
    clearTimeout(frameTimer);
    dropFrame();
    for (const [type, fn] of LISTENERS) removeEventListener(type, fn, true);
    box.hidden = true;
    bar.hidden = true;
    preview.hidden = true;
    marks.replaceChildren();
  }

  // ---------- capture ----------

  function grow(r, pad) {
    return { left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
  }

  function clipToViewport(r, vw, vh) {
    const left = Math.max(0, r.left);
    const top = Math.max(0, r.top);
    return { left, top, width: Math.min(vw, r.left + r.width) - left, height: Math.min(vh, r.top + r.height) - top };
  }

  async function send(msg) {
    const res = await chrome.runtime.sendMessage(msg);
    if (msg.t === 'tile' || msg.t === 'frame') lastShotAt = Date.now();
    if (!res?.ok) throw new Error(res?.error || 'NO RESPONSE FROM EXTENSION');
    return res;
  }

  // Fixed and sticky elements (headers, chat bubbles) would repeat in every tile.
  function hideFloating(el) {
    const hidden = [];
    for (const node of document.body?.querySelectorAll('*') ?? []) {
      if (node.contains(el) || el.contains(node)) continue;
      const pos = getComputedStyle(node).position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;
      hidden.push([node, node.style.getPropertyValue('visibility'), node.style.getPropertyPriority('visibility')]);
      node.style.setProperty('visibility', 'hidden', 'important');
    }
    return () => {
      for (const [node, value, prio] of hidden) {
        if (value) node.style.setProperty('visibility', value, prio);
        else node.style.removeProperty('visibility');
      }
    };
  }

  async function captureVisible(el, pad, vw, vh, base) {
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    await settle();
    const r = clipToViewport(grow(el.getBoundingClientRect(), pad), vw, vh);
    if (r.width < 1 || r.height < 1) throw new Error('ELEMENT IS NOT VISIBLE');
    await send({ ...base, t: 'tile', W: r.width, H: r.height, sx: r.left, sy: r.top, sw: r.width, sh: r.height, dx: 0, dy: 0 });
  }

  // Scrolls the window across an element bigger than the viewport, one tile per screen.
  // Returns false if the window can't reach part of it (e.g. it lives in a nested scroll box).
  async function captureTiled(el, pad, vw, vh, base) {
    const de = document.documentElement;
    const r = grow(el.getBoundingClientRect(), pad);
    const docW = Math.max(de.scrollWidth, document.body?.scrollWidth ?? 0);
    const docH = Math.max(de.scrollHeight, document.body?.scrollHeight ?? 0);
    const x0 = Math.max(0, r.left + scrollX);
    const y0 = Math.max(0, r.top + scrollY);
    const x1 = Math.min(docW, r.left + r.width + scrollX);
    const y1 = Math.min(docH, r.top + r.height + scrollY);
    const W = x1 - x0;
    const H = y1 - y0;

    const restore = hideFloating(el);
    try {
      for (let ty = y0; ty < y1; ty += vh) {
        for (let tx = x0; tx < x1; tx += vw) {
          scrollTo({ left: tx, top: ty, behavior: 'instant' });
          await settle();
          const sx = tx - scrollX;
          const sy = ty - scrollY;
          const sw = Math.min(vw, x1 - tx);
          const sh = Math.min(vh, y1 - ty);
          if (sx < -1 || sy < -1 || sx + sw > vw + 1 || sy + sh > vh + 1) return false;
          await send({ ...base, t: 'tile', W, H, sx, sy, sw, sh, dx: tx - x0, dy: ty - y0 });
        }
      }
      return true;
    } finally {
      restore();
    }
  }

  // Returns a PNG data URL when the clipboard needs one.
  async function captureOne(el, s, name) {
    const pad = Math.max(0, Number(s.padding) || 0);
    const vw = document.documentElement.clientWidth; // excludes scrollbars
    const vh = document.documentElement.clientHeight;
    let base = { job: crypto.randomUUID(), vw: innerWidth, scale: s.scale, format: s.format };

    showOverlay(false);
    try {
      const r = grow(el.getBoundingClientRect(), pad);
      if (r.width <= vw && r.height <= vh) {
        await captureVisible(el, pad, vw, vh, base);
      } else if (!(await captureTiled(el, pad, vw, vh, base))) {
        await send({ t: 'abort', job: base.job });
        base = { ...base, job: crypto.randomUUID() };
        await captureVisible(el, pad, vw, vh, base);
      }
      const res = await send({ t: 'finish', job: base.job, name, format: s.format, output: s.output });
      return res.png;
    } catch (err) {
      send({ t: 'abort', job: base.job }).catch(() => {});
      throw err;
    } finally {
      showOverlay(true);
    }
  }

  function fileName(el, stamp, n) {
    const tag = el.id || el.classList[0] ? `${el.tagName.toLowerCase()}-${el.id || el.classList[0]}` : el.tagName.toLowerCase();
    const parts = [location.hostname.replace(/^www\./, '') || 'page', tag, stamp];
    if (n) parts.push(String(n).padStart(2, '0'));
    return parts.join('_').replace(/[^\w.-]+/g, '-').slice(0, 120);
  }

  function stampNow() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  // Decoded by hand: fetch() on a data URL can be blocked by the page's CSP.
  function dataUrlToBlob(dataUrl) {
    const bin = atob(dataUrl.split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: 'image/png' });
  }

  async function copyPng(dataUrl) {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': dataUrlToBlob(dataUrl) })]);
  }

  const hasSize = (el) => {
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1;
  };

  async function snap(els) {
    if (busy) return;
    els = els.filter((el) => el.isConnected && hasSize(el));
    if (!els.length) return toast('NOTHING VISIBLE TO SNAP', 'err');

    busy = true;
    mount();
    await frameJob; // a preview refresh may have the overlay hidden right now
    const s = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
    const start = [scrollX, scrollY];
    const stamp = stampNow();
    let png = null;
    let done = 0;
    try {
      for (const [i, el] of els.entries()) {
        if (els.length > 1) toast(`SNAPPING ${i + 1} / ${els.length}`, 'busy');
        png = (await captureOne(el, s, fileName(el, stamp, els.length > 1 ? i + 1 : 0))) || png;
        done++;
      }
      let note = s.output === 'clipboard' ? '' : `SAVED ${done} → DOWNLOADS/ELEMENT-SNAP`;
      if (png) {
        try {
          await copyPng(png);
          note = [note, els.length > 1 ? 'LAST ONE COPIED' : 'COPIED TO CLIPBOARD'].filter(Boolean).join(' · ');
        } catch {
          note = [note, 'CLIPBOARD BLOCKED. CLICK THE PAGE AND RETRY'].filter(Boolean).join(' · ');
        }
      }
      toast(note);
    } catch (err) {
      const msg = /context invalidated/i.test(err.message) ? 'EXTENSION WAS RELOADED. REFRESH THE PAGE' : err.message;
      toast(`FAILED${done ? ` AFTER ${done}` : ''}: ${msg}`, 'err');
    } finally {
      scrollTo({ left: start[0], top: start[1], behavior: 'instant' });
      busy = false;
    }
  }

  function query(selector) {
    try {
      return [...document.querySelectorAll(selector)].filter(hasSize);
    } catch {
      return null;
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.t !== 'toggle') return;
    if (picking) stopPicker();
    else startPicker();
    reply({ ok: true });
  });
})();
