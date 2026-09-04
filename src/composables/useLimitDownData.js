import { ref, computed } from 'vue'
import { createAutoRefreshTimer } from './useTimerManager.js'

// ===== 跌停板监控 · 数据单例 =====
// 数据源：东财 push2ex getTopicDTPool（跌停池）
// 字段约定（金额单位均为元）：
//   c 代码、n 名称、p 现价（×1000 整数）、zdp 涨跌幅%
//   fund 封单资金（元）、lbt 最后封板时间（HHMMSS 整数）、fba 板上成交额（元）
//   days 连续跌停天数、oc 开板次数、hybk 所属行业、hs 换手率%、pe 市盈率
// 注意：push2ex 接口原生返回 Access-Control-Allow-Origin（任意 Origin），
//   生产环境（GitHub Pages）可直接直连，无需 CORS 代理；dev 走 vite 代理。

const tableData = ref([])      // 跌停股列表（已按连续跌停天数降序）
const loading = ref(false)
const lastUpdate = ref('')
const error = ref('')
const displayDate = ref('')    // 数据实际所属交易日（YYYYMMDD）

const ZTB_UT = '7eea3edcaed734bea9cbfc24409ed989'
const DPT = 'wz.ztzt'
const API_BASE = 'https://push2ex.eastmoney.com'

// ===== 交易日判断 =====
// 接口对非交易日返回 data=null（周末/节假日），此时回退到最近一个工作日。
// 简化处理：仅排除周末（节假日命中时会在请求后按 data=null 逐日向前回退）
function isWeekend(d) {
  const day = d.getDay()
  return day === 0 || day === 6
}

// 生成 YYYYMMDD 字符串
function fmtDate(d) {
  const pad = n => (n < 10 ? '0' : '') + n
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}

// 当前市场日期：周末回退到周五
function getMarketDate() {
  const now = new Date()
  if (isWeekend(now)) {
    const friday = new Date(now)
    friday.setDate(now.getDate() - (now.getDay() === 0 ? 2 : 1))
    return fmtDate(friday)
  }
  return fmtDate(now)
}

// ===== 自动刷新定时器（30s，走统一管理） =====
const _limitDownTimer = createAutoRefreshTimer('limitDown', {
  onRefresh: () => {
    if (!loading.value) fetchLimitDownData()
  },
  refreshInterval: 30,
  initialCountdown: 30,
  shouldRefresh: () => !loading.value
})

const autoRefresh = _limitDownTimer.isActive
const countdown = _limitDownTimer.countdown

// ===== 请求 URL（生产直连，dev 走 vite 代理） =====
function buildUrl(date) {
  const isDev = import.meta.env.DEV
  const params = `getTopicDTPool?ut=${ZTB_UT}&dpt=${DPT}&Pageindex=0&pagesize=10000&sort=fund:asc&date=${date}`
  // push2ex 原生 CORS 全开，生产直连；dev 走 vite 代理（/em-ex-api → push2ex）
  return isDev ? `/em-ex-api/${params}` : `${API_BASE}/${params}`
}

// ===== 时间格式化：HHMMSS 整数 → HH:MM:SS =====
function fmtTime(t) {
  if (t === null || t === undefined || t === '') return '-'
  const s = String(t).padStart(6, '0')
  return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`
}

// ===== 日期回退请求：非交易日 data=null → 逐日向前找最近一个交易日 =====
// 最多回退 7 天（覆盖国庆/春节长假）
async function fetchWithDateFallback(startDate) {
  const MAX_FALLBACK_DAYS = 7
  let d = new Date(`${startDate.slice(0, 4)}-${startDate.slice(4, 6)}-${startDate.slice(6, 8)}T12:00:00`)
  for (let i = 0; i < MAX_FALLBACK_DAYS; i++) {
    const dateStr = fmtDate(d)
    const res = await fetch(buildUrl(dateStr))
    const json = await res.json()
    const pool = json?.data?.pool || []
    if (pool.length > 0) {
      return { pool, date: dateStr }
    }
    // 非交易日 data=null，向前一天
    d.setDate(d.getDate() - 1)
  }
  return { pool: [], date: startDate }
}

async function fetchLimitDownData() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const { pool, date } = await fetchWithDateFallback(getMarketDate())
    // 字段映射 + 排序（连续跌停天数降序，同天数按封单资金降序）
    const rows = pool.map(p => ({
      code: p.c,
      name: p.n,
      price: (Number(p.p) || 0) / 1000,          // ×1000 整数 → 元
      pct: Number(p.zdp) || 0,                    // 涨跌幅 %
      sealFund: Number(p.fund) || 0,              // 封单资金（元）
      lastSeal: fmtTime(p.lbt),                   // 最后封板时间
      boardAmount: Number(p.fba) || 0,            // 板上成交额（元）
      dtDays: Number(p.days) || 0,                // 连续跌停天数
      openTimes: Number(p.oc) || 0,               // 开板次数
      industry: p.hybk || '',
      turnover: Number(p.hs) || 0,                // 换手率 %
      pe: p.pe
    }))
    rows.sort((a, b) => b.dtDays - a.dtDays || b.sealFund - a.sealFund)
    tableData.value = rows
    displayDate.value = date
    const now = new Date()
    lastUpdate.value = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
  } catch (e) {
    error.value = '跌停板数据获取失败：' + (e.message || e)
    console.error('[limitDown] 数据获取失败:', e)
  } finally {
    loading.value = false
  }
}

// ===== 汇总统计 =====
const stats = computed(() => {
  const rows = tableData.value
  const total = rows.length
  // 连续跌停 ≥2 天（连跌停）
  const multi = rows.filter(r => r.dtDays >= 2).length
  // 封单资金合计（元）
  const sealTotal = rows.reduce((s, r) => s + r.sealFund, 0)
  // 开板次数 ≥1
  const opened = rows.filter(r => r.openTimes > 0).length
  // 最大连续跌停天数
  const maxDays = rows.reduce((m, r) => Math.max(m, r.dtDays), 0)
  return { total, multi, sealTotal, opened, maxDays }
})

function toggleAutoRefresh() {
  _limitDownTimer.toggle()
}

export function useLimitDownData() {
  return {
    tableData,
    loading,
    lastUpdate,
    error,
    displayDate,
    autoRefresh,
    countdown,
    stats,
    fetchLimitDownData,
    toggleAutoRefresh
  }
}