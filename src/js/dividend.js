// 股息监控模块

// 股息相关工具函数
export function getDividendColor(rate) {
  if (rate >= 6) return '#67c23a';
  if (rate >= 5.5) return '#e6a23c';
  if (rate >= 5) return '#f56c6c';
  if (rate >= 4.5) return '#409eff';
  return '#909399';
}

export function getDividendClass(rate) {
  if (rate >= 6) return 'rate-green';
  if (rate >= 5.5) return 'rate-yellow';
  if (rate >= 5) return 'rate-orange';
  if (rate >= 4.5) return 'rate-blue';
  return '';
}

export function getDividendEmoji(rate) {
  if (rate >= 6) return '🟢';
  if (rate >= 5.5) return '🟡';
  if (rate >= 5) return '🟠';
  if (rate >= 4.5) return '🔵';
  return '';
}

export function getThresholdCount(tableData, threshold) {
  return tableData.filter(row => row.dividendRate !== undefined && row.dividendRate !== null && row.dividendRate >= threshold).length;
}

export function dividendAlertTypeKey(code, type) {
  return `dividend__${code}__${type}`;
}

export function hasDividendAlert(flags, code) {
  if (!code) return false;
  return Object.keys(flags).some(key => key.startsWith(`dividend__${code}`));
}

export function checkDividendAlerts(tableData, flags, fireNotify, selectedVoice) {
  tableData.forEach(row => {
    const code = row.fullCode;
    const rate = parseFloat(row.dividendRate);
    if (!code || isNaN(rate)) return;
    const name = row.name;

    // 找到达到的最高阈值
    const thresholds = [6, 5.5, 5, 4.5];
    const reachedThreshold = thresholds.find(t => rate >= t);

    // 只对最高阈值触发告警，清除其他低级别的告警标记
    thresholds.forEach(threshold => {
      const key = dividendAlertTypeKey(code, threshold);
      if (threshold === reachedThreshold) {
        // 最高阈值：触发告警
        if (!flags[key]) {
          flags[key] = rate;
          const emoji = getDividendEmoji(threshold);
          fireNotify(`${emoji} 股息率突破`, `${name} 股息率达到 ${threshold}%（当前 ${rate.toFixed(2)}%）`, 2, selectedVoice);
        }
      } else {
        // 其他阈值：清除标记
        delete flags[key];
      }
    });
  });
}

export function isDividendRateReached(row, threshold) {
  const rate = parseFloat(row.dividendRate);
  if (isNaN(rate)) return false;
  // 当前股息率 >= 该阈值，且是达到的最高阈值（按0.5%档位）
  const thresholds = [6, 5.5, 5, 4.5, 4];
  const reached = thresholds.find(t => rate >= t);
  return reached === threshold;
}

export function getDividendChgClass(row) {
  const now = parseFloat(row.price);
  const prev = parseFloat(row.prevClose) || 0;
  if (prev <= 0) return '';
  if (now > prev) return 'up-text';
  if (now < prev) return 'down-text';
  return '';
}

export function formatDividendChg(row) {
  const now = parseFloat(row.price);
  const prev = parseFloat(row.prevClose) || 0;
  if (prev <= 0 || !now) return '-';
  const diff = now - prev;
  const pct = (diff / prev) * 100;
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${diff.toFixed(2)} ${sign}${pct.toFixed(2)}%`;
}

export function calcDividendFields(row) {
  const dps = (parseFloat(row.dividendPerShare) || 0) / 10;
  const price = parseFloat(row.price) || 0;
  if (dps > 0 && price > 0) {
    row.dividendRate = parseFloat(((dps / price) * 100).toFixed(2));
    row.priceAt400 = parseFloat((dps / 0.040).toFixed(3));
    row.priceAt450 = parseFloat((dps / 0.045).toFixed(3));
    row.priceAt500 = parseFloat((dps / 0.05).toFixed(3));
    row.priceAt550 = parseFloat((dps / 0.055).toFixed(3));
    row.priceAt600 = parseFloat((dps / 0.06).toFixed(3));
  } else {
    row.dividendRate = null;
    row.priceAt400 = null;
    row.priceAt450 = null;
    row.priceAt500 = null;
    row.priceAt550 = null;
    row.priceAt600 = null;
  }
}

export function onUpdateDividendPerShare(row, stockList, saveCallback) {
  calcDividendFields(row);
  // 同步到 dividendStockList
  const stockItem = stockList.find(s => s.fullCode === row.fullCode);
  if (stockItem) {
    stockItem.dividendPerShare = row.dividendPerShare;
  }
  saveCallback();
  localStorage.setItem('dividend_data_v1', JSON.stringify(row));
  return row;
}