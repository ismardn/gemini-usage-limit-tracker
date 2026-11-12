document.addEventListener('DOMContentLoaded', () => {
  const accountIndicatorElement = document.getElementById('popup-acc');
  const currentPercentageTagElement = document.getElementById('popup-cur-tag');
  const currentProgressFillElement = document.getElementById('popup-cur-fill');
  const currentCountdownElement = document.getElementById('popup-countdown');
  const currentResetClockElement = document.getElementById('popup-reset-clock');
  const weeklyPercentageTagElement = document.getElementById('popup-week-tag');
  const weeklyProgressFillElement = document.getElementById('popup-week-fill');
  const weeklyResetElement = document.getElementById('popup-week-reset');
  const refreshButtonElement = document.getElementById('popup-refresh-btn');

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

  function getQuotaStatusClass(percentageValue) {
    if (percentageValue >= 85) return 'status-red';
    if (percentageValue >= 60) return 'status-orange';
    return 'status-green';
  }

  function formatCountdown(currentMetrics) {
    if (!currentMetrics) return '--';

    if (currentMetrics.resetsAtEpochMs) {
      const differenceMs = currentMetrics.resetsAtEpochMs - Date.now();
      if (differenceMs <= 0) return 'Ready to reset';
      const totalMinutes = Math.floor(differenceMs / 60000);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      return hours > 0 ? `${hours}h ${minutes}m remaining` : `${minutes}m remaining`;
    }

    if (currentMetrics.resetTime) {
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

        const totalMinutes = Math.floor(differenceMs / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return hours > 0 ? `${hours}h ${minutes}m remaining` : `${minutes}m remaining`;
      }

      return `Resets at ${timeString}`;
    }

    return '--';
  }

  function renderMetrics(usageMetrics, activeAccountIndex) {
    accountIndicatorElement.textContent = `u/${activeAccountIndex}`;

    if (!usageMetrics) return;

    const currentMetrics = usageMetrics.current;
    const weeklyMetrics = usageMetrics.weekly;

    if (currentMetrics) {
      const percentage = currentMetrics.percentage;
      const statusClass = getQuotaStatusClass(percentage);
      currentPercentageTagElement.textContent = `${percentage}%`;
      currentPercentageTagElement.className = `pct-tag ${statusClass}`;
      currentProgressFillElement.style.width = `${percentage}%`;
      currentProgressFillElement.className = `progress-fill ${statusClass}`;
      currentCountdownElement.textContent = formatCountdown(currentMetrics);
      currentResetClockElement.textContent = formatToEnglishDateString(currentMetrics.resetTime) || '--';
    }

    if (weeklyMetrics) {
      const percentage = weeklyMetrics.percentage;
      const statusClass = getQuotaStatusClass(percentage);
      weeklyPercentageTagElement.textContent = `${percentage}%`;
      weeklyPercentageTagElement.className = `pct-tag ${statusClass}`;
      weeklyProgressFillElement.style.width = `${percentage}%`;
      weeklyProgressFillElement.className = `progress-fill ${statusClass}`;
      weeklyResetElement.textContent = formatToEnglishDateString(weeklyMetrics.resetTime) || '--';
    }
  }

  function loadLatestUsageData() {
    chrome.storage.local.get(null, (storageItems) => {
      const activeAccount = storageItems.last_active_account || '0';
      let storedMetrics = storageItems[`usage_${activeAccount}`] || storageItems['usage_0'];

      const timestamp = storedMetrics?.timestamp || storageItems.last_updated || 0;
      if (Date.now() - timestamp > 5 * 3600 * 1000 && storedMetrics) {
        storedMetrics = {
          ...storedMetrics,
          current: {
            percentage: 0,
            resetTime: '',
            resetsAtEpochMs: null
          }
        };
      }

      renderMetrics(storedMetrics, activeAccount);
    });
  }

  refreshButtonElement.addEventListener('click', () => {
    refreshButtonElement.classList.add('spinning');
    chrome.runtime.sendMessage({ action: 'FORCE_REFRESH' }, () => {
      setTimeout(() => {
        refreshButtonElement.classList.remove('spinning');
        loadLatestUsageData();
      }, 2500);
    });
  });

  loadLatestUsageData();
});
