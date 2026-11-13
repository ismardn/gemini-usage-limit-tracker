(() => {
  'use strict';

  let activeAccountIndex = getActiveAccountIndex();
  let latestUsageData = null;
  let isExtractionInProgress = false;
  let countdownIntervalIdentifier = null;
  let isPromptGenerating = false;
  let lastPromptCompletionTimestamp = 0;

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
      const timeString = formatToEnglishDateString(currentUsageMetrics.resetTime);
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

        let differenceMs = targetDate.getTime() - currentDate.getTime();

        if (differenceMs <= 0) {
          const nextDayDiffMs = (targetDate.getTime() + 24 * 3600 * 1000) - currentDate.getTime();
          if (nextDayDiffMs > 0 && nextDayDiffMs <= 5.5 * 3600 * 1000) {
            differenceMs = nextDayDiffMs;
          } else {
            return 'Ready to reset';
          }
        }

        if (differenceMs > 5.5 * 3600 * 1000) {
          return 'Ready to reset';
        }

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

  function calculateElapsedPercentage5h(currentUsageMetrics) {
    if (!currentUsageMetrics) return null;

    let differenceMs = null;
    if (currentUsageMetrics.resetsAtEpochMs) {
      differenceMs = currentUsageMetrics.resetsAtEpochMs - Date.now();
    } else if (currentUsageMetrics.resetTime) {
      const timeString = formatToEnglishDateString(currentUsageMetrics.resetTime);
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

        differenceMs = targetDate.getTime() - currentDate.getTime();
        if (differenceMs <= 0) {
          const nextDayDiffMs = (targetDate.getTime() + 24 * 3600 * 1000) - currentDate.getTime();
          if (nextDayDiffMs > 0 && nextDayDiffMs <= 5.5 * 3600 * 1000) {
            differenceMs = nextDayDiffMs;
          } else {
            differenceMs = 0;
          }
        }
      }
    }

    if (differenceMs === null) return null;

    const WINDOW_5H_MS = 5 * 3600 * 1000;
    if (differenceMs <= 0) return 100;
    if (differenceMs >= WINDOW_5H_MS) return 0;

    const elapsedMs = WINDOW_5H_MS - differenceMs;
    return Math.min(100, Math.max(0, Math.round((elapsedMs / WINDOW_5H_MS) * 100)));
  }

  function calculateElapsedPercentageWeekly(weeklyMetrics) {
    if (!weeklyMetrics || !weeklyMetrics.resetTime) return null;

    const timeString = formatToEnglishDateString(weeklyMetrics.resetTime);
    const now = new Date();
    const cleaned = timeString.replace(/\bat\b/gi, ' ').replace(/\s+/g, ' ').trim();

    const withYear = `${cleaned} ${now.getFullYear()}`;
    let parsedEpoch = Date.parse(withYear);
    let targetTime = null;

    if (!isNaN(parsedEpoch)) {
      let target = new Date(parsedEpoch);
      if (target.getTime() < now.getTime() - 24 * 3600 * 1000) {
        target.setFullYear(now.getFullYear() + 1);
      }
      targetTime = target.getTime();
    } else {
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayMatch = cleaned.match(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+(\d{1,2})[:.](\d{2})?(?:\s*([AaPp][Mm]))?/i);
      if (dayMatch) {
        const targetDayIndex = days.indexOf(dayMatch[1].toLowerCase());
        let hour = parseInt(dayMatch[2], 10);
        const minute = dayMatch[3] ? parseInt(dayMatch[3], 10) : 0;
        const isPm = dayMatch[4] && dayMatch[4].toLowerCase() === 'pm';
        if (isPm && hour < 12) hour += 12;
        if (dayMatch[4] && dayMatch[4].toLowerCase() === 'am' && hour === 12) hour = 0;

        let daysUntil = (targetDayIndex - now.getDay() + 7) % 7;
        if (daysUntil === 0) {
          const todayTarget = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0);
          if (todayTarget.getTime() <= now.getTime()) {
            daysUntil = 7;
          }
        }
        const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntil, hour, minute, 0);
        targetTime = target.getTime();
      }
    }

    if (!targetTime) return null;

    const WINDOW_WEEKLY_MS = 7 * 24 * 3600 * 1000;
    const differenceMs = targetTime - now.getTime();
    if (differenceMs <= 0) return 100;
    if (differenceMs >= WINDOW_WEEKLY_MS) return 0;

    const elapsedMs = WINDOW_WEEKLY_MS - differenceMs;
    return Math.min(100, Math.max(0, Math.round((elapsedMs / WINDOW_WEEKLY_MS) * 100)));
  }

  function setSidebarRefreshSpinning(isSpinning) {
    const refreshBtn = document.getElementById('gem-sidebar-refresh-btn');
    if (!refreshBtn) return;
    if (isSpinning) {
      refreshBtn.classList.add('spinning');
      setTimeout(() => {
        refreshBtn.classList.remove('spinning');
      }, 10000);
    } else {
      refreshBtn.classList.remove('spinning');
    }
  }

  function setModalRefreshSpinning(isSpinning) {
    const refreshBtn = document.getElementById('gem-modal-refresh-btn');
    if (!refreshBtn) return;
    if (isSpinning) {
      refreshBtn.classList.add('spinning');
      setTimeout(() => {
        refreshBtn.classList.remove('spinning');
      }, 10000);
    } else {
      refreshBtn.classList.remove('spinning');
    }
  }

  function executeUsageExtraction(forceImmediate = false) {
    if (isExtractionInProgress && !forceImmediate) return;
    isExtractionInProgress = true;
    setSidebarRefreshSpinning(true);
    setModalRefreshSpinning(true);

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
        setSidebarRefreshSpinning(false);
        setModalRefreshSpinning(false);
        const staleFrame = document.getElementById('gem-usage-silent-frame');
        if (staleFrame) staleFrame.remove();
      }
    }, 18000);

    const handleExtractionMessage = (messageEvent) => {
      if (messageEvent.data && messageEvent.data.type === 'GEMINI_USAGE_EXTRACTED') {
        clearTimeout(safetyTimeoutIdentifier);
        window.removeEventListener('message', handleExtractionMessage);
        isExtractionInProgress = false;
        setSidebarRefreshSpinning(false);
        setModalRefreshSpinning(false);

        latestUsageData = messageEvent.data.payload;
        renderUsageInterface();

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
          <span class="gem-usage-pct-text status-green" id="gem-sidebar-pct-text">--%</span>
          <div class="gem-usage-progress-track">
            <div class="gem-usage-progress-fill status-green" id="gem-sidebar-progress-fill" style="width: 0%;"></div>
            <div class="gem-usage-time-marker" id="gem-sidebar-cur-marker" title="Time elapsed"></div>
          </div>
          <button class="gem-usage-sidebar-refresh-btn" id="gem-sidebar-refresh-btn" type="button" title="Refresh quotas">
            <svg viewBox="0 0 24 24" class="gem-usage-refresh-icon">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-1.19"/>
            </svg>
          </button>
        </div>
        <div class="gem-usage-info-row">
          <span class="gem-usage-time-text" id="gem-sidebar-time-text">⏱ Loading...</span>
          <span class="gem-usage-clock-text" id="gem-sidebar-clock-text"></span>
        </div>
      `;

      const sidebarRefreshBtn = sidebarBarWidget.querySelector('#gem-sidebar-refresh-btn');
      if (sidebarRefreshBtn) {
        sidebarRefreshBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          event.preventDefault();
          setSidebarRefreshSpinning(true);
          executeUsageExtraction(true);
        });
      }

      sidebarBarWidget.addEventListener('click', (event) => {
        if (event.target.closest('#gem-sidebar-refresh-btn')) return;
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
      const clockString = currentMetrics?.resetTime ? ` (${formatToEnglishDateString(currentMetrics.resetTime)})` : '';

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

      collapsedCircleWidget.addEventListener('mouseenter', () => {
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
          const clk = latestUsageData.current.resetTime ? ` (${formatToEnglishDateString(latestUsageData.current.resetTime)})` : '';
          innerCountdown.textContent = `Reset: ${cd}${clk}`;
        }

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
    const clockFormattedString = currentMetrics?.resetTime ? formatToEnglishDateString(currentMetrics.resetTime) : '';

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

    const elapsed5hPct = calculateElapsedPercentage5h(currentMetrics);
    const sidebarMarker = document.getElementById('gem-sidebar-cur-marker');
    if (sidebarMarker) {
      if (elapsed5hPct !== null) {
        sidebarMarker.style.left = `${elapsed5hPct}%`;
        sidebarMarker.style.display = 'block';
        const pacingText = hasCurrent
          ? (currentPercentage > elapsed5hPct ? ' • High burn rate' : ' • Pacing on track')
          : '';
        sidebarMarker.title = `Time elapsed: ${elapsed5hPct}%${pacingText}`;
      } else {
        sidebarMarker.style.display = 'none';
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
            <div class="gem-usage-time-marker" id="gem-modal-cur-marker" title="Time elapsed"></div>
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
            <div class="gem-usage-time-marker" id="gem-modal-week-marker" title="Time elapsed"></div>
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
              <option value="60">Every 60 minutes</option>
              <option value="0">Disabled (default)</option>
            </select>
          </div>
          <div class="gem-modal-row" style="align-items:center;">
            <span>Auto-refresh prompts:</span>
            <select id="gem-modal-prompt-select" style="background:#0f172a;color:#f8fafc;border:1px solid rgba(255,255,255,0.15);padding:3px 8px;border-radius:6px;font-size:11px;">
              <option value="1">Every 1 prompt</option>
              <option value="2">Every 2 prompts</option>
              <option value="3">Every 3 prompts (default)</option>
              <option value="5">Every 5 prompts</option>
              <option value="10">Every 10 prompts</option>
              <option value="0">Disabled</option>
            </select>
          </div>
          <div class="gem-modal-row" style="align-items:center; font-size:11px; opacity:0.85;">
            <span>Prompt progress:</span>
            <strong id="gem-modal-prompt-progress">0 / 3</strong>
          </div>
        </div>

        <div class="gem-modal-footer-actions">
          <button class="gem-modal-btn gem-modal-btn-primary" id="gem-modal-refresh-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-1.19"/>
            </svg>
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
      setModalRefreshSpinning(true);
      setSidebarRefreshSpinning(true);
      executeUsageExtraction(true);
    });

    const intervalSelectElement = modalBackdropElement.querySelector('#gem-modal-interval-select');
    const promptSelectElement = modalBackdropElement.querySelector('#gem-modal-prompt-select');

    chrome.storage.local.get(['refreshInterval', 'promptRefreshThreshold', 'promptCounter'], (storageResult) => {
      if (storageResult.refreshInterval !== undefined) {
        intervalSelectElement.value = String(storageResult.refreshInterval);
      } else {
        intervalSelectElement.value = '0';
      }

      const threshold = storageResult.promptRefreshThreshold !== undefined
        ? parseInt(storageResult.promptRefreshThreshold, 10)
        : 3;
      promptSelectElement.value = String(threshold);
      updateModalPromptProgress(storageResult.promptCounter || 0, threshold);
    });

    intervalSelectElement.addEventListener('change', (changeEvent) => {
      chrome.runtime.sendMessage({
        action: 'SET_REFRESH_INTERVAL',
        minutes: parseInt(changeEvent.target.value, 10)
      });
    });

    promptSelectElement.addEventListener('change', (changeEvent) => {
      const thresholdVal = parseInt(changeEvent.target.value, 10);
      chrome.runtime.sendMessage({
        action: 'SET_PROMPT_THRESHOLD',
        threshold: thresholdVal
      });
      chrome.storage.local.get(['promptCounter'], (res) => {
        updateModalPromptProgress(res.promptCounter || 0, thresholdVal);
      });
    });

    document.addEventListener('keydown', (keyboardEvent) => {
      if (keyboardEvent.key === 'Escape') dismissUsageDetailsModal();
    });

    document.body.appendChild(modalBackdropElement);
  }

  function updateModalPromptProgress(counter, threshold) {
    const progressEl = document.getElementById('gem-modal-prompt-progress');
    if (!progressEl) return;
    if (threshold <= 0) {
      progressEl.textContent = 'Disabled';
    } else {
      progressEl.textContent = `${counter} / ${threshold}`;
    }
  }

  function openUsageDetailsModal() {
    ensureDetailsModalCreated();
    updateModalDataFields();
    if (isExtractionInProgress) {
      setModalRefreshSpinning(true);
    }
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

    const curMarkerElement = backdropElement.querySelector('#gem-modal-cur-marker');
    if (curMarkerElement) {
      const elapsed5hPct = calculateElapsedPercentage5h(currentMetrics);
      if (elapsed5hPct !== null) {
        curMarkerElement.style.left = `${elapsed5hPct}%`;
        curMarkerElement.style.display = 'block';
        const pacingText = (typeof currentPercentage === 'number')
          ? (currentPercentage > elapsed5hPct ? ' • High burn rate' : ' • Pacing on track')
          : '';
        curMarkerElement.title = `Time elapsed: ${elapsed5hPct}%${pacingText}`;
      } else {
        curMarkerElement.style.display = 'none';
      }
    }

    const currentCountdownElement = backdropElement.querySelector('#gem-modal-cur-countdown');
    if (currentCountdownElement) {
      currentCountdownElement.textContent = formatRemainingTime(currentMetrics);
    }

    const currentResetElement = backdropElement.querySelector('#gem-modal-cur-reset');
    if (currentResetElement) {
      currentResetElement.textContent = formatToEnglishDateString(currentMetrics?.resetTime) || '--';
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

    const weekMarkerElement = backdropElement.querySelector('#gem-modal-week-marker');
    if (weekMarkerElement) {
      const elapsedWeekPct = calculateElapsedPercentageWeekly(weeklyMetrics);
      if (elapsedWeekPct !== null) {
        weekMarkerElement.style.left = `${elapsedWeekPct}%`;
        weekMarkerElement.style.display = 'block';
        const pacingText = (typeof weeklyPercentage === 'number')
          ? (weeklyPercentage > elapsedWeekPct ? ' • High burn rate' : ' • Pacing on track')
          : '';
        weekMarkerElement.title = `Time elapsed: ${elapsedWeekPct}%${pacingText}`;
      } else {
        weekMarkerElement.style.display = 'none';
      }
    }

    const weeklyResetElement = backdropElement.querySelector('#gem-modal-week-reset');
    if (weeklyResetElement) {
      weeklyResetElement.textContent = formatToEnglishDateString(weeklyMetrics?.resetTime) || '--';
    }

    const accountIndicatorElement = backdropElement.querySelector('#gem-modal-acc');
    if (accountIndicatorElement) {
      accountIndicatorElement.textContent = `/u/${activeAccountIndex}`;
    }

    chrome.storage.local.get(['promptCounter', 'promptRefreshThreshold'], (res) => {
      const threshold = res.promptRefreshThreshold !== undefined ? parseInt(res.promptRefreshThreshold, 10) : 3;
      updateModalPromptProgress(res.promptCounter || 0, threshold);
    });
  }

  function registerPromptCompletionObserver() {
    function evaluatePromptButtonState() {
      const stopIcon = document.querySelector(
        'mat-icon[data-mat-icon-name="stop"], mat-icon[fonticon="stop"], button[aria-label*="Stop"], button[aria-label*="Arrêter"]'
      );

      if (stopIcon) {
        isPromptGenerating = true;
        return;
      }

      if (isPromptGenerating) {
        const readyIcon = document.querySelector(
          'mat-icon[data-mat-icon-name="mic"], mat-icon[fonticon="mic"], mat-icon[data-mat-icon-name="arrow_upward"], mat-icon[fonticon="arrow_upward"], button[aria-label*="Microphone"], button[aria-label*="Micro"], button[aria-label*="Envoyer"], button[aria-label*="Send"]'
        );

        if (readyIcon) {
          isPromptGenerating = false;
          const now = Date.now();
          if (now - lastPromptCompletionTimestamp > 2500) {
            lastPromptCompletionTimestamp = now;
            onPromptSuccessfullyCompleted();
          }
        }
      }
    }

    const promptObserver = new MutationObserver(() => {
      evaluatePromptButtonState();
    });

    promptObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-mat-icon-name', 'fonticon', 'aria-label', 'disabled']
    });

    setInterval(evaluatePromptButtonState, 1000);
  }

  function onPromptSuccessfullyCompleted() {
    chrome.storage.local.get(['promptCounter', 'promptRefreshThreshold'], (storageResult) => {
      const threshold = storageResult.promptRefreshThreshold !== undefined
        ? parseInt(storageResult.promptRefreshThreshold, 10)
        : 3;

      if (threshold <= 0) return;

      const currentCount = (parseInt(storageResult.promptCounter, 10) || 0) + 1;

      if (currentCount >= threshold) {
        chrome.storage.local.set({ promptCounter: 0 }, () => {
          updateModalPromptProgress(0, threshold);
          setTimeout(() => {
            setSidebarRefreshSpinning(true);
            executeUsageExtraction(true);
          }, 1500);
        });
      } else {
        chrome.storage.local.set({ promptCounter: currentCount }, () => {
          updateModalPromptProgress(currentCount, threshold);
        });
      }
    });
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

  let lastResetRefreshAttemptTime = 0;
  let resetRefreshRetryCount = 0;
  let resetRefreshTimeoutIdentifier = null;

  function checkIfResetRefreshNeeded() {
    if (!latestUsageData || !latestUsageData.current) return;
    if (isExtractionInProgress) return;

    const currentMetrics = latestUsageData.current;
    const hasUsage = typeof currentMetrics.percentage === 'number' && currentMetrics.percentage > 0;

    if (!hasUsage) {
      resetRefreshRetryCount = 0;
      return;
    }

    const countdownText = formatRemainingTime(currentMetrics);
    if (countdownText !== 'Ready to reset') {
      resetRefreshRetryCount = 0;
      return;
    }

    const now = Date.now();
    const timeSinceLastAttempt = now - lastResetRefreshAttemptTime;

    if (timeSinceLastAttempt < 15000) return;
    if (resetRefreshRetryCount >= 3) return;

    lastResetRefreshAttemptTime = now;
    resetRefreshRetryCount++;

    setSidebarRefreshSpinning(true);
    setModalRefreshSpinning(true);

    if (resetRefreshTimeoutIdentifier) clearTimeout(resetRefreshTimeoutIdentifier);
    resetRefreshTimeoutIdentifier = setTimeout(() => {
      chrome.runtime.sendMessage({ action: 'REQUEST_RESET_REFRESH' }, (response) => {
        if (chrome.runtime.lastError || !response || response.shouldExtract) {
          executeUsageExtraction(true);
        }
      });
    }, 1500);
  }

  function loadPersistedUsageData() {
    activeAccountIndex = getActiveAccountIndex();
    chrome.storage.local.get(null, (storageResult) => {
      if (!storageResult) return;
      const accountKey = `usage_${activeAccountIndex}`;
      const fallbackAccount = storageResult.last_active_account || '0';
      const fallbackKey = `usage_${fallbackAccount}`;

      let savedData = storageResult[accountKey] || storageResult[fallbackKey];
      if (savedData) {
        const timestamp = savedData.timestamp || storageResult.last_updated || 0;
        const ageMs = Date.now() - timestamp;
        if (ageMs > 5 * 3600 * 1000) {
          savedData = {
            ...savedData,
            current: {
              percentage: 0,
              resetTime: '',
              resetsAtEpochMs: null
            }
          };
        }
        latestUsageData = savedData;
        renderUsageInterface();
        checkIfResetRefreshNeeded();
      }

      const threshold = storageResult.promptRefreshThreshold !== undefined
        ? parseInt(storageResult.promptRefreshThreshold, 10)
        : 3;
      updateModalPromptProgress(storageResult.promptCounter || 0, threshold);
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      const hasUsageChange = Object.keys(changes).some(
        (key) => key.startsWith('usage_') || key === 'last_active_account'
      );
      if (hasUsageChange) {
        loadPersistedUsageData();
      }

      if (changes.promptCounter || changes.promptRefreshThreshold) {
        chrome.storage.local.get(['promptCounter', 'promptRefreshThreshold'], (res) => {
          const threshold = res.promptRefreshThreshold !== undefined ? parseInt(res.promptRefreshThreshold, 10) : 3;
          updateModalPromptProgress(res.promptCounter || 0, threshold);
        });
      }
    }
  });

  chrome.runtime.onMessage.addListener((incomingMessage) => {
    if (incomingMessage.action === 'SYNC_USAGE_DATA' && incomingMessage.data) {
      latestUsageData = incomingMessage.data;
      setSidebarRefreshSpinning(false);
      setModalRefreshSpinning(false);
      renderUsageInterface();
      return;
    }

    if (incomingMessage.action === 'TRIGGER_TAB_REFRESH') {
      setSidebarRefreshSpinning(true);
      setModalRefreshSpinning(true);
      executeUsageExtraction(true);
      return;
    }
  });

  function initializeApplication() {
    if (window.self !== window.top) return;

    loadPersistedUsageData();
    mountWidgetsToDOM();
    registerDomAndNavigationObservers();
    registerPromptCompletionObserver();

    countdownIntervalIdentifier = setInterval(() => {
      if (latestUsageData) {
        renderUsageInterface();
        checkIfResetRefreshNeeded();
      }
    }, 1000);

    setInterval(() => {
      loadPersistedUsageData();
    }, 20000);

    chrome.storage.local.get(['last_updated'], (storageResult) => {
      const lastUpdated = storageResult.last_updated || 0;
      const ageMs = Date.now() - lastUpdated;
      if (ageMs > 5 * 3600 * 1000) {
        executeUsageExtraction(true);
      } else {
        setTimeout(() => {
          chrome.runtime.sendMessage({ action: 'CHECK_IF_EXTRACTION_NEEDED' }, (response) => {
            if (chrome.runtime.lastError) return;
            if (response && response.shouldExtract) {
              executeUsageExtraction(false);
            }
          });
        }, 3500);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApplication);
  } else {
    initializeApplication();
  }
})();
