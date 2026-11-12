(() => {
  'use strict';

  let hasExtractedUsageData = false;
  let extractionAttemptCount = 0;
  const MAX_EXTRACTION_ATTEMPTS = 40;

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

  function parseUsageMetricsFromDOM() {
    const currentUsageElement = document.querySelector('[data-testid="current-usage"]');
    const weeklyUsageElement = document.querySelector('[data-testid="weekly-usage"]');

    if (!currentUsageElement && !weeklyUsageElement) {
      return null;
    }

    const extractionResult = {
      timestamp: Date.now(),
      accountIndex: getActiveAccountIndex(),
      current: null,
      weekly: null
    };

    function extractFromReactInternal(domElement) {
      if (!domElement) return null;
      for (const propertyKey in domElement) {
        if (propertyKey.startsWith('__reactFiber$') || propertyKey.startsWith('__reactProps$')) {
          try {
            let currentFiber = domElement[propertyKey];
            let depthCounter = 0;
            while (currentFiber && depthCounter < 10) {
              const memoizedProperties = currentFiber.memoizedProps || currentFiber;
              if (memoizedProperties && typeof memoizedProperties.value === 'number') {
                return { percentage: Math.round(memoizedProperties.value * 100) };
              }
              if (memoizedProperties?.percentageUsed !== undefined) {
                const percentageValue = memoizedProperties.percentageUsed;
                return {
                  percentage: typeof percentageValue === 'number'
                    ? (percentageValue <= 1 ? Math.round(percentageValue * 100) : Math.round(percentageValue))
                    : null,
                  refreshesAt: memoizedProperties?.gxu?.windowRefreshesAt || null
                };
              }
              currentFiber = currentFiber.return || currentFiber.child;
              depthCounter++;
            }
          } catch (traversalError) {
            return null;
          }
        }
      }
      return null;
    }

    if (currentUsageElement) {
      const textContent = currentUsageElement.innerText || currentUsageElement.textContent || '';
      let calculatedCurrentPercentage = null;

      const percentageRegexMatch =
        textContent.match(/(\d+(?:[.,]\d+)?)\s*%\s*(?:utilis[ée]?s?|used)?/i) ||
        textContent.match(/(\d+(?:[.,]\d+)?)\s*%/);

      if (percentageRegexMatch) {
        calculatedCurrentPercentage = parseFloat(percentageRegexMatch[1].replace(',', '.'));
      }

      const nativeProgressElement = currentUsageElement.querySelector('progress, [role="progressbar"], [value]');
      if (nativeProgressElement) {
        const attributeValue = nativeProgressElement.getAttribute('aria-valuenow') || nativeProgressElement.getAttribute('value');
        if (attributeValue !== null && !isNaN(parseFloat(attributeValue))) {
          const parsedNumeric = parseFloat(attributeValue);
          calculatedCurrentPercentage = parsedNumeric <= 1 ? Math.round(parsedNumeric * 100) : Math.round(parsedNumeric);
        }
      }

      const reactExtracted = extractFromReactInternal(currentUsageElement);
      if (reactExtracted && reactExtracted.percentage !== null) {
        calculatedCurrentPercentage = reactExtracted.percentage;
      }

      let parsedResetTimeString = null;
      let calculatedResetsAtEpochMs = null;

      const resetTimeMatch = textContent.match(/(?:R[ée]initialisation\s+[àa]|Resets?\s+at)\s*([0-9]{1,2}(?:[:.][0-9]{2})?(?:\s*[AaPp][Mm])?)/i);
      if (resetTimeMatch) {
        parsedResetTimeString = formatToEnglishDateString(resetTimeMatch[1].trim());
      }

      if (reactExtracted?.refreshesAt) {
        const parsedEpoch = Date.parse(reactExtracted.refreshesAt);
        if (!isNaN(parsedEpoch)) {
          calculatedResetsAtEpochMs = parsedEpoch;
        }
      }

      extractionResult.current = {
        percentage: calculatedCurrentPercentage !== null ? Math.min(100, Math.max(0, calculatedCurrentPercentage)) : 0,
        resetTime: parsedResetTimeString || '',
        resetsAtEpochMs: calculatedResetsAtEpochMs
      };
    }

    if (weeklyUsageElement) {
      const textContent = weeklyUsageElement.innerText || weeklyUsageElement.textContent || '';
      let calculatedWeeklyPercentage = null;

      const percentageRegexMatch =
        textContent.match(/(\d+(?:[.,]\d+)?)\s*%\s*(?:utilis[ée]?s?|used)?/i) ||
        textContent.match(/(\d+(?:[.,]\d+)?)\s*%/);

      if (percentageRegexMatch) {
        calculatedWeeklyPercentage = parseFloat(percentageRegexMatch[1].replace(',', '.'));
      }

      let parsedWeeklyResetString = null;
      const weeklyResetMatch = textContent.match(/(?:R[ée]initialisation\s+(?:le\s+)?|Resets?\s+(?:on\s+)?)([^\n\r]+)/i);
      if (weeklyResetMatch) {
        parsedWeeklyResetString = formatToEnglishDateString(weeklyResetMatch[1].trim());
      }

      extractionResult.weekly = {
        percentage: calculatedWeeklyPercentage !== null ? Math.min(100, Math.max(0, calculatedWeeklyPercentage)) : 0,
        resetTime: parsedWeeklyResetString || ''
      };
    }

    return extractionResult;
  }

  function getActiveAccountIndex() {
    const pathnameMatch = window.location.pathname.match(/\/u\/(\d+)/);
    if (pathnameMatch) return pathnameMatch[1];
    const baseElement = document.querySelector('base')?.getAttribute('href') || '';
    const baseMatch = baseElement.match(/\/u\/(\d+)/);
    if (baseMatch) return baseMatch[1];
    return '0';
  }

  function dispatchUsageData(usagePayload) {
    if (hasExtractedUsageData) return;
    hasExtractedUsageData = true;

    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'GEMINI_USAGE_EXTRACTED',
          payload: usagePayload
        }, '*');
      }
    } catch (messagingError) {}

    try {
      chrome.runtime.sendMessage({
        action: 'USAGE_DATA_SAVED',
        data: usagePayload
      }).catch(() => {});
    } catch (runtimeError) {}
  }

  function executeExtractionPoll() {
    if (hasExtractedUsageData) return;
    extractionAttemptCount++;

    const extractedMetrics = parseUsageMetricsFromDOM();
    if (extractedMetrics && (extractedMetrics.current || extractedMetrics.weekly)) {
      dispatchUsageData(extractedMetrics);
      return;
    }

    if (extractionAttemptCount < MAX_EXTRACTION_ATTEMPTS) {
      setTimeout(executeExtractionPoll, 500);
    }
  }

  const domMutationObserver = new MutationObserver(() => {
    if (hasExtractedUsageData) {
      domMutationObserver.disconnect();
      return;
    }
    const extractedMetrics = parseUsageMetricsFromDOM();
    if (extractedMetrics && (extractedMetrics.current || extractedMetrics.weekly)) {
      dispatchUsageData(extractedMetrics);
      domMutationObserver.disconnect();
    }
  });

  domMutationObserver.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    executeExtractionPoll();
  } else {
    document.addEventListener('DOMContentLoaded', executeExtractionPoll);
  }
})();
