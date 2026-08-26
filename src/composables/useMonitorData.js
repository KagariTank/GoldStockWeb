import { ref } from 'vue'
import { formatCode, ensureFields, calculateRow, formatMoney } from '@/js/utils.js'
import { initAudio, fireNotify, speakAlert } from '@/js/notify.js'
import { createAutoRefreshTimer } from './useTimerManager.js'
import { selectedVoice } from './useVoice.js'
import { isFileProtocol } from './useEnv.js'

// ===== 单例状态（所有组件共享） =====
const STORAGE_KEY = 'phi_batch_table_v7'
const inputCodes = ref('')
const tableData = ref([])
const loading = ref(false)

// 封单追踪
const _prevSealMap = new Map()  // { code: { buy1Vol, sell1Vol } }
const _sealHistoryMap = new Map()  // { code: [{ time, buy1Vol, sell1Vol }, ...] }
const _SEAL_HISTORY_MAX = 30  // 保存最近30条记录（约15分钟）

// Auto refresh - 使用统一定时器管理
const _monitorTimer = createAutoRefreshTimer('monitor', {
  onRefresh: () => {
    if (tableData.value.length > 0 && !loading.value) {
      refreshAllPrices()
    }
  },
  refreshInterval: 30,
  initialCountdown: 30,
  shouldRefresh: () => tableData.value.length > 0 && !loading.value,
  onStart: () => {
    initAudio()
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        setTimeout(() => {
          fireNotify('🔄 自动刷新已开启', '将每 30 秒刷新一次数据，并在触发阈值时发送提醒。', 1, isFileProtocol.value, selectedVoice)
        }, 80)
      } else if (Notification.permission === 'default') {
        try {
          Notification.requestPermission().then(r => {
            setTimeout(() => {
              if (r === 'granted') {
                fireNotify('🔄 自动刷新已开启', '将每 30 秒刷新一次数据，并在触发阈值时发送系统通知。', 1, isFileProtocol.value, selectedVoice)
              } else {
                speakAlert('自动刷新已开启', '未开启系统通知。触发阈值时将通过站内消息和语音进行提醒。', 1, selectedVoice)
              }
            }, 200)
          })
        } catch (e) {
          console.warn('请求通知权限失败:', e)
        }
      } else {
        speakAlert('自动刷新已开启', '通知权限已拒绝。将使用站内消息加语音进行提醒。', 1, selectedVoice)
      }
    } else {
      speakAlert('自动刷新已开启', '将每 30 秒刷新一次数据。', 1, selectedVoice)
    }
    refreshAllPrices()
  },
  onStop: () => {
    // 停止时重置告警状态
  }
})

const autoRefresh = _monitorTimer.isActive
const autoCountdown = _monitorTimer.countdown

// Alert flags
const alertFlags = ref({})
let _alertInitialized = false

// Config dialog
const cfgVisible = ref(false)
const cfgRow = ref(null)
const cfgChanged = ref(false)
const _cfgBackup = ref(null)

// Add position dialog
const addPosVisible = ref(false)
const addPosRow = ref(null)
const addPosForm = ref({
  buyPrice: 0,
  adr20: 0,
  quantity: 0,
  buyDate: ''
})

// Expanded rows
const expandedRows = ref(new Set())

// ===== 单例初始化标记 =====
let _initialized = false

// ===== 方法定义 =====
const saveToLocal = () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tableData.value))
  localStorage.setItem('alert_flags_v1', JSON.stringify(alertFlags.value))
}

const alertTypeKey = (code, type) => `${code}__${type}`

const hasAlert = (code, type) => {
  if (!code) return false
  return !!alertFlags.value[alertTypeKey(code, type)]
}

const checkAlertsForRow = (row, skipNotify = false) => {
  const code = row.fullCode
  const now = parseFloat(row.now)
  if (!now || isNaN(now)) return
  const name = row.name
  const mk = (type) => alertTypeKey(code, type)

  const sl = parseFloat(row.stopLoss)
  if (sl > 0 && now <= sl) {
    if (!alertFlags.value[mk('STOP_LOSS')]) {
      alertFlags.value[mk('STOP_LOSS')] = now
      if (!skipNotify) fireNotify('⚠️ 破位警告', `${name} 已跌破止损 ${sl.toFixed(3)}（当前 ${now}）`, 3, isFileProtocol.value, selectedVoice)
    }
  } else {
    delete alertFlags.value[mk('STOP_LOSS')]
  }

  const tp = parseFloat(row.takeProfit)
  if (tp > 0 && now >= tp) {
    if (!alertFlags.value[mk('TAKE_PROFIT')]) {
      alertFlags.value[mk('TAKE_PROFIT')] = now
      if (!skipNotify) fireNotify('✅ 达标提醒', `${name} 已达止盈 ${tp.toFixed(3)}（当前 ${now}）`, 2, isFileProtocol.value, selectedVoice)
    }
  } else {
    delete alertFlags.value[mk('TAKE_PROFIT')]
  }

  const topL = parseFloat(row.topLine)
  if (topL > 0 && now >= topL) {
    if (!alertFlags.value[mk('TOP_BOUND')]) {
      alertFlags.value[mk('TOP_BOUND')] = now
      if (!skipNotify) fireNotify('📈 触顶提醒', `${name} 上穿8848高位 ${topL.toFixed(3)}（当前 ${now}）`, 1, isFileProtocol.value, selectedVoice)
    }
  } else {
    delete alertFlags.value[mk('TOP_BOUND')]
  }

  const botL = parseFloat(row.bottomLine)
  if (botL > 0 && now <= botL) {
    if (!alertFlags.value[mk('BOT_BOUND')]) {
      alertFlags.value[mk('BOT_BOUND')] = now
      if (!skipNotify) fireNotify('📉 触底提醒', `${name} 下穿8848低位 ${botL.toFixed(3)}（当前 ${now}）`, 1, isFileProtocol.value, selectedVoice)
    }
  } else {
    delete alertFlags.value[mk('BOT_BOUND')]
  }

  const l3 = parseFloat(row.f786)
  if (l3 > 0 && now <= l3) {
    if (!alertFlags.value[mk('L3_THRESH')]) {
      alertFlags.value[mk('L3_THRESH')] = now
      if (!skipNotify) fireNotify('🔻 L3 警戒', `${name} 跌破 L3 阈值 ${l3.toFixed(3)}（当前 ${now}）`, 2, isFileProtocol.value, selectedVoice)
    }
  } else {
    delete alertFlags.value[mk('L3_THRESH')]
  }

  const l2 = parseFloat(row.f618)
  if (l2 > 0 && now <= l2 && !alertFlags.value[mk('L3_THRESH')]) {
    if (!alertFlags.value[mk('L2_THRESH')]) {
      alertFlags.value[mk('L2_THRESH')] = now
      if (!skipNotify) fireNotify('🟠 L2 预警', `${name} 跌破 L2 阈值 ${l2.toFixed(3)}（当前 ${now}）`, 1, isFileProtocol.value, selectedVoice)
    }
  } else {
    delete alertFlags.value[mk('L2_THRESH')]
  }

  // 检查加仓的止盈止损
  if (row.addPositions && row.addPositions.length > 0) {
    row.addPositions.forEach((pos, idx) => {
      const posMk = (type) => alertTypeKey(code, `ADD_${idx}_${type}`)
      
      const posSL = parseFloat(pos.stopLoss)
      if (posSL > 0 && now <= posSL) {
        if (!alertFlags.value[posMk('STOP_LOSS')]) {
          alertFlags.value[posMk('STOP_LOSS')] = now
          if (!skipNotify) fireNotify('⚠️ 加仓破位', `${name} 加仓${idx + 1} 已跌破止损 ${posSL.toFixed(3)}（当前 ${now}）`, 3, isFileProtocol.value, selectedVoice)
        }
      } else {
        delete alertFlags.value[posMk('STOP_LOSS')]
      }

      const posTP = parseFloat(pos.takeProfit)
      if (posTP > 0 && now >= posTP) {
        if (!alertFlags.value[posMk('TAKE_PROFIT')]) {
          alertFlags.value[posMk('TAKE_PROFIT')] = now
          if (!skipNotify) fireNotify('✅ 加仓达标', `${name} 加仓${idx + 1} 已达止盈 ${posTP.toFixed(3)}（当前 ${now}）`, 2, isFileProtocol.value, selectedVoice)
        }
      } else {
        delete alertFlags.value[posMk('TAKE_PROFIT')]
      }
    })
  }
}

const checkAllAlerts = (skipNotify = false) => {
  tableData.value.forEach(row => ensureFields(row))
  tableData.value.forEach(row => checkAlertsForRow(row, skipNotify))
  if (!skipNotify) checkSealAlerts()
}

// 获取股票的涨跌停幅度和价格精度
function getLimitInfo(code, name) {
  // 港股：无涨跌停限制，跳过判断
  if (code.startsWith('hk')) return { skip: true }
  // 科创板 688/689开头：20%，0.001精度
  if (code.startsWith('sh688') || code.startsWith('sh689')) return { pct: 0.20, tick: 0.001 }
  // 科创板ETF 588开头：20%，0.001精度
  if (code.startsWith('sh588')) return { pct: 0.20, tick: 0.001 }
  // 创业板 300/301开头：20%，0.001精度
  if (code.startsWith('sz300') || code.startsWith('sz301')) return { pct: 0.20, tick: 0.001 }
  // 创业板ETF 159开头：20%，0.001精度
  if (code.startsWith('sz159')) return { pct: 0.20, tick: 0.001 }
  // 可转债：20%，0.001精度（沪市sh113/sh118/sh110，深市sz123/sz127/sz128）
  if (/^(sh113|sh118|sh110|sz123|sz127|sz128)/.test(code)) return { pct: 0.20, tick: 0.001 }
  // 北交所：30%，0.001精度
  if (code.startsWith('bj')) return { pct: 0.30, tick: 0.001 }
  // 主板ST股票：5%，0.01精度（仅主板适用，科创板/创业板ST仍为20%）
  if (name && name.toUpperCase().includes('ST')) return { pct: 0.05, tick: 0.01 }
  // 主板/普通ETF：10%，0.01精度
  return { pct: 0.10, tick: 0.01 }
}

// 按精度四舍五入到实际涨跌停价
function roundLimitPrice(price, tick) {
  return Math.round(price / tick) * tick
}

// 判断是否涨停
function isLimitUp(row) {
  const prevClose = row.prevClose || 0
  const currPrice = row.now || 0
  const info = getLimitInfo(row.fullCode, row.name)
  if (info.skip) return false
  
  const { pct, tick } = info
  if (prevClose <= 0 || currPrice <= 0) return false
  
  const limitPrice = roundLimitPrice(prevClose * (1 + pct), tick)
  // 现价 >= 涨停价（按精度取整后的实际涨停价）
  return currPrice >= limitPrice
}

// 判断是否跌停
function isLimitDown(row) {
  const prevClose = row.prevClose || 0
  const currPrice = row.now || 0
  const info = getLimitInfo(row.fullCode, row.name)
  if (info.skip) return false
  
  const { pct, tick } = info
  if (prevClose <= 0 || currPrice <= 0) return false
  
  const limitPrice = roundLimitPrice(prevClose * (1 - pct), tick)
  // 现价 <= 跌停价（按精度取整后的实际跌停价）
  return currPrice <= limitPrice
}

// 根据市值获取安全阈值
function getSealThreshold(marketCap) {
  if (marketCap < 30e8) return { safe: 3, danger: 1 }      // <30亿
  if (marketCap < 100e8) return { safe: 2, danger: 0.8 }   // 30~100亿
  if (marketCap < 300e8) return { safe: 1.5, danger: 0.5 } // 100~300亿
  if (marketCap < 1000e8) return { safe: 1, danger: 0.3 }  // 300~1000亿
  return { safe: 0.5, danger: 0.15 }                       // >1000亿
}

const checkSealAlerts = () => {
  tableData.value.forEach(row => {
    const code = row.fullCode
    const name = row.name
    const currBuyVol = row.buy1Vol || 0
    const currSellVol = row.sell1Vol || 0
    const currBuyPrice = row.buy1Price || 0
    const currSellPrice = row.sell1Price || 0
    const currPrice = row.now || 0
    const marketCapFloat = row.marketCapFloat || 0  // 流通市值（亿）

    // 先判断是否涨停/跌停
    const limitUp = isLimitUp(row)
    const limitDown = isLimitDown(row)
    
    // 清除之前的分析结果
    if (!limitUp && !limitDown) {
      row.sealAnalysis = null
      _prevSealMap.delete(code)
      _sealHistoryMap.delete(code)
      return
    }

    const limitType = limitUp ? '涨停' : '跌停'
    const sealVol = limitUp ? currBuyVol : currSellVol  // 封单量（手）
    const sealPrice = limitUp ? currBuyPrice : currSellPrice

    // 计算封单金额 = 封单量(手) × 100股/手 × 价格
    const sealAmount = sealVol * 100 * sealPrice

    // 使用接口返回的流通市值（亿），转换为元
    const marketCap = marketCapFloat * 1e8

    // 封单占比 = 封单金额 / 流通市值 × 100%
    const sealPct = marketCap > 0 ? (sealAmount / marketCap) * 100 : 0

    // 获取阈值
    const threshold = getSealThreshold(marketCapFloat * 1e8)

    // 记录历史数据（保存封单金额用于趋势判定）
    const now = new Date()
    const timeKey = now.getHours() * 60 + now.getMinutes()
    const history = _sealHistoryMap.get(code) || []
    history.push({ time: timeKey, sealAmount: sealAmount })
    if (history.length > _SEAL_HISTORY_MAX) history.shift()
    _sealHistoryMap.set(code, history)

    // 趋势判定（对比5分钟前）
    let trend = 'new'  // new/增强/稳定/减弱/骤减
    let trendDesc = '数据不足'
    if (history.length >= 10) {
      const fiveMinAgo = history[history.length - 10]
      if (fiveMinAgo.sealAmount > 0) {
        const change = (sealAmount - fiveMinAgo.sealAmount) / fiveMinAgo.sealAmount
        if (change > 0.05) {
          trend = 'strengthen'
          trendDesc = `封单增强(+${(change * 100).toFixed(1)}%)`
        } else if (change >= -0.05) {
          trend = 'stable'
          trendDesc = `封单稳定(${(change * 100).toFixed(1)}%)`
        } else if (change >= -0.30) {
          trend = 'weaken'
          trendDesc = `封单减弱预警(${(change * 100).toFixed(1)}%)`
        } else {
          trend = 'crash'
          trendDesc = `封单骤减(危险)(${(change * 100).toFixed(1)}%)`
        }
      }
    }

    // 输出等级
    let level = 0  // 0=安全, 1=注意, 2=警惕, 3=高危
    let levelLabel = ''

    if (trend === 'crash' || sealPct < threshold.danger) {
      // 高危：封单骤减 或 封单占比低于危险阈值
      level = 3
      levelLabel = '高危（随时炸板）'
    } else if (sealPct >= threshold.safe && (trend === 'strengthen' || trend === 'stable' || trend === 'new')) {
      // 安全：封单占比 ≥ 安全阈值 且 趋势为增强或稳定
      level = 0
      levelLabel = '安全'
    } else if (sealPct >= threshold.safe && trend === 'weaken') {
      // 注意：封单占比 ≥ 安全阈值 但趋势减弱
      level = 1
      levelLabel = '注意'
    } else {
      // 警惕：封单占比介于安全与危险之间
      level = 2
      levelLabel = '警惕'
    }

    // 保存风险评估结果
    row.sealAnalysis = {
      limitType: limitType,
      sealAmount: sealAmount,
      sealPct: sealPct.toFixed(2),
      marketCap: marketCap,
      threshold: threshold,
      trend: trend,
      trendDesc: trendDesc,
      level: level,
      levelLabel: levelLabel
    }

    // 高危触发告警
    if (level === 3) {
      const dangerMsg = [
        `当前股价: ${currPrice}`,
        `${limitType}封单金额: ${formatMoney(sealAmount)}`,
        `封单占比: ${sealPct.toFixed(2)}%（危险阈值${threshold.danger}%）`,
        `趋势: ${trendDesc}`,
      ]
      
      fireNotify(
        '🔴 封单高危',
        `${name}(${code}) ${levelLabel}，${dangerMsg.join(' | ')}`,
        2,
        isFileProtocol.value,
        selectedVoice
      )
    }

    _prevSealMap.set(code, { sealAmount: sealAmount })
  })
}

const fetchData = (codes, isAddition = true) => {
  if (codes.length === 0) return
  loading.value = true
  const queryStr = codes.join(',')

  const oldScript = document.getElementById('jsonp-stock')
  if (oldScript) oldScript.remove()

  const script = document.createElement('script')
  script.id = 'jsonp-stock'
  script.src = `https://qt.gtimg.cn/q=${queryStr}`
  document.body.appendChild(script)

  script.onload = () => {
    codes.forEach(code => {
      const dataStr = window[`v_${code}`]
      if (dataStr) {
        const d = dataStr.split('~')
        const nowPrice = parseFloat(d[3])
        const prevClosePrice = parseFloat(d[4]) || 0

        let turnover = parseFloat(d[37])
        let volume = parseFloat(d[36])

        let newAvg = 0
        if (code.startsWith('hk')) {
          newAvg = volume > 0 ? turnover / volume : prevClosePrice
        } else {
          newAvg = volume > 0 ? (turnover * 10000) / (volume * 100) : prevClosePrice
        }

        const existingIndex = tableData.value.findIndex(item => item.fullCode === code)

        // 解析买卖盘口数据
        const buy1Price = parseFloat(d[9]) || 0
        const buy1Vol = parseFloat(d[10]) || 0
        const sell1Price = parseFloat(d[19]) || 0
        const sell1Vol = parseFloat(d[20]) || 0
        
        // 解析封单分析所需字段
        const turnoverVol = parseFloat(d[36]) || 0  // 成交量（手）
        const timeStr = d[30] || ''  // 时间 HHMMSS
        const changePct = parseFloat(d[32]) || 0  // 涨跌幅
        const outstandingShares = parseFloat(d[38]) || 0  // 流通股本（万股）
        const marketCapFloat = parseFloat(d[44]) || 0  // 流通市值（亿）

        if (existingIndex > -1) {
          const item = tableData.value[existingIndex]
          item.now = nowPrice
          item.prevClose = prevClosePrice
          item.avg = parseFloat(newAvg.toFixed(3))
          item.buy1Price = buy1Price
          item.buy1Vol = buy1Vol
          item.sell1Price = sell1Price
          item.sell1Vol = sell1Vol
          item.turnoverVol = turnoverVol
          item.time = timeStr
          item.changePct = changePct
          item.outstandingShares = outstandingShares  // 流通股本（万股）
          item.marketCapFloat = marketCapFloat  // 流通市值（亿）
          ensureFields(item)
          if (nowPrice > (parseFloat(item.maxSinceBuy) || 0)) item.maxSinceBuy = parseFloat(nowPrice.toFixed(3))
          calculateRow(item, saveToLocal)
        } else if (isAddition) {
          const newItem = {
            name: d[1],
            fullCode: code,
            now: nowPrice,
            prevClose: prevClosePrice,
            high: parseFloat(d[33]) || nowPrice,
            low: parseFloat(d[34]) || nowPrice,
            avg: parseFloat(newAvg.toFixed(3)),
            buy1Price,
            buy1Vol,
            sell1Price,
            sell1Vol,
            turnoverVol,
            time: timeStr,
            changePct,
            outstandingShares: outstandingShares,  // 流通股本（万股）
            marketCapFloat: marketCapFloat,  // 流通市值（亿）
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
            _toTPNum: 0, _toSLNum: 0,
            addPositions: []
          }
          calculateRow(newItem, saveToLocal)
          tableData.value.unshift(newItem)
        }
      }
    })
    loading.value = false
    saveToLocal()
    if (isAddition) inputCodes.value = ""
    // 刷新数据时总是检查告警（skipNotify只在首次加载时为true）
    checkAllAlerts(!_alertInitialized)
    _alertInitialized = true
  }

  script.onerror = () => {
    console.warn('行情数据请求失败（腾讯 JSONP），可能是网络问题或接口被限流')
    loading.value = false
    script.remove()
  }
}

const addNewCodes = () => {
  const codes = inputCodes.value.split(/[,\s\n]/).map(c => formatCode(c)).filter(c => c)
  if (codes.length > 0) fetchData(codes, true)
}

const refreshAllPrices = () => {
  const currentCodes = tableData.value.map(item => item.fullCode)
  if (currentCodes.length > 0) {
    fetchData(currentCodes, false)
  }
}

const openCfg = (row) => {
  if (!row) return
  ensureFields(row)
  _cfgBackup.value = JSON.parse(JSON.stringify({
    high: row.high,
    low: row.low,
    adr20: row.adr20,
    buyDate: row.buyDate,
    buyPrice: row.buyPrice,
    quantity: row.quantity
  }))
  cfgRow.value = row
  cfgChanged.value = false
  cfgVisible.value = true
}

const saveCfg = () => {
  if (cfgRow.value) {
    calculateRow(cfgRow.value, saveToLocal)
    saveToLocal()
  }
  cfgVisible.value = false
  cfgRow.value = null
  _cfgBackup.value = null
}

const removeItem = (index) => {
  tableData.value.splice(index, 1)
  saveToLocal()
}

const clearAll = () => {
  if (confirm('确定清空所有数据吗？')) {
    tableData.value = []
    saveToLocal()
  }
}

const toggleAutoRefresh = () => {
  _monitorTimer.toggle()
}

// Add position methods
const openAddPos = (row) => {
  if (!row) return
  ensureFields(row)
  addPosRow.value = row
  addPosForm.value = {
    buyPrice: parseFloat(row.now) || 0,
    adr20: parseFloat(row.adr20) || 0,
    quantity: 0,
    buyDate: new Date().toISOString().slice(0, 10)
  }
  addPosVisible.value = true
}

const saveAddPos = () => {
  if (!addPosRow.value) return
  if (!addPosRow.value.addPositions) {
    addPosRow.value.addPositions = []
  }
  const newPos = {
    id: 'pos_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    buyPrice: parseFloat(addPosForm.value.buyPrice) || 0,
    adr20: parseFloat(addPosForm.value.adr20) || 0,
    quantity: parseInt(addPosForm.value.quantity) || 0,
    buyDate: addPosForm.value.buyDate || '',
    maxSinceBuy: 0,
    takeProfit: '',
    stopLoss: '',
    pnlAmount: '',
    pnlPct: '',
    toTPPct: '',
    toSLPct: '',
    _toTPNum: 0,
    _toSLNum: 0
  }
  addPosRow.value.addPositions.push(newPos)
  calculateRow(addPosRow.value, saveToLocal)
  saveToLocal()
  addPosVisible.value = false
  addPosRow.value = null
}

const removeAddPos = (row, posId) => {
  if (!row || !row.addPositions) return
  const idx = row.addPositions.findIndex(p => p.id === posId)
  if (idx !== -1) {
    row.addPositions.splice(idx, 1)
    saveToLocal()
  }
}

// Expanded rows
const toggleRowExpand = (row) => {
  const key = row.fullCode
  if (expandedRows.value.has(key)) {
    expandedRows.value.delete(key)
  } else {
    expandedRows.value.add(key)
  }
}

const isRowExpanded = (row) => expandedRows.value.has(row.fullCode)

// ===== 初始化函数（只执行一次） =====
const initializeOnce = () => {
  if (_initialized) return
  _initialized = true

  // Restore alert flags
  const cachedFlags = localStorage.getItem('alert_flags_v1')
  if (cachedFlags) {
    try { alertFlags.value = JSON.parse(cachedFlags) } catch (e) { console.warn('解析缓存的告警标记失败:', e) }
  }

  // Restore monitor data
  const cached = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('phi_batch_table_v6') || localStorage.getItem('phi_batch_table_v5')
  if (cached) {
    tableData.value = JSON.parse(cached).map(item => ensureFields(item))
    refreshAllPrices()
    tableData.value.forEach(r => calculateRow(r, saveToLocal))
  }
}

export function useMonitorData() {
  // 确保只初始化一次
  initializeOnce()

  return {
    // State
    inputCodes,
    tableData,
    loading,
    autoRefresh,
    autoCountdown,
    alertFlags,
    cfgVisible,
    cfgRow,
    cfgChanged,
    addPosVisible,
    addPosRow,
    addPosForm,
    expandedRows,
    isFileProtocol,
    selectedVoice,

    // Methods
    saveToLocal,
    hasAlert,
    checkAllAlerts,
    fetchData,
    addNewCodes,
    refreshAllPrices,
    openCfg,
    saveCfg,
    removeItem,
    clearAll,
    toggleAutoRefresh,
    openAddPos,
    saveAddPos,
    removeAddPos,
    toggleRowExpand,
    isRowExpanded
  }
}