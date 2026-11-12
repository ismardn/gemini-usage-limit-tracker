const DEFAULT_REFRESH_INTERVAL_MINUTES = 0;
const DEFAULT_PROMPT_REFRESH_THRESHOLD = 3;
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
  const minutes = intervalMinutes !== undefined ? parseInt(intervalMinutes, 10) : DEFAULT_REFRESH_INTERVAL_MINUTES;
  chrome.alarms.clear('check_gemini_usage', () => {
    if (minutes <= 0) {
      return;
    }
    const delayMs = calculateJitteredDelayMs(minutes);
    chrome.alarms.create('check_gemini_usage', {
      when: Date.now() + delayMs
    });
  });
}

function formatToEnglishDateString(rawString) {
  if (!rawString) return '';
  let str = String(rawString).trim();
  str = str.replace(/\b(?:le|on)\s+/gi, '');
  const months = [
    [/janv(?:\.|\b)|janvier/gi, 'Jan'],
    [/f[ée]vr(?:\.|\b)|f[ée]vrier/gi, 'Feb'],
    [/mars/gi, 'Mar'],
    [/avr(?:\.|\b)|avril/gi, 'Apr'],
    [/mai/gi, 'May'],
    [/juin/gi, 'Jun'],
    [/juil(?:\.|\b)|juillet/gi, 'Jul'],
    [/ao[uû]t/gi, 'Aug'],
    [/sept(?:\.|\b)|septembre/gi, 'Sep'],
    [/oct(?:\.|\b)|octobre/gi, 'Oct'],
    [/nov(?:\.|\b)|novembre/gi, 'Nov'],
    [/d[ée]c(?:\.|\b)|d[ée]cembre/gi, 'Dec']
  ];
  for (const [pattern, enMonth] of months) {
    str = str.replace(pattern, enMonth);
  }
  const days = [
    [/lundi/gi, 'Monday'],
    [/mardi/gi, 'Tuesday'],
    [/mercredi/gi, 'Wednesday'],
    [/jeudi/gi, 'Thursday'],
    [/vendredi/gi, 'Friday'],
    [/samedi/gi, 'Saturday'],
    [/dimanche/gi, 'Sunday']
  ];
  for (const [pattern, enDay] of days) {
    str = str.replace(pattern, enDay);
  }
  str = str.replace(/\s+[àa]\s+/gi, ' at ');
  str = str.replace(/^[àa]\s+/gi, '');
  str = str.replace(/(\d{1,2})h(\d{2})/gi, '$1:$2');
  const dateFirstMatch = str.match(/^(\d{1,2})\s+([A-Za-z]+)\s+at\s+(\d{1,2}:\d{2}.*)$/i);
  if (dateFirstMatch) {
    str = `${dateFirstMatch[2]} ${dateFirstMatch[1]} at ${dateFirstMatch[3]}`;
  }
  return str.trim();
}

function calculateResetEpochMs(currentMetrics) {
  if (!currentMetrics) return null;
  if (typeof currentMetrics.resetsAtEpochMs === 'number' && !isNaN(currentMetrics.resetsAtEpochMs)) {
    return currentMetrics.resetsAtEpochMs;
  }
  if (!currentMetrics.resetTime) return null;

  const timeString = formatToEnglishDateString(currentMetrics.resetTime);
  const match24Hour = timeString.match(/^(\d{1,2})[:.](\d{2})$/);
  const match12Hour = timeString.match(/^(\d{1,2})[:.]?(\d{2})?\s*([AaPp][Mm])$/i);

  let targetHour = null;
  let targetMinute = 0;

  if (match24Hour) {
    targetHour = parseInt(match24Hour[1], 10);
    targetMinute = parseInt(match24Hour[2], 10);
  } else if (match12Hour) {
    targetHour = parseInt(match12Hour[1], 10);
    targetMinute = match12Hour[2] ? parseInt(match12Hour[2], 10) : 0;
    const isPostMeridiem = match12Hour[3].toLowerCase() === 'pm';
    if (isPostMeridiem && targetHour < 12) targetHour += 12;
    if (!isPostMeridiem && targetHour === 12) targetHour = 0;
  }

  if (targetHour !== null) {
    const now = new Date();
    const targetDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      targetHour,
      targetMinute,
      0,
      0
    );

    let diffMs = targetDate.getTime() - now.getTime();
    if (diffMs <= 0) {
      const nextDayDiffMs = (targetDate.getTime() + 24 * 3600 * 1000) - now.getTime();
      if (nextDayDiffMs > 0 && nextDayDiffMs <= 5.5 * 3600 * 1000) {
        return targetDate.getTime() + 24 * 3600 * 1000;
      }
      return targetDate.getTime();
    }

    if (diffMs <= 5.5 * 3600 * 1000) {
      return targetDate.getTime();
    }

    return targetDate.getTime() - 24 * 3600 * 1000;
  }

  return null;
}

function scheduleResetAlarm(currentMetrics) {
  chrome.alarms.clear('check_gemini_reset', () => {
    if (!currentMetrics) return;
    const epochMs = calculateResetEpochMs(currentMetrics);
    const now = Date.now();
    if (epochMs && epochMs > now) {
      chrome.alarms.create('check_gemini_reset', {
        when: epochMs + 2000
      });
    }
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
  chrome.action.setBadgeText({ text: '' });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({ text: '' });
  chrome.storage.local.get(['refreshInterval', 'promptRefreshThreshold', 'promptCounter', 'last_active_account'], (result) => {
    const minutes = result.refreshInterval !== undefined ? result.refreshInterval : DEFAULT_REFRESH_INTERVAL_MINUTES;
    const threshold = result.promptRefreshThreshold !== undefined ? result.promptRefreshThreshold : DEFAULT_PROMPT_REFRESH_THRESHOLD;
    const updates = {};
    if (result.refreshInterval === undefined) {
      updates.refreshInterval = DEFAULT_REFRESH_INTERVAL_MINUTES;
    }
    if (result.promptRefreshThreshold === undefined) {
      updates.promptRefreshThreshold = threshold;
    }
    if (result.promptCounter === undefined) {
      updates.promptCounter = 0;
    }
    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
    scheduleNextAlarm(minutes);

    const activeAccount = result.last_active_account || '0';
    chrome.storage.local.get([`usage_${activeAccount}`, 'usage_0'], (usageRes) => {
      const usage = usageRes[`usage_${activeAccount}`] || usageRes.usage_0;
      if (usage && usage.current) {
        scheduleResetAlarm(usage.current);
      }
    });
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.action.setBadgeText({ text: '' });
  chrome.storage.local.get(['refreshInterval', 'last_updated', 'last_active_account'], (result) => {
    const minutes = result.refreshInterval !== undefined ? result.refreshInterval : DEFAULT_REFRESH_INTERVAL_MINUTES;
    scheduleNextAlarm(minutes);

    const activeAccount = result.last_active_account || '0';
    chrome.storage.local.get([`usage_${activeAccount}`, 'usage_0'], (usageRes) => {
      const usage = usageRes[`usage_${activeAccount}`] || usageRes.usage_0;
      if (usage && usage.current) {
        scheduleResetAlarm(usage.current);
      }
    });

    const now = Date.now();
    const lastUpdated = result.last_updated || 0;
    if (!lastUpdated || (now - lastUpdated > 5 * 3600 * 1000)) {
      setTimeout(triggerSingleTabRefresh, 2500);
    }
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'check_gemini_usage') {
    triggerSingleTabRefresh();

    chrome.storage.local.get(['refreshInterval'], (result) => {
      const minutes = result.refreshInterval !== undefined ? result.refreshInterval : DEFAULT_REFRESH_INTERVAL_MINUTES;
      scheduleNextAlarm(minutes);
    });
  }

  if (alarm.name === 'check_gemini_reset') {
    triggerSingleTabRefresh();
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
      updateActionBadge(null);
      broadcastUsageDataToAllTabs(usageData, accountIndex);
      scheduleResetAlarm(usageData.current);
      sendResponse({ status: 'success' });
    });
    return true;
  }

  if (message.action === 'REQUEST_RESET_REFRESH') {
    const now = Date.now();
    const timeSinceLast = now - lastExtractionTimestamp;

    if (isExtractionActive || timeSinceLast < 10000) {
      sendResponse({ shouldExtract: false });
      return true;
    }

    isExtractionActive = true;
    lastExtractionTimestamp = now;

    setTimeout(() => {
      isExtractionActive = false;
    }, 20000);

    sendResponse({ shouldExtract: true });
    return true;
  }

  if (message.action === 'SET_REFRESH_INTERVAL') {
    const rawVal = parseInt(message.minutes, 10);
    const parsedMinutes = isNaN(rawVal) ? DEFAULT_REFRESH_INTERVAL_MINUTES : rawVal;
    chrome.storage.local.set({ refreshInterval: parsedMinutes }, () => {
      scheduleNextAlarm(parsedMinutes);
      sendResponse({ status: 'success', minutes: parsedMinutes });
    });
    return true;
  }

  if (message.action === 'SET_PROMPT_THRESHOLD') {
    const parsedThreshold = parseInt(message.threshold, 10);
    const safeThreshold = isNaN(parsedThreshold) ? DEFAULT_PROMPT_REFRESH_THRESHOLD : parsedThreshold;
    chrome.storage.local.set({ promptRefreshThreshold: safeThreshold }, () => {
      sendResponse({ status: 'success', threshold: safeThreshold });
    });
    return true;
  }

  if (message.action === 'FORCE_REFRESH') {
    triggerSingleTabRefresh();
    sendResponse({ status: 'refresh_triggered' });

    chrome.storage.local.get(['refreshInterval'], (result) => {
      const minutes = result.refreshInterval !== undefined ? result.refreshInterval : DEFAULT_REFRESH_INTERVAL_MINUTES;
      scheduleNextAlarm(minutes);
    });
    return true;
  }
});
