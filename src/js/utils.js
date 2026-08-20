// 工具函数模块

// 代码格式化逻辑
export function formatCode(code) {
  code = code.trim().toLowerCase();
  if (!code) return null;

  // 如果已经带了前缀直接返回
  if (/^(sh|sz|hk|bj|s_sh|s_sz)/.test(code)) return code;

  // 纯数字判断
  if (/^\d+$/.test(code)) {
    // 港股判断：1-4位数字，或以0开头的5位数字(如 00700)
    if (code.length <= 4 || (code.length === 5 && code.startsWith('0'))) {
      return 'hk' + code.padStart(5, '0');
    }
    // A股 & ETF 判断
    if (code.length === 6) {
      if (/^(5[168]|6)/.test(code)) return 'sh' + code; // 上海A股或ETF
      if (/^(1[568]|0|3)/.test(code)) return 'sz' + code; // 深圳A股或ETF
      if (/^(4|8)/.test(code)) return 'bj' + code; // 北交所
    }
  }
  return code;
}

// 获取市场标识
export function getMarket(fullCode) {
  if (fullCode.startsWith('sh')) return 'sh';
  if (fullCode.startsWith('sz')) return 'sz';
  if (fullCode.startsWith('hk')) return 'hk';
  if (fullCode.startsWith('bj')) return 'bj';
  return 'other';
}

// 获取市场标签
export function getMarketLabel(fullCode) {
  if (fullCode.startsWith('sh')) return 'A类';
  if (fullCode.startsWith('sz')) return 'B类';
  if (fullCode.startsWith('hk')) return 'C类';
  if (fullCode.startsWith('bj')) return 'D类';
  return 'E类';
}

// 获取涨跌样式类
export function getChgClass(row) {
  const now = parseFloat(row.now);
  const prev = parseFloat(row.prevClose) || 0;
  if (prev <= 0) return '';
  if (now > prev) return 'up-text';
  if (now < prev) return 'down-text';
  return '';
}

// 格式化涨跌显示
export function formatChg(row) {
  const now = parseFloat(row.now);
  const prev = parseFloat(row.prevClose) || 0;
  if (prev <= 0 || isNaN(now)) return '-';
  const diff = now - prev;
  const pct = (diff / prev) * 100;
  const sign = diff > 0 ? '+' : '';
  return `${sign}${diff.toFixed(2)}  (${sign}${pct.toFixed(2)}%)`;
}

// 获取盈亏样式类
export function getPnlClass(val) {
  const v = parseFloat(val);
  if (isNaN(v)) return '';
  if (v > 0) return 'up-text';
  if (v < 0) return 'alert-text';
  return '';
}

// 确保字段存在
export function ensureFields(row) {
  if (row.buyPrice === undefined || row.buyPrice === null) row.buyPrice = 0;
  if (row.adr20 === undefined) row.adr20 = 0;
  if (row.takeProfit === undefined) row.takeProfit = '';
  if (row.stopLoss === undefined) row.stopLoss = '';
  if (row.buyDate === undefined) row.buyDate = '';
  if (row.maxSinceBuy === undefined || row.maxSinceBuy === null) row.maxSinceBuy = 0;
  if (row.prevClose === undefined || row.prevClose === null) row.prevClose = 0;
  if (row.quantity === undefined || row.quantity === null) row.quantity = 0;
  if (row.pnlAmount === undefined) row.pnlAmount = '';
  if (row.pnlPct === undefined) row.pnlPct = '';
  if (row.toTPPct === undefined) row.toTPPct = '';
  if (row.toSLPct === undefined) row.toSLPct = '';
  if (row._toTPNum === undefined) row._toTPNum = 0;
  if (row._toSLNum === undefined) row._toSLNum = 0;
  // 加仓仓位数组
  if (!row.addPositions) row.addPositions = [];
  return row;
}

// 计算单个仓位的止盈止损和盈亏（用于底仓和加仓）
export function calculatePosition(position, now) {
  const buy = parseFloat(position.buyPrice);
  const adr = parseFloat(position.adr20);
  const qty = parseInt(position.quantity) || 0;
  
  // 计算止盈止损
  if (buy > 0 && adr > 0) {
    const maxSince = Math.max(parseFloat(position.maxSinceBuy) || 0, now, buy);
    position.maxSinceBuy = parseFloat(maxSince.toFixed(3));
    const initialTP = buy + 2 * adr;
    if (maxSince >= initialTP) {
      const trailingTP = maxSince - 1 * adr;
      position.takeProfit = Math.max(initialTP, trailingTP).toFixed(3);
    } else {
      position.takeProfit = initialTP.toFixed(3);
    }
    let slVal = buy - 2 * adr;
    if (maxSince >= buy + 1.5 * adr) {
      slVal = Math.max(slVal, buy);
    }
    position.stopLoss = slVal.toFixed(3);
  } else {
    position.takeProfit = '';
    position.stopLoss = '';
  }

  // 计算盈亏
  if (buy > 0 && now > 0) {
    const pnlPerShare = now - buy;
    const pnlPerShareAmt = qty > 0 ? pnlPerShare * qty : pnlPerShare;
    const pnlPerPct = (pnlPerShare / buy) * 100;
    const signPnl = pnlPerShare > 0 ? '+' : '';
    if (qty > 0) {
      position.pnlAmount = `${signPnl}${pnlPerShareAmt.toFixed(2)}`;
    } else {
      position.pnlAmount = `${signPnl}${pnlPerShareAmt.toFixed(3)}`;
    }
    position.pnlPct = `${signPnl}${pnlPerPct.toFixed(2)}%`;
  } else {
    position.pnlAmount = '';
    position.pnlPct = '';
  }

  // 计算距离止盈止损
  if (buy > 0 && adr > 0) {
    const tp = parseFloat(position.takeProfit);
    const sl = parseFloat(position.stopLoss);
    if (now > 0 && tp > 0) {
      const toTP = ((tp - now) / now) * 100;
      position._toTPNum = toTP;
      const tSign = toTP > 0 ? '+' : '';
      position.toTPPct = `距止盈 ${tSign}${toTP.toFixed(2)}%`;
    } else {
      position.toTPPct = '';
      position._toTPNum = 0;
    }
    if (now > 0 && sl > 0) {
      const toSL = ((sl - now) / now) * 100;
      position._toSLNum = toSL;
      const sSign = toSL > 0 ? '+' : '';
      position.toSLPct = `距止损 ${sSign}${toSL.toFixed(2)}%`;
    } else {
      position.toSLPct = '';
      position._toSLNum = 0;
    }
  } else {
    position.toTPPct = '';
    position.toSLPct = '';
    position._toTPNum = 0;
    position._toSLNum = 0;
  }
}

// 计算行数据
export function calculateRow(row, saveCallback) {
  const diff = row.high - row.low;
  const K = 0.98848;
  row.f382 = (row.high - diff * 0.382).toFixed(3);
  row.f618 = (row.high - diff * 0.618).toFixed(3);
  row.f786 = (row.high - diff * 0.786).toFixed(3);
  if (row.avg > 0) {
    row.topLine = (row.avg / K).toFixed(3);
    row.bottomLine = (row.avg * K).toFixed(3);
  }
  
  const now = parseFloat(row.now) || 0;
  
  // 计算底仓（使用 calculatePosition）
  calculatePosition(row, now);
  
  // 计算所有加仓仓位
  if (row.addPositions && row.addPositions.length > 0) {
    row.addPositions.forEach(pos => calculatePosition(pos, now));
  }
  
  if (saveCallback) saveCallback();
}