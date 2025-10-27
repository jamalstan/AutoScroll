(() => {
  const SETTINGS_KEY = "enabled";
  let isEnabled = true;
  let currentVideo = null;
  let isAdvancing = false;
  let urlAtLastBind = location.href;
  let lastKnownTime = 0;
  let nearEndTriggered = false;
  let pauseListenerBound = false;
  let playerEndedObserver = null;
  let videoLoopObserver = null;
  let currentRendererEl = null;
  let lastAdvanceMs = 0;

  function getDefaultSettings() {
    return { [SETTINGS_KEY]: true };
  }

  function loadSettings() {
    try {
      chrome.storage.sync.get(getDefaultSettings(), (items) => {
        isEnabled = !!items[SETTINGS_KEY];
      });
    } catch (_) {
      // Fallback for environments where chrome.storage isn't available
      isEnabled = true;
    }
  }

  function onStorageChanged(changes, area) {
    if (area !== "sync") return;
    if (changes[SETTINGS_KEY]) {
      isEnabled = !!changes[SETTINGS_KEY].newValue;
    }
  }

  function isOnShortsPage() {
    return location.pathname.startsWith("/shorts");
  }

  function isShortsUiPresent() {
    return !!document.querySelector('ytd-shorts');
  }

  function findActiveShortsVideo() {
    // Prefer the active reel's video
    const candidates = [
      'ytd-reel-video-renderer[is-active] video',
      'ytd-reel-video-renderer[active] video',
      'ytd-reel-video-renderer.active video',
      'ytd-reel-video-renderer[is-active] #player-container-inner video',
      'ytd-shorts video.html5-main-video',
      'video.html5-main-video'
    ];
    for (const selector of candidates) {
      const el = document.querySelector(selector);
      if (el && el.tagName === 'VIDEO') return el;
    }
    // Fallback: choose the video closest to viewport center
    const all = Array.from(document.querySelectorAll('ytd-reel-video-renderer video, ytd-shorts video, video.html5-main-video'));
    if (all.length === 0) return null;
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    let best = null;
    let bestDist = Infinity;
    for (const v of all) {
      const rect = v.getBoundingClientRect();
      const vx = rect.left + rect.width / 2;
      const vy = rect.top + rect.height / 2;
      const dx = vx - cx;
      const dy = vy - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) { bestDist = d2; best = v; }
    }
    return best;
  }

  function clickNextShortButton() {
    const selectors = [
      'ytd-reel-player-navigation-button-renderer[is-next] button',
      'ytd-reel-player-navigation-button-renderer[use-next] button',
      'button[aria-label="Next"]',
      'button[aria-label*="Next"]',
      'yt-button-shape[aria-label*="Next"] button',
      '#navigation-button-down button',
      '#navigation-button-down',
      '.navigation-button#navigation-button-down'
    ];
    for (const selector of selectors) {
      const btn = document.querySelector(selector);
      if (btn) {
        try {
          const events = [
            new PointerEvent('pointerdown', { bubbles: true }),
            new MouseEvent('mousedown', { bubbles: true }),
            new PointerEvent('pointerup', { bubbles: true }),
            new MouseEvent('mouseup', { bubbles: true }),
            new MouseEvent('click', { bubbles: true })
          ];
          for (const ev of events) btn.dispatchEvent(ev);
        } catch (_) {
          try { btn.click(); } catch (_) {}
        }
        return true;
      }
    }
    return false;
  }

  function pressNextShortcut() {
    const targets = [document.querySelector('ytd-shorts'), document.activeElement, document.body, window].filter(Boolean);
    const kd = new KeyboardEvent('keydown', { key: 'N', code: 'KeyN', keyCode: 78, which: 78, shiftKey: true, bubbles: true, cancelable: true, composed: true });
    const ku = new KeyboardEvent('keyup',   { key: 'N', code: 'KeyN', keyCode: 78, which: 78, shiftKey: true, bubbles: true, cancelable: true, composed: true });
    let dispatched = false;
    for (const t of targets) {
      try { t.dispatchEvent(kd); t.dispatchEvent(ku); dispatched = true; } catch (_) {}
    }
    return dispatched;
  }

  function focusShortsUi() {
    const shorts = document.querySelector('ytd-shorts');
    if (shorts) {
      try { if (!shorts.hasAttribute('tabindex')) shorts.setAttribute('tabindex', '-1'); } catch (_) {}
      try { shorts.focus({ preventScroll: true }); } catch (_) {}
    }
    const btn = document.querySelector('#navigation-button-down button');
    if (btn) {
      try { btn.focus({ preventScroll: true }); } catch (_) {}
    }
  }

  function sendPageDown() {
    const targets = [document.querySelector('ytd-shorts'), document.activeElement, document.body, window, document].filter(Boolean);
    const kd = new KeyboardEvent('keydown', { key: 'PageDown', code: 'PageDown', keyCode: 34, which: 34, bubbles: true, cancelable: true, composed: true });
    const ku = new KeyboardEvent('keyup',   { key: 'PageDown', code: 'PageDown', keyCode: 34, which: 34, bubbles: true, cancelable: true, composed: true });
    for (const t of targets) {
      try { t.dispatchEvent(kd); t.dispatchEvent(ku); } catch (_) {}
    }
  }

  function getShortsContainer() {
    return document.querySelector('ytd-shorts #shorts-container') || document.querySelector('ytd-shorts');
  }

  function getActiveRenderer() {
    return document.querySelector('ytd-reel-video-renderer[is-active]') || document.querySelector('ytd-reel-video-renderer[active]') || document.querySelector('ytd-reel-video-renderer.active');
  }

  function getActiveWrapper() {
    const active = getActiveRenderer();
    if (!active) return null;
    return active.closest('.reel-video-in-sequence-new') || active.parentElement;
  }

  function getActiveIndex() {
    const wrapper = getActiveWrapper();
    if (!wrapper) return null;
    const idAttr = wrapper.getAttribute('id');
    const idNum = idAttr != null ? Number(idAttr) : NaN;
    if (Number.isFinite(idNum)) return idNum;
    const container = getShortsContainer();
    if (!container) return null;
    const items = Array.from(container.querySelectorAll('.reel-video-in-sequence-new'));
    const idx = items.indexOf(wrapper);
    return idx >= 0 ? idx : null;
  }

  function scrollToNextReel() {
    const container = getShortsContainer();
    if (!container) return false;
    const active = getActiveRenderer();
    if (active) {
      let wrapper = active.closest('.reel-video-in-sequence-new');
      if (wrapper && wrapper.nextElementSibling) {
        const target = wrapper.nextElementSibling;
        try {
          const y = target.offsetTop - Math.round(container.clientHeight * 0.02);
          if (typeof container.scrollTo === 'function') {
            container.scrollTo({ top: y, behavior: 'smooth' });
          } else {
            container.scrollTop = y;
          }
          // Fire a synthetic scroll event to notify listeners
          try { container.dispatchEvent(new Event('scroll', { bubbles: true })); } catch (_) {}
          return true;
        } catch (_) {}
      }
    }
    // Generic fallback: increment scroll by almost a viewport height
    try {
      const delta = Math.max(200, Math.round((typeof window.innerHeight === 'number' ? window.innerHeight : 720) * 0.98));
      container.scrollTop = container.scrollTop + delta;
      try { container.dispatchEvent(new Event('scroll', { bubbles: true })); } catch (_) {}
      return true;
    } catch (_) {}
    return false;
  }

  function sendArrowDown() {
    const targets = [];
    const shorts = document.querySelector('ytd-shorts');
    if (shorts) targets.push(shorts);
    if (document.activeElement) targets.push(document.activeElement);
    targets.push(document.body, window);
    const events = [
      new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true, cancelable: true }),
      new KeyboardEvent('keyup',   { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true, cancelable: true })
    ];
    for (const t of targets) {
      for (const ev of events) {
        try { t.dispatchEvent(ev); } catch (_) {}
      }
    }
  }

  function tryAdvanceToNextShort() {
    const now = Date.now();
    if (isAdvancing) return;
    if (now - lastAdvanceMs < 1800) return; // increased cooldown to prevent skipping
    isAdvancing = true;
    const startUrl = location.href;
    const startIdx = getActiveIndex();
    const startRenderer = getActiveRenderer();

    const attemptOnce = (step) => {
      focusShortsUi();
      switch (step) {
        case 0:
          try { pressNextShortcut(); } catch (_) {}
          break;
        case 1:
          try { sendPageDown(); } catch (_) {}
          break;
        case 2:
          try { sendArrowDown(); } catch (_) {}
          break;
        case 3:
          try { scrollToNextReel(); } catch (_) {}
          break;
        case 4:
        default:
          try {
            const shorts = getShortsContainer() || document.scrollingElement || window;
            const wheelTarget = shorts instanceof Element ? shorts : window;
            const ev = new WheelEvent('wheel', { deltaY: 500, bubbles: true, cancelable: true });
            (wheelTarget.dispatchEvent ? wheelTarget.dispatchEvent(ev) : window.dispatchEvent(ev));
          } catch (_) {}
          break;
      }
    };

    const hasAdvanced = () => {
      if (location.href !== startUrl) return true;
      const idx = getActiveIndex();
      if (idx != null && startIdx != null && idx !== startIdx) return true;
      const nowRenderer = getActiveRenderer();
      if (startRenderer && nowRenderer && nowRenderer !== startRenderer) return true;
      return false;
    };

    let tries = 0;
    const maxTries = 10;
    const tick = () => {
      if (hasAdvanced()) {
        lastAdvanceMs = Date.now();
        isAdvancing = false;
        return;
      }
      if (tries >= maxTries) {
        isAdvancing = false;
        return;
      }
      attemptOnce(tries % 5);
      tries += 1;
      setTimeout(tick, 220);
    };
    attemptOnce(0);
    setTimeout(tick, 220);
  }

  function onVideoEnded() {
    if (!isEnabled) return;
    try {
      if (currentVideo) {
        currentVideo.pause();
        currentVideo.loop = false;
      }
    } catch (_) {}
    // Allow YouTube a short moment, then advance
    setTimeout(tryAdvanceToNextShort, 50);
  }

  function unbindFromCurrentVideo() {
    if (!currentVideo) return;
    try {
      currentVideo.removeEventListener('ended', onVideoEnded);
      currentVideo.removeEventListener('timeupdate', onTimeUpdate);
      currentVideo.removeEventListener('loadedmetadata', onLoadedMetadata);
      currentVideo.removeEventListener('seeking', onSeeking);
      currentVideo.removeEventListener('pause', onPausedNearEnd);
      currentVideo.removeEventListener('play', onPlayResetNearEnd);
    } catch (_) {}
    try { if (videoLoopObserver) { videoLoopObserver.disconnect(); videoLoopObserver = null; } } catch (_) {}
    try { if (playerEndedObserver) { playerEndedObserver.disconnect(); playerEndedObserver = null; } } catch (_) {}
    currentVideo = null;
  }

  function bindToActiveVideoIfNeeded() {
    if (!isOnShortsPage() && !isShortsUiPresent()) return;
    const video = findActiveShortsVideo();
    if (!video) return;
    if (video === currentVideo) return;
    unbindFromCurrentVideo();
    currentVideo = video;
    try {
      currentVideo.loop = false;
    } catch (_) {}
    currentVideo.addEventListener('ended', onVideoEnded, { passive: true });
    currentVideo.addEventListener('timeupdate', onTimeUpdate);
    currentVideo.addEventListener('loadedmetadata', onLoadedMetadata);
    currentVideo.addEventListener('seeking', onSeeking);
    currentVideo.addEventListener('pause', onPausedNearEnd);
    currentVideo.addEventListener('play', onPlayResetNearEnd);
    // Reset state for new video
    lastKnownTime = 0;
    nearEndTriggered = false;
    observeLoopAttribute(currentVideo);
    observeEndedModeOnPlayer(currentVideo);
    // If we arrived and the player is already in ended-mode (common on SPA entry), advance now
    maybeAdvanceOnEnded();
    currentRendererEl = getActiveRenderer();
  }

  function observeLoopAttribute(video) {
    try { video.loop = false; } catch (_) {}
    try {
      if (videoLoopObserver) videoLoopObserver.disconnect();
      videoLoopObserver = new MutationObserver(() => {
        try { if (video.hasAttribute('loop') || video.loop) { video.removeAttribute('loop'); video.loop = false; } } catch (_) {}
      });
      videoLoopObserver.observe(video, { attributes: true, attributeFilter: ['loop'] });
    } catch (_) {}
  }

  function observeEndedModeOnPlayer(video) {
    const player = findShortsPlayerElement();
    if (!player) return;
    try {
      if (playerEndedObserver) playerEndedObserver.disconnect();
      playerEndedObserver = new MutationObserver(() => {
        maybeAdvanceOnEnded();
      });
      playerEndedObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
      // Also check immediately on bind
      maybeAdvanceOnEnded();
    } catch (_) {}
  }

  function findShortsPlayerElement() {
    // Prefer the active renderer's player
    const active = getActiveRenderer();
    if (active) {
      const p = active.querySelector('#shorts-player');
      if (p) return p;
    }
    return document.querySelector('ytd-player #shorts-player') || document.getElementById('shorts-player');
  }

  function maybeAdvanceOnEnded() {
    if (!isEnabled) return;
    const player = findShortsPlayerElement();
    if (!player) return;
    const ended = player.classList && player.classList.contains('ended-mode');
    if (!ended && currentVideo) {
      // Handle case where video shows cued overlay and duration is NaN while paused at 0
      try {
        const dur = Number.isFinite(currentVideo.duration) ? currentVideo.duration : NaN;
        if (!Number.isFinite(dur) && currentVideo.paused) {
          setTimeout(tryAdvanceToNextShort, 0);
          return;
        }
      } catch (_) {}
    }
    if (ended) {
      try {
        const dur = Number.isFinite(currentVideo?.duration) ? currentVideo.duration : NaN;
        const rem = Number.isFinite(dur) ? dur - (currentVideo?.currentTime ?? 0) : 0;
        if (!Number.isFinite(dur) || rem <= 1.2) {
          setTimeout(tryAdvanceToNextShort, 0);
        }
      } catch (_) {
        setTimeout(tryAdvanceToNextShort, 0);
      }
    }
  }

  function onLoadedMetadata() {
    lastKnownTime = 0;
    nearEndTriggered = false;
    try { if (currentVideo) currentVideo.loop = false; } catch (_) {}
  }

  function onSeeking() {
    // Reset near-end trigger on manual seeks
    nearEndTriggered = false;
  }

  function onTimeUpdate() {
    if (!isEnabled || !currentVideo) return;
    const v = currentVideo;
    const duration = Number.isFinite(v.duration) ? v.duration : NaN;
    if (!Number.isFinite(duration) || duration <= 0.5) {
      lastKnownTime = v.currentTime;
      return;
    }
    // Keep loop disabled in case YouTube toggles it back
    try { if (v.loop) v.loop = false; } catch (_) {}
    const t = v.currentTime;
    const remaining = duration - t;
    // If we detect wrap-around near the end (loop), advance
    if (t < lastKnownTime && (duration - lastKnownTime) < 0.25) {
      nearEndTriggered = true;
      setTimeout(tryAdvanceToNextShort, 0);
    } else if (!nearEndTriggered && remaining <= 0.2) {
      nearEndTriggered = true;
      setTimeout(tryAdvanceToNextShort, 0);
    }
    lastKnownTime = t;
  }

  function onPausedNearEnd() {
    if (!isEnabled || !currentVideo) return;
    const v = currentVideo;
    const duration = Number.isFinite(v.duration) ? v.duration : NaN;
    if (!Number.isFinite(duration) || duration <= 0.5) return;
    const remaining = duration - v.currentTime;
    if (remaining <= 0.25) {
      setTimeout(tryAdvanceToNextShort, 0);
    }
  }

  function onPlayResetNearEnd() {
    nearEndTriggered = false;
  }

  function observeShortsDom() {
    const observer = new MutationObserver(() => {
      // Re-bind when DOM changes significantly; also handle attribute changes like is-active
      bindToActiveVideoIfNeeded();
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['is-active', 'active', 'class', 'hidden', 'style']
    });
    return observer;
  }

  function observeUrlChanges() {
    // YouTube SPA navigation changes the URL; poll as a lightweight safety net
    const intervalId = setInterval(() => {
      if (location.href !== urlAtLastBind) {
        urlAtLastBind = location.href;
        // Delay slightly to allow DOM to settle
        setTimeout(() => bindToActiveVideoIfNeeded(), 50);
      }
    }, 300);
    return () => clearInterval(intervalId);
  }

  function attachNavigationListeners() {
    const onNavigateFinish = () => setTimeout(bindToActiveVideoIfNeeded, 50);
    window.addEventListener('yt-navigate-finish', onNavigateFinish);
    window.addEventListener('popstate', onNavigateFinish);
    window.addEventListener('pushstate', onNavigateFinish);
    return () => {
      window.removeEventListener('yt-navigate-finish', onNavigateFinish);
      window.removeEventListener('popstate', onNavigateFinish);
      window.removeEventListener('pushstate', onNavigateFinish);
    };
  }

  function init() {
    loadSettings();
    try { chrome.storage.onChanged.addListener(onStorageChanged); } catch (_) {}
    // Try binding immediately if already on Shorts
    if (isOnShortsPage() || isShortsUiPresent()) bindToActiveVideoIfNeeded();
    const disconnectDomObserver = observeShortsDom();
    const clearUrlPoll = observeUrlChanges();
    const detachNavListeners = attachNavigationListeners();

    window.addEventListener('beforeunload', () => {
      unbindFromCurrentVideo();
      try { disconnectDomObserver.disconnect(); } catch (_) {}
      try { clearUrlPoll(); } catch (_) {}
      try { detachNavListeners(); } catch (_) {}
    });
  }

  // Kick off after load to ensure DOM nodes are present
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('DOMContentLoaded', init, { once: true });
  }
})();


