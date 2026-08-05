import { ref } from 'vue'
import { fireNotify, initAudio } from '@/js/notify.js'

// ===== 单例状态 =====
const sectorType = ref('industry') // industry | concept
const tableData = ref([])
const loading = ref(false)
const lastUpdate = ref('')

// 自动刷新
const autoRefresh = ref(false)
const countdown = ref(30)
let _timer = null
let _countdownTimer = null

// 告警
const alertEnabled = ref(true)
const isFileProtocol = ref(false)
try { isFileProtocol.value = /^file:$/i.test(window.location.protocol) } catch (e) {}
const selectedVoice = ref('')
let _alertInitialized = false
let _prevSnapshot = null // { code: { name, inflow }, ... }
const _alertCooldown = {} // { `${code}_${type}`: timestamp }
const COOLDOWN_MS = 5 * 60 * 1000 // 5 分钟冷却

// 板块类型 -> 东方财富 code 参数映射
const sectorCodeMap = {
  industry: 'm:90+s:4',
  concept: 'm:90+s:3'
}

// 请求的字段
const FIELDS = 'f3,f12,f14,f62,f184,f66,f78,f128,f140'

// ===== 告警阈值 =====
const THRESHOLDS = {
  massiveInflow: 3e9,    // 巨量流入 30亿
  massiveOutflow: -3e9,  // 巨量流出 -30亿
  reversalPrev: 1e9,     // 反转前需 > 10亿
  reversalCurr: -1e9,    // 反转后需 < -10亿（或反向）
}

// 格式化金额（元 -> 亿元/万元）
function formatAmount(val) {
  if (val === null || val === undefined || val === '' || isNaN(val)) return '-'
  const abs = Math.abs(val)
  const sign = val < 0 ? '-' : ''
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}亿`
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(2)}万`
  return `${sign}${abs.toFixed(0)}`
}

// 格式化百分比（API 返回基点，如 572 = 5.72%）
function formatPercent(val) {
  if (val === null || val === undefined || val === '' || isNaN(val)) return '-'
  return `${(val / 100).toFixed(2)}%`
}

// 获取资金流向颜色
function getFlowClass(val) {
  if (val === null || val === undefined || val === '' || isNaN(val)) return ''
  if (val > 0) return 'up-text'
  if (val < 0) return 'down-text'
  return ''
}

// 涨跌幅颜色
function getChangeClass(val) {
  if (val === null || val === undefined || val === '' || isNaN(val)) return ''
  if (val > 0) return 'up-text'
  if (val < 0) return 'down-text'
  return ''
}

// ===== 告警检测 =====
function _canAlert(key) {
  const now = Date.now()
  const last = _alertCooldown[key]
  if (last && now - last < COOLDOWN_MS) return false
  _alertCooldown[key] = now
  return true
}

function _notify(title, body, level) {
  fireNotify(title, body, level, isFileProtocol.value, selectedVoice)
}

function checkAlerts() {
  if (!alertEnabled.value || !_prevSnapshot) return

  const curr = {}
  for (const row of tableData.value) {
    curr[row.code] = { name: row.name, inflow: row.mainNetInflow }
  }

  // 当前 top3 流入 / top3 流出
  const sorted = [...tableData.value].sort((a, b) => b.mainNetInflow - a.mainNetInflow)
  const top3InCodes = new Set(sorted.slice(0, 3).map(r => r.code))
  const top3OutCodes = new Set(sorted.slice(-3).map(r => r.code))

  // 上次 top3
  const prevSorted = Object.entries(_prevSnapshot)
    .map(([code, v]) => ({ code, ...v }))
    .sort((a, b) => b.inflow - a.inflow)
  const prevTop3InCodes = new Set(prevSorted.slice(0, 3).map(r => r.code))
  const prevTop3OutCodes = new Set(prevSorted.slice(-3).map(r => r.code))

  for (const row of tableData.value) {
    const prev = _prevSnapshot[row.code]
    const inflow = row.mainNetInflow
    const prevInflow = prev ? prev.inflow : 0

    // 1. 巨量流入
    if (inflow > THRESHOLDS.massiveInflow) {
      if (_canAlert(`${row.code}_massive_in`)) {
        _notify('📈 巨量资金流入', `${row.name} 主力净流入 ${formatAmount(inflow)}，资金大幅涌入`, 2)
      }
    }

    // 2. 巨量流出
    if (inflow < THRESHOLDS.massiveOutflow) {
      if (_canAlert(`${row.code}_massive_out`)) {
        _notify('📉 巨量资金流出', `${row.name} 主力净流出 ${formatAmount(inflow)}，资金大幅撤离`, 3)
      }
    }

    // 3. 流向反转（之前大幅流入，现在大幅流出，或反向）
    if (prev) {
      if (prevInflow > THRESHOLDS.reversalPrev && inflow < THRESHOLDS.reversalCurr) {
        if (_canAlert(`${row.code}_reversal_down`)) {
          _notify('⚠️ 资金流向反转', `${row.name} 由流入 ${formatAmount(prevInflow)} 转为流出 ${formatAmount(inflow)}`, 2)
        }
      } else if (prevInflow < THRESHOLDS.reversalCurr && inflow > THRESHOLDS.reversalPrev) {
        if (_canAlert(`${row.code}_reversal_up`)) {
          _notify('🔄 资金流向反转', `${row.name} 由流出 ${formatAmount(prevInflow)} 转为流入 ${formatAmount(inflow)}`, 2)
        }
      }
    }

    // 4. 新晋前三（流入）
    if (top3InCodes.has(row.code) && !prevTop3InCodes.has(row.code)) {
      if (_canAlert(`${row.code}_top3_in`)) {
        _notify('🔥 流入前三', `${row.name} 新晋流入前三，主力净流入 ${formatAmount(inflow)}`, 1)
      }
    }

    // 5. 新晋前三（流出）
    if (top3OutCodes.has(row.code) && !prevTop3OutCodes.has(row.code)) {
      if (_canAlert(`${row.code}_top3_out`)) {
        _notify('❄️ 流出前三', `${row.name} 新晋流出前三，主力净流出 ${formatAmount(inflow)}`, 1)
      }
    }
  }

  // 更新快照
  _prevSnapshot = curr
}

// 拉取数据
async function fetchData() {
  if (loading.value) return
  loading.value = true
  try {
    const code = sectorCodeMap[sectorType.value] || sectorCodeMap.industry
    // dev 环境走 vite 代理避免 CORS，生产环境走 cors 代理
    const isDev = import.meta.env.DEV
    // 加时间戳防止浏览器缓存 GET 请求
    const originPath = `/dataapi/bkzj/getbkzj?key=${FIELDS}&code=${encodeURIComponent(code)}&_t=${Date.now()}`
    let url
    if (isDev) {
      url = `/em-api${originPath}`
    } else {
      url = `https://corsproxy.io/?url=${encodeURIComponent('https://data.eastmoney.com' + originPath)}`
    }
    const res = await fetch(url)
    const json = await res.json()
    const diff = json?.data?.diff || []
    // API 已按 f62 降序返回，直接映射
    tableData.value = diff.map(item => ({
      code: item.f12,
      name: item.f14,
      changePercent: item.f3,          // 基点
      mainNetInflow: item.f62,          // 元
      mainNetInflowPercent: item.f184,  // 基点
      superLargeNetInflow: item.f66,    // 元
      largeNetInflow: item.f78,         // 元
      topStockName: item.f128,
      topStockCode: item.f140
    }))
    const now = new Date()
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
    lastUpdate.value = timeStr

    // 告警检测（首次加载跳过，只比较前后两次数据）
    if (_alertInitialized) {
      checkAlerts()
    } else {
      _prevSnapshot = {}
      for (const row of tableData.value) {
        _prevSnapshot[row.code] = { name: row.name, inflow: row.mainNetInflow }
      }
      _alertInitialized = true
    }
  } catch (e) {
    console.error('板块资金流向获取失败:', e)
  } finally {
    loading.value = false
  }
}

// 切换自动刷新
function toggleAutoRefresh() {
  if (autoRefresh.value) {
    autoRefresh.value = false
    countdown.value = 30
    if (_timer) { clearInterval(_timer); _timer = null }
    if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null }
    return
  }

  initAudio()
  autoRefresh.value = true
  countdown.value = 30
  _countdownTimer = setInterval(() => {
    countdown.value--
    if (countdown.value <= 0) countdown.value = 30
  }, 1000)
  _timer = setInterval(() => {
    if (!loading.value) fetchData()
  }, 30000)
  fetchData()
}

// 切换板块类型
function onSectorTypeChange() {
  // 切换板块类型时重置告警基线
  _prevSnapshot = null
  _alertInitialized = false
  fetchData()
}

export function useSectorFundFlow(voiceRef) {
  if (voiceRef && voiceRef.value) {
    selectedVoice.value = voiceRef.value
  }

  return {
    sectorType,
    tableData,
    loading,
    lastUpdate,
    autoRefresh,
    countdown,
    alertEnabled,
    isFileProtocol,
    selectedVoice,
    fetchData,
    toggleAutoRefresh,
    onSectorTypeChange,
    formatAmount,
    formatPercent,
    getFlowClass,
    getChangeClass
  }
}
