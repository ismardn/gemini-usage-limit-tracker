(() => {
  'use strict';

  let activeAccountIndex = getActiveAccountIndex();
  let latestUsageData = null;
  let isExtractionInProgress = false;
  let countdownIntervalIdentifier = null;
  let postPromptRefreshTimer = null;

  function getActiveAccountIndex() {
    const pathnameMatch = window.location.pathname.match(/\/u\/(\d+)/);
    if (pathnameMatch) return pathnameMatch[1];
    const baseElement = document.querySelector('base')?.getAttribute('href') || '';
    const baseMatch = baseElement.match(/\/u\/(\d+)/);
    if (baseMatch) return baseMatch[1];
    return '0';
  }

  function getQuotaStatusClass(percentageValue) {
    if (percentageValue >= 85) return 'status-red';
    if (percentageValue >= 60) return 'status-orange';
    return 'status-green';
  }

  function isNavigationSidebarOpen() {
    const chatAppElement = document.querySelector('chat-app');
    if (!chatAppElement || !chatAppElement.classList.contains('side-nav-open')) {
      return false;
    }

    const bardSidenavElement = document.querySelector('bard-sidenav');
    if (bardSidenavElement && bardSidenavElement.classList.contains('collapsed')) {
      return false;
    }

    const historyContainerElement = document.querySelector('.sidenav-with-history-container');
    if (historyContainerElement && historyContainerElement.classList.contains('collapsed')) {
      return false;
    }

    if (bardSidenavElement) {
      const boundingRectangle = bardSidenavElement.getBoundingClientRect();
      if (boundingRectangle.width > 0 && boundingRectangle.width < 140) {
        return false;
      }
    }

    return true;
  }

  function synchronizeSidebarWidgetVisibility() {
    const sidebarOpenState = isNavigationSidebarOpen();
    const sidebarBarWidget = document.getElementById('gem-usage-sidebar-widget');
    const collapsedCircleWidget = document.getElementById('gem-usage-circle-widget');

    if (sidebarBarWidget) {
      const targetDisplay = sidebarOpenState ? 'block' : 'none';
      if (sidebarBarWidget.style.display !== targetDisplay) {
        sidebarBarWidget.style.setProperty('display', targetDisplay, 'important');
      }
    }

    if (collapsedCircleWidget) {
      const targetDisplay = sidebarOpenState ? 'none' : 'inline-flex';
      if (collapsedCircleWidget.style.display !== targetDisplay) {
        collapsedCircleWidget.style.setProperty('display', targetDisplay, 'important');
      }
    }
  }

  function formatRemainingTime(currentUsageMetrics) {
    if (!currentUsageMetrics) return '--';

    if (currentUsageMetrics.resetsAtEpochMs) {
      const differenceMs = currentUsageMetrics.resetsAtEpochMs - Date.now();
      if (differenceMs <= 0) return 'Ready to reset';
      const totalMinutesRemaining = Math.floor(differenceMs / 60000);
      const hoursRemaining = Math.floor(totalMinutesRemaining / 60);
      const minutesRemaining = totalMinutesRemaining % 60;
      if (hoursRemaining > 0) return `${hoursRemaining}h ${minutesRemaining}m remaining`;
      if (minutesRemaining > 0) return `${minutesRemaining}m remaining`;
      return '< 1m remaining';
    }

    if (currentUsageMetrics.resetTime) {
      const timeString = currentUsageMetrics.resetTime;
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
        const currentDate = new Date();
        const targetDate = new Date(
          currentDate.getFullYear(),
          currentDate.getMonth(),
          currentDate.getDate(),
          targetHour,
          targetMinute,
          0
        );
        if (targetDate.getTime() <= currentDate.getTime()) {
          targetDate.setDate(targetDate.getDate() + 1);
        }
        const differenceMs = targetDate.getTime() - currentDate.getTime();
        const totalMinutesRemaining = Math.floor(differenceMs / 60000);
        const hoursRemaining = Math.floor(totalMinutesRemaining / 60);
        const minutesRemaining = totalMinutesRemaining % 60;
        if (hoursRemaining > 0) return `${hoursRemaining}h ${minutesRemaining}m remaining`;
        if (minutesRemaining > 0) return `${minutesRemaining}m remaining`;
        return '< 1m remaining';
      }

      return `Resets at ${timeString}`;
    }

    return '--';
  }

  function executeUsageExtraction(forceImmediate = false) {
    if (isExtractionInProgress && !forceImmediate) return;
    isExtractionInProgress = true;

    activeAccountIndex = getActiveAccountIndex();
    const usageEndpointUrl = `https://gemini.google.com/u/${activeAccountIndex}/usage`;

    const existingExtractionFrame = document.getElementById('gem-usage-silent-frame');
    if (existingExtractionFrame) existingExtractionFrame.remove();

    const extractionIframe = document.createElement('iframe');
    extractionIframe.id = 'gem-usage-silent-frame';
    extractionIframe.src = usageEndpointUrl;
    extractionIframe.style.cssText =
      'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;border:none;';
    document.body.appendChild(extractionIframe);

    const safetyTimeoutIdentifier = setTimeout(() => {
      if (isExtractionInProgress) {
        isExtractionInProgress = false;
        const staleFrame = document.getElementById('gem-usage-silent-frame');
        if (staleFrame) staleFrame.remove();
      }
    }, 18000);

    const handleExtractionMessage = (messageEvent) => {
      if (messageEvent.data && messageEvent.data.type === 'GEMINI_USAGE_EXTRACTED') {
        clearTimeout(safetyTimeoutIdentifier);
        window.removeEventListener('message', handleExtractionMessage);
        isExtractionInProgress = false;

        latestUsageData = messageEvent.data.payload;
        renderUsageInterface();

        // Forward to background to save and broadcast to all other open tabs immediately
        chrome.runtime.sendMessage({
          action: 'USAGE_DATA_SAVED',
          data: latestUsageData
        }).catch(() => {});

        setTimeout(() => {
          const completedFrame = document.getElementById('gem-usage-silent-frame');
          if (completedFrame) completedFrame.remove();
        }, 1000);
      }
    };

    window.addEventListener('message', handleExtractionMessage);
  }

  function mountWidgetsToDOM() {
    const sidebarContainer =
      document.querySelector('.sidenav-with-history-container .top-action-list') ||
      document.querySelector('.sidenav-with-history-container .overflow-container') ||
      document.querySelector('.sidenav-with-history-container');
    const menuButtonContainer = document.querySelector('.side-nav-menu-button');

    // If Gemini's interface structure is not ready yet, postpone mounting
    if (!sidebarContainer && !menuButtonContainer) {
      return false;
    }

    let sidebarBarWidget = document.getElementById('gem-usage-sidebar-widget');
    if (!sidebarBarWidget) {
      sidebarBarWidget = document.createElement('div');
      sidebarBarWidget.id = 'gem-usage-sidebar-widget';
      sidebarBarWidget.title = 'Click for Gemini quota details';
      sidebarBarWidget.innerHTML = `
        <div class="gem-usage-bar-row">
          <div class="gem-usage-progress-track">
            <div class="gem-usage-progress-fill status-green" id="gem-sidebar-progress-fill" style="width: 0%;"></div>
          </div>
          <span class="gem-usage-pct-text status-green" id="gem-sidebar-pct-text">--%</span>
        </div>
        <div class="gem-usage-info-row">
          <span class="gem-usage-time-text" id="gem-sidebar-time-text">⏱ Loading...</span>
          <span class="gem-usage-clock-text" id="gem-sidebar-clock-text"></span>
        </div>
      `;

      sidebarBarWidget.addEventListener('click', () => {
        openUsageDetailsModal();
      });
    }

    if (sidebarContainer && !sidebarContainer.contains(sidebarBarWidget)) {
      sidebarContainer.prepend(sidebarBarWidget);
    }

    let collapsedCircleWidget = document.getElementById('gem-usage-circle-widget');
    if (!collapsedCircleWidget) {
      collapsedCircleWidget = document.createElement('div');
      collapsedCircleWidget.id = 'gem-usage-circle-widget';

      const currentMetrics = latestUsageData?.current;
      const hasCurrent = currentMetrics && typeof currentMetrics.percentage === 'number' && !isNaN(currentMetrics.percentage);
      const initialPercentage = hasCurrent ? Math.round(currentMetrics.percentage) : null;
      const pctDisplay = initialPercentage !== null ? `${initialPercentage}%` : '--%';
      const labelDisplay = initialPercentage !== null ? `${initialPercentage}` : '--';
      const statusClass = initialPercentage !== null ? getQuotaStatusClass(initialPercentage) : 'status-green';
      const countdownString = formatRemainingTime(currentMetrics);
      const clockString = currentMetrics?.resetTime ? ` (${currentMetrics.resetTime})` : '';

      const circumferenceConstant = 69.11;
      const initialOffset = initialPercentage !== null
        ? circumferenceConstant - (initialPercentage / 100) * circumferenceConstant
        : circumferenceConstant;

      collapsedCircleWidget.innerHTML = `
        <svg class="gem-usage-svg-ring" viewBox="0 0 28 28">
          <circle class="gem-usage-svg-bg-circle" cx="14" cy="14" r="11"></circle>
          <circle class="gem-usage-svg-bar-circle ${statusClass}" id="gem-circle-bar" cx="14" cy="14" r="11"
                  stroke-dasharray="69.11" stroke-dashoffset="${initialOffset}"></circle>
        </svg>
        <span class="gem-usage-circle-label" id="gem-circle-label">${labelDisplay}</span>
        <div class="gem-usage-circle-tooltip" id="gem-circle-tooltip">
          <div id="gem-tooltip-pct">5h Usage: ${pctDisplay}</div>
          <div id="gem-tooltip-countdown">Reset: ${countdownString}${clockString}</div>
        </div>
      `;

      collapsedCircleWidget.addEventListener('click', () => {
        openUsageDetailsModal();
      });

      // Update hover tooltip immediately when hovered
      collapsedCircleWidget.addEventListener('mouseenter', () => {
        // 1. Immediately update any tooltip elements inside this widget
        const targetPct = (latestUsageData?.current && typeof latestUsageData.current.percentage === 'number')
          ? `5h Usage: ${Math.round(latestUsageData.current.percentage)}%`
          : '5h Usage: --%';
        const innerPct = collapsedCircleWidget.querySelector('#gem-tooltip-pct');
        if (innerPct) {
          innerPct.textContent = targetPct;
        }

        const innerCountdown = collapsedCircleWidget.querySelector('#gem-tooltip-countdown');
        if (innerCountdown && latestUsageData?.current) {
          const cd = formatRemainingTime(latestUsageData.current);
          const clk = latestUsageData.current.resetTime ? ` (${latestUsageData.current.resetTime})` : '';
          innerCountdown.textContent = `Reset: ${cd}${clk}`;
        }

        // Also ensure label and progress bar color match immediately
        if (latestUsageData?.current && typeof latestUsageData.current.percentage === 'number') {
          const pct = Math.round(latestUsageData.current.percentage);
          const statusCls = getQuotaStatusClass(pct);
          const innerLabel = collapsedCircleWidget.querySelector('#gem-circle-label');
          if (innerLabel) {
            innerLabel.textContent = `${pct}`;
          }
          const innerBar = collapsedCircleWidget.querySelector('#gem-circle-bar');
          if (innerBar) {
            innerBar.setAttribute('class', `gem-usage-svg-bar-circle ${statusCls}`);
          }
        }

        // 2. Refresh from local storage to catch any background/popup updates
        loadPersistedUsageData();
      });
    }

    if (menuButtonContainer && !menuButtonContainer.contains(collapsedCircleWidget)) {
      menuButtonContainer.appendChild(collapsedCircleWidget);
    }

    ensureDetailsModalCreated();
    synchronizeSidebarWidgetVisibility();

    if (latestUsageData) {
      renderUsageInterface();
    }
    return true;
  }

  function renderUsageInterface() {
    if (!latestUsageData) return;

    const currentMetrics = latestUsageData.current;
    const weeklyMetrics = latestUsageData.weekly;

    const hasCurrent = currentMetrics && typeof currentMetrics.percentage === 'number' && !isNaN(currentMetrics.percentage);
    const currentPercentage = hasCurrent ? Math.round(currentMetrics.percentage) : 0;
    const currentPctString = hasCurrent ? `${currentPercentage}%` : '--%';
    const currentStatusClass = getQuotaStatusClass(currentPercentage);
    const countdownFormattedString = formatRemainingTime(currentMetrics);
    const clockFormattedString = currentMetrics?.resetTime ? currentMetrics.resetTime : '';

    const percentageTextElement = document.getElementById('gem-sidebar-pct-text');
    if (percentageTextElement && percentageTextElement.textContent !== currentPctString) {
      percentageTextElement.textContent = currentPctString;
      percentageTextElement.className = `gem-usage-pct-text ${currentStatusClass}`;
    }

    const progressFillElement = document.getElementById('gem-sidebar-progress-fill');
    if (progressFillElement) {
      const targetWidth = `${currentPercentage}%`;
      if (progressFillElement.style.width !== targetWidth) {
        progressFillElement.style.width = targetWidth;
        progressFillElement.className = `gem-usage-progress-fill ${currentStatusClass}`;
      }
    }

    const timeTextElement = document.getElementById('gem-sidebar-time-text');
    const targetTimeText = `⏱ ${countdownFormattedString}`;
    if (timeTextElement && timeTextElement.textContent !== targetTimeText) {
      timeTextElement.textContent = targetTimeText;
    }

    const clockTextElement = document.getElementById('gem-sidebar-clock-text');
    if (clockTextElement && clockTextElement.textContent !== clockFormattedString) {
      clockTextElement.textContent = clockFormattedString;
    }

    // Circular gauge elements (update ALL instances in case of multiple containers)
    const targetCircleLabel = hasCurrent ? `${currentPercentage}` : '--';
    const circleLabelElements = document.querySelectorAll('#gem-circle-label, .gem-usage-circle-label');
    circleLabelElements.forEach((el) => {
      if (el.textContent !== targetCircleLabel) {
        el.textContent = targetCircleLabel;
      }
    });

    const circumferenceConstant = 69.11;
    const strokeOffset = String(circumferenceConstant - (currentPercentage / 100) * circumferenceConstant);
    const targetBarClass = `gem-usage-svg-bar-circle ${currentStatusClass}`;
    const circleBarElements = document.querySelectorAll('#gem-circle-bar, .gem-usage-svg-bar-circle');
    circleBarElements.forEach((el) => {
      if (el.style.strokeDashoffset !== strokeOffset) {
        el.style.strokeDashoffset = strokeOffset;
      }
      if (el.getAttribute('class') !== targetBarClass) {
        el.setAttribute('class', targetBarClass);
      }
    });

    // Tooltip elements (update ALL instances in DOM)
    const targetTooltipPct = `5h Usage: ${currentPctString}`;
    const tooltipPctElements = document.querySelectorAll('#gem-tooltip-pct');
    tooltipPctElements.forEach((el) => {
      if (el.textContent !== targetTooltipPct) {
        el.textContent = targetTooltipPct;
      }
    });

    const clockSuffix = clockFormattedString ? ` (${clockFormattedString})` : '';
    const targetCountdownText = `Reset: ${countdownFormattedString}${clockSuffix}`;
    const tooltipCountdownElements = document.querySelectorAll('#gem-tooltip-countdown');
    tooltipCountdownElements.forEach((el) => {
      if (el.textContent !== targetCountdownText) {
        el.textContent = targetCountdownText;
      }
    });

    updateModalDataFields();
  }

  function ensureDetailsModalCreated() {
    if (document.getElementById('gem-usage-modal-backdrop')) return;

    const modalBackdropElement = document.createElement('div');
    modalBackdropElement.id = 'gem-usage-modal-backdrop';
    modalBackdropElement.innerHTML = `
      <div id="gem-usage-modal">
        <div class="gem-modal-header">
          <div class="gem-modal-title">Gemini Usage Quotas</div>
          <button class="gem-modal-close-btn" id="gem-modal-close-btn" title="Close">✕</button>
        </div>

        <div class="gem-modal-card">
          <div class="gem-modal-card-title">
            <span>Rolling Window (5 Hours)</span>
            <span class="gem-usage-pct-text status-green" id="gem-modal-cur-badge">--%</span>
          </div>
          <div class="gem-usage-progress-track" style="margin-bottom:8px;">
            <div class="gem-usage-progress-fill status-green" id="gem-modal-cur-fill" style="width:0%;"></div>
          </div>
          <div class="gem-modal-row">
            <span>Time remaining:</span>
            <strong id="gem-modal-cur-countdown">--</strong>
          </div>
          <div class="gem-modal-row">
            <span>Reset time:</span>
            <span id="gem-modal-cur-reset">--</span>
          </div>
        </div>

        <div class="gem-modal-card">
          <div class="gem-modal-card-title">
            <span>Weekly Limit</span>
            <span class="gem-usage-pct-text status-green" id="gem-modal-week-badge">--%</span>
          </div>
          <div class="gem-usage-progress-track" style="margin-bottom:8px;">
            <div class="gem-usage-progress-fill status-green" id="gem-modal-week-fill" style="width:0%;"></div>
          </div>
          <div class="gem-modal-row">
            <span>Resets on:</span>
            <span id="gem-modal-week-reset">--</span>
          </div>
        </div>

        <div class="gem-modal-card">
          <div class="gem-modal-row">
            <span>Active account:</span>
            <strong id="gem-modal-acc">/u/${activeAccountIndex}</strong>
          </div>
          <div class="gem-modal-row" style="align-items:center;">
            <span>Refresh frequency:</span>
            <select id="gem-modal-interval-select" style="background:#0f172a;color:#f8fafc;border:1px solid rgba(255,255,255,0.15);padding:3px 8px;border-radius:6px;font-size:11px;">
              <option value="5">Every 5 minutes</option>
              <option value="10">Every 10 minutes</option>
              <option value="15">Every 15 minutes</option>
              <option value="30">Every 30 minutes</option>
            </select>
          </div>
        </div>

        <div class="gem-modal-footer-actions">
          <button class="gem-modal-btn gem-modal-btn-primary" id="gem-modal-refresh-btn">
            <span>Refresh now</span>
          </button>
        </div>
      </div>
    `;

    modalBackdropElement.addEventListener('click', (event) => {
      if (event.target === modalBackdropElement) dismissUsageDetailsModal();
    });

    modalBackdropElement.querySelector('#gem-modal-close-btn').addEventListener('click', dismissUsageDetailsModal);

    modalBackdropElement.querySelector('#gem-modal-refresh-btn').addEventListener('click', () => {
      executeUsageExtraction(true);
    });

    const intervalSelectElement = modalBackdropElement.querySelector('#gem-modal-interval-select');
    chrome.storage.local.get(['refreshInterval'], (storageResult) => {
      if (storageResult.refreshInterval) {
        intervalSelectElement.value = String(storageResult.refreshInterval);
      }
    });

    intervalSelectElement.addEventListener('change', (changeEvent) => {
      chrome.runtime.sendMessage({
        action: 'SET_REFRESH_INTERVAL',
        minutes: parseInt(changeEvent.target.value, 10)
      });
    });

    document.addEventListener('keydown', (keyboardEvent) => {
      if (keyboardEvent.key === 'Escape') dismissUsageDetailsModal();
    });

    document.body.appendChild(modalBackdropElement);
  }

  function openUsageDetailsModal() {
    ensureDetailsModalCreated();
    updateModalDataFields();
    document.getElementById('gem-usage-modal-backdrop')?.classList.add('active');
  }

  function dismissUsageDetailsModal() {
    document.getElementById('gem-usage-modal-backdrop')?.classList.remove('active');
  }

  function updateModalDataFields() {
    const backdropElement = document.getElementById('gem-usage-modal-backdrop');
    if (!backdropElement) return;

    const currentMetrics = latestUsageData?.current;
    const weeklyMetrics = latestUsageData?.weekly;

    const currentPercentage = currentMetrics ? currentMetrics.percentage : 0;
    const currentStatusClass = getQuotaStatusClass(currentPercentage);

    const currentBadgeElement = backdropElement.querySelector('#gem-modal-cur-badge');
    if (currentBadgeElement) {
      currentBadgeElement.textContent = `${currentPercentage}%`;
      currentBadgeElement.className = `gem-usage-pct-text ${currentStatusClass}`;
    }

    const currentFillElement = backdropElement.querySelector('#gem-modal-cur-fill');
    if (currentFillElement) {
      currentFillElement.style.width = `${currentPercentage}%`;
      currentFillElement.className = `gem-usage-progress-fill ${currentStatusClass}`;
    }

    const currentCountdownElement = backdropElement.querySelector('#gem-modal-cur-countdown');
    if (currentCountdownElement) {
      currentCountdownElement.textContent = formatRemainingTime(currentMetrics);
    }

    const currentResetElement = backdropElement.querySelector('#gem-modal-cur-reset');
    if (currentResetElement) {
      currentResetElement.textContent = currentMetrics?.resetTime || '--';
    }

    const weeklyPercentage = weeklyMetrics ? weeklyMetrics.percentage : 0;
    const weeklyStatusClass = getQuotaStatusClass(weeklyPercentage);

    const weeklyBadgeElement = backdropElement.querySelector('#gem-modal-week-badge');
    if (weeklyBadgeElement) {
      weeklyBadgeElement.textContent = `${weeklyPercentage}%`;
      weeklyBadgeElement.className = `gem-usage-pct-text ${weeklyStatusClass}`;
    }

    const weeklyFillElement = backdropElement.querySelector('#gem-modal-week-fill');
    if (weeklyFillElement) {
      weeklyFillElement.style.width = `${weeklyPercentage}%`;
      weeklyFillElement.className = `gem-usage-progress-fill ${weeklyStatusClass}`;
    }

    const weeklyResetElement = backdropElement.querySelector('#gem-modal-week-reset');
    if (weeklyResetElement) {
      weeklyResetElement.textContent = weeklyMetrics?.resetTime || '--';
    }

    const accountIndicatorElement = backdropElement.querySelector('#gem-modal-acc');
    if (accountIndicatorElement) {
      accountIndicatorElement.textContent = `/u/${activeAccountIndex}`;
    }
  }

  function registerPromptSubmissionListeners() {
    document.addEventListener('keydown', (keyboardEvent) => {
      if (keyboardEvent.key === 'Enter' && !keyboardEvent.shiftKey) {
        const activeFocusedElement = document.activeElement;
        if (
          activeFocusedElement &&
          (activeFocusedElement.tagName === 'TEXTAREA' ||
            activeFocusedElement.isContentEditable ||
            activeFocusedElement.getAttribute('role') === 'textbox')
        ) {
          queuePostPromptUsageRefresh();
        }
      }
    }, true);

    document.addEventListener('click', (mouseClickEvent) => {
      const sendButtonElement = mouseClickEvent.target.closest(
        '[aria-label*="Envoyer"], [aria-label*="Send"], .send-button'
      );
      if (sendButtonElement) {
        queuePostPromptUsageRefresh();
      }
    }, true);
  }

  function queuePostPromptUsageRefresh() {
    if (postPromptRefreshTimer) clearTimeout(postPromptRefreshTimer);
    // Add jitter around 10 seconds: 8s to 13s to prevent robotic periodicity
    const postPromptDelayMs = 8000 + Math.floor(Math.random() * 5000);
    postPromptRefreshTimer = setTimeout(() => {
      executeUsageExtraction(false);
    }, postPromptDelayMs);
  }

  function registerDomAndNavigationObservers() {
    let debounceTimer = null;
    const scheduleSyncAndMount = () => {
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        mountWidgetsToDOM();
        synchronizeSidebarWidgetVisibility();
      }, 80);
    };

    const domStructureObserver = new MutationObserver((mutations) => {
      // Ignore mutations originating from tracker elements
      let isRelevant = false;
      for (const mutation of mutations) {
        const target = mutation.target;
        if (target && target.id && (String(target.id).startsWith('gem-') || String(target.id).startsWith('gemini-'))) {
          continue;
        }
        isRelevant = true;
        break;
      }

      if (isRelevant) {
        scheduleSyncAndMount();
      }
    });

    const rootTarget = document.querySelector('chat-app') || document.body;
    domStructureObserver.observe(rootTarget, {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      subtree: true
    });

    document.addEventListener('click', (mouseClickEvent) => {
      const sidebarToggleButton = mouseClickEvent.target.closest(
        'button[aria-label*="barre latérale"], button[aria-label*="sidenav"], .close-sidenav-button, .side-nav-sparkle-button, [data-test-id="side-nav-sparkle-button"]'
      );
      if (sidebarToggleButton) {
        setTimeout(scheduleSyncAndMount, 50);
        setTimeout(scheduleSyncAndMount, 200);
        setTimeout(scheduleSyncAndMount, 400);
      }
    }, true);

    window.addEventListener('resize', () => {
      synchronizeSidebarWidgetVisibility();
    });

    let recordedCurrentUrl = window.location.href;
    const verifyUrlChange = () => {
      if (window.location.href !== recordedCurrentUrl) {
        recordedCurrentUrl = window.location.href;
        const detectedAccount = getActiveAccountIndex();
        if (detectedAccount !== activeAccountIndex) {
          activeAccountIndex = detectedAccount;
          loadPersistedUsageData();
          executeUsageExtraction(true);
        }
        scheduleSyncAndMount();
      }
    };

    window.addEventListener('popstate', verifyUrlChange);
    setInterval(verifyUrlChange, 1500);
  }

  function loadPersistedUsageData() {
    activeAccountIndex = getActiveAccountIndex();
    chrome.storage.local.get(null, (storageResult) => {
      if (!storageResult) return;
      const accountKey = `usage_${activeAccountIndex}`;
      const fallbackAccount = storageResult.last_active_account || '0';
      const fallbackKey = `usage_${fallbackAccount}`;

      const savedData = storageResult[accountKey] || storageResult[fallbackKey];
      if (savedData) {
        latestUsageData = savedData;
        renderUsageInterface();
      }
    });
  }

  // Listen to storage updates from background or sibling tabs
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      const hasUsageChange = Object.keys(changes).some(
        (key) => key.startsWith('usage_') || key === 'last_active_account'
      );
      if (hasUsageChange) {
        loadPersistedUsageData();
      }
    }
  });

  chrome.runtime.onMessage.addListener((incomingMessage) => {
    if (incomingMessage.action === 'SYNC_USAGE_DATA' && incomingMessage.data) {
      latestUsageData = incomingMessage.data;
      renderUsageInterface();
      return;
    }

    if (incomingMessage.action === 'TRIGGER_TAB_REFRESH') {
      executeUsageExtraction(true);
      return;
    }
  });

  function initializeApplication() {
    if (window.self !== window.top) return;

    loadPersistedUsageData();
    mountWidgetsToDOM();
    registerDomAndNavigationObservers();
    registerPromptSubmissionListeners();

    countdownIntervalIdentifier = setInterval(() => {
      if (latestUsageData) {
        renderUsageInterface();
      }
      // Periodically sync from storage to keep everything aligned
      loadPersistedUsageData();
    }, 10000);

    // Coordinate with background so only ONE tab runs extraction on load
    setTimeout(() => {
      chrome.runtime.sendMessage({ action: 'CHECK_IF_EXTRACTION_NEEDED' }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response && response.shouldExtract) {
          executeUsageExtraction(false);
        }
      });
    }, 3500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApplication);
  } else {
    initializeApplication();
  }
})();
