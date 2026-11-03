// Takes viewport screenshots for the content script and hands them to the
// offscreen document, which crops and stitches them into the final image.

const SHOT_GAP = 600; // captureVisibleTab is capped at 2 calls per second
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let shotQueue = Promise.resolve();
let lastShot = 0;
let creating = null;

function shoot(windowId) {
  const run = shotQueue.then(async () => {
    const wait = lastShot + SHOT_GAP - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    } finally {
      lastShot = Date.now();
    }
  });
  shotQueue = run.catch(() => {});
  return run;
}

async function ensureOffscreen() {
  const open = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (open.length) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Stitch element screenshots and hand blob URLs to chrome.downloads',
    })
    .finally(() => (creating = null));
  await creating;
}

async function toOffscreen(msg) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ ...msg, target: 'offscreen' });
  if (!res?.ok) throw new Error(res?.error || 'OFFSCREEN DOCUMENT DID NOT ANSWER');
  return res;
}

async function shootTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.active) throw new Error('TAB LOST FOCUS. KEEP IT VISIBLE WHILE SNAPPING');
  return shoot(tab.windowId).catch((err) => {
    throw new Error(
      /activeTab|all_urls|permission/i.test(err.message)
        ? 'NO ACCESS. CLICK THE ELEMENT SNAP ICON ON THIS TAB FIRST'
        : err.message,
    );
  });
}

const handlers = {
  async tile(msg, sender) {
    await toOffscreen({ ...msg, shot: await shootTab(sender.tab.id) });
    return {};
  },

  // A clean viewport screenshot the picker crops hover previews from.
  async frame(_msg, sender) {
    return { shot: await shootTab(sender.tab.id) };
  },

  async finish(msg) {
    const { url, png } = await toOffscreen(msg);
    if (url) {
      await chrome.downloads.download({
        url,
        filename: `element-snap/${msg.name}.${msg.format === 'jpeg' ? 'jpg' : 'png'}`,
        conflictAction: 'uniquify',
      });
    }
    return { png };
  },

  abort: (msg) => toOffscreen(msg),
};

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.target === 'offscreen' || !sender.tab || !handlers[msg?.t]) return;
  handlers[msg.t](msg, sender).then(
    (res) => reply({ ok: true, ...res }),
    (err) => reply({ ok: false, error: err.message }),
  );
  return true;
});

// Icon click (or its shortcut) toggles the picker on the current tab.
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tab.id, { t: 'toggle' });
  } catch {
    // chrome://, the Web Store and similar pages refuse injection
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#ff3b00' });
    await chrome.action.setBadgeText({ tabId: tab.id, text: 'NO' });
    setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: '' }), 2500);
  }
});
