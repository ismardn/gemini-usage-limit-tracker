const DEFAULT_REFRESH_INTERVAL_MINUTES = 5;
const EXTRACTION_COOLDOWN_MS = 60000;

let isExtractionActive = false;
let lastExtractionTimestamp = 0;

function calculateJitteredDelayMs(baseMinutes) {
  const safeMinutes = Math.max(1, parseInt(baseMinutes, 10) || DEFAULT_REFRESH_INTERVAL_MINUTES);
  const baseMs = safeMinutes * 60 * 1000;

  const maxJitterSec = Math.min(45, Math.max(20, Math.round(safeMinutes * 3)));
  const jitterSec = Math.floor(Math.random() * (maxJitterSec * 2 + 1)) - maxJitterSec;
  const jitterMs = jitterSec * 1000;

  return Math.max(60 * 1000, baseMs + jitterMs);
}

function scheduleNextAlarm(intervalMinutes) {
  const minutes = intervalMinutes || DEFAULT_REFRESH_INTERVAL_MINUTES;
  chrome.alarms.clear('check_gemini_usage', () => {
    const delayMs = calculateJitteredDelayMs(minutes);
    chrome.alarms.create('check_gemini_usage', {
      when: Date.now() + delayMs
    });
  });
}

function triggerSingleTabRefresh() {
  chrome.tabs.query({ url: 'https://gemini.google.com/*' }, (tabs) => {
    if (!tabs || tabs.length === 0) return;

    const targetTab =
      tabs.find((t) => t.active && t.lastFocusedWindow) ||
      tabs.find((t) => t.active) ||
      tabs[0];

    if (targetTab) {
      isExtractionActive = true;
      lastExtractionTimestamp = Date.now();

      chrome.tabs.sendMessage(targetTab.id, { action: 'TRIGGER_TAB_REFRESH' }).catch(() => {
        isExtractionActive = false;
      });

      setTimeout(() => {
        isExtractionActive = false;
      }, 20000);
    }
  });
}

function broadcastUsageDataToAllTabs(usageData, accountIndex) {
  chrome.tabs.query({ url: 'https://gemini.google.com/*' }, (tabs) => {
    if (tabs && tabs.length > 0) {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'SYNC_USAGE_DATA',
          data: usageData,
          accountIndex: accountIndex
        }).catch(() => {});
      });
    }
  });
}

function updateActionBadge(percentage) {
  if (percentage === null || percentage === undefined || isNaN(percentage)) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  const roundedPercentage = Math.round(percentage);
  chrome.action.setBadgeText({ text: `${roundedPercentage}%` });

  let badgeColor = '#10b981';
  if (roundedPercentage >= 85) {
    badgeColor = '#ef4444';
  } else if (roundedPercentage >= 60) {
    badgeColor = '#f59e0b';
  }

  chrome.action.setBadgeBackgroundColor({ color: badgeColor });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['refreshInterval'], (result) => {
    const minutes = result.refreshInterval || DEFAULT_REFRESH_INTERVAL_MINUTES;
    if (!result.refreshInterval) {
      chrome.storage.local.set({ refreshInterval: DEFAULT_REFRESH_INTERVAL_MINUTES });
    }
    scheduleNextAlarm(minutes);
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get(['refreshInterval'], (result) => {
    scheduleNextAlarm(result.refreshInterval || DEFAULT_REFRESH_INTERVAL_MINUTES);
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'check_gemini_usage') {
    triggerSingleTabRefresh();

    chrome.storage.local.get(['refreshInterval'], (result) => {
      const minutes = result.refreshInterval || DEFAULT_REFRESH_INTERVAL_MINUTES;
      scheduleNextAlarm(minutes);
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'CHECK_IF_EXTRACTION_NEEDED') {
    const now = Date.now();
    const timeSinceLast = now - lastExtractionTimestamp;

    chrome.storage.local.get(['last_updated'], (storageResult) => {
      const storageLastUpdated = storageResult.last_updated || 0;
      const timeSinceStorageUpdated = now - storageLastUpdated;

      if (isExtractionActive || timeSinceLast < EXTRACTION_COOLDOWN_MS || timeSinceStorageUpdated < EXTRACTION_COOLDOWN_MS) {
        sendResponse({ shouldExtract: false });
        return;
      }

      isExtractionActive = true;
      lastExtractionTimestamp = now;

      setTimeout(() => {
        isExtractionActive = false;
      }, 20000);

      sendResponse({ shouldExtract: true });
    });
    return true;
  }

  if (message.action === 'USAGE_DATA_SAVED' && message.data) {
    const usageData = message.data;
    const accountIndex = usageData.accountIndex || '0';

    isExtractionActive = false;
    lastExtractionTimestamp = Date.now();

    const storagePayload = {
      [`usage_${accountIndex}`]: usageData,
      last_active_account: accountIndex,
      last_updated: Date.now()
    };

    chrome.storage.local.set(storagePayload, () => {
      if (usageData.current && typeof usageData.current.percentage === 'number') {
        updateActionBadge(usageData.current.percentage);
      }

      broadcastUsageDataToAllTabs(usageData, accountIndex);

      sendResponse({ status: 'success' });
    });
    return true;
  }

  if (message.action === 'SET_REFRESH_INTERVAL') {
    const parsedMinutes = parseInt(message.minutes, 10) || DEFAULT_REFRESH_INTERVAL_MINUTES;
    chrome.storage.local.set({ refreshInterval: parsedMinutes }, () => {
      scheduleNextAlarm(parsedMinutes);
      sendResponse({ status: 'success', minutes: parsedMinutes });
    });
    return true;
  }

  if (message.action === 'FORCE_REFRESH') {
    triggerSingleTabRefresh();
    sendResponse({ status: 'refresh_triggered' });

    chrome.storage.local.get(['refreshInterval'], (result) => {
      const minutes = result.refreshInterval || DEFAULT_REFRESH_INTERVAL_MINUTES;
      scheduleNextAlarm(minutes);
    });
    return true;
  }
});
