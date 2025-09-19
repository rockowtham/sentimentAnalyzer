const STORAGE_KEYS = {
  accessToken: 'upstoxAccessToken',
  instrumentKeys: 'instrumentKeys',
  geminiApiKey: 'geminiApiKey'
};

function setInStorage(obj) {
  return new Promise((resolve, reject) => chrome.storage.sync.set(obj, () => {
    const err = chrome.runtime && chrome.runtime.lastError;
    if (err) return reject(err);
    resolve(undefined);
  }));
}

function getFromStorage(keys) {
  return new Promise((resolve, reject) => chrome.storage.sync.get(keys, (items) => {
    const err = chrome.runtime && chrome.runtime.lastError;
    if (err) return reject(err);
    resolve(items);
  }));
}

async function load() {
  try {
    const tokenEl = document.getElementById('token');
    const geminiEl = document.getElementById('gemini');
    const keysEl = document.getElementById('keys');
    const { upstoxAccessToken, instrumentKeys, geminiApiKey } = await getFromStorage([STORAGE_KEYS.accessToken, STORAGE_KEYS.instrumentKeys, STORAGE_KEYS.geminiApiKey]);
    tokenEl.value = upstoxAccessToken || '';
    if (geminiEl) geminiEl.value = geminiApiKey || '';
    keysEl.value = Array.isArray(instrumentKeys) ? instrumentKeys.join(', ') : '';
  } catch (e) {
    console.error('Load options failed:', e);
  }
}

function normalizeKeys(input) {
  // Replace fancy commas, split by comma or newline, trim, dedupe, cap at 10
  const raw = input.replace(/\u201A|\u201E|\uFF0C/g, ',');
  const parts = raw.split(/[\,\n]/).map(s => s.trim()).filter(Boolean);
  const seen = new Set();
  const result = [];
  for (const p of parts) {
    if (!seen.has(p)) {
      seen.add(p);
      result.push(p);
      if (result.length >= 10) break;
    }
  }
  return result;
}

async function save() {
  const saveStatus = document.getElementById('saveStatus');
  const saveError = document.getElementById('saveError');
  saveStatus.hidden = true;
  saveError.hidden = true;
  try {
    const token = document.getElementById('token').value.trim();
    const geminiEl = document.getElementById('gemini');
    const gemini = geminiEl ? geminiEl.value.trim() : '';
    const keysRaw = document.getElementById('keys').value;
    const keys = normalizeKeys(keysRaw);
    console.log('Saving options:', { tokenPresent: Boolean(token), geminiPresent: Boolean(gemini), keysCount: keys.length });
    await setInStorage({ upstoxAccessToken: token, instrumentKeys: keys, geminiApiKey: gemini });
    saveStatus.hidden = false;
  } catch (err) {
    console.error('Save options failed:', err);
    saveError.textContent = err && err.message ? err.message : String(err);
    saveError.hidden = false;
  }
}

document.getElementById('saveBtn').addEventListener('click', save);
document.addEventListener('DOMContentLoaded', load);


