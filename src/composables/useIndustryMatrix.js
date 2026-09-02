import { ref } from 'vue'
import { createAutoRefreshTimer } from './useTimerManager.js'

// ===== 行业强度矩阵 · 数据单例 =====
// 数据源：东财 push2 clist（行业板块 m:90+t:2），与 useSectorFundFlow 同源
// 字段约定（基点 = 实际% × 100）：
//   f12 板块代码、f14 板块名称
//   f109 5日涨跌幅、f160 20日涨跌幅、f24 60日涨跌幅
//   f20 成交额（分，需 /100 换算为元）、f3 当日涨跌幅、f62 主力净流入（元）

const matrixData = ref([])        // 归一化后的板块列表
const loading = ref(false)
const lastUpdate = ref('')
const error = ref('')

// 多周期涨跌家数统计（市场宽度）
const breadth = ref({
  today: { up: 0, down: 0, ratio: 0 },
  day5: { up: 0, down: 0, ratio: 0 },
  day20: { up: 0, down: 0, ratio: 0 },
  day60: { up: 0, down: 0, ratio: 0 }
})

const FIELDS = 'f12,f14,f109,f160,f24,f20,f3,f62,f2'

// 东财板块 fs 参数（行业板块）
const BOARD_FS = 'm:90+t:2'

// 自动刷新定时器（30s，走统一管理）
const _matrixTimer = createAutoRefreshTimer('industryMatrix', {
  onRefresh: () => {
    if (!loading.value) fetchMatrixData()
  },
  refreshInterval: 30,
  initialCountdown: 30,
  shouldRefresh: () => !loading.value
})

const autoRefresh = _matrixTimer.isActive
const countdown = _matrixTimer.countdown

// 东财行情接口（dev 走 vite 代理 /em-api，生产走 proxy.cors.sh 免费 CORS 代理）
function buildUrl() {
  const isDev = import.meta.env.DEV
  const originPath = `/dataapi/bkzj/getbkzj?key=${FIELDS}&code=${encodeURIComponent(BOARD_FS)}&_t=${Date.now()}`
  if (isDev) return `/em-api${originPath}`
  return `https://proxy.cors.sh/https://data.eastmoney.com${originPath}`
}

// 行业板块筛选：东财行业接口（m:90+t:2）返回全量 496 个，含三级细分（BK12~BK16 段 400+ 个）。
// 参考图（约 90 个点）用的是东财标准行业板块（BK04~BK10 段，74 个）。
// 筛选规则：板块代码 BK04xx~BK10xx 且名称不以「Ⅲ」结尾（Ⅲ 是三级子类，如 白酒Ⅲ/银行Ⅲ）
function filterIndustryBoards(list) {
  return list.filter(item => {
    const code = item.f12 || ''
    if (!/^BK\d+$/.test(code)) return false
    const num = parseInt(code.slice(2), 10)
    if (!(num >= 400 && num < 1100)) return false
    if (/Ⅲ$/.test(item.f14 || '')) return false
    return true
  })
}

// 计算涨跌家数统计（板块级口径）
function calcBreadth(rows) {
  const stats = {
    today: { up: 0, down: 0 },
    day5: { up: 0, down: 0 },
    day20: { up: 0, down: 0 },
    day60: { up: 0, down: 0 }
  }
  for (const r of rows) {
    const chg5 = Number(r.f109) || 0
    const chg20 = Number(r.f160) || 0
    const chg60 = Number(r.f24) || 0
    const chgToday = Number(r.f3) || 0
    if (chgToday > 0) stats.today.up++
    else if (chgToday < 0) stats.today.down++
    if (chg5 > 0) stats.day5.up++
    else if (chg5 < 0) stats.day5.down++
    if (chg20 > 0) stats.day20.up++
    else if (chg20 < 0) stats.day20.down++
    if (chg60 > 0) stats.day60.up++
    else if (chg60 < 0) stats.day60.down++
  }
  const ratio = s => (s.up === 0 && s.down === 0) ? 0 : +((s.up / Math.max(s.down, 1))).toFixed(1)
  return {
    today: { ...stats.today, ratio: ratio(stats.today) },
    day5: { ...stats.day5, ratio: ratio(stats.day5) },
    day20: { ...stats.day20, ratio: ratio(stats.day20) },
    day60: { ...stats.day60, ratio: ratio(stats.day60) }
  }
}

async function fetchMatrixData() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const res = await fetch(buildUrl())
    const json = await res.json()
    const diff = json?.data?.diff || []
    const rows = filterIndustryBoards(diff)
    // 仅保留有有效 5日/20日涨幅的数据
    const valid = rows.filter(r => r.f109 !== undefined && r.f160 !== undefined)
    matrixData.value = valid.map(r => ({
      code: r.f12,
      name: r.f14,
      chg5: (Number(r.f109) || 0) / 100,       // 5日涨幅 %
      chg20: (Number(r.f160) || 0) / 100,      // 20日涨幅 %
      chg60: (Number(r.f24) || 0) / 100,       // 60日涨幅 %
      chgToday: (Number(r.f3) || 0) / 100,     // 当日涨幅 %
      amount: (Number(r.f20) || 0) / 100,        // 成交额（f20 单位为分，换算为元）
      mainInflow: Number(r.f62) || 0           // 主力净流入
    }))
    breadth.value = calcBreadth(valid)
    const now = new Date()
    lastUpdate.value = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
  } catch (e) {
    error.value = '行业矩阵数据获取失败：' + (e.message || e)
    console.error('[industryMatrix] 数据获取失败:', e)
  } finally {
    loading.value = false
  }
}

function toggleAutoRefresh() {
  _matrixTimer.toggle()
}

// 气泡图数据（已算好的矩阵点）
function getMatrixPoints() {
  return matrixData.value.map(r => ({
    name: r.name,
    value: [r.chg5, r.chg20, r.amount], // [x=5日, y=20日, size=成交额]
    chg60: r.chg60,
    chgToday: r.chgToday,
    mainInflow: r.mainInflow,
    code: r.code
  }))
}

export function useIndustryMatrix() {
  return {
    matrixData,
    loading,
    lastUpdate,
    error,
    breadth,
    autoRefresh,
    countdown,
    fetchMatrixData,
    toggleAutoRefresh,
    getMatrixPoints
  }
}