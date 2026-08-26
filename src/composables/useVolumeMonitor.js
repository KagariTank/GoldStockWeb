import { ref, computed } from 'vue'
import { fireNotify, initAudio } from '@/js/notify.js'
import { createAutoRefreshTimer } from './useTimerManager.js'
import { selectedVoice } from './useVoice.js'
import { isFileProtocol } from './useEnv.js'
// ===== 单例状态 =====
const loading = ref(false)
const lastUpdate = ref('')

// 原始数据
const header = ref(null)       // { today, yesterday, change, predict }
const points = ref([])         // [[ts, turnover, turnover_pre, turnover_change], ...]

// 分钟级数据（API 返回的是累计值，不需再次累加）
const minuteData = ref([])     // [{ time, todayVol, yestVol, turnoverChange, ratio }]

// 上证指数分时数据
const indexData = ref([])      // [{ time, close, average }]

// 趋势状态
const trendStatus = ref('')    // 'shrinking' | 'expanding' | 'stable' | ''
const trendLabel = ref('')

// 告警历史（防重复）
const alertEnabled = ref(true)
const _alertCooldown = {}       // { type: timestamp }
const COOLDOWN_MS = 60 * 1000  // 1 分钟冷却
let _prevTrend = ''             // 上一次的趋势状态
let _prevCumulativeDiff = 0     // 上一次的累计差额（亿元）
let _prevCumulativeRatio = 1    // 上一次的累计比率（今日/昨日）
let _prevIncrementalRatio = 1  // 上一次的增量比率（今日增量/昨日增量）
let _prevCumulativeTrend = ''   // 上一次的累计差额趋势: 'positive' | 'negative' | ''
let _prevDiffDirection = ''     // 上一次的差额变化方向: 'increasing' | 'decreasing' | ''
let _prevCloseVsAvg = ''       // 上一次收盘价与均价关系: 'above' | 'below' | ''
let _lastCrossTime = 0         // 上次交叉检测时间戳

// 自动刷新 - 使用统一定时器管理
const _volumeTimer = createAutoRefreshTimer('volume', {
  onRefresh: () => {
    if (!loading.value) fetchData()
  },
  refreshInterval: 60,
  initialCountdown: 60,
  shouldRefresh: () => !loading.value,
  onStart: () => {
    initAudio()
    _prevTrend = ''
    _prevCumulativeDiff = 0
    _prevCumulativeRatio = 1
    _prevIncrementalRatio = 1
    _prevCumulativeTrend = ''
    _prevDiffDirection = ''
    _prevCloseVsAvg = ''
    _lastCrossTime = 0
  },
  onStop: () => {
    _prevTrend = ''
    _prevCumulativeDiff = 0
    _prevCumulativeRatio = 1
    _prevIncrementalRatio = 1
    _prevCumulativeTrend = ''
    _prevDiffDirection = ''
    _prevCloseVsAvg = ''
    _lastCrossTime = 0
  }
})

// 动态刷新频率：交易时段15s，非交易时段60s
function updateRefreshInterval() {
  if (!_volumeTimer.isActive.value) return
  const now = new Date()
  const hour = now.getHours()
  const minute = now.getMinutes()
  const timeOfDay = hour * 60 + minute
  
  const isMorningSession = timeOfDay >= 9 * 60 + 30 && timeOfDay <= 11 * 60 + 30
  const isAfternoonSession = timeOfDay >= 13 * 60 && timeOfDay <= 15 * 60
  const isTradingTime = isMorningSession || isAfternoonSession
  
  const newInterval = isTradingTime ? 15 : 60
  
  if (_volumeTimer.refreshInterval.value !== newInterval) {
    console.log(`[量能监控] 调整刷新频率: ${_volumeTimer.refreshInterval.value}s -> ${newInterval}s (${isTradingTime ? '交易时段' : '非交易时段'})`)
    _volumeTimer.updateInterval(newInterval)
  }
}

// 每分钟检查一次是否需要调整刷新频率
const _intervalCheckId = setInterval(updateRefreshInterval, 60 * 1000)

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

// 判断分钟数据点是否完整
// 规则：对于时间点 "HH:MM"，只有当当前时间已经过了这个分钟才算完整
// 为了安全起见，要求至少过了 30 秒，确保 API 数据已更新
function isDataPointComplete(timeStr) {
  if (!timeStr || !/^\d{2}:\d{2}$/.test(timeStr)) return true  // 无法判断时默认完整
  const [hh, mm] = timeStr.split(':').map(Number)
  const now = new Date()
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const dataPointMinutes = hh * 60 + mm
  
  // 如果是上午 11:30 或下午 15:00 这种收盘时间点，视为完整
  if (dataPointMinutes === 11 * 60 + 30 || dataPointMinutes === 15 * 60) return true
  
  // 只有当前时间超过数据点时间 + 30秒才算完整
  // 即：当前分钟 > 数据点分钟，或(当前分钟 == 数据点分钟 且 秒数 >= 30)
  const currentSecs = now.getSeconds()
  if (currentMinutes > dataPointMinutes) return true
  if (currentMinutes === dataPointMinutes && currentSecs >= 30) return true
  return false
}

// 获取最后一个完整的数据点索引
function getLastCompleteIndex(data) {
  let lastCompleteIdx = -1
  for (let i = 0; i < data.length; i++) {
    const d = data[i]
    if (d.hasData && !d.isFuture && d.todayVol > 0 && d.yestVol > 0) {
      if (isDataPointComplete(d.time)) {
        lastCompleteIdx = i
      } else {
        break  // 遇到第一个不完整的点就停止
      }
    }
  }
  return lastCompleteIdx
}

// ===== 趋势分析 =====

const WINDOW = 5  // 最近5分钟窗口

// 趋势判断参数（用于表格每行趋势列）
const TREND_WINDOW = 3       // 动量回看窗口（分钟）
const RATIO_EXPAND = 1.1     // 放量阈值
const RATIO_SHRINK = 0.9     // 缩量阈值
// 动量阈值：3分钟内累计差额(turnoverChange)变化超过 20亿(2e10元)视为有方向
// 用差额变化而非比率变化，因为累计比率变化极慢，无法反映短期趋势
const MOMENTUM_CHANGE_THRESH = 2e10

// 计算单行趋势标签
// ratio: 当前累计比率(今日/昨日)
// change: 当前累计差额(今日-昨日，单位元，负值=缩量)
// prevChange: TREND_WINDOW 分钟前的累计差额
function computeTrendLabel(ratio, change, prevChange) {
  if (ratio == null) return { label: '-', cls: 'text-muted-foreground' }

  // 无前值时仅根据绝对水平判断
  if (prevChange == null || change == null) {
    if (ratio >= 1.3) return { label: '放量', cls: 'text-red-500' }
    if (ratio < 0.7) return { label: '缩量', cls: 'text-green-500' }
    return { label: '平稳', cls: 'text-muted-foreground' }
  }

  // 差额变化：>0 表示差额收窄(量能改善)，<0 表示差额扩大(量能恶化)
  const changeDelta = change - prevChange
  const isExpanding = ratio > RATIO_EXPAND
  const isShrinking = ratio < RATIO_SHRINK
  const momentumUp = changeDelta > MOMENTUM_CHANGE_THRESH    // 量能改善
  const momentumDown = changeDelta < -MOMENTUM_CHANGE_THRESH // 量能恶化

  if (isExpanding) {
    if (momentumUp) return { label: '放量加速', cls: 'text-red-600 font-semibold' }
    if (momentumDown) return { label: '放量减弱', cls: 'text-orange-500' }
    return { label: '放量', cls: 'text-red-500' }
  }
  if (isShrinking) {
    if (momentumDown) return { label: '缩量加剧', cls: 'text-green-600 font-semibold' }
    if (momentumUp) return { label: '缩量收窄', cls: 'text-teal-500' }
    return { label: '缩量', cls: 'text-green-500' }
  }
  // 正常区间 0.9~1.1
  if (momentumUp) return { label: '温和放量', cls: 'text-orange-400' }
  if (momentumDown) return { label: '温和缩量', cls: 'text-teal-400' }
  return { label: '平稳', cls: 'text-muted-foreground' }
}

// 为分钟数据数组中每个有效点计算趋势标签
function enrichTrends(data) {
  const validIdxs = []
  for (let i = 0; i < data.length; i++) {
    if (data[i].hasData && data[i].ratio != null) validIdxs.push(i)
  }
  for (let vi = 0; vi < validIdxs.length; vi++) {
    const i = validIdxs[vi]
    const prevVi = vi - TREND_WINDOW
    const prevChange = prevVi >= 0 ? data[validIdxs[prevVi]].turnoverChange : null
    data[i].trend = computeTrendLabel(data[i].ratio, data[i].turnoverChange, prevChange)
  }
  return data
}

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
  
  // 获取最后一个完整数据点的索引
  const lastCompleteIdx = getLastCompleteIndex(data)
  
  // 至少需要 WINDOW 个完整数据点
  if (lastCompleteIdx < WINDOW - 1) {
    trendStatus.value = ''
    trendLabel.value = '数据不足'
    return
  }

  // 获取所有完整的数据点（截止到 lastCompleteIdx）
  const completedData = []
  for (let i = 0; i <= lastCompleteIdx; i++) {
    const d = data[i]
    if (d.hasData && !d.isFuture && d.todayVol > 0 && d.yestVol > 0) {
      completedData.push(d)
    }
  }

  if (completedData.length < WINDOW) {
    trendStatus.value = ''
    trendLabel.value = '有效数据不足'
    return
  }

  console.log('[量能分析] 完整性检测', {
    lastCompleteIdx,
    completedCount: completedData.length,
    lastCompleteTime: completedData[completedData.length - 1].time
  })

  // ========== 主要判断：累计比率（反映整体情况）==========
  const lastPoint = completedData[completedData.length - 1]
  const cumRatio = lastPoint.yestVol > 0 ? lastPoint.todayVol / lastPoint.yestVol : 1

  // ========== 辅助参考：增量比率（最近5分钟变化情况）==========
  const recent = completedData.slice(-WINDOW)
  if (recent.length < WINDOW / 2) {
    trendStatus.value = ''
    trendLabel.value = '有效数据不足'
    return
  }

  const firstRecent = recent[0]
  const lastRecent = recent[recent.length - 1]
  const todayIncrement = lastRecent.todayVol - firstRecent.todayVol
  const yestIncrement = lastRecent.yestVol - firstRecent.yestVol
  const incRatio = yestIncrement > 0 ? todayIncrement / yestIncrement : 1

  console.log('[量能分析]', {
    cumRatio: cumRatio.toFixed(4),
    incRatio: incRatio.toFixed(4),
    todayCum: lastPoint.todayVol.toFixed(2),
    yestCum: lastPoint.yestVol.toFixed(2),
    todayInc: todayIncrement.toFixed(2),
    yestInc: yestIncrement.toFixed(2)
  })

  if (!isFinite(cumRatio) || isNaN(cumRatio) || !isFinite(incRatio) || isNaN(incRatio)) {
    trendStatus.value = ''
    trendLabel.value = '数据异常'
    return
  }

  // ========== 综合判断逻辑 ==========
  // 用累计比率判断"整体趋势方向"，增量比率判断"变化程度"
  let status = 'stable'
  let label = ''

  if (cumRatio < 0.7) {
    // 整体明显缩量 (< 70%)
    if (cumRatio < 0.5) {
      status = 'extreme_shrinking'
      label = `极端缩量（今日为昨日 ${(cumRatio * 100).toFixed(0)}%）`
    } else {
      status = 'shrinking'
      label = `缩量趋势（今日为昨日 ${(cumRatio * 100).toFixed(0)}%）`
    }
  } else if (cumRatio > 1.3) {
    // 整体明显放量 (> 130%)
    if (cumRatio > 2.0) {
      status = 'extreme_expanding'
      label = `极端放量（今日为昨日 ${(cumRatio * 100).toFixed(0)}%）`
    } else {
      status = 'expanding'
      label = `放量趋势（今日为昨日 ${(cumRatio * 100).toFixed(0)}%）`
    }
  } else if (cumRatio >= 0.7 && cumRatio <= 1.3) {
    // 整体接近正常（70%-130%），用增量比率判断是否有趋势
    if (incRatio > 2.0 && cumRatio > 1.0) {
      // 整体正常但最近放量加速
      status = 'expanding'
      label = `温和放量（今日 ${(cumRatio * 100).toFixed(0)}%，近${WINDOW}分钟加速至 ${(incRatio * 100).toFixed(0)}%）`
    } else if (incRatio < 0.5 && cumRatio < 1.0) {
      // 整体正常但最近缩量加速
      status = 'shrinking'
      label = `温和缩量（今日 ${(cumRatio * 100).toFixed(0)}%，近${WINDOW}分钟降至 ${(incRatio * 100).toFixed(0)}%）`
    } else {
      status = 'stable'
      label = `量能平稳（今日为昨日 ${(cumRatio * 100).toFixed(0)}%）`
    }
  } else {
    status = 'stable'
    label = `量能平稳（今日为昨日 ${(cumRatio * 100).toFixed(0)}%）`
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
  
  // 获取最后一个完整数据点的索引
  const lastCompleteIdx = getLastCompleteIndex(data)
  if (lastCompleteIdx < WINDOW - 1) return  // 数据不足

  // 获取所有完整的数据点
  const completedData = []
  for (let i = 0; i <= lastCompleteIdx; i++) {
    const d = data[i]
    if (d.hasData && !d.isFuture && d.todayVol > 0 && d.yestVol > 0) {
      completedData.push(d)
    }
  }

  if (completedData.length < WINDOW) return

  // 用累计比率判断整体情况（与 analyzeTrend 保持一致）
  const lastPoint = completedData[completedData.length - 1]
  const cumRatio = lastPoint.yestVol > 0 ? lastPoint.todayVol / lastPoint.yestVol : 1

  console.log('[极端告警调试]', {
    todayCum: lastPoint.todayVol.toFixed(2),
    yestCum: lastPoint.yestVol.toFixed(2),
    cumRatio: cumRatio.toFixed(4),
    lastCompleteTime: lastPoint.time
  })

  if (!isFinite(cumRatio) || isNaN(cumRatio)) return

  // 极端缩量（累计比率 < 50%）
  if (cumRatio < 0.5) {
    if (_canAlert('extreme_shrink')) {
      _notify('⚠️ 持续极端缩量', `今日累计量能仅为昨日同期的 ${(cumRatio * 100).toFixed(0)}%，市场交投极度清淡`, 1)
    }
  } else if (cumRatio < 0.7) {
    // 显著缩量（累计比率 < 70%）
    if (_canAlert('significant_shrink')) {
      _notify('📊 持续缩量', `今日累计量能为昨日同期的 ${(cumRatio * 100).toFixed(0)}%，市场交投清淡`, 1)
    }
  }
  
  // 极端放量（累计比率 > 200%）
  if (cumRatio > 2.0) {
    if (_canAlert('extreme_expand')) {
      _notify('🔥 持续极端放量', `今日累计量能为昨日同期的 ${(cumRatio * 100).toFixed(0)}%，市场交投极度活跃`, 2)
    }
  } else if (cumRatio > 1.3) {
    // 显著放量（累计比率 > 130%）
    if (_canAlert('significant_expand')) {
      _notify('📊 持续放量', `今日累计量能为昨日同期的 ${(cumRatio * 100).toFixed(0)}%，市场交投活跃`, 2)
    }
  }
}

function checkCumulativeDiffAlert() {
  if (!alertEnabled.value) return
  const data = minuteData.value
  
  const lastCompleteIdx = getLastCompleteIndex(data)
  if (lastCompleteIdx < WINDOW) return

  const completedData = []
  for (let i = 0; i <= lastCompleteIdx; i++) {
    const d = data[i]
    if (d.hasData && !d.isFuture && d.todayVol > 0 && d.yestVol > 0) {
      completedData.push(d)
    }
  }

  if (completedData.length < WINDOW) return

  // 核心：柱子高度 = 累计差额（今日 - 昨日），单位：元
  const recent = completedData.slice(-WINDOW)
  const diffs = recent.map(d => d.todayVol - d.yestVol)
  
  // 柱子首尾差（元）→ 转亿元
  const latestDiff = diffs[diffs.length - 1]
  const firstDiff = diffs[0]
  const diffChangeYuan = latestDiff - firstDiff
  const latestDiffYi = latestDiff / 1e8
  const diffChangeYi = diffChangeYuan / 1e8

  const latestData = recent[recent.length - 1]
  const cumulativeRatio = latestData.yestVol > 0 ? latestData.todayVol / latestData.yestVol : 1

  console.log('[量能告警] 柱子分析', {
    time: recent[recent.length - 1].time,
    latestDiffYi: latestDiffYi.toFixed(2),
    diffChangeYi: diffChangeYi.toFixed(2),
    trend: latestDiffYi < 0 ? '缩量' : '放量',
    speed: diffChangeYi > 0 ? '加速' : diffChangeYi < 0 ? '减速' : '平稳'
  })

  const DIFF_THRESHOLD_YI = 30  // 30亿最小变化量，过滤噪音

  // 1. 柱子变高 → 加速
  if (diffChangeYi > DIFF_THRESHOLD_YI) {
    if (latestDiffYi < 0) {
      if (_canAlert('diff_shrink_relief')) {
        _notify('📈 缩量减弱', `当前差额 ${latestDiffYi.toFixed(0)}亿，收窄 ${diffChangeYi.toFixed(0)}亿`, 2)
      }
    } else {
      if (_canAlert('diff_expand_speed')) {
        _notify('🚀 放量加速', `当前差额 +${latestDiffYi.toFixed(0)}亿，扩大 +${diffChangeYi.toFixed(0)}亿`, 2)
      }
    }
  }
  // 2. 柱子变低 → 减速
  else if (diffChangeYi < -DIFF_THRESHOLD_YI) {
    if (latestDiffYi < 0) {
      if (_canAlert('diff_shrink_speed')) {
        _notify('⚠️ 缩量加速', `当前差额 ${latestDiffYi.toFixed(0)}亿，扩大 ${Math.abs(diffChangeYi).toFixed(0)}亿`, 1)
      }
    } else {
      if (_canAlert('diff_expand_decrease')) {
        _notify('📉 放量减弱', `当前差额 +${latestDiffYi.toFixed(0)}亿，收窄 ${Math.abs(diffChangeYi).toFixed(0)}亿`, 2)
      }
    }
  }

  // 3. 趋势颜色转换（由强转弱 / 由弱转强）
  let cumulativeTrend = ''
  if (cumulativeRatio > 1.3) cumulativeTrend = 'positive'
  else if (cumulativeRatio < 0.7) cumulativeTrend = 'negative'

  if (_prevCumulativeTrend && _prevCumulativeTrend !== cumulativeTrend) {
    if (cumulativeTrend === 'negative') {
      if (_canAlert('diff_pos_to_neg')) {
        _notify('📉 量能由强转弱', `今日累计量能为昨日同期的 ${(cumulativeRatio * 100).toFixed(0)}%`, 2)
      }
    } else if (cumulativeTrend === 'positive') {
      if (_canAlert('diff_neg_to_pos')) {
        _notify('📈 量能由弱转强', `今日累计量能为昨日同期的 ${(cumulativeRatio * 100).toFixed(0)}%`, 2)
      }
    }
  }

  // 4. 极端比率告警
  if (cumulativeRatio < 0.5) {
    if (_canAlert('diff_extreme_shrink')) {
      _notify('⚠️ 极端缩量', `今日累计量能仅为昨日同期的 ${(cumulativeRatio * 100).toFixed(0)}%`, 1)
    }
  } else if (cumulativeRatio < 0.7) {
    if (_canAlert('diff_significant_shrink')) {
      _notify('📊 显著缩量', `今日累计量能为昨日同期的 ${(cumulativeRatio * 100).toFixed(0)}%`, 1)
    }
  } else if (cumulativeRatio > 2.0) {
    if (_canAlert('diff_extreme_expand')) {
      _notify('🔥 极端放量', `今日累计量能达昨日同期的 ${(cumulativeRatio * 100).toFixed(0)}%`, 2)
    }
  } else if (cumulativeRatio > 1.5) {
    if (_canAlert('diff_significant_expand')) {
      _notify('📊 显著放量', `今日累计量能为昨日同期的 ${(cumulativeRatio * 100).toFixed(0)}%`, 2)
    }
  }

  // 更新状态
  _prevCumulativeRatio = cumulativeRatio
  if (cumulativeTrend) _prevCumulativeTrend = cumulativeTrend
}

// 上证指数加权线与未加权线交叉检测
function checkIndexCrossAlert() {
  if (!alertEnabled.value) return
  const data = indexData.value
  if (!data || data.length < 2) return

  // 只取最后两个有效点（最近一分钟 vs 前一分钟）
  const validPoints = data.filter(d => d.close != null && d.average != null)
  if (validPoints.length < 2) return

  const curr = validPoints[validPoints.length - 1]
  const prev = validPoints[validPoints.length - 2]

  const currDiff = curr.close - curr.average
  const prevDiff = prev.close - prev.average

  // 如果没有发生交叉，更新状态并返回
  if ((prevDiff > 0 && currDiff > 0) || (prevDiff < 0 && currDiff < 0)) {
    _prevCloseVsAvg = currDiff > 0 ? 'above' : 'below'
    return
  }

  // 避免同一分钟重复提示（通过冷却机制）
  const volDesc = getVolumeStatusDesc()

  // 加权线从下方穿越未加权线
  if (prevDiff <= 0 && currDiff > 0) {
    if (_canAlert('index_weighted_cross_up')) {
      _notify('🟢 上证指数加权线上穿', `加权线 ${curr.close.toFixed(2)} 上穿未加权线 ${curr.average.toFixed(2)}，当前${volDesc}`, 2)
    }
    _prevCloseVsAvg = 'above'
    _lastCrossTime = curr.time
    return
  }

  // 加权线从上方穿越未加权线
  if (prevDiff >= 0 && currDiff < 0) {
    if (_canAlert('index_weighted_cross_down')) {
      _notify('🔴 上证指数加权线下穿', `加权线 ${curr.close.toFixed(2)} 下穿未加权线 ${curr.average.toFixed(2)}，当前${volDesc}`, 2)
    }
    _prevCloseVsAvg = 'below'
    _lastCrossTime = curr.time
    return
  }
}

function getVolumeStatusDesc() {
  const s = trendStatus.value
  if (s === 'extreme_expanding') return '极端放量'
  if (s === 'expanding') return '放量中'
  if (s === 'extreme_shrinking') return '极端缩量'
  if (s === 'shrinking') return '缩量中'

  // 无趋势时用累计比率判断
  const diff = cumulativeDiff.value
  if (diff > 0) return '放量中'
  if (diff < 0) return '缩量中'
  return '成交清淡'
}

// ===== 数据拉取 =====

// JSONP 方式拉取上证指数分时数据
function fetchIndexData() {
  return new Promise((resolve) => {
    const callbackName = `__idx_cb_${Date.now()}_${Math.floor(Math.random() * 10000)}`
    const script = document.createElement('script')
    const timer = setTimeout(() => {
      cleanup()
      resolve([])
    }, 10000)

    function cleanup() {
      clearTimeout(timer)
      delete window[callbackName]
      script.remove()
    }

    window[callbackName] = (data) => {
      cleanup()
      const trends = data?.data?.trends || []
      const parsed = trends.map(line => {
        const parts = line.split(',')
        if (parts.length < 8) return null
        const timeStr = parts[0].substring(11) // "2026-08-11 13:18" -> "13:18"
        return {
          time: timeStr,
          close: parseFloat(parts[2]),   // 收盘价（蓝线）
          average: parseFloat(parts[7])  // 均价（黄线）
        }
      }).filter(Boolean)
      resolve(parsed)
    }

    const cbParam = encodeURIComponent(callbackName)
    const secid = '1.000001' // 上证指数
    script.src = `https://push2his.eastmoney.com/api/qt/stock/trends2/get?fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ut=fa5fd1943c7b386f172d6893dbfba10b&iscr=0&ndays=1&secid=${secid}&cb=${cbParam}&_=${Date.now()}`
    script.onerror = () => {
      cleanup()
      resolve([])
    }
    document.head.appendChild(script)
  })
}

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
    minuteData.value = enrichTrends(computeMinuteData(raw))

    // 拉取上证指数分时数据并匹配到时间轴
    const idxRaw = await fetchIndexData()
    if (idxRaw.length > 0) {
      const idxMap = new Map()
      for (const item of idxRaw) {
        idxMap.set(item.time, item)
      }
      indexData.value = minuteData.value.map(d => {
        const idx = idxMap.get(d.time)
        if (!idx || !d.hasData || d.isFuture) {
          return { time: d.time, close: null, average: null }
        }
        return { time: d.time, close: idx.close, average: idx.average }
      })
    } else {
      indexData.value = minuteData.value.map(d => ({ time: d.time, close: null, average: null }))
    }

    // 趋势分析
    analyzeTrend()

    // 极值告警
    checkExtremeAlert()

    // 累计差额告警
    checkCumulativeDiffAlert()

    // 上证指数金叉/死叉检测
    checkIndexCrossAlert()

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

// 今日为昨日同期比率（从分钟级数据计算，更准确）
const vsYesterdaySamePeriod = computed(() => {
  const data = minuteData.value
  const validData = data.filter(d => d.hasData && !d.isFuture && d.todayVol > 0 && d.yestVol > 0)
  if (validData.length === 0) return 0
  const lastPoint = validData[validData.length - 1]
  return (lastPoint.todayVol / lastPoint.yestVol) * 100
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
  if (s === 'extreme_expanding') return '🔥'
  if (s === 'expanding') return '📈'
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

export function useVolumeMonitor() {
  return {
    loading,
    lastUpdate,
    header,
    points,
    minuteData,
    indexData,
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
    refreshInterval: _volumeTimer.refreshInterval,
    todayTotal,
    yesterdayTotal,
    predictTotal,
    vsYesterdaySamePeriod,
    fetchData,
    toggleAutoRefresh,
    formatVolume,
    formatPercent
  }
}
