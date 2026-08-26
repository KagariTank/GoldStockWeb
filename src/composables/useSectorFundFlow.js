import { ref } from 'vue'
import { fireNotify, initAudio } from '@/js/notify.js'
import { createAutoRefreshTimer } from './useTimerManager.js'
import { selectedVoice } from './useVoice.js'
import { isFileProtocol } from './useEnv.js'

// ===== 单例状态 =====
const sectorType = ref('industry') // industry | concept
const tableData = ref([])
const loading = ref(false)
const lastUpdate = ref('')

// 板块日内K线聚合状态（用于蜡烛图）
// 每个板块只存 OHLC 四个值，不需要存历史快照
// 结构: { code: { code, name, open, close, high, low } }
// 按板块类型分别存储（industry / concept），互不覆盖
const candleSectors = ref({}) // 当前选中类型（兼容旧用法）
const candleSectorsByType = {
  industry: ref({}),
  concept: ref({})
}
const _currentDateByType = { industry: null, concept: null } // 跨日检测，按类型
const _prevSnapshotByType = { industry: null, concept: null } // 告警基线，按类型

// 持久化相关（按类型分别存储）
const STORAGE_KEY = 'sector_candle_data'
const STORAGE_KEYS = {
  industry: 'sector_candle_data_industry',
  concept: 'sector_candle_data_concept'
}

function getTodayKey() {
  const now = new Date()
  return now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate()
}

function loadFromStorage(sectorType) {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS[sectorType] || STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    // 检查日期
    const todayKey = getTodayKey()
    if (data.date !== todayKey) {
      // 日期不匹配，清除
      localStorage.removeItem(STORAGE_KEYS[sectorType] || STORAGE_KEY)
      return null
    }
    return data.sectors || {}
  } catch (e) {
    console.warn('加载K线持久化数据失败:', e)
    return null
  }
}

function saveToStorage(sectors, sectorType) {
  try {
    const data = {
      date: getTodayKey(),
      sectorType,
      sectors
    }
    localStorage.setItem(STORAGE_KEYS[sectorType] || STORAGE_KEY, JSON.stringify(data))
  } catch (e) {
    console.warn('保存K线持久化数据失败:', e)
  }
}

function clearStorage() {
  localStorage.removeItem(STORAGE_KEYS.industry)
  localStorage.removeItem(STORAGE_KEYS.concept)
  localStorage.removeItem(STORAGE_KEY)
}

// 自动刷新 - 使用统一定时器管理
// 同时刷新行业和概念两种类型（串行避免 loading 互斥）
const _sectorTimer = createAutoRefreshTimer('sector', {
  onRefresh: async () => {
    if (!loading.value) {
      await fetchData('industry')
      await fetchData('concept')
    }
  },
  refreshInterval: 30,
  initialCountdown: 30,
  shouldRefresh: () => !loading.value,
  onStart: () => {
    initAudio()
  }
})

const autoRefresh = _sectorTimer.isActive
const countdown = _sectorTimer.countdown

// 告警
const alertEnabled = ref(true)
const _alertInitializedByType = { industry: false, concept: false } // 告警基线是否已建立，按类型
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

function checkAlerts(type) {
  const snapshot = _prevSnapshotByType[type]
  if (!alertEnabled.value || !snapshot) return

  const curr = {}
  for (const row of tableData.value) {
    curr[row.code] = { name: row.name, inflow: row.mainNetInflow }
  }

  // 当前 top3 流入 / top3 流出
  const sorted = [...tableData.value].sort((a, b) => b.mainNetInflow - a.mainNetInflow)
  const top3InCodes = new Set(sorted.slice(0, 3).map(r => r.code))
  const top3OutCodes = new Set(sorted.slice(-3).map(r => r.code))

  // 上次 top3
  const prevSorted = Object.entries(snapshot)
    .map(([code, v]) => ({ code, ...v }))
    .sort((a, b) => b.inflow - a.inflow)
  const prevTop3InCodes = new Set(prevSorted.slice(0, 3).map(r => r.code))
  const prevTop3OutCodes = new Set(prevSorted.slice(-3).map(r => r.code))

  for (const row of tableData.value) {
    const prev = snapshot[row.code]
    const inflow = row.mainNetInflow
    const prevInflow = prev ? prev.inflow : 0
    const delta = inflow - prevInflow  // 本次变化量
    const deltaStr = delta >= 0 ? `+${formatAmount(delta)}` : formatAmount(delta)
    const trendDesc = delta > 1e8 ? '加速流入'
      : delta < -1e8 ? '加速流出'
      : delta > 0 ? '流入减弱'
      : delta < 0 ? '流出减弱'
      : '平稳'

    // 1. 巨量流入
    if (inflow > THRESHOLDS.massiveInflow) {
      if (_canAlert(`${row.code}_massive_in`)) {
        _notify('📈 巨量资金流入', `${row.name} 净流入 ${formatAmount(inflow)}，${deltaStr}（${trendDesc}）`, 2)
      }
    }

    // 2. 巨量流出
    if (inflow < THRESHOLDS.massiveOutflow) {
      if (_canAlert(`${row.code}_massive_out`)) {
        _notify('📉 巨量资金流出', `${row.name} 净流出 ${formatAmount(inflow)}，${deltaStr}（${trendDesc}）`, 3)
      }
    }

    // 3. 流向反转（之前大幅流入，现在大幅流出，或反向）
    if (prev) {
      if (prevInflow > THRESHOLDS.reversalPrev && inflow < THRESHOLDS.reversalCurr) {
        if (_canAlert(`${row.code}_reversal_down`)) {
          _notify('⚠️ 资金流向反转', `${row.name} 由流入 ${formatAmount(prevInflow)} 转为流出 ${formatAmount(inflow)}，${deltaStr}`, 2)
        }
      } else if (prevInflow < THRESHOLDS.reversalCurr && inflow > THRESHOLDS.reversalPrev) {
        if (_canAlert(`${row.code}_reversal_up`)) {
          _notify('🔄 资金流向反转', `${row.name} 由流出 ${formatAmount(prevInflow)} 转为流入 ${formatAmount(inflow)}，${deltaStr}`, 2)
        }
      }
    }

    // 4. 新晋前三（流入）
    if (top3InCodes.has(row.code) && !prevTop3InCodes.has(row.code)) {
      if (_canAlert(`${row.code}_top3_in`)) {
        _notify('🔥 流入前三', `${row.name} 新晋流入前三，净流入 ${formatAmount(inflow)}，${deltaStr}（${trendDesc}）`, 1)
      }
    }

    // 5. 新晋前三（流出）
    if (top3OutCodes.has(row.code) && !prevTop3OutCodes.has(row.code)) {
      if (_canAlert(`${row.code}_top3_out`)) {
        _notify('❄️ 流出前三', `${row.name} 新晋流出前三，净流出 ${formatAmount(inflow)}，${deltaStr}（${trendDesc}）`, 1)
      }
    }
  }

  // 更新快照
  _prevSnapshotByType[type] = curr
}

// 拉取数据
async function fetchData(targetType) {
  if (loading.value) return
  // 指定类型时拉取该类型数据；未指定时用当前选中类型
  const type = targetType || sectorType.value
  const typeCandle = candleSectorsByType[type]
  loading.value = true
  try {
    const code = sectorCodeMap[type] || sectorCodeMap.industry
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
    // 仅当前选中类型才更新 tableData（汇总信息），避免 Dashboard 预拉取其他类型时污染
    if (type === sectorType.value) {
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

      // 告警检测（首次加载跳过，后续比较前后两次数据）
      if (_alertInitializedByType[type]) {
        checkAlerts(type)
      } else {
        _prevSnapshotByType[type] = {}
        for (const row of tableData.value) {
          _prevSnapshotByType[type][row.code] = { name: row.name, inflow: row.mainNetInflow }
        }
        _alertInitializedByType[type] = true
      }
    }

    // 更新板块K线聚合状态（增量更新 OHLC）
    // 跨日检测：日期变了就清空，开始新的一天
    const todayKey = getTodayKey()
    const prevDate = _currentDateByType[type]
    if (prevDate && prevDate !== todayKey) {
      typeCandle.value = {}
      _prevSnapshotByType[type] = null
      _alertInitializedByType[type] = false
      clearStorage()
    } else if (!prevDate) {
      // 首次加载：尝试从 localStorage 恢复当天数据
      const stored = loadFromStorage(type)
      if (stored && Object.keys(stored).length > 0) {
        typeCandle.value = stored
        _currentDateByType[type] = todayKey
      }
    }
    _currentDateByType[type] = todayKey
    // 若该类型是当前选中类型，同步当前视图
    if (type === sectorType.value) {
      candleSectors.value = typeCandle.value
    }

    // 更新每个板块的日内K线数据（open 恒为 0，只存 close/high/low）
    // 注意：非当前类型时 diff 未写入 tableData，直接用 diff 遍历
    const rows = type === sectorType.value ? tableData.value : diff.map(item => ({
      code: item.f12,
      name: item.f14,
      mainNetInflow: item.f62
    }))
    for (const row of rows) {
      const code = row.code
      const value = parseFloat(row.mainNetInflow) || 0
      const existing = typeCandle.value[code]

      if (!existing) {
        typeCandle.value[code] = {
          code,
          name: row.name,
          close: value,
          high: value,
          low: value
        }
      } else {
        existing.close = value
        if (value > existing.high) existing.high = value
        if (value < existing.low) existing.low = value
      }
    }

    // 若该类型是当前选中类型，同步当前视图
    if (type === sectorType.value) {
      candleSectors.value = typeCandle.value
    }
    // 持久化保存
    saveToStorage(typeCandle.value, type)
  } catch (e) {
    console.error('板块资金流向获取失败:', e)
  } finally {
    loading.value = false
  }
}

// 拉取指定板块类型的数据（供 Dashboard 双图同时拉取 industry/concept，不影响当前选中类型）
async function fetchDataByType(type) {
  await fetchData(type)
}

// 切换自动刷新
function toggleAutoRefresh() {
  _sectorTimer.toggle()
}

// 切换板块类型
function onSectorTypeChange() {
  // 切换时重置当前类型的告警基线，但保留各类的K线聚合数据
  _prevSnapshotByType[sectorType.value] = null
  _alertInitializedByType[sectorType.value] = false
  // 立即切换当前视图到目标类型的缓存（无需清空，数据已按类型分别存储）
  candleSectors.value = candleSectorsByType[sectorType.value].value
  // fetchData 会继续增量更新对应板块类型的数据
  fetchData()
}

// 获取指定类型的K线聚合数据（供同时渲染多类型图表使用）
function getCandleSectors(type) {
  return candleSectorsByType[type] || candleSectorsByType.industry
}

export function useSectorFundFlow() {
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
    candleSectors,
    candleSectorsByType,
    getCandleSectors,
    fetchData,
    fetchDataByType,
    toggleAutoRefresh,
    onSectorTypeChange,
    formatAmount,
    formatPercent,
    getFlowClass,
    getChangeClass
  }
}
