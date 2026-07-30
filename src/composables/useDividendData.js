import { ref, onMounted, onBeforeUnmount } from 'vue'
import { formatCode } from '@/js/utils.js'
import { calcDividendFields, checkDividendAlerts } from '@/js/dividend.js'
import { initAudio, fireNotify } from '@/js/notify.js'

// State
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

// Selected voice
const selectedVoice = ref('')

// Methods
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

// Lifecycle
onMounted(() => {
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
})

onBeforeUnmount(() => {
  if (_dividendTimer.value) clearInterval(_dividendTimer.value)
  if (_dividendCountdownTimer.value) clearInterval(_dividendCountdownTimer.value)
})

export function useDividendData(voiceRef) {
  // Update selected voice if provided
  if (voiceRef && voiceRef.value) {
    selectedVoice.value = voiceRef.value
  }

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