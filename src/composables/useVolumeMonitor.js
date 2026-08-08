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

function computeMinuteData(rawPoints) {
  if (!rawPoints || rawPoints.length < 2) return []

  const result = []
  for (let i = 1; i < rawPoints.length; i++) {
    const [ts, todayCum, yestCum] = rawPoints[i]
    const [_, prevToday, prevYest] = rawPoints[i - 1]
    const todayVol = todayCum - prevToday
    const yestVol = yestCum - prevYest
    const ratio = yestVol > 0 ? todayVol / yestVol : 1
    const d = new Date(ts)
    const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    result.push({ time: timeStr, ts, todayVol, yestVol, ratio })
  }
  return result
}

function analyzeTrend() {
  const data = minuteData.value
  if (data.length < WINDOW * 2) {
    trendStatus.value = ''
    trendLabel.value = '数据不足'
    return
  }

  // 最近 WINDOW 分钟 vs 前 WINDOW 分钟
  const recent = data.slice(-WINDOW)
  const prev = data.slice(-WINDOW * 2, -WINDOW)

  const recentAvg = recent.reduce((s, d) => s + d.todayVol, 0) / WINDOW
  const prevAvg = prev.reduce((s, d) => s + d.todayVol, 0) / WINDOW

  // 今天 vs 昨天同时段
  const recentYestAvg = recent.reduce((s, d) => s + d.yestVol, 0) / WINDOW
  const yestRatio = recentYestAvg > 0 ? recentAvg / recentYestAvg : 1

  // 环比变化率（最近 vs 前一段）
  const seqRatio = prevAvg > 0 ? recentAvg / prevAvg : 1

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
    // 环比变化
    if (seqRatio < 0.75) {
      status = 'shrinking'
      label = `缩量趋势（环比 ${(seqRatio * 100).toFixed(0)}%）`
    } else if (seqRatio > 1.25) {
      status = 'expanding'
      label = `放量趋势（环比 ${(seqRatio * 100).toFixed(0)}%）`
    } else {
      status = 'stable'
      label = `量能平稳（较昨日同期 ${(yestRatio * 100).toFixed(0)}%）`
    }
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
  if (data.length < WINDOW) return

  const recent = data.slice(-WINDOW)
  const recentYestAvg = recent.reduce((s, d) => s + d.yestVol, 0) / WINDOW
  const recentAvg = recent.reduce((s, d) => s + d.todayVol, 0) / WINDOW
  const yestRatio = recentYestAvg > 0 ? recentAvg / recentYestAvg : 1

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
