import { ref } from 'vue'
import { createAutoRefreshTimer } from './useTimerManager.js'

// ===== 行业强度矩阵 · 数据单例 =====
// 数据源：东财 push2 clist（行业板块 m:90+t:2），与 useSectorFundFlow 同源
// 字段约定（API 直接返回百分比数值，非基点）：
//   f12 板块代码、f14 板块名称
//   f109 5日涨跌幅(%)、f160 20日涨跌幅(%)、f24 60日涨跌幅(%)
//   f20 成交额(元)、f3 当日涨跌幅(%)、f62 主力净流入(元)

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

// push2delay clist 接口（东财延迟行情子域，CORS 全开，浏览器可直连）
// 注：push2.eastmoney.com 对部分 IP 有间歇性风控（empty reply），push2delay 为备用子域实测稳定
const PUSH2_CLIST_URL = 'https://push2delay.eastmoney.com/api/qt/clist/get'
const MAX_RETRIES = 3

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

// 东财行情接口（dev 走 vite 代理 /em-api，生产直连 push2delay clist）
// 注：proxy.cors.sh / cors.eu.org 已失效；push2delay 为 push2 备用子域，CORS 全开可直连
// push2delay 单页上限 100 条，需翻页拉满 total（行业 496）
async function fetchAllPages(boardFs) {
  const all = []
  let lastErr
  let total = Infinity
  for (let pn = 1; all.length < total; pn++) {
    const params = new URLSearchParams({
      pn: String(pn), pz: '100', po: '1', np: '1',
      fltt: '2', invt: '2', fid: 'f3',
      fs: boardFs,
      fields: FIELDS,
      _: String(Date.now())
    })
    const url = `${PUSH2_CLIST_URL}?${params.toString()}`
    let pageData = null
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (data && data.data && data.data.diff) { pageData = data; break }
        throw new Error('empty data')
      } catch (e) {
        lastErr = e
        if (attempt < MAX_RETRIES - 1) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
      }
    }
    if (!pageData) throw lastErr || new Error('push2delay clist 全部重试失败')
    total = pageData.data.total || all.length
    const diff = pageData.data.diff || []
    all.push(...diff)
    if (diff.length < 100) break  // 不足一页，已到末页
  }
  return all
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
    const isDev = import.meta.env.DEV
    let diff
    if (isDev) {
      const originPath = `/dataapi/bkzj/getbkzj?key=${FIELDS}&code=${encodeURIComponent(BOARD_FS)}&_t=${Date.now()}`
      const res = await fetch(`/em-api${originPath}`)
      const json = await res.json()
      diff = json?.data?.diff || []
    } else {
      diff = await fetchAllPages(BOARD_FS)
    }
    const rows = filterIndustryBoards(diff)
    // 仅保留有有效 5日/20日涨幅的数据
    const valid = rows.filter(r => r.f109 !== undefined && r.f160 !== undefined)
    matrixData.value = valid.map(r => ({
      code: r.f12,
      name: r.f14,
      chg5: Number(r.f109) || 0,       // 5日涨幅 %（API 直接返回百分比）
      chg20: Number(r.f160) || 0,      // 20日涨幅 %
      chg60: Number(r.f24) || 0,       // 60日涨幅 %
      chgToday: Number(r.f3) || 0,     // 当日涨幅 %
      amount: Number(r.f20) || 0,      // 成交额（元）
      mainInflow: Number(r.f62) || 0   // 主力净流入（元）
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