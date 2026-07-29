// 主应用模块 - 聚合所有功能模块
import { formatCode, getMarket, getMarketLabel, getChgClass, formatChg, getPnlClass, ensureFields, tableRowClassName, calculateRow } from './utils.js';
import { initVoices, initAudio, playBeep, fireNotify, speakAlert, testNotify, ensureNotifyPerm } from './notify.js';
import { getDividendColor, getDividendClass, getDividendEmoji, getThresholdCount, dividendAlertTypeKey, hasDividendAlert, checkDividendAlerts, isDividendRateReached, getDividendChgClass, formatDividendChg, calcDividendFields, onUpdateDividendPerShare } from './dividend.js';

const { createApp, ref, onMounted, reactive } = Vue;

// 导出所有需要在模板中使用的函数
export function setupApp() {
  const STORAGE_KEY = 'phi_batch_table_v7';
  const inputCodes = ref("");
  const tableData = ref([]);
  const loading = ref(false);
  const cfgVisible = ref(false);
  const cfgRow = ref(null);
  const cfgChanged = ref(false);
  const _cfgBackup = ref(null);

  const isFileProtocol = ref(false);
  try {
    isFileProtocol.value = /^file:$/i.test(window.location.protocol);
  } catch (e) { }

  const exportVisible = ref(false);
  const importVisible = ref(false);
  const exportJsonText = ref('');
  const importJsonText = ref('');
  const importMode = ref('merge');

  const autoRefresh = ref(false);
  const autoCountdown = ref(30);
  const _autoTimer = ref(null);
  const _countdownTimer = ref(null);
  const alertFlags = ref({});
  const selectedVoice = ref('');
  const chineseVoices = ref([]);
  const activeTab = ref('monitor');
  const dividendInputCodes = ref('');
  const dividendStockList = ref([]);
  const dividendTableData = ref([]);
  const dividendLoading = ref(false);
  const autoDividendRefresh = ref(false);
  const dividendCountdown = ref(60);
  const _dividendTimer = ref(null);
  const _dividendCountdownTimer = ref(null);
  const dividendAlertFlags = ref({});
  const currentDividendRate = ref(0);
  const maxDividendRate = ref(10);

  const dividendThresholds = [
    { value: 6, label: '≥6%', colorClass: 'dot-green' },
    { value: 5.5, label: '≥5.5%', colorClass: 'dot-yellow' },
    { value: 5, label: '≥5%', colorClass: 'dot-orange' },
    { value: 4.5, label: '≥4.5%', colorClass: 'dot-red' }
  ];

  // 首次用户交互后初始化
  let voicesInitAttempted = false;
  const ensureVoicesInit = () => {
    if (voicesInitAttempted) return;
    voicesInitAttempted = true;
    initVoices(chineseVoices, selectedVoice);
  };

  // 监听首次用户交互
  if ('speechSynthesis' in window) {
    const initOnUserAction = () => {
      ensureVoicesInit();
      document.removeEventListener('click', initOnUserAction);
      document.removeEventListener('keydown', initOnUserAction);
    };
    document.addEventListener('click', initOnUserAction, { once: true });
    document.addEventListener('keydown', initOnUserAction, { once: true });

    // 页面加载后延迟初始化（Windows可以不需要交互）
    setTimeout(ensureVoicesInit, 500);
  }

  const alertTypeKey = (code, type) => `${code}__${type}`;

  const hasAlert = (code, type) => {
    if (!code) return false;
    return !!alertFlags.value[alertTypeKey(code, type)];
  };

  const checkAlertsForRow = (row) => {
    const code = row.fullCode;
    const now = parseFloat(row.now);
    if (!now || isNaN(now)) return;
    const name = row.name;
    const mk = (type) => alertTypeKey(code, type);

    const sl = parseFloat(row.stopLoss);
    if (sl > 0 && now <= sl) {
      if (!alertFlags.value[mk('STOP_LOSS')]) {
        alertFlags.value[mk('STOP_LOSS')] = now;
        fireNotify('⚠️ 破位警告', `${name} 已跌破止损 ${sl.toFixed(3)}（当前 ${now}）`, 3, isFileProtocol.value, selectedVoice);
      }
    } else {
      delete alertFlags.value[mk('STOP_LOSS')];
    }

    const tp = parseFloat(row.takeProfit);
    if (tp > 0 && now >= tp) {
      if (!alertFlags.value[mk('TAKE_PROFIT')]) {
        alertFlags.value[mk('TAKE_PROFIT')] = now;
        fireNotify('✅ 达标提醒', `${name} 已达止盈 ${tp.toFixed(3)}（当前 ${now}）`, 2, isFileProtocol.value, selectedVoice);
      }
    } else {
      delete alertFlags.value[mk('TAKE_PROFIT')];
    }

    const topL = parseFloat(row.topLine);
    if (topL > 0 && now >= topL) {
      if (!alertFlags.value[mk('TOP_BOUND')]) {
        alertFlags.value[mk('TOP_BOUND')] = now;
        fireNotify('📈 触顶提醒', `${name} 上穿8848高位 ${topL.toFixed(3)}（当前 ${now}）`, 1, isFileProtocol.value, selectedVoice);
      }
    } else {
      delete alertFlags.value[mk('TOP_BOUND')];
    }

    const botL = parseFloat(row.bottomLine);
    if (botL > 0 && now <= botL) {
      if (!alertFlags.value[mk('BOT_BOUND')]) {
        alertFlags.value[mk('BOT_BOUND')] = now;
        fireNotify('📉 触底提醒', `${name} 下穿8848低位 ${botL.toFixed(3)}（当前 ${now}）`, 1, isFileProtocol.value, selectedVoice);
      }
    } else {
      delete alertFlags.value[mk('BOT_BOUND')];
    }

    const l3 = parseFloat(row.f786);
    if (l3 > 0 && now <= l3) {
      if (!alertFlags.value[mk('L3_THRESH')]) {
        alertFlags.value[mk('L3_THRESH')] = now;
        fireNotify('🔻 L3 警戒', `${name} 跌破 L3 阈值 ${l3.toFixed(3)}（当前 ${now}）`, 2, isFileProtocol.value, selectedVoice);
      }
    } else {
      delete alertFlags.value[mk('L3_THRESH')];
    }

    const l2 = parseFloat(row.f618);
    if (l2 > 0 && now <= l2 && !alertFlags.value[mk('L3_THRESH')]) {
      if (!alertFlags.value[mk('L2_THRESH')]) {
        alertFlags.value[mk('L2_THRESH')] = now;
        fireNotify('🟠 L2 预警', `${name} 跌破 L2 阈值 ${l2.toFixed(3)}（当前 ${now}）`, 1, isFileProtocol.value, selectedVoice);
      }
    } else {
      delete alertFlags.value[mk('L2_THRESH')];
    }
  };

  const checkAllAlerts = () => {
    tableData.value.forEach(row => ensureFields(row));
    tableData.value.forEach(checkAlertsForRow);
  };

  const saveToLocal = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tableData.value));
    localStorage.setItem('alert_flags_v1', JSON.stringify(alertFlags.value));
  };

  const fetchData = (codes, isAddition = true) => {
    if (codes.length === 0) return;
    loading.value = true;
    const queryStr = codes.join(',');

    const oldScript = document.getElementById('jsonp-stock');
    if (oldScript) oldScript.remove();

    const script = document.createElement('script');
    script.id = 'jsonp-stock';
    script.src = `https://qt.gtimg.cn/q=${queryStr}`;
    document.body.appendChild(script);

    script.onload = () => {
      codes.forEach(code => {
        const dataStr = window[`v_${code}`];
        if (dataStr) {
          const d = dataStr.split('~');
          const nowPrice = parseFloat(d[3]);
          const prevClosePrice = parseFloat(d[4]) || 0;

          let turnover = parseFloat(d[37]);
          let volume = parseFloat(d[36]);

          let newAvg = 0;
          if (code.startsWith('hk')) {
            newAvg = volume > 0 ? turnover / volume : prevClosePrice;
          } else {
            newAvg = volume > 0 ? (turnover * 10000) / (volume * 100) : prevClosePrice;
          }

          const existingIndex = tableData.value.findIndex(item => item.fullCode === code);

          if (existingIndex > -1) {
            const item = tableData.value[existingIndex];
            item.now = nowPrice;
            item.prevClose = prevClosePrice;
            item.avg = parseFloat(newAvg.toFixed(3));
            ensureFields(item);
            if (nowPrice > (parseFloat(item.maxSinceBuy) || 0)) item.maxSinceBuy = parseFloat(nowPrice.toFixed(3));
            calculateRow(item, saveToLocal);
          } else if (isAddition) {
            const newItem = reactive({
              name: d[1],
              fullCode: code,
              now: nowPrice,
              prevClose: prevClosePrice,
              high: parseFloat(d[33]) || nowPrice,
              low: parseFloat(d[34]) || nowPrice,
              avg: parseFloat(newAvg.toFixed(3)),
              f382: 0, f618: 0, f786: 0,
              topLine: 0, bottomLine: 0,
              buyPrice: 0,
              buyDate: '',
              adr20: 0,
              quantity: 0,
              maxSinceBuy: parseFloat(nowPrice.toFixed(3)),
              takeProfit: '',
              stopLoss: '',
              pnlAmount: '', pnlPct: '',
              toTPPct: '', toSLPct: '',
              _toTPNum: 0, _toSLNum: 0
            });
            calculateRow(newItem, saveToLocal);
            tableData.value.unshift(newItem);
          }
        }
      });
      loading.value = false;
      saveToLocal();
      if (isAddition) inputCodes.value = "";
      checkAllAlerts();
    };
  };

  const addNewCodes = () => {
    const codes = inputCodes.value.split(/[,\s\n]/).map(c => formatCode(c)).filter(c => c);
    if (codes.length > 0) fetchData(codes, true);
  };

  const refreshAllPrices = () => {
    const currentCodes = tableData.value.map(item => item.fullCode);
    if (currentCodes.length > 0) {
      fetchData(currentCodes, false);
    }
  };

  const openCfg = (row) => {
    if (!row) return;
    ensureFields(row);
    _cfgBackup.value = JSON.parse(JSON.stringify({
      high: row.high, low: row.low, adr20: row.adr20,
      buyDate: row.buyDate, buyPrice: row.buyPrice, quantity: row.quantity
    }));
    cfgRow.value = row;
    cfgChanged.value = false;
    cfgVisible.value = true;
  };

  const saveCfg = () => {
    if (cfgRow.value) {
      calculateRow(cfgRow.value, saveToLocal);
      saveToLocal();
    }
    cfgVisible.value = false;
    cfgRow.value = null;
    _cfgBackup.value = null;
  };

  const removeItem = (index) => {
    tableData.value.splice(index, 1);
    saveToLocal();
  };

  const clearAll = () => {
    ElementPlus.ElMessageBox.confirm('确定清空所有数据吗？').then(() => {
      tableData.value = [];
      saveToLocal();
    });
  };

  const toggleAutoRefresh = () => {
    if (autoRefresh.value) {
      autoRefresh.value = false;
      autoCountdown.value = 30;
      if (_autoTimer.value) { clearInterval(_autoTimer.value); _autoTimer.value = null; }
      if (_countdownTimer.value) { clearInterval(_countdownTimer.value); _countdownTimer.value = null; }
      ElementPlus.ElMessage.success('已关闭自动刷新。');
      return;
    }
    initAudio();
    ElementPlus.ElMessage.info('开启 30 秒自动刷新模式。若要测试提醒通道，请先点击旁边的【测试提醒】按钮。');

    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        setTimeout(() => {
          fireNotify('🔄 自动刷新已开启', '将每 30 秒刷新一次数据，并在触发阈值时发送提醒。', 1, isFileProtocol.value, selectedVoice);
        }, 80);
      } else if (Notification.permission === 'default') {
        try {
          Notification.requestPermission().then(r => {
            setTimeout(() => {
              if (r === 'granted') {
                fireNotify('🔄 自动刷新已开启', '将每 30 秒刷新一次数据，并在触发阈值时发送系统通知。', 1, isFileProtocol.value, selectedVoice);
              } else {
                ElementPlus.ElMessage.warning('未开启系统通知。触发阈值时将通过站内消息和语音进行提醒。');
                speakAlert('自动刷新已开启', '未开启系统通知。触发阈值时将通过站内消息和语音进行提醒。', 1, selectedVoice);
              }
            }, 200);
          });
        } catch (e) { }
      } else {
        ElementPlus.ElMessage.warning('通知权限已被手动拒绝。请点击浏览器地址栏左侧 🔒 图标重新允许。\n已自动开启站内消息 + 语音双提醒，不影响使用。');
        speakAlert('自动刷新已开启', '通知权限已拒绝。将使用站内消息加语音进行提醒。', 1, selectedVoice);
      }
    } else {
      speakAlert('自动刷新已开启', '将每 30 秒刷新一次数据。', 1, selectedVoice);
    }

    autoRefresh.value = true;
    autoCountdown.value = 30;
    _countdownTimer.value = setInterval(() => {
      autoCountdown.value--;
      if (autoCountdown.value <= 0) autoCountdown.value = 30;
    }, 1000);
    _autoTimer.value = setInterval(() => {
      if (tableData.value.length > 0 && !loading.value) {
        refreshAllPrices();
      }
    }, 30000);
    refreshAllPrices();
  };

  // 股息相关函数
  const saveDividendStocksToLocal = () => {
    localStorage.setItem('dividend_stocks_v1', JSON.stringify(dividendStockList.value));
  };

  const fetchDividendData = () => {
    const codes = dividendStockList.value.map(item => item.fullCode).filter(c => c);
    if (codes.length === 0) {
      dividendLoading.value = false;
      return;
    }

    dividendLoading.value = true;
    const queryStr = codes.join(',');

    const oldScript = document.getElementById('jsonp-dividend');
    if (oldScript) oldScript.remove();

    const script = document.createElement('script');
    script.id = 'jsonp-dividend';
    script.src = `https://qt.gtimg.cn/q=${queryStr}`;
    document.body.appendChild(script);

    script.onload = () => {
      // 更新 dividendStockList 中的名称和价格
      codes.forEach(code => {
        const dataStr = window[`v_${code}`];
        if (dataStr) {
          const d = dataStr.split('~');
          const nowPrice = parseFloat(d[3]);
          const prevClose = parseFloat(d[4]) || 0;
          const item = dividendStockList.value.find(r => r.fullCode === code);
          if (item) {
            item.name = d[1];
            item.price = nowPrice;
            item.prevClose = prevClose;
          }
        }
      });

      // 更新已有行的价格，保留用户编辑的股息
      dividendTableData.value.forEach(row => {
        const stockItem = dividendStockList.value.find(s => s.fullCode === row.fullCode);
        if (stockItem) {
          row.name = stockItem.name;
          row.price = stockItem.price || 0;
          row.prevClose = stockItem.prevClose || 0;
          calcDividendFields(row);
        }
      });

      // 新增 dividendStockList 中有但表中没有的股票
      const existingCodes = new Set(dividendTableData.value.map(r => r.fullCode));
      dividendStockList.value.forEach(item => {
        if (!existingCodes.has(item.fullCode)) {
          const row = reactive({
            name: item.name,
            fullCode: item.fullCode,
            price: item.price || 0,
            dividendPerShare: item.dividendPerShare || 0
          });
          calcDividendFields(row);
          dividendTableData.value.push(row);
        }
      });

      // 按股息率降序排序
      dividendTableData.value.sort((a, b) => {
        const rateA = a.dividendRate !== null && !isNaN(a.dividendRate) ? a.dividendRate : -Infinity;
        const rateB = b.dividendRate !== null && !isNaN(b.dividendRate) ? b.dividendRate : -Infinity;
        return rateB - rateA;
      });

      saveDividendStocksToLocal();
      localStorage.setItem('dividend_data_v1', JSON.stringify(dividendTableData.value));
      dividendLoading.value = false;
      checkDividendAlerts(dividendTableData.value, dividendAlertFlags.value, (title, body, level) => fireNotify(title, body, level, isFileProtocol.value, selectedVoice), selectedVoice);
    };

    script.onerror = () => {
      dividendLoading.value = false;
      ElementPlus.ElMessage.error('刷新失败，请重试');
    };
  };

  const addDividendCodes = () => {
    const codes = dividendInputCodes.value.split(/[,\s\n]/).map(c => formatCode(c)).filter(c => c);
    if (codes.length === 0) return;

    dividendLoading.value = true;
    const queryStr = codes.join(',');

    const oldScript = document.getElementById('jsonp-dividend');
    if (oldScript) oldScript.remove();

    const script = document.createElement('script');
    script.id = 'jsonp-dividend';
    script.src = `https://qt.gtimg.cn/q=${queryStr}`;
    document.body.appendChild(script);

    script.onload = () => {
      codes.forEach(code => {
        const dataStr = window[`v_${code}`];
        if (dataStr) {
          const d = dataStr.split('~');
          const nowPrice = parseFloat(d[3]);
          const existingIndex = dividendStockList.value.findIndex(item => item.fullCode === code);

          if (existingIndex === -1) {
            dividendStockList.value.unshift({
              name: d[1],
              fullCode: code,
              price: nowPrice,
              dividendPerShare: 0
            });
          }
        }
      });
      dividendInputCodes.value = '';
      dividendLoading.value = false;
      saveDividendStocksToLocal();
      fetchDividendData();
    };

    script.onerror = () => {
      dividendLoading.value = false;
      ElementPlus.ElMessage.error('股票查询失败');
    };
  };

  const removeDividendItem = (index) => {
    dividendStockList.value.splice(index, 1);
    saveDividendStocksToLocal();
    fetchDividendData();
  };

  const refreshDividendData = () => {
    fetchDividendData();
  };

  const toggleAutoDividendRefresh = () => {
    if (autoDividendRefresh.value) {
      autoDividendRefresh.value = false;
      dividendCountdown.value = 60;
      if (_dividendTimer.value) { clearInterval(_dividendTimer.value); _dividendTimer.value = null; }
      if (_dividendCountdownTimer.value) { clearInterval(_dividendCountdownTimer.value); _dividendCountdownTimer.value = null; }
      ElementPlus.ElMessage.success('已关闭股息数据自动刷新。');
      return;
    }

    initAudio();
    ElementPlus.ElMessage.info('开启 60 秒股息数据自动刷新模式。');

    autoDividendRefresh.value = true;
    dividendCountdown.value = 60;
    _dividendCountdownTimer.value = setInterval(() => {
      dividendCountdown.value--;
      if (dividendCountdown.value <= 0) dividendCountdown.value = 60;
    }, 1000);
    _dividendTimer.value = setInterval(() => {
      if (dividendTableData.value.length > 0 && !dividendLoading.value) {
        refreshDividendData();
      }
    }, 60000);
    refreshDividendData();
  };

  const onUpdateDividendPerShareHandler = (row) => {
    calcDividendFields(row);
    // 同步到 dividendStockList
    const stockItem = dividendStockList.value.find(s => s.fullCode === row.fullCode);
    if (stockItem) {
      stockItem.dividendPerShare = row.dividendPerShare;
    }
    saveDividendStocksToLocal();
    localStorage.setItem('dividend_data_v1', JSON.stringify(dividendTableData.value));
    checkDividendAlerts(dividendTableData.value, dividendAlertFlags.value, (title, body, level) => fireNotify(title, body, level, isFileProtocol.value, selectedVoice), selectedVoice);
  };

  // 导出数据
  const openExport = () => {
    exportJsonText.value = JSON.stringify(
      {
        version: 8,
        exportedAt: new Date().toISOString(),
        monitor: { items: tableData.value },
        dividend: {
          stocks: dividendStockList.value,
          data: dividendTableData.value
        }
      },
      null, 2
    );
    exportVisible.value = true;
  };

  const copyExportToClipboard = async () => {
    const txt = exportJsonText.value || '';
    if (!txt) { ElementPlus.ElMessage.warning('尚未生成导出内容'); return; }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(txt);
        ElementPlus.ElMessage.success('✅ 已复制到剪贴板。到目标页面点【📥 导入数据】粘贴即可。');
        return;
      }
    } catch (e) { }
    const ta = document.createElement('textarea');
    ta.value = txt; ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    try {
      document.execCommand('copy');
      ElementPlus.ElMessage.success('✅ 已复制到剪贴板。到目标页面点【📥 导入数据】粘贴即可。');
    } catch (e) {
      ElementPlus.ElMessage.error('复制失败，请手动选中文本复制或改用【下载 JSON 文件】。');
    }
    document.body.removeChild(ta);
  };

  const downloadExportJson = () => {
    const txt = exportJsonText.value || '';
    if (!txt) { ElementPlus.ElMessage.warning('尚未生成导出内容'); return; }
    const blob = new Blob([txt], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    const pad = n => (n < 10 ? '0' : '') + n;
    const name = `project-metrics-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 100);
  };

  const openImport = () => {
    importJsonText.value = '';
    importMode.value = 'merge';
    importVisible.value = true;
  };

  const confirmImport = () => {
    let raw;
    try {
      raw = JSON.parse(importJsonText.value || '{}');
    } catch (e) {
      ElementPlus.ElMessage.error('JSON 解析失败。请确认粘贴的是完整导出内容（以 { 开头）。');
      return;
    }

    // 兼容旧版本格式
    let monitorData = null;
    let dividendData = null;

    if (raw.version && raw.version >= 8) {
      // 新版本格式
      monitorData = raw.monitor?.items;
      dividendData = raw.dividend;
    } else if (Array.isArray(raw)) {
      // 旧版本格式：纯数组
      monitorData = raw;
    } else if (raw.items && Array.isArray(raw.items)) {
      // 旧版本格式：{ items: [...] }
      monitorData = raw.items;
    } else {
      ElementPlus.ElMessage.error('格式不对，无法识别数据类型。');
      return;
    }

    let importCount = 0;

    // 导入监控tab数据
    if (monitorData && Array.isArray(monitorData)) {
      let parsed = monitorData.map(r => ensureFields(Object.assign({}, r)));
      if (!parsed.every(r => r && r.fullCode)) {
        ElementPlus.ElMessage.error('监控数据缺少【编号/名称/fullCode】字段。');
        return;
      }

      if (importMode.value === 'replace') {
        tableData.value = parsed.map(r => reactive(r));
      } else {
        const byCode = new Map();
        tableData.value.forEach(r => byCode.set(r.fullCode, r));
        parsed.forEach(r => {
          byCode.set(r.fullCode, reactive(r));
        });
        tableData.value = Array.from(byCode.values());
      }
      tableData.value.forEach(r => calculateRow(r, saveToLocal));
      importCount += tableData.value.length;
    }

    // 导入红利tab数据
    if (dividendData) {
      if (dividendData.stocks && Array.isArray(dividendData.stocks)) {
        if (importMode.value === 'replace') {
          dividendStockList.value = dividendData.stocks.map(item => ({
            ...item,
            dividendPerShare: item.dividendPerShare || 0
          }));
        } else {
          const byCode = new Map();
          dividendStockList.value.forEach(s => byCode.set(s.fullCode, s));
          dividendData.stocks.forEach(item => {
            byCode.set(item.fullCode, {
              ...item,
              dividendPerShare: item.dividendPerShare || 0
            });
          });
          dividendStockList.value = Array.from(byCode.values());
        }
        saveDividendStocksToLocal();
      }

      if (dividendData.data && Array.isArray(dividendData.data)) {
        if (importMode.value === 'replace') {
          dividendTableData.value = dividendData.data.map(item => reactive({
            ...item,
            dividendPerShare: item.dividendPerShare || 0
          }));
        } else {
          const byCode = new Map();
          dividendTableData.value.forEach(r => byCode.set(r.fullCode, r));
          dividendData.data.forEach(item => {
            byCode.set(item.fullCode, reactive({
              ...item,
              dividendPerShare: item.dividendPerShare || 0
            }));
          });
          dividendTableData.value = Array.from(byCode.values());
        }
        // 按股息率降序排序
        dividendTableData.value.sort((a, b) => {
          const rateA = a.dividendRate !== null && !isNaN(a.dividendRate) ? a.dividendRate : -Infinity;
          const rateB = b.dividendRate !== null && !isNaN(b.dividendRate) ? b.dividendRate : -Infinity;
          return rateB - rateA;
        });
        localStorage.setItem('dividend_data_v1', JSON.stringify(dividendTableData.value));
      }
    }

    // 重置告警标记
    alertFlags.value = {};
    dividendAlertFlags.value = {};
    saveToLocal();
    importVisible.value = false;

    ElementPlus.ElMessage.success(`导入成功！监控 ${tableData.value.length} 条，红利 ${dividendTableData.value.length} 条。`);

    // 刷新价格
    if (tableData.value.length > 0) refreshAllPrices();
    if (dividendTableData.value.length > 0) refreshDividendData();
  };

  onMounted(() => {
    // 恢复告警状态，避免刷新页面后重复告警
    const cachedFlags = localStorage.getItem('alert_flags_v1');
    if (cachedFlags) {
      try { alertFlags.value = JSON.parse(cachedFlags); } catch (e) { }
    }

    const cached = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('phi_batch_table_v6') || localStorage.getItem('phi_batch_table_v5');
    if (cached) {
      tableData.value = JSON.parse(cached).map(item => ensureFields(reactive(item)));
      refreshAllPrices();
      tableData.value.forEach(r => calculateRow(r, saveToLocal));
    }

    const cachedDividendStocks = localStorage.getItem('dividend_stocks_v1');
    if (cachedDividendStocks) {
      try {
        dividendStockList.value = JSON.parse(cachedDividendStocks).map(item => ({
          ...item,
          dividendPerShare: item.dividendPerShare || 0
        }));
      } catch (e) { }
    }

    const cachedDividend = localStorage.getItem('dividend_data_v1');
    if (cachedDividend) {
      try {
        dividendTableData.value = JSON.parse(cachedDividend).map(item => ({
          ...item,
          dividendPerShare: item.dividendPerShare || 0
        }));
        // 按股息率降序排序
        dividendTableData.value.sort((a, b) => {
          const rateA = a.dividendRate !== null && !isNaN(a.dividendRate) ? a.dividendRate : -Infinity;
          const rateB = b.dividendRate !== null && !isNaN(b.dividendRate) ? b.dividendRate : -Infinity;
          return rateB - rateA;
        });
        if (dividendTableData.value.length > 0) {
          const rates = dividendTableData.value.filter(r => r.dividendRate !== null && !isNaN(r.dividendRate)).map(r => r.dividendRate);
          if (rates.length > 0) {
            currentDividendRate.value = rates[0];
            maxDividendRate.value = Math.max(...rates) * 1.2;
          }
        }
      } catch (e) { }
    }

    if (isFileProtocol.value) {
      setTimeout(() => {
        try {
          ElementPlus.ElMessageBox.alert(
            '当前为本地 file:// 模式，浏览器通常会禁用系统通知。\n\n为了完整使用：\n1. 使用 Live Server 等工具以 http://localhost 打开页面（系统通知 + 语音完整）\n2. 数据迁移：先用右上角【📤 导出数据】复制 JSON，切到 localhost 后点【📥 导入数据】粘贴即可。',
            '检测到本地文件模式（file://）',
            { confirmButtonText: '知道了', type: 'warning', showClose: true }
          );
        } catch (e) { }
      }, 150);
    }
  });

  return {
    inputCodes, tableData, loading,
    cfgVisible, cfgRow, cfgChanged,
    isFileProtocol,
    exportVisible, importVisible, exportJsonText, importJsonText, importMode,
    autoRefresh, autoCountdown,
    activeTab,
    dividendInputCodes, dividendStockList,
    dividendTableData, dividendLoading, autoDividendRefresh, dividendCountdown,
    dividendThresholds, currentDividendRate, maxDividendRate,
    addNewCodes, refreshAllPrices, calculateRow: (row) => calculateRow(row, saveToLocal), removeItem, clearAll,
    tableRowClassName, getMarket, getMarketLabel,
    getChgClass, formatChg, getPnlClass,
    openCfg, saveCfg,
    toggleAutoRefresh, testNotify: () => testNotify(isFileProtocol.value, selectedVoice),
    selectedVoice, chineseVoices,
    openExport, copyExportToClipboard, downloadExportJson,
    openImport, confirmImport,
    hasAlert,
    getDividendColor, getDividendClass, getDividendEmoji,
    getDividendChgClass, formatDividendChg, isDividendRateReached,
    getThresholdCount: (threshold) => getThresholdCount(dividendTableData.value, threshold),
    hasDividendAlert: (code) => hasDividendAlert(dividendAlertFlags.value, code),
    addDividendCodes, refreshDividendData, toggleAutoDividendRefresh, removeDividendItem,
    onUpdateDividendPerShare: onUpdateDividendPerShareHandler
  };
}

// 创建并挂载应用
export function mountApp() {
  createApp({
    setup: setupApp
  }).use(ElementPlus).mount('#app');
}