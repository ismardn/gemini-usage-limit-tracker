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
      return `Resets at ${currentMetrics.resetTime}`;
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
      currentResetClockElement.textContent = currentMetrics.resetTime || '--';
    }

    if (weeklyMetrics) {
      const percentage = weeklyMetrics.percentage;
      const statusClass = getQuotaStatusClass(percentage);
      weeklyPercentageTagElement.textContent = `${percentage}%`;
      weeklyPercentageTagElement.className = `pct-tag ${statusClass}`;
      weeklyProgressFillElement.style.width = `${percentage}%`;
      weeklyProgressFillElement.className = `progress-fill ${statusClass}`;
      weeklyResetElement.textContent = weeklyMetrics.resetTime || '--';
    }
  }

  function loadLatestUsageData() {
    chrome.storage.local.get(null, (storageItems) => {
      const activeAccount = storageItems.last_active_account || '0';
      const storedMetrics = storageItems[`usage_${activeAccount}`] || storageItems['usage_0'];
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
