import { ref, computed } from 'vue'
import { fireNotify, initAudio } from '@/js/notify.js'

// ===== 单例状态 =====
const loading = ref(false)
const lastUpdate = ref('')

// 原始数据
const header = ref(null)       // { today, yesterday, change, predict }
const points = ref([])         // [[ts, todayCum, yestCum, change], ...]

// 分钟级增量数据
const minuteData = ref([])     // [{ time, todayVol, yestVol, ratio }]

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
let _prevCumulativeTrend = ''   // 上一次的累计差额趋势: 'positive' | 'negative' | ''
let _prevDiffDirection = ''     // 上一次的差额变化方向: 'increasing' | 'decreasing' | ''

// 自动刷新
const autoRefresh = ref(false)
const countdown = ref(30)
let _timer = null
let _countdownTimer = null

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

// 生成A股全天交易时间轴（9:30-11:30, 13:00-15:00）
function generateFullDayTimestamps(baseDate) {
  const timestamps = []
  const slots = [
    { start: 9 * 60 + 30, end: 11 * 60 + 30 },   // 上午：9:30 - 11:30
    { start: 13 * 60, end: 15 * 60 }              // 下午：13:00 - 15:00
  ]
  
  for (const slot of slots) {
    for (let minutes = slot.start; minutes < slot.end; minutes++) {
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

function computeMinuteData(rawPoints) {
  if (!rawPoints || rawPoints.length < 2) return []

  const now = Date.now()
  
  // 使用今天的日期生成全天时间轴
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const fullDayTimestamps = generateFullDayTimestamps(today)
  
  // 将原始数据转换为 Map，便于按时间查找
  const dataMap = new Map()
  for (let i = 1; i < rawPoints.length; i++) {
    const [ts, todayCum, yestCum] = rawPoints[i]
    const [_, prevToday, prevYest] = rawPoints[i - 1]

    const todayVol = todayCum - prevToday
    const yestVol = yestCum - prevYest

    // 跳过无效数据
    if (todayVol < 0 || yestVol < 0) continue

    let ratio = 1
    if (yestVol > 0) {
      ratio = todayVol / yestVol
      if (!isFinite(ratio) || isNaN(ratio)) ratio = 1
    }

    dataMap.set(ts, { todayVol, yestVol, ratio })
  }
  
  // 按全天时间轴生成数据，无数据的时间点用null填充
  const result = fullDayTimestamps.map(({ ts, timeStr }) => {
    const data = dataMap.get(ts)
    const isFuture = ts > now
    const hasData = !!data && !isFuture  // 只有已发生且有实际数据才标记为有效
    
    return {
      time: timeStr,
      ts,
      todayVol: hasData ? data.todayVol : null,
      yestVol: hasData ? data.yestVol : null,
      ratio: hasData ? data.ratio : null,
      isFuture,
      hasData
    }
  })
  
  return result
}

function analyzeTrend() {
  const data = minuteData.value
  
  // 过滤掉没有实际数据的记录（包括未来时间点和无数据的已发生时间点）
  const validData = data.filter(d => d.hasData && !d.isFuture)
  
  if (validData.length < WINDOW) {
    trendStatus.value = ''
    trendLabel.value = '数据不足'
    return
  }

  // 取最近 WINDOW 分钟的有效数据
  const recent = validData.slice(-WINDOW)

  // 过滤掉无效数据
  const validRecent = recent.filter(d => d.todayVol > 0 && d.yestVol > 0 && isFinite(d.ratio) && !isNaN(d.ratio))

  if (validRecent.length < WINDOW / 2) {
    trendStatus.value = ''
    trendLabel.value = '有效数据不足'
    return
  }

  // 计算平均值
  const recentAvg = validRecent.reduce((s, d) => s + d.todayVol, 0) / validRecent.length
  const recentYestAvg = validRecent.reduce((s, d) => s + d.yestVol, 0) / validRecent.length

  // 检查平均值是否有效
  if (recentAvg <= 0 || recentYestAvg <= 0 || !isFinite(recentAvg) || !isFinite(recentYestAvg)) {
    trendStatus.value = ''
    trendLabel.value = '数据异常'
    return
  }

  // 今天 vs 昨天同时段
  const yestRatio = recentAvg / recentYestAvg

  // 检查比例是否有效
  if (!isFinite(yestRatio) || isNaN(yestRatio)) {
    trendStatus.value = ''
    trendLabel.value = '数据异常'
    return
  }

  let status = 'stable'
  let label = ''

  // 与昨日同时段比较
  if (yestRatio < 0.7) {
    status = 'shrinking'
    label = `缩量趋势（较昨日同期 ${(yestRatio * 100).toFixed(0)}%）`
  } else if (yestRatio > 1.3) {
    status = 'expanding'
    label = `放量趋势（较昨日同期 ${(yestRatio * 100).toFixed(0)}%）`
  } else {
    status = 'stable'
    label = `量能平稳（较昨日同期 ${(yestRatio * 100).toFixed(0)}%）`
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
  fireNotify(title, body, level, isFileProtocol.value, selectedVoice)
}

function checkTransitionAlert(from, to) {
  if (!alertEnabled.value) return

  if (from === 'shrinking' && to === 'expanding') {
    if (_canAlert('shrink_to_expand')) {
      _notify('📈 缩量转放量', '市场成交量由缩量转为放量，资金活跃度提升，关注后续走势', 2)
    }
  } else if (from === 'expanding' && to === 'shrinking') {
    if (_canAlert('expand_to_shrink')) {
      _notify('📉 放量转缩量', '市场成交量由放量转为缩量，资金活跃度下降，注意风险', 2)
    }
  }
}

function checkExtremeAlert() {
  if (!alertEnabled.value) return
  const data = minuteData.value
  
  // 过滤掉没有实际数据的记录
  const validData = data.filter(d => d.hasData && !d.isFuture)
  if (validData.length < WINDOW) return

  const recent = validData.slice(-WINDOW)

  // 过滤无效数据
  const validRecent = recent.filter(d => d.todayVol > 0 && d.yestVol > 0 && isFinite(d.ratio) && !isNaN(d.ratio))

  if (validRecent.length < WINDOW / 2) return

  const recentYestAvg = validRecent.reduce((s, d) => s + d.yestVol, 0) / validRecent.length
  const recentAvg = validRecent.reduce((s, d) => s + d.todayVol, 0) / validRecent.length

  // 检查数据有效性
  if (recentYestAvg <= 0 || recentAvg <= 0 || !isFinite(recentYestAvg) || !isFinite(recentAvg)) {
    return
  }

  const yestRatio = recentAvg / recentYestAvg

  // 检查比例有效性
  if (!isFinite(yestRatio) || isNaN(yestRatio)) return

  // 持续缩量（较昨日 < 50%）
  if (yestRatio < 0.5) {
    if (_canAlert('extreme_shrink')) {
      _notify('⚠️ 持续缩量', `当前成交额仅为昨日同期的 ${(yestRatio * 100).toFixed(0)}%，市场交投清淡`, 1)
    }
  }
  // 持续放量（较昨日 > 200%）
  if (yestRatio > 2.0) {
    if (_canAlert('extreme_expand')) {
      _notify('🔥 持续放量', `当前成交额为昨日同期的 ${(yestRatio * 100).toFixed(0)}%，市场交投活跃`, 2)
    }
  }
}

function checkCumulativeDiffAlert() {
  if (!alertEnabled.value) return
  const data = minuteData.value
  
  // 过滤掉没有实际数据的记录
  const validData = data.filter(d => d.hasData && !d.isFuture)
  if (validData.length < WINDOW) return

  // 计算当前累计差额
  let cumulativeDiff = 0
  for (const d of validData) {
    cumulativeDiff += (d.todayVol - d.yestVol)
  }
  const cumulativeDiffYi = cumulativeDiff / 1e8  // 转换为亿元

  // 判断当前累计差额趋势
  let currentTrend = ''
  if (cumulativeDiffYi > 0) currentTrend = 'positive'
  else if (cumulativeDiffYi < 0) currentTrend = 'negative'

  // 判断差额变化方向（与上一次累计差额比较）
  let currentDirection = ''
  const diffChange = cumulativeDiffYi - _prevCumulativeDiff
  if (Math.abs(diffChange) < 0.01) {
    currentDirection = 'stable'
  } else if (diffChange > 0) {
    currentDirection = 'increasing'
  } else {
    currentDirection = 'decreasing'
  }

  // 1. 检测颜色转换（红转绿/绿转红）
  if (_prevCumulativeTrend && _prevCumulativeTrend !== currentTrend) {
    if (currentTrend === 'negative') {
      // 红转绿：累计差额由正转负（放量转缩量）
      if (_canAlert('diff_pos_to_neg')) {
        _notify('📉 累计差额由正转负', `累计成交额差额由正转负，当前 ${cumulativeDiffYi >= 0 ? '+' : ''}${cumulativeDiffYi.toFixed(2)}亿，资金流出加速`, 2)
      }
    } else if (currentTrend === 'positive') {
      // 绿转红：累计差额由负转正（缩量转放量）
      if (_canAlert('diff_neg_to_pos')) {
        _notify('📈 累计差额由负转正', `累计成交额差额由负转正，当前 +${cumulativeDiffYi.toFixed(2)}亿，资金流入加速`, 2)
      }
    }
  }

  // 2. 检测持续放量加剧（红色越来越高）
  if (currentTrend === 'positive' && currentDirection === 'increasing') {
    const pctChange = _prevCumulativeDiff !== 0 
      ? ((cumulativeDiffYi - _prevCumulativeDiff) / Math.abs(_prevCumulativeDiff) * 100) 
      : 0
    if (pctChange > 20 && cumulativeDiffYi > 1) {
      if (_canAlert('diff_strong_increase')) {
        _notify('🚀 放量加速', `累计放量差额加速增长，当前 +${cumulativeDiffYi.toFixed(2)}亿，较上次增长 ${pctChange.toFixed(0)}%`, 2)
      }
    }
  }

  // 3. 检测红色持续降低（放量减弱，柱子变矮）
  if (currentTrend === 'positive' && currentDirection === 'decreasing') {
    const pctChange = _prevCumulativeDiff !== 0 
      ? ((_prevCumulativeDiff - cumulativeDiffYi) / Math.abs(_prevCumulativeDiff) * 100) 
      : 0
    if (pctChange > 15 && cumulativeDiffYi > 0.5) {
      if (_canAlert('diff_positive_decreasing')) {
        _notify('📉 放量减弱', `累计放量差额持续降低，当前 +${cumulativeDiffYi.toFixed(2)}亿，较上次减少 ${pctChange.toFixed(0)}%，资金流入放缓`, 2)
      }
    }
  }

  // 4. 检测持续缩量加剧（绿色越来越深）
  if (currentTrend === 'negative' && currentDirection === 'decreasing') {
    const pctChange = _prevCumulativeDiff !== 0 
      ? ((_prevCumulativeDiff - cumulativeDiffYi) / Math.abs(_prevCumulativeDiff) * 100) 
      : 0
    if (pctChange > 20 && cumulativeDiffYi < -1) {
      if (_canAlert('diff_strong_decrease')) {
        _notify('⚠️ 缩量加速', `累计缩量差额加速扩大，当前 ${cumulativeDiffYi.toFixed(2)}亿，较上次扩大 ${pctChange.toFixed(0)}%`, 1)
      }
    }
  }

  // 5. 检测绿色持续降低（缩量减弱，柱子变矮）
  if (currentTrend === 'negative' && currentDirection === 'increasing') {
    const pctChange = _prevCumulativeDiff !== 0 
      ? ((cumulativeDiffYi - _prevCumulativeDiff) / Math.abs(_prevCumulativeDiff) * 100) 
      : 0
    if (pctChange > 15 && cumulativeDiffYi < -0.5) {
      if (_canAlert('diff_negative_decreasing')) {
        _notify('📈 缩量减弱', `累计缩量差额持续收窄，当前 ${cumulativeDiffYi.toFixed(2)}亿，较上次减少 ${pctChange.toFixed(0)}%，资金流出放缓`, 2)
      }
    }
  }

  // 6. 检测极端累计差额
  if (cumulativeDiffYi > 3) {
    if (_canAlert('diff_extreme_positive')) {
      _notify('🔥 累计放量超3亿', `今日累计成交放量差额达 +${cumulativeDiffYi.toFixed(2)}亿，显著高于昨日同期`, 1)
    }
  } else if (cumulativeDiffYi < -3) {
    if (_canAlert('diff_extreme_negative')) {
      _notify('⚠️ 累计缩量超3亿', `今日累计成交缩量差额达 ${cumulativeDiffYi.toFixed(2)}亿，显著低于昨日同期`, 1)
    }
  }

  // 更新状态
  _prevCumulativeDiff = cumulativeDiffYi
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
  if (autoRefresh.value) {
    autoRefresh.value = false
    countdown.value = 30
    if (_timer) { clearInterval(_timer); _timer = null }
    if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null }
    _prevTrend = ''
    _prevCumulativeDiff = 0
    _prevCumulativeTrend = ''
    _prevDiffDirection = ''
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
  if (s === 'expanding') return 'text-red-500'
  if (s === 'shrinking') return 'text-green-500'
  return 'text-muted-foreground'
})

const trendIcon = computed(() => {
  const s = trendStatus.value
  if (s === 'expanding') return '📈'
  if (s === 'shrinking') return '📉'
  return '➡️'
})

const cumulativeDiff = computed(() => {
  const data = minuteData.value
  const validData = data.filter(d => d.hasData && !d.isFuture)
  if (validData.length === 0) return 0
  let diff = 0
  for (const d of validData) {
    diff += (d.todayVol - d.yestVol)
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
