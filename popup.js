const SETTINGS_KEY = 'enabled';

function setStatus(text) {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}

function init() {
  const toggle = document.getElementById('enabledToggle');
  if (!toggle) return;
  chrome.storage.sync.get({ [SETTINGS_KEY]: true }, (items) => {
    const enabled = !!items[SETTINGS_KEY];
    toggle.checked = enabled;
    setStatus(enabled ? 'Auto-advance is enabled' : 'Auto-advance is disabled');
  });
  toggle.addEventListener('change', () => {
    const enabled = !!toggle.checked;
    chrome.storage.sync.set({ [SETTINGS_KEY]: enabled }, () => {
      setStatus(enabled ? 'Auto-advance is enabled' : 'Auto-advance is disabled');
    });
  });
}

document.addEventListener('DOMContentLoaded', init);


