import { ref, onMounted, onBeforeUnmount } from 'vue'
import { formatCode, ensureFields, calculateRow } from '@/js/utils.js'
import { initAudio, fireNotify, speakAlert } from '@/js/notify.js'

// ===== 单例状态（所有组件共享） =====
const STORAGE_KEY = 'phi_batch_table_v7'
const inputCodes = ref('')
const tableData = ref([])
const loading = ref(false)

// Auto refresh
const autoRefresh = ref(false)
const autoCountdown = ref(30)
const _autoTimer = ref(null)
const _countdownTimer = ref(null)

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

// Is file protocol
const isFileProtocol = ref(false)
try {
  isFileProtocol.value = /^file:$/i.test(window.location.protocol)
} catch (e) {}

// Selected voice
const selectedVoice = ref('')

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

        if (existingIndex > -1) {
          const item = tableData.value[existingIndex]
          item.now = nowPrice
          item.prevClose = prevClosePrice
          item.avg = parseFloat(newAvg.toFixed(3))
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
    checkAllAlerts(!_alertInitialized || !isAddition)
    _alertInitialized = true
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
  if (autoRefresh.value) {
    autoRefresh.value = false
    autoCountdown.value = 30
    if (_autoTimer.value) { clearInterval(_autoTimer.value); _autoTimer.value = null }
    if (_countdownTimer.value) { clearInterval(_countdownTimer.value); _countdownTimer.value = null }
    return
  }

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
      } catch (e) {}
    } else {
      speakAlert('自动刷新已开启', '通知权限已拒绝。将使用站内消息加语音进行提醒。', 1, selectedVoice)
    }
  } else {
    speakAlert('自动刷新已开启', '将每 30 秒刷新一次数据。', 1, selectedVoice)
  }

  autoRefresh.value = true
  autoCountdown.value = 30
  _countdownTimer.value = setInterval(() => {
    autoCountdown.value--
    if (autoCountdown.value <= 0) autoCountdown.value = 30
  }, 1000)
  _autoTimer.value = setInterval(() => {
    if (tableData.value.length > 0 && !loading.value) {
      refreshAllPrices()
    }
  }, 30000)
  refreshAllPrices()
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
    try { alertFlags.value = JSON.parse(cachedFlags) } catch (e) {}
  }

  // Restore monitor data
  const cached = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('phi_batch_table_v6') || localStorage.getItem('phi_batch_table_v5')
  if (cached) {
    tableData.value = JSON.parse(cached).map(item => ensureFields(item))
    refreshAllPrices()
    tableData.value.forEach(r => calculateRow(r, saveToLocal))
  }
}

export function useMonitorData(voiceRef) {
  // 确保只初始化一次
  initializeOnce()

  // Update selected voice if provided
  if (voiceRef && voiceRef.value) {
    selectedVoice.value = voiceRef.value
  }

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