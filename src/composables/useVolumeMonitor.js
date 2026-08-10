import { ref, computed } from 'vue'
import { fireNotify, initAudio } from '@/js/notify.js'
import { createAutoRefreshTimer } from './useTimerManager.js'
// ===== 单例状态 =====
const loading = ref(false)
const lastUpdate = ref('')

// 原始数据
const header = ref(null)       // { today, yesterday, change, predict }
const points = ref([])         // [[ts, turnover, turnover_pre, turnover_change], ...]

// 分钟级数据（API 返回的是累计值，不需再次累加）
const minuteData = ref([])     // [{ time, todayVol, yestVol, turnoverChange, ratio }]

// 趋势状态
const trendStatus = ref('')    // 'shrinking' | 'expanding' | 'stable' | ''
const trendLabel = ref('')

// 告警历史（防重复）
const alertEnabled = ref(true)
const isFileProtocol = ref(false)
try { isFileProtocol.value = /^file:$/i.test(window.location.protocol) } catch (e) {}
const selectedVoice = ref('')
const _alertCooldown = {}       // { type: timestamp }
const COOLDOWN_MS = 3 * 60 * 1000  // 3 分钟冷却
let _prevTrend = ''             // 上一次的趋势状态
let _prevCumulativeDiff = 0     // 上一次的累计差额（亿元）
let _prevCumulativeRatio = 1    // 上一次的累计比率（今日/昨日）
let _prevCumulativeTrend = ''   // 上一次的累计差额趋势: 'positive' | 'negative' | ''
let _prevDiffDirection = ''     // 上一次的差额变化方向: 'increasing' | 'decreasing' | ''

// 自动刷新 - 使用统一定时器管理
const _volumeTimer = createAutoRefreshTimer('volume', {
  onRefresh: () => {
    if (!loading.value) fetchData()
  },
  refreshInterval: 30,
  countdownFrom: 30,
  shouldRefresh: () => !loading.value,
  onStart: () => {
    initAudio()
    _prevTrend = ''
    _prevCumulativeDiff = 0
    _prevCumulativeRatio = 1
    _prevCumulativeTrend = ''
    _prevDiffDirection = ''
  },
  onStop: () => {
    _prevTrend = ''
    _prevCumulativeDiff = 0
    _prevCumulativeRatio = 1
    _prevCumulativeTrend = ''
    _prevDiffDirection = ''
  }
})

const autoRefresh = _volumeTimer.isActive
const countdown = _volumeTimer.countdown

// ===== 工具函数 =====

function formatVolume(val) {
  if (val === null || val === undefined || isNaN(val)) return '-'
  const abs = Math.abs(val)
  if (abs >= 1e8) return (val / 1e8).toFixed(2) + '亿'
  if (abs >= 1e4) return (val / 1e4).toFixed(2) + '万'
  return val.toFixed(0)
}

function formatPercent(val) {
  if (val === null || val === undefined || isNaN(val)) return '-'
  return (val >= 0 ? '+' : '') + val.toFixed(2) + '%'
}

// ===== 趋势分析 =====

const WINDOW = 5  // 最近5分钟窗口

// 生成A股全天交易时间轴（9:30-11:30, 13:01-15:00，跳过13:00）
function generateFullDayTimestamps(baseDate) {
  const timestamps = []
  const slots = [
    { start: 9 * 60 + 30, end: 11 * 60 + 30 },   // 上午：9:30 - 11:30（含）
    { start: 13 * 60 + 1, end: 15 * 60 }          // 下午：13:01 - 15:00（含，跳过13:00）
  ]
  
  for (const slot of slots) {
    for (let minutes = slot.start; minutes <= slot.end; minutes++) {
      const hours = Math.floor(minutes / 60)
      const mins = minutes % 60
      const ts = new Date(baseDate)
      ts.setHours(hours, mins, 0, 0)
      timestamps.push({
        ts: ts.getTime(),
        timeStr: `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`
      })
    }
  }
  
  return timestamps
}

function formatTimeStr(ts) {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

// 判断是否为A股交易时段（不含13:00）
function isTradingTime(ts) {
  const d = new Date(ts)
  const m = d.getHours() * 60 + d.getMinutes()
  return (m >= 9 * 60 + 30 && m <= 11 * 60 + 30) || (m >= 13 * 60 + 1 && m <= 15 * 60)
}

function computeMinuteData(rawPoints) {
  if (!rawPoints || rawPoints.length === 0) return []

  const now = Date.now()
  
  // 先从 API 数据中提取所有有效点
  const apiDataMap = new Map()
  for (const point of rawPoints) {
    const [ts, turnover, turnoverPre, turnoverChange] = point
    // 跳过无效数据
    if (turnover < 0 || turnoverPre < 0) continue

    let ratio = 1
    if (turnoverPre > 0) {
      ratio = turnover / turnoverPre
      if (!isFinite(ratio) || isNaN(ratio)) ratio = 1
    }

    apiDataMap.set(ts, { todayVol: turnover, yestVol: turnoverPre, turnoverChange: turnoverChange || 0, ratio })
  }

  // 如果 API 数据很少，直接返回 API 数据的时间轴，不做填充
  if (apiDataMap.size < 30) {
    const result = []
    for (const [ts, data] of apiDataMap) {
      const isFuture = ts > now
      result.push({
        time: formatTimeStr(ts),
        ts,
        todayVol: isFuture ? null : data.todayVol,
        yestVol: isFuture ? null : data.yestVol,
        turnoverChange: isFuture ? null : data.turnoverChange,
        ratio: isFuture ? null : data.ratio,
        isFuture,
        hasData: !isFuture
      })
    }
    return result.sort((a, b) => a.ts - b.ts)
  }

  // 正常情况：用全天时间轴填充，缺失点用 null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const fullDayTimestamps = generateFullDayTimestamps(today)

  const result = fullDayTimestamps.map(({ ts, timeStr }) => {
    const data = apiDataMap.get(ts)
    const isFuture = ts > now
    const hasData = !!data && !isFuture && isTradingTime(ts)
    
    return {
      time: timeStr,
      ts,
      todayVol: hasData ? data.todayVol : null,
      yestVol: hasData ? data.yestVol : null,
      turnoverChange: hasData ? data.turnoverChange : null,
      ratio: hasData ? data.ratio : null,
      isFuture,
      hasData
    }
  })
  
  return result
}

function analyzeTrend() {
  const data = minuteData.value
  
  // 过滤掉没有实际数据的记录
  const validData = data.filter(d => d.hasData && !d.isFuture && d.todayVol > 0 && d.yestVol > 0)
  
  if (validData.length < WINDOW) {
    trendStatus.value = ''
    trendLabel.value = '数据不足'
    return
  }

  // 取最近 WINDOW 分钟的数据
  const recent = validData.slice(-WINDOW)
  // 取再往前的 WINDOW 分钟（用于环比）
  const prevWindow = validData.slice(-WINDOW * 2, -WINDOW)

  if (recent.length < WINDOW / 2) {
    trendStatus.value = ''
    trendLabel.value = '有效数据不足'
    return
  }

  // 计算最近窗口的增量（今日 vs 昨日）
  const firstRecent = recent[0]
  const lastRecent = recent[recent.length - 1]
  const todayIncrement = lastRecent.todayVol - firstRecent.todayVol
  const yestIncrement = lastRecent.yestVol - firstRecent.yestVol

  // 今日增量 vs 昨日同期增量
  const ratio = yestIncrement > 0 ? todayIncrement / yestIncrement : 1

  if (!isFinite(ratio) || isNaN(ratio)) {
    trendStatus.value = ''
    trendLabel.value = '数据异常'
    return
  }

  let status = 'stable'
  let label = ''

  if (ratio < 0.5) {
    status = 'extreme_shrinking'
    label = `极端缩量（近${WINDOW}分钟仅为昨日 ${(ratio * 100).toFixed(0)}%）`
  } else if (ratio < 0.7) {
    status = 'shrinking'
    label = `缩量趋势（近${WINDOW}分钟为昨日 ${(ratio * 100).toFixed(0)}%）`
  } else if (ratio > 2.0) {
    status = 'extreme_expanding'
    label = `极端放量（近${WINDOW}分钟为昨日 ${(ratio * 100).toFixed(0)}%）`
  } else if (ratio > 1.3) {
    status = 'expanding'
    label = `放量趋势（近${WINDOW}分钟为昨日 ${(ratio * 100).toFixed(0)}%）`
  } else {
    status = 'stable'
    label = `量能平稳（近${WINDOW}分钟为昨日 ${(ratio * 100).toFixed(0)}%）`
  }

  trendStatus.value = status
  trendLabel.value = label

  // 检测趋势转换
  if (_prevTrend && _prevTrend !== status) {
    checkTransitionAlert(_prevTrend, status)
  }
  _prevTrend = status
}

// ===== 告警 =====

function _canAlert(key) {
  const now = Date.now()
  const last = _alertCooldown[key]
  if (last && now - last < COOLDOWN_MS) return false
  _alertCooldown[key] = now
  return true
}

function _notify(title, body, level) {
  initAudio()
  fireNotify(title, body, level, isFileProtocol.value, selectedVoice)
}

function checkTransitionAlert(from, to) {
  if (!alertEnabled.value) return

  const expandingStates = ['expanding', 'extreme_expanding']
  const shrinkingStates = ['shrinking', 'extreme_shrinking']

  if (shrinkingStates.includes(from) && expandingStates.includes(to)) {
    if (_canAlert('shrink_to_expand')) {
      _notify('📈 缩量转放量', '市场成交量由缩量转为放量，资金活跃度提升，关注后续走势', 2)
    }
  } else if (expandingStates.includes(from) && shrinkingStates.includes(to)) {
    if (_canAlert('expand_to_shrink')) {
      _notify('📉 放量转缩量', '市场成交量由放量转为缩量，资金活跃度下降，注意风险', 2)
    }
  }
}

function checkExtremeAlert() {
  if (!alertEnabled.value) return
  const data = minuteData.value
  
  // 过滤掉没有实际数据的记录
  const validData = data.filter(d => d.hasData && !d.isFuture && d.todayVol > 0 && d.yestVol > 0)
  if (validData.length < WINDOW) return

  const recent = validData.slice(-WINDOW)
  if (recent.length < WINDOW / 2) return

  // 计算最近窗口的增量（今日 vs 昨日）
  const first = recent[0]
  const last = recent[recent.length - 1]
  const todayIncrement = last.todayVol - first.todayVol
  const yestIncrement = last.yestVol - first.yestVol

  if (yestIncrement <= 0 || todayIncrement <= 0 || !isFinite(todayIncrement) || !isFinite(yestIncrement)) {
    return
  }

  const ratio = todayIncrement / yestIncrement

  if (!isFinite(ratio) || isNaN(ratio)) return

  // 持续缩量（较昨日 < 50%）
  if (ratio < 0.5) {
    if (_canAlert('extreme_shrink')) {
      _notify('⚠️ 持续极端缩量', `近${WINDOW}分钟成交额仅为昨日同期的 ${(ratio * 100).toFixed(0)}%，市场交投极度清淡`, 1)
    }
  } else if (ratio < 0.7) {
    if (_canAlert('significant_shrink')) {
      _notify('📊 持续缩量', `近${WINDOW}分钟成交额为昨日同期的 ${(ratio * 100).toFixed(0)}%，市场交投清淡`, 1)
    }
  }
  // 持续放量（较昨日 > 200%）
  if (ratio > 2.0) {
    if (_canAlert('extreme_expand')) {
      _notify('🔥 持续极端放量', `近${WINDOW}分钟成交额为昨日同期的 ${(ratio * 100).toFixed(0)}%，市场交投极度活跃`, 2)
    }
  } else if (ratio > 1.3) {
    if (_canAlert('significant_expand')) {
      _notify('📊 持续放量', `近${WINDOW}分钟成交额为昨日同期的 ${(ratio * 100).toFixed(0)}%，市场交投活跃`, 2)
    }
  }
}

function checkCumulativeDiffAlert() {
  if (!alertEnabled.value) return
  const data = minuteData.value
  
  const validData = data.filter(d => d.hasData && !d.isFuture)
  if (validData.length < WINDOW) return

  // todayVol 和 yestVol 已经是累计值，取最后一个即可
  const todayCum = validData[validData.length - 1].todayVol || 0
  const yestCum = validData[validData.length - 1].yestVol || 0

  const cumulativeDiffYi = (todayCum - yestCum) / 1e8

  const cumulativeRatio = yestCum > 0 ? todayCum / yestCum : 1

  let currentTrend = ''
  if (cumulativeRatio > 1.05) currentTrend = 'positive'
  else if (cumulativeRatio < 0.95) currentTrend = 'negative'

  let currentDirection = ''
  const diffChange = cumulativeRatio - _prevCumulativeRatio
  if (Math.abs(diffChange) < 0.02) {
    currentDirection = 'stable'
  } else if (diffChange > 0) {
    currentDirection = 'increasing'
  } else {
    currentDirection = 'decreasing'
  }

  // 1. 颜色转换（红转绿/绿转红）
  if (_prevCumulativeTrend && _prevCumulativeTrend !== currentTrend) {
    if (currentTrend === 'negative') {
      if (_canAlert('diff_pos_to_neg')) {
        _notify('📉 量能趋势由强转弱', `今日累计量能为昨日同期的 ${(cumulativeRatio * 100).toFixed(0)}%，资金流出加速`, 2)
      }
    } else if (currentTrend === 'positive') {
      if (_canAlert('diff_neg_to_pos')) {
        _notify('📈 量能趋势由弱转强', `今日累计量能为昨日同期的 ${(cumulativeRatio * 100).toFixed(0)}%，资金流入加速`, 2)
      }
    }
  }

  // 2. 持续放量加剧（红色越来越高，增速加快）
  if (currentTrend === 'positive' && currentDirection === 'increasing') {
    const ratioChange = _prevCumulativeRatio > 0
      ? ((cumulativeRatio - _prevCumulativeRatio) / _prevCumulativeRatio) * 100
      : 0
    if (ratioChange > 10 && cumulativeRatio > 1.15) {
      if (_canAlert('diff_strong_increase')) {
        _notify('🚀 放量加速', `今日累计量能 ${(cumulativeRatio * 100).toFixed(0)}% 昨日，较上次加速 ${ratioChange.toFixed(0)}%`, 2)
      }
    }
  }

  // 3. 放量减弱（红色柱子变矮，增速放缓）——放宽触发条件
  if (currentTrend === 'positive' && currentDirection === 'decreasing') {
    const ratioChange = _prevCumulativeRatio > 0
      ? ((_prevCumulativeRatio - cumulativeRatio) / _prevCumulativeRatio) * 100
      : 0
    // 只要累积比率仍在 1.05 以上且增速放缓（相对变化 >= 3%）即触发
    if (ratioChange > 3 && cumulativeRatio > 1.05) {
      if (_canAlert('diff_positive_decreasing')) {
        _notify('📉 放量减弱', `今日累计量能 ${(cumulativeRatio * 100).toFixed(0)}% 昨日，增速放缓 ${ratioChange.toFixed(0)}%，资金流入放缓`, 2)
      }
    }
  }

  // 4. 持续缩量加剧（绿色越来越深，缩量加速）
  if (currentTrend === 'negative' && currentDirection === 'decreasing') {
    const ratioChange = _prevCumulativeRatio > 0
      ? ((_prevCumulativeRatio - cumulativeRatio) / _prevCumulativeRatio) * 100
      : 0
    if (ratioChange > 10 && cumulativeRatio < 0.85) {
      if (_canAlert('diff_strong_decrease')) {
        _notify('⚠️ 缩量加速', `今日累计量能 ${(cumulativeRatio * 100).toFixed(0)}% 昨日，缩量加速 ${ratioChange.toFixed(0)}%`, 1)
      }
    }
  }

  // 5. 缩量减弱（绿色柱子变矮，缩量收窄）
  if (currentTrend === 'negative' && currentDirection === 'increasing') {
    const ratioChange = _prevCumulativeRatio > 0
      ? ((cumulativeRatio - _prevCumulativeRatio) / _prevCumulativeRatio) * 100
      : 0
    if (ratioChange > 8 && cumulativeRatio < 0.95) {
      if (_canAlert('diff_negative_decreasing')) {
        _notify('📈 缩量减弱', `今日累计量能 ${(cumulativeRatio * 100).toFixed(0)}% 昨日，缩量收窄 ${ratioChange.toFixed(0)}%，资金流出放缓`, 1)
      }
    }
  }

  // 6. 极端比率告警（基于比率而非绝对值）
  if (cumulativeRatio > 2.0) {
    if (_canAlert('diff_extreme_expand')) {
      _notify('🔥 极端放量', `今日累计量能达昨日同期的 ${(cumulativeRatio * 100).toFixed(0)}%，市场交投极度活跃`, 2)
    }
  } else if (cumulativeRatio > 1.5) {
    if (_canAlert('diff_significant_expand')) {
      _notify('📊 显著放量', `今日累计量能为昨日同期的 ${(cumulativeRatio * 100).toFixed(0)}%，市场交投活跃`, 1)
    }
  } else if (cumulativeRatio < 0.3) {
    if (_canAlert('diff_extreme_shrink')) {
      _notify('⚠️ 极端缩量', `今日累计量能仅为昨日同期的 ${(cumulativeRatio * 100).toFixed(0)}%，市场交投极度清淡`, 1)
    }
  } else if (cumulativeRatio < 0.5) {
    if (_canAlert('diff_significant_shrink')) {
      _notify('📊 显著缩量', `今日累计量能为昨日同期的 ${(cumulativeRatio * 100).toFixed(0)}%，市场交投清淡`, 1)
    }
  }

  _prevCumulativeDiff = cumulativeDiffYi
  _prevCumulativeRatio = cumulativeRatio
  if (currentTrend) _prevCumulativeTrend = currentTrend
  _prevDiffDirection = currentDirection
}

// ===== 数据拉取 =====

async function fetchData() {
  if (loading.value) return
  loading.value = true
  try {
    const isDev = import.meta.env.DEV
    const originPath = `/fuyao/market_analysis_api/chart/v1/get_chart_data?chart_key=turnover_minute&_t=${Date.now()}`
    let url
    if (isDev) {
      url = `/hsd-api${originPath}`
    } else {
      url = `https://corsproxy.io/?url=${encodeURIComponent('https://dq.10jqka.com.cn' + originPath)}`
    }

    const res = await fetch(url)
    const json = await res.json()
    const charts = json?.data?.charts
    if (!charts) throw new Error('无效数据')

    // header
    const h = {}
    if (charts.header) {
      for (const item of charts.header) {
        h[item.key] = item.val
      }
    }
    header.value = {
      today: h.turnover || 0,
      yesterday: h.turnover_pre || 0,
      change: h.turnover_change || 0,
      predict: h.predict_turnover || 0
    }

    // point_list
    const raw = charts.point_list || []
    points.value = raw

    // 计算分钟增量
    minuteData.value = computeMinuteData(raw)

    // 趋势分析
    analyzeTrend()

    // 极值告警
    checkExtremeAlert()

    // 累计差额告警
    checkCumulativeDiffAlert()

    const now = new Date()
    lastUpdate.value = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
  } catch (e) {
    console.error('量能数据获取失败:', e)
  } finally {
    loading.value = false
  }
}

// ===== 自动刷新 =====

function toggleAutoRefresh() {
  _volumeTimer.toggle()
}

// ===== 计算属性 =====

const todayTotal = computed(() => header.value?.today || 0)
const yesterdayTotal = computed(() => header.value?.yesterday || 0)
const predictTotal = computed(() => header.value?.predict || 0)
const changePercent = computed(() => {
  if (!header.value || !header.value.yesterday) return 0
  return ((header.value.today - header.value.yesterday) / header.value.yesterday) * 100
})

const trendColor = computed(() => {
  const s = trendStatus.value
  if (s === 'extreme_expanding') return 'text-red-600'
  if (s === 'expanding') return 'text-red-500'
  if (s === 'extreme_shrinking') return 'text-green-600'
  if (s === 'shrinking') return 'text-green-500'
  return 'text-muted-foreground'
})

const trendIcon = computed(() => {
  const s = trendStatus.value
  if (s === 'extreme_expanding') return '�'
  if (s === 'expanding') return '��'
  if (s === 'extreme_shrinking') return '⚠️'
  if (s === 'shrinking') return '📉'
  return '➡️'
})

const cumulativeDiff = computed(() => {
  const data = minuteData.value
  const validData = data.filter(d => d.hasData && !d.isFuture && d.turnoverChange !== null)
  if (validData.length === 0) return 0
  let diff = 0
  for (const d of validData) {
    diff += d.turnoverChange
  }
  return diff / 1e8  // 转换为亿元
})

const cumulativeDiffText = computed(() => {
  const diff = cumulativeDiff.value
  if (diff > 0) return `+${diff.toFixed(2)}亿`
  if (diff < 0) return `${diff.toFixed(2)}亿`
  return '0.00亿'
})

const cumulativeDiffColor = computed(() => {
  const diff = cumulativeDiff.value
  if (diff > 0) return 'text-red-500'
  if (diff < 0) return 'text-green-500'
  return 'text-muted-foreground'
})

export function useVolumeMonitor(voiceRef) {
  if (voiceRef && voiceRef.value) {
    selectedVoice.value = voiceRef.value
  }

  return {
    loading,
    lastUpdate,
    header,
    points,
    minuteData,
    trendStatus,
    trendLabel,
    trendColor,
    trendIcon,
    cumulativeDiff,
    cumulativeDiffText,
    cumulativeDiffColor,
    alertEnabled,
    isFileProtocol,
    selectedVoice,
    autoRefresh,
    countdown,
    todayTotal,
    yesterdayTotal,
    predictTotal,
    changePercent,
    fetchData,
    toggleAutoRefresh,
    formatVolume,
    formatPercent
  }
}
