<script setup>
import { ref, onMounted, computed, onBeforeUnmount } from 'vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Textarea from '@/components/ui/Textarea.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Dropdown from '@/components/ui/Dropdown.vue'
import NumberInput from '@/components/ui/NumberInput.vue'
import DatePicker from '@/components/ui/DatePicker.vue'
import Tabs from '@/components/ui/Tabs.vue'
import FormItem from '@/components/ui/FormItem.vue'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell, TableExpandRow } from '@/components/ui/Table'

import { formatCode, getMarket, getMarketLabel, getChgClass, formatChg, getPnlClass, ensureFields, tableRowClassName, calculateRow, calculatePosition } from '@/js/utils.js'
import { initVoices, initAudio, fireNotify, speakAlert, testNotify, clearAllNotifications } from '@/js/notify.js'
import { getDividendColor, getDividendClass, getDividendEmoji, getThresholdCount, dividendAlertTypeKey, hasDividendAlert, checkDividendAlerts, isDividendRateReached, getDividendChgClass, formatDividendChg, calcDividendFields, onUpdateDividendPerShare } from '@/js/dividend.js'

// State
const STORAGE_KEY = 'phi_batch_table_v7'
const inputCodes = ref('')
const tableData = ref([])
const loading = ref(false)
const activeTab = ref('monitor')

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

// Export/Import
const exportVisible = ref(false)
const importVisible = ref(false)
const exportJsonText = ref('')
const importJsonText = ref('')
const importMode = ref('merge')

// Auto refresh
const autoRefresh = ref(false)
const autoCountdown = ref(30)
const _autoTimer = ref(null)
const _countdownTimer = ref(null)

// Voice
const selectedVoice = ref('')
const chineseVoices = ref([])

// Alert flags
const alertFlags = ref({})
let _alertInitialized = false

// Dividend
const dividendInputCodes = ref('')
const dividendStockList = ref([])
const dividendTableData = ref([])
const dividendLoading = ref(false)
const autoDividendRefresh = ref(false)
const dividendCountdown = ref(60)
const _dividendTimer = ref(null)
const _dividendCountdownTimer = ref(null)
const dividendAlertFlags = ref({})
const currentDividendRate = ref(0)
const maxDividendRate = ref(10)

// Is file protocol
const isFileProtocol = ref(false)
try {
  isFileProtocol.value = /^file:$/i.test(window.location.protocol)
} catch (e) {}

// Tab options
const tabOptions = [
  { label: '指标监控', value: 'monitor' },
  { label: '红利股息监控', value: 'dividend' }
]

// Dividend thresholds
const dividendThresholds = [
  { value: 6, label: '≥6%', colorClass: 'dot-green' },
  { value: 5.5, label: '≥5.5%', colorClass: 'dot-yellow' },
  { value: 5, label: '≥5%', colorClass: 'dot-orange' },
  { value: 4.5, label: '≥4.5%', colorClass: 'dot-red' }
]

// Methods
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
    checkAllAlerts(!_alertInitialized)
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

// Voice dropdown
const onDropdownCommand = (command) => {
  if (command === 'test') {
    testNotify(isFileProtocol.value, selectedVoice)
  } else {
    selectedVoice.value = command
  }
}

// Export/Import
const openExport = () => {
  exportJsonText.value = JSON.stringify({
    version: 8,
    exportedAt: new Date().toISOString(),
    monitor: { items: tableData.value },
    dividend: {
      stocks: dividendStockList.value,
      data: dividendTableData.value
    }
  }, null, 2)
  exportVisible.value = true
}

const copyExportToClipboard = async () => {
  const txt = exportJsonText.value || ''
  if (!txt) {
    alert('尚未生成导出内容')
    return
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(txt)
      alert('✅ 已复制到剪贴板')
      return
    }
  } catch (e) {}
  const ta = document.createElement('textarea')
  ta.value = txt
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand('copy')
    alert('✅ 已复制到剪贴板')
  } catch (e) {
    alert('复制失败，请手动选中文本复制')
  }
  document.body.removeChild(ta)
}

const downloadExportJson = () => {
  const txt = exportJsonText.value || ''
  if (!txt) {
    alert('尚未生成导出内容')
    return
  }
  const blob = new Blob([txt], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const d = new Date()
  const pad = n => (n < 10 ? '0' : '') + n
  const name = `project-metrics-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    URL.revokeObjectURL(url)
    document.body.removeChild(a)
  }, 100)
}

const openImport = () => {
  importJsonText.value = ''
  importMode.value = 'merge'
  importVisible.value = true
}

const confirmImport = () => {
  let raw
  try {
    raw = JSON.parse(importJsonText.value || '{}')
  } catch (e) {
    alert('JSON 解析失败。请确认粘贴的是完整导出内容（以 { 开头）。')
    return
  }

  let monitorData = null
  let dividendData = null

  if (raw.version && raw.version >= 8) {
    monitorData = raw.monitor?.items
    dividendData = raw.dividend
  } else if (Array.isArray(raw)) {
    monitorData = raw
  } else if (raw.items && Array.isArray(raw.items)) {
    monitorData = raw.items
  } else {
    alert('格式不对，无法识别数据类型。')
    return
  }

  let importCount = 0

  // Import monitor data
  if (monitorData && Array.isArray(monitorData)) {
    const parsed = monitorData.map(r => ensureFields(Object.assign({}, r)))
    if (!parsed.every(r => r && r.fullCode)) {
      alert('监控数据缺少【编号/名称/fullCode】字段。')
      return
    }

    if (importMode.value === 'replace') {
      tableData.value = parsed
    } else {
      const byCode = new Map()
      tableData.value.forEach(r => byCode.set(r.fullCode, r))
      parsed.forEach(r => {
        byCode.set(r.fullCode, r)
      })
      tableData.value = Array.from(byCode.values())
    }
    tableData.value.forEach(r => calculateRow(r, saveToLocal))
    importCount += tableData.value.length
  }

  // Import dividend data
  if (dividendData) {
    if (dividendData.stocks && Array.isArray(dividendData.stocks)) {
      if (importMode.value === 'replace') {
        dividendStockList.value = dividendData.stocks.map(item => ({
          ...item,
          dividendPerShare: item.dividendPerShare || 0
        }))
      } else {
        const byCode = new Map()
        dividendStockList.value.forEach(s => byCode.set(s.fullCode, s))
        dividendData.stocks.forEach(item => {
          byCode.set(item.fullCode, {
            ...item,
            dividendPerShare: item.dividendPerShare || 0
          })
        })
        dividendStockList.value = Array.from(byCode.values())
      }
      saveDividendStocksToLocal()
    }

    if (dividendData.data && Array.isArray(dividendData.data)) {
      if (importMode.value === 'replace') {
        dividendTableData.value = dividendData.data.map(item => ({
          ...item,
          dividendPerShare: item.dividendPerShare || 0
        }))
      } else {
        const byCode = new Map()
        dividendTableData.value.forEach(r => byCode.set(r.fullCode, r))
        dividendData.data.forEach(item => {
          byCode.set(item.fullCode, {
            ...item,
            dividendPerShare: item.dividendPerShare || 0
          })
        })
        dividendTableData.value = Array.from(byCode.values())
      }
      // Sort by dividend rate descending
      dividendTableData.value.sort((a, b) => {
        const rateA = a.dividendRate !== null && !isNaN(a.dividendRate) ? a.dividendRate : -Infinity
        const rateB = b.dividendRate !== null && !isNaN(b.dividendRate) ? b.dividendRate : -Infinity
        return rateB - rateA
      })
      localStorage.setItem('dividend_data_v1', JSON.stringify(dividendTableData.value))
    }
  }

  // Reset alert flags
  alertFlags.value = {}
  dividendAlertFlags.value = {}
  saveToLocal()
  importVisible.value = false

  alert(`导入成功！监控 ${tableData.value.length} 条，红利 ${dividendTableData.value.length} 条。`)

  // Refresh prices
  if (tableData.value.length > 0) refreshAllPrices()
  if (dividendTableData.value.length > 0) refreshDividendData()
}

// Dividend methods
const saveDividendStocksToLocal = () => {
  localStorage.setItem('dividend_stocks_v1', JSON.stringify(dividendStockList.value))
}

const fetchDividendData = () => {
  const codes = dividendStockList.value.map(item => item.fullCode).filter(c => c)
  if (codes.length === 0) {
    dividendLoading.value = false
    return
  }

  dividendLoading.value = true
  const queryStr = codes.join(',')

  const oldScript = document.getElementById('jsonp-dividend')
  if (oldScript) oldScript.remove()

  const script = document.createElement('script')
  script.id = 'jsonp-dividend'
  script.src = `https://qt.gtimg.cn/q=${queryStr}`
  document.body.appendChild(script)

  script.onload = () => {
    codes.forEach(code => {
      const dataStr = window[`v_${code}`]
      if (dataStr) {
        const d = dataStr.split('~')
        const nowPrice = parseFloat(d[3])
        const prevClose = parseFloat(d[4]) || 0
        const item = dividendStockList.value.find(r => r.fullCode === code)
        if (item) {
          item.name = d[1]
          item.price = nowPrice
          item.prevClose = prevClose
        }
      }
    })

    // Update existing rows
    dividendTableData.value.forEach(row => {
      const stockItem = dividendStockList.value.find(s => s.fullCode === row.fullCode)
      if (stockItem) {
        row.name = stockItem.name
        row.price = stockItem.price || 0
        row.prevClose = stockItem.prevClose || 0
        calcDividendFields(row)
      }
    })

    // Add new stocks
    const existingCodes = new Set(dividendTableData.value.map(r => r.fullCode))
    dividendStockList.value.forEach(item => {
      if (!existingCodes.has(item.fullCode)) {
        const row = {
          name: item.name,
          fullCode: item.fullCode,
          price: item.price || 0,
          prevClose: item.prevClose || 0,
          dividendPerShare: item.dividendPerShare || 0
        }
        calcDividendFields(row)
        dividendTableData.value.push(row)
      }
    })

    // Sort by dividend rate descending
    dividendTableData.value.sort((a, b) => {
      const rateA = a.dividendRate !== null && !isNaN(a.dividendRate) ? a.dividendRate : -Infinity
      const rateB = b.dividendRate !== null && !isNaN(b.dividendRate) ? b.dividendRate : -Infinity
      return rateB - rateA
    })

    saveDividendStocksToLocal()
    localStorage.setItem('dividend_data_v1', JSON.stringify(dividendTableData.value))
    dividendLoading.value = false
    checkDividendAlerts(dividendTableData.value, dividendAlertFlags.value, (title, body, level) => fireNotify(title, body, level, isFileProtocol.value, selectedVoice), selectedVoice)
  }

  script.onerror = () => {
    dividendLoading.value = false
    alert('刷新失败，请重试')
  }
}

const addDividendCodes = () => {
  const codes = dividendInputCodes.value.split(/[,\s\n]/).map(c => formatCode(c)).filter(c => c)
  if (codes.length === 0) return

  dividendLoading.value = true
  const queryStr = codes.join(',')

  const oldScript = document.getElementById('jsonp-dividend')
  if (oldScript) oldScript.remove()

  const script = document.createElement('script')
  script.id = 'jsonp-dividend'
  script.src = `https://qt.gtimg.cn/q=${queryStr}`
  document.body.appendChild(script)

  script.onload = () => {
    codes.forEach(code => {
      const dataStr = window[`v_${code}`]
      if (dataStr) {
        const d = dataStr.split('~')
        const nowPrice = parseFloat(d[3])
        const existingIndex = dividendStockList.value.findIndex(item => item.fullCode === code)

        if (existingIndex === -1) {
          dividendStockList.value.unshift({
            name: d[1],
            fullCode: code,
            price: nowPrice,
            dividendPerShare: 0
          })
        }
      }
    })
    dividendInputCodes.value = ''
    dividendLoading.value = false
    saveDividendStocksToLocal()
    fetchDividendData()
  }

  script.onerror = () => {
    dividendLoading.value = false
    alert('股票查询失败')
  }
}

const removeDividendItem = (index) => {
  // 从 dividendTableData 和 dividendStockList 中同步移除
  const removedItem = dividendTableData.value[index]
  dividendTableData.value.splice(index, 1)
  
  if (removedItem && removedItem.fullCode) {
    const stockIndex = dividendStockList.value.findIndex(s => s.fullCode === removedItem.fullCode)
    if (stockIndex !== -1) {
      dividendStockList.value.splice(stockIndex, 1)
    }
  }
  
  saveDividendStocksToLocal()
}

const refreshDividendData = () => {
  fetchDividendData()
}

const toggleAutoDividendRefresh = () => {
  if (autoDividendRefresh.value) {
    autoDividendRefresh.value = false
    dividendCountdown.value = 60
    if (_dividendTimer.value) { clearInterval(_dividendTimer.value); _dividendTimer.value = null }
    if (_dividendCountdownTimer.value) { clearInterval(_dividendCountdownTimer.value); _dividendCountdownTimer.value = null }
    return
  }

  initAudio()

  autoDividendRefresh.value = true
  dividendCountdown.value = 60
  _dividendCountdownTimer.value = setInterval(() => {
    dividendCountdown.value--
    if (dividendCountdown.value <= 0) dividendCountdown.value = 60
  }, 1000)
  _dividendTimer.value = setInterval(() => {
    if (dividendTableData.value.length > 0 && !dividendLoading.value) {
      refreshDividendData()
    }
  }, 60000)
  refreshDividendData()
}

const onUpdateDividendPerShareHandler = (row) => {
  calcDividendFields(row)
  const stockItem = dividendStockList.value.find(s => s.fullCode === row.fullCode)
  if (stockItem) {
    stockItem.dividendPerShare = row.dividendPerShare
  }
  saveDividendStocksToLocal()
  localStorage.setItem('dividend_data_v1', JSON.stringify(dividendTableData.value))
  checkDividendAlerts(dividendTableData.value, dividendAlertFlags.value, (title, body, level) => fireNotify(title, body, level, isFileProtocol.value, selectedVoice), selectedVoice)
}

// Computed
const expandedRows = ref(new Set())
const toggleRowExpand = (row) => {
  const key = row.fullCode
  if (expandedRows.value.has(key)) {
    expandedRows.value.delete(key)
  } else {
    expandedRows.value.add(key)
  }
}
const isRowExpanded = (row) => expandedRows.value.has(row.fullCode)

// Initialize voices
let voicesInitAttempted = false
const ensureVoicesInit = () => {
  if (voicesInitAttempted) return
  voicesInitAttempted = true
  initVoices(chineseVoices, selectedVoice)
}

// Lifecycle
onMounted(() => {
  // Init voices
  if ('speechSynthesis' in window) {
    const initOnUserAction = () => {
      ensureVoicesInit()
      document.removeEventListener('click', initOnUserAction)
      document.removeEventListener('keydown', initOnUserAction)
    }
    document.addEventListener('click', initOnUserAction, { once: true })
    document.addEventListener('keydown', initOnUserAction, { once: true })
    setTimeout(ensureVoicesInit, 500)
  }

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

  // Restore dividend stocks
  const cachedDividendStocks = localStorage.getItem('dividend_stocks_v1')
  if (cachedDividendStocks) {
    try {
      dividendStockList.value = JSON.parse(cachedDividendStocks).map(item => ({
        ...item,
        dividendPerShare: item.dividendPerShare || 0
      }))
    } catch (e) {}
  }

  // Restore dividend data
  const cachedDividend = localStorage.getItem('dividend_data_v1')
  if (cachedDividend) {
    try {
      dividendTableData.value = JSON.parse(cachedDividend).map(item => ({
        ...item,
        dividendPerShare: item.dividendPerShare || 0
      }))
      // Sort by dividend rate descending
      dividendTableData.value.sort((a, b) => {
        const rateA = a.dividendRate !== null && !isNaN(a.dividendRate) ? a.dividendRate : -Infinity
        const rateB = b.dividendRate !== null && !isNaN(b.dividendRate) ? b.dividendRate : -Infinity
        return rateB - rateA
      })
      if (dividendTableData.value.length > 0) {
        const rates = dividendTableData.value.filter(r => r.dividendRate !== null && !isNaN(r.dividendRate)).map(r => r.dividendRate)
        if (rates.length > 0) {
          currentDividendRate.value = rates[0]
          maxDividendRate.value = Math.max(...rates) * 1.2
        }
      }
    } catch (e) {}
  }

  // File protocol warning
  if (isFileProtocol.value) {
    setTimeout(() => {
      alert('当前为本地 file:// 模式，浏览器通常会禁用系统通知。\n\n为了完整使用：\n1. 使用 Live Server 等工具以 http://localhost 打开页面（系统通知 + 语音完整）\n2. 数据迁移：先用右上角【📤 导出数据】复制 JSON，切到 localhost 后点【📥 导入数据】粘贴即可。')
    }, 150)
  }
})

onBeforeUnmount(() => {
  if (_autoTimer.value) clearInterval(_autoTimer.value)
  if (_countdownTimer.value) clearInterval(_countdownTimer.value)
  if (_dividendTimer.value) clearInterval(_dividendTimer.value)
  if (_dividendCountdownTimer.value) clearInterval(_dividendCountdownTimer.value)
})

// Helper functions for template
const getRowClass = (row) => {
  const classes = []
  const now = parseFloat(row.now)
  const sl = parseFloat(row.stopLoss)
  const tp = parseFloat(row.takeProfit)

  if (!isNaN(sl) && sl > 0 && now <= sl) {
    classes.push('bg-red-50')
  } else if (!isNaN(tp) && tp > 0 && now >= tp) {
    classes.push('bg-green-50')
  } else if (!isNaN(now) && row.f618) {
    if (now <= parseFloat(row.f786)) {
      classes.push('bg-red-50')
    } else if (now <= parseFloat(row.f618)) {
      classes.push('bg-orange-50')
    }
  }

  return classes.join(' ')
}
</script>

<template>
  <div class="min-h-screen bg-background">
    <div class="max-w-full mx-auto p-4">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-4">
        <div>
          <h1 class="text-2xl font-bold">项目指标看板</h1>
          <p class="text-sm text-muted-foreground mt-1">
            📋 说明：蓝色-达标区 | 橙色-警戒区。保本止损：浮盈达 1.5系数后止损抬至入标成本。
            <span v-if="isFileProtocol" class="text-yellow-600 font-semibold ml-2">
              ⚠️ 当前为本地文件模式（file://），系统通知可能被浏览器禁用。建议使用 Live Server（http://localhost）打开。
            </span>
          </p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <Button variant="success" @click="openExport">导出</Button>
          <Button variant="outline" @click="openImport">导入</Button>

          <Dropdown class="ml-2">
            <template #trigger="{ toggle, isOpen }">
              <Button variant="default" @click="toggle">
                语音设置
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="ml-1">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </Button>
            </template>
            <template #default="{ close }">
              <button
                v-for="voice in chineseVoices"
                :key="voice.name"
                class="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                :class="{ 'text-green-600 font-semibold': selectedVoice === voice.name }"
                @click="onDropdownCommand(voice.name); close()"
              >
                <span v-if="selectedVoice === voice.name">✓ </span>{{ voice.name }}
              </button>
              <div class="border-t my-1"></div>
              <button
                class="w-full text-left px-3 py-2 text-sm text-orange-500 hover:bg-accent transition-colors"
                @click="onDropdownCommand('test'); close()"
              >
                🔊 测试语音提醒
              </button>
            </template>
          </Dropdown>

          <Button variant="destructive" @click="clearAllNotifications">清除通知</Button>
        </div>
      </div>

      <!-- Tabs -->
      <Tabs :tabs="tabOptions" v-model="activeTab">
        <template #default="{ activeTab }">
          <!-- Monitor Tab -->
          <div v-if="activeTab === 'monitor'" class="flex flex-col h-full">
            <!-- Toolbar -->
            <div class="flex gap-2 mb-4">
              <Textarea
                v-model="inputCodes"
                :rows="1"
                placeholder="输入编号（支持批量，空格/逗号分隔）"
                class="flex-1"
              />
              <div class="flex gap-2 flex-wrap">
                <Button :loading="loading" @click="addNewCodes">查询并追加</Button>
                <Button :loading="loading" @click="refreshAllPrices">刷新数据</Button>
                <Button
                  :variant="autoRefresh ? 'success' : 'outline'"
                  @click="toggleAutoRefresh"
                >
                  {{ autoRefresh ? `自动刷新 ${autoCountdown}s` : '30s自动刷新' }}
                </Button>
                <Button variant="outline" @click="clearAll">清空</Button>
              </div>
            </div>

            <!-- Table -->
            <div class="border rounded-lg overflow-auto flex-1">
              <Table :data="tableData" :loading="loading">
                <TableHeader>
                  <TableRow>
                    <TableHead class="w-10"></TableHead>
                    <TableHead label="项目 / 编号" class="min-w-[140px]" />
                    <TableHead label="当前值 / 波动" class="w-[160px]" />
                    <TableHead label="均线" class="w-[80px]" />
                    <TableHead label="止盈止损" class="w-[170px]" />
                    <TableHead label="距离(%)" class="w-[130px]" />
                    <TableHead label="黄金分割线" class="w-[210px]" />
                    <TableHead label="8848线" class="w-[150px]" />
                    <TableHead label="操作" class="w-[140px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <template v-for="(row, index) in tableData" :key="row.fullCode">
                    <TableRow :rowKey="row.fullCode" :class="getRowClass(row)" #="{ isExpanded, toggleExpand }">
                      <TableCell>
                        <button
                          class="p-1 hover:bg-accent rounded transition-transform"
                          :class="{ 'rotate-90': isRowExpanded(row) }"
                          @click="toggleRowExpand(row)"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                          >
                            <polyline points="9 18 15 12 9 6"></polyline>
                          </svg>
                        </button>
                      </TableCell>
                      <TableCell>
                        <div class="flex items-center gap-1">
                          <span
                            :class="[
                              'inline-block px-1.5 py-0.5 text-xs rounded font-medium',
                              getMarket(row.fullCode) === 'sh' ? 'bg-blue-100 text-blue-700' :
                              getMarket(row.fullCode) === 'sz' ? 'bg-yellow-100 text-yellow-700' :
                              getMarket(row.fullCode) === 'hk' ? 'bg-purple-100 text-purple-700' :
                              'bg-gray-100 text-gray-700'
                            ]"
                          >
                            {{ getMarketLabel(row.fullCode) }}
                          </span>
                          <span class="font-semibold">{{ row.name }}</span>
                          <span
                            v-if="row.addPositions?.length"
                            class="ml-1 text-xs bg-green-500 text-white px-1.5 py-0.5 rounded"
                          >
                            +{{ row.addPositions.length }}
                          </span>
                        </div>
                        <div class="text-xs text-muted-foreground ml-8">{{ row.fullCode }}</div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <span
                            class="font-mono font-semibold"
                            :class="[
                              getChgClass(row),
                              { 'animate-pulse': hasAlert(row.fullCode, 'TAKE_PROFIT') || hasAlert(row.fullCode, 'STOP_LOSS') }
                            ]"
                          >
                            {{ row.now }}
                          </span>
                        </div>
                        <div class="text-xs" :class="getChgClass(row)">
                          {{ formatChg(row) }}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span class="font-mono text-blue-600">{{ row.avg }}</span>
                      </TableCell>
                      <TableCell>
                        <div class="text-sm">
                          <div
                            class="font-mono"
                            :class="{ 'animate-pulse text-green-600': hasAlert(row.fullCode, 'TAKE_PROFIT') }"
                          >
                            止盈 {{ row.takeProfit || '-' }}
                          </div>
                          <div
                            class="font-mono mt-1"
                            :class="{ 'animate-pulse text-red-600': hasAlert(row.fullCode, 'STOP_LOSS') }"
                          >
                            止损 {{ row.stopLoss || '-' }}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div class="text-sm">
                          <div
                            v-if="row.toTPPct !== undefined && row.toTPPct !== ''"
                            class="font-mono"
                            :class="[
                              getPnlClass(row._toTPNum),
                              { 'animate-pulse text-green-600': hasAlert(row.fullCode, 'TAKE_PROFIT') }
                            ]"
                          >
                            {{ row.toTPPct }}
                          </div>
                          <div v-else class="text-muted-foreground">距止盈 -</div>
                          <div
                            v-if="row.toSLPct !== undefined && row.toSLPct !== ''"
                            class="font-mono mt-1"
                            :class="[
                              getPnlClass(row._toSLNum),
                              { 'animate-pulse text-red-600': hasAlert(row.fullCode, 'STOP_LOSS') }
                            ]"
                          >
                            {{ row.toSLPct }}
                          </div>
                          <div v-else class="text-muted-foreground mt-1">距止损 -</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div class="text-sm font-mono">
                          <div>
                            <span
                              :class="{ 'animate-pulse text-orange-600': hasAlert(row.fullCode, 'L2_THRESH') && !hasAlert(row.fullCode, 'L3_THRESH') }"
                            >
                              L1 {{ row.f382 }}
                            </span>
                            &nbsp;
                            <span
                              :class="{ 'animate-pulse text-orange-600': hasAlert(row.fullCode, 'L2_THRESH') && !hasAlert(row.fullCode, 'L3_THRESH') }"
                            >
                              L2 {{ row.f618 }}
                            </span>
                          </div>
                          <div
                            class="mt-1"
                            :class="{ 'animate-pulse text-red-600': hasAlert(row.fullCode, 'L3_THRESH') }"
                          >
                            L3 {{ row.f786 }}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div class="text-sm font-mono">
                          <div
                            :class="{ 'animate-pulse text-green-600': hasAlert(row.fullCode, 'TOP_BOUND') }"
                          >
                            上 {{ row.topLine }}
                          </div>
                          <div
                            class="mt-1"
                            :class="{ 'animate-pulse text-red-600': hasAlert(row.fullCode, 'BOT_BOUND') }"
                          >
                            下 {{ row.bottomLine }}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div class="flex gap-1">
                          <Button variant="success" size="sm" @click="openAddPos(row)">加仓</Button>
                          <Button variant="outline" size="sm" @click="openCfg(row)">参数</Button>
                          <Button variant="destructive" size="sm" @click="removeItem(index)">移除</Button>
                        </div>
                      </TableCell>
                    </TableRow>

                    <!-- Expand Row -->
                    <TableExpandRow v-if="isRowExpanded(row)">
                      <div class="bg-slate-50 p-4 rounded">
                        <div class="font-semibold text-blue-600 mb-2">📊 底仓 (ADR20: {{ row.adr20 || '-' }})</div>
                        <div class="flex gap-6 text-sm mb-4 bg-white p-2 rounded">
                          <span>成本: <strong class="font-mono">{{ row.buyPrice || '-' }}</strong></span>
                          <span>数量: <strong class="font-mono">{{ row.quantity || '-' }}</strong></span>
                          <span>止盈: <strong class="font-mono" :class="{ 'animate-pulse text-green-600': hasAlert(row.fullCode, 'TAKE_PROFIT') }">{{ row.takeProfit || '-' }}</strong></span>
                          <span>止损: <strong class="font-mono" :class="{ 'animate-pulse text-red-600': hasAlert(row.fullCode, 'STOP_LOSS') }">{{ row.stopLoss || '-' }}</strong></span>
                          <span>盈亏: <strong class="font-mono" :class="getPnlClass(row.pnlAmount)">{{ row.pnlAmount || '-' }} ({{ row.pnlPct || '-' }})</strong></span>
                          <span class="text-muted-foreground">{{ row.toTPPct || '-' }}</span>
                          <span class="text-muted-foreground">{{ row.toSLPct || '-' }}</span>
                        </div>

                        <div v-if="row.addPositions?.length">
                          <div class="font-semibold text-green-600 mb-2">📈 加仓记录</div>
                          <div
                            v-for="(pos, idx) in row.addPositions"
                            :key="pos.id"
                            class="flex gap-6 text-sm mb-2 pl-4 border-l-2 border-green-500 bg-white p-2 rounded"
                          >
                            <span class="text-green-600 font-bold">加仓{{ idx + 1 }}</span>
                            <span>成本: <strong class="font-mono">{{ pos.buyPrice || '-' }}</strong></span>
                            <span>ADR20: <strong class="font-mono">{{ pos.adr20 || '-' }}</strong></span>
                            <span>数量: <strong class="font-mono">{{ pos.quantity || '-' }}</strong></span>
                            <span>止盈: <strong class="font-mono" :class="{ 'animate-pulse text-green-600': hasAlert(row.fullCode, `ADD_${idx}_TAKE_PROFIT`) }">{{ pos.takeProfit || '-' }}</strong></span>
                            <span>止损: <strong class="font-mono" :class="{ 'animate-pulse text-red-600': hasAlert(row.fullCode, `ADD_${idx}_STOP_LOSS`) }">{{ pos.stopLoss || '-' }}</strong></span>
                            <span>盈亏: <strong class="font-mono" :class="getPnlClass(pos.pnlAmount)">{{ pos.pnlAmount || '-' }} ({{ pos.pnlPct || '-' }})</strong></span>
                            <span class="text-muted-foreground">{{ pos.toTPPct || '-' }}</span>
                            <span class="text-muted-foreground">{{ pos.toSLPct || '-' }}</span>
                            <Button variant="destructive" size="sm" @click="removeAddPos(row, pos.id)">删除</Button>
                          </div>
                        </div>
                        <div v-else class="text-muted-foreground text-sm">暂无加仓</div>
                      </div>
                    </TableExpandRow>
                  </template>
                </TableBody>
              </Table>
            </div>
          </div>

          <!-- Dividend Tab -->
          <div v-if="activeTab === 'dividend'" class="flex flex-col h-full">
            <!-- Toolbar -->
            <div class="flex gap-2 mb-4">
              <Textarea
                v-model="dividendInputCodes"
                :rows="1"
                placeholder="输入股票编号（支持批量，空格/逗号分隔）"
                class="flex-1"
              />
              <div class="flex gap-2 flex-wrap">
                <Button :loading="dividendLoading" @click="addDividendCodes">查询并追加</Button>
                <Button :loading="dividendLoading" @click="refreshDividendData">刷新数据</Button>
                <Button
                  :variant="autoDividendRefresh ? 'success' : 'outline'"
                  @click="toggleAutoDividendRefresh"
                >
                  {{ autoDividendRefresh ? `自动刷新 ${dividendCountdown}s` : '60s自动刷新' }}
                </Button>
              </div>
            </div>

            <!-- Table -->
            <div class="border rounded-lg overflow-auto" style="max-height: 50vh;">
              <Table :data="dividendTableData" :loading="dividendLoading">
                <TableHeader>
                  <TableRow>
                    <TableHead label="股票名称" class="min-w-[120px]" />
                    <TableHead label="当前价格" class="w-[120px]" />
                    <TableHead label="每股股息" class="w-[130px]" />
                    <TableHead label="股息率" class="w-[100px]" />
                    <TableHead label="4%价" class="w-[90px]" />
                    <TableHead label="4.5%价" class="w-[90px]" />
                    <TableHead label="5%价" class="w-[90px]" />
                    <TableHead label="5.5%价" class="w-[90px]" />
                    <TableHead label="6%价" class="w-[90px]" />
                    <TableHead label="操作" class="w-[80px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="(row, index) in dividendTableData" :key="row.fullCode">
                    <TableCell>
                      <div class="flex items-center gap-1">
                        <span
                          :class="[
                            'inline-block px-1.5 py-0.5 text-xs rounded font-medium',
                            getMarket(row.fullCode) === 'sh' ? 'bg-blue-100 text-blue-700' :
                            getMarket(row.fullCode) === 'sz' ? 'bg-yellow-100 text-yellow-700' :
                            getMarket(row.fullCode) === 'hk' ? 'bg-purple-100 text-purple-700' :
                            'bg-gray-100 text-gray-700'
                          ]"
                        >
                          {{ getMarketLabel(row.fullCode) }}
                        </span>
                        <span>{{ row.name }}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <span class="font-mono font-semibold" :class="getDividendChgClass(row)">
                          {{ row.price || '-' }}
                        </span>
                      </div>
                      <div class="text-xs" :class="getDividendChgClass(row)">
                        {{ formatDividendChg(row) }}
                      </div>
                    </TableCell>
                    <TableCell>
                      <NumberInput
                        v-model="row.dividendPerShare"
                        :precision="4"
                        :min="0"
                        :controls="false"
                        class="w-24"
                        @change="onUpdateDividendPerShareHandler(row)"
                      />
                    </TableCell>
                    <TableCell>
                      <span
                        :class="[
                          'font-mono font-semibold',
                          getDividendClass(row.dividendRate)
                        ]"
                      >
                        {{ row.dividendRate !== null && row.dividendRate !== undefined ? row.dividendRate.toFixed(2) + '%' : '-' }}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        :class="{ 'animate-pulse text-purple-600 font-semibold': isDividendRateReached(row, 4) }"
                      >
                        {{ row.priceAt400 || '-' }}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        :class="{ 'animate-pulse text-blue-600 font-semibold': isDividendRateReached(row, 4.5) }"
                      >
                        {{ row.priceAt450 || '-' }}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        :class="{ 'animate-pulse text-red-600 font-semibold': isDividendRateReached(row, 5) }"
                      >
                        {{ row.priceAt500 || '-' }}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        :class="{ 'animate-pulse text-orange-600 font-semibold': isDividendRateReached(row, 5.5) }"
                      >
                        {{ row.priceAt550 || '-' }}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        :class="{ 'animate-pulse text-green-600 font-semibold': isDividendRateReached(row, 6) }"
                      >
                        {{ row.priceAt600 || '-' }}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button variant="destructive" size="sm" @click="removeDividendItem(index)">移除</Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        </template>
      </Tabs>

      <!-- Config Dialog -->
      <Dialog v-model="cfgVisible" title="参数设置" width="520px">
        <div v-if="cfgRow" class="space-y-4">
          <FormItem label="阶段峰值">
            <NumberInput v-model="cfgRow.high" :precision="3" :controls="false" class="w-64" @change="cfgChanged = true" />
          </FormItem>
          <FormItem label="阶段谷值">
            <NumberInput v-model="cfgRow.low" :precision="3" :controls="false" class="w-64" @change="cfgChanged = true" />
          </FormItem>
          <FormItem label="波动系数(20)">
            <NumberInput v-model="cfgRow.adr20" :precision="3" :controls="false" class="w-64" @change="cfgChanged = true" />
          </FormItem>
          <FormItem label="入标日期">
            <DatePicker v-model="cfgRow.buyDate" class="w-64" />
          </FormItem>
          <FormItem label="入标成本">
            <NumberInput v-model="cfgRow.buyPrice" :precision="3" :controls="false" class="w-64" @change="cfgChanged = true" />
          </FormItem>
          <FormItem label="权重（数量）">
            <NumberInput v-model="cfgRow.quantity" :precision="0" :controls="false" class="w-64" @change="cfgChanged = true" />
          </FormItem>
        </div>
        <template #footer>
          <Button variant="outline" @click="cfgVisible = false">取消</Button>
          <Button @click="saveCfg">保存应用</Button>
        </template>
      </Dialog>

      <!-- Add Position Dialog -->
      <Dialog v-model="addPosVisible" title="📈 加仓设置" width="480px">
        <div class="space-y-4">
          <FormItem label="加仓成本">
            <NumberInput v-model="addPosForm.buyPrice" :precision="3" :controls="false" class="w-60" />
          </FormItem>
          <FormItem label="ADR20">
            <NumberInput v-model="addPosForm.adr20" :precision="3" :controls="false" class="w-60" />
          </FormItem>
          <FormItem label="加仓数量">
            <NumberInput v-model="addPosForm.quantity" :precision="0" :controls="false" class="w-60" />
          </FormItem>
          <FormItem label="加仓日期">
            <DatePicker v-model="addPosForm.buyDate" class="w-60" />
          </FormItem>
        </div>
        <p class="text-sm text-muted-foreground mt-4">
          提示：加仓将独立计算止盈止损，点击行左侧展开按钮可查看各仓位详情。
        </p>
        <template #footer>
          <Button variant="outline" @click="addPosVisible = false">取消</Button>
          <Button variant="success" @click="saveAddPos">确认加仓</Button>
        </template>
      </Dialog>

      <!-- Export Dialog -->
      <Dialog v-model="exportVisible" title="📤 导出数据（一键迁移）" width="720px">
        <p class="text-sm text-muted-foreground mb-2">
          点击下方「复制全部到剪贴板」，然后用 Live Server 打开同一页面后点【📥 导入数据】粘贴即可。或者直接下载 JSON 文件保存到本地。
        </p>
        <Textarea v-model="exportJsonText" :rows="14" class="font-mono text-xs" readonly />
        <template #footer>
          <Button variant="outline" @click="exportVisible = false">关闭</Button>
          <Button @click="copyExportToClipboard">复制全部到剪贴板</Button>
          <Button variant="success" @click="downloadExportJson">下载 JSON 文件</Button>
        </template>
      </Dialog>

      <!-- Import Dialog -->
      <Dialog v-model="importVisible" title="📥 导入数据" width="720px">
        <p class="text-sm text-muted-foreground mb-2">
          粘贴之前导出的 JSON 文本到下面的文本框，选择合并方式后点【确认导入】。
        </p>
        <div class="flex gap-4 mb-3">
          <label class="flex items-center gap-2">
            <input type="radio" v-model="importMode" value="merge" class="w-4 h-4" />
            <span class="text-sm">合并（按编号覆盖同编号覆盖、不同编号保留两边相加）</span>
          </label>
          <label class="flex items-center gap-2">
            <input type="radio" v-model="importMode" value="replace" class="w-4 h-4" />
            <span class="text-sm">替换（清空现有，用导入的覆盖整个列表）</span>
          </label>
        </div>
        <Textarea v-model="importJsonText" :rows="14" class="font-mono text-xs" placeholder="请粘贴之前导出的 JSON 字符串..." />
        <template #footer>
          <Button variant="outline" @click="importVisible = false">取消</Button>
          <Button @click="confirmImport">确认导入</Button>
        </template>
      </Dialog>
    </div>
  </div>
</template>

<style>
/* Global styles */
.up-text {
  color: #f56c6c;
}

.down-text {
  color: #67c23a;
}

.alert-text {
  color: #e6a23c;
  font-weight: 600;
}

.fib-val {
  color: #409eff;
  font-weight: 500;
}

/* Dividend rate colors */
.rate-green {
  color: #67c23a;
  font-weight: 600;
}

.rate-yellow {
  color: #e6a23c;
  font-weight: 600;
}

.rate-orange {
  color: #f56c6c;
  font-weight: 600;
}

.rate-blue {
  color: #409eff;
  font-weight: 600;
}

/* Animations */
@keyframes flash {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.animate-pulse {
  animation: flash 1s ease-in-out infinite;
}

/* Table row styles */
.bg-red-50 {
  background-color: #fef2f2;
}

.bg-green-50 {
  background-color: #f0fdf4;
}

.bg-orange-50 {
  background-color: #fff7ed;
}

/* Price now styles */
.price-now {
  font-size: 16px;
  font-weight: 600;
}

/* Market tag styles */
.market-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
  margin-right: 4px;
}

.tag-sh {
  background: #ecf5ff;
  color: #409eff;
}

.tag-sz {
  background: #fef9ec;
  color: #e6a23c;
}

.tag-hk {
  background: #f4e8f8;
  color: #9c27b0;
}

.tag-bj {
  background: #f0f0f0;
  color: #606266;
}

/* Dividend rate dots */
.dot-green {
  background-color: #67c23a;
}

.dot-yellow {
  background-color: #e6a23c;
}

.dot-orange {
  background-color: #f56c6c;
}

.dot-red {
  background-color: #409eff;
}
</style>