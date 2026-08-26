import { ref } from 'vue'
import { formatCode } from '@/js/utils.js'
import { calcDividendFields, checkDividendAlerts } from '@/js/dividend.js'
import { initAudio, fireNotify } from '@/js/notify.js'
import { createAutoRefreshTimer } from './useTimerManager.js'
import { selectedVoice } from './useVoice.js'
import { isFileProtocol } from './useEnv.js'

// State
const dividendInputCodes = ref('')
const dividendStockList = ref([])
const dividendTableData = ref([])
const dividendLoading = ref(false)
const dividendAlertFlags = ref({})
const currentDividendRate = ref(0)
const maxDividendRate = ref(10)

// 自动刷新 - 使用统一定时器管理（股息60秒间隔）
const _dividendTimer = createAutoRefreshTimer('dividend', {
  onRefresh: () => {
    if (dividendTableData.value.length > 0 && !dividendLoading.value) {
      refreshDividendData()
    }
  },
  refreshInterval: 60,
  initialCountdown: 60,
  shouldRefresh: () => dividendTableData.value.length > 0 && !dividendLoading.value,
  onStart: () => {
    initAudio()
    refreshDividendData()
  }
})

const autoDividendRefresh = _dividendTimer.isActive
const dividendCountdown = _dividendTimer.countdown

// ===== 单例初始化标记 =====
let _dividendInitialized = false

// ===== 方法定义 =====
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
  _dividendTimer.toggle()
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

// ===== 初始化函数（只执行一次） =====
const initializeDividendOnce = () => {
  if (_dividendInitialized) return
  _dividendInitialized = true

  // Restore dividend stocks
  const cachedDividendStocks = localStorage.getItem('dividend_stocks_v1')
  if (cachedDividendStocks) {
    try {
      dividendStockList.value = JSON.parse(cachedDividendStocks).map(item => ({
        ...item,
        dividendPerShare: item.dividendPerShare || 0
      }))
    } catch (e) {
      console.warn('解析缓存的高股息股票列表失败:', e)
    }
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
    } catch (e) {
      console.warn('解析缓存的股息数据失败:', e)
    }
  }
}

export function useDividendData() {
  // 确保只初始化一次
  initializeDividendOnce()

  return {
    // State
    dividendInputCodes,
    dividendStockList,
    dividendTableData,
    dividendLoading,
    autoDividendRefresh,
    dividendCountdown,
    dividendAlertFlags,
    currentDividendRate,
    maxDividendRate,
    isFileProtocol,
    selectedVoice,

    // Methods
    saveDividendStocksToLocal,
    fetchDividendData,
    addDividendCodes,
    removeDividendItem,
    refreshDividendData,
    toggleAutoDividendRefresh,
    onUpdateDividendPerShareHandler
  }
}