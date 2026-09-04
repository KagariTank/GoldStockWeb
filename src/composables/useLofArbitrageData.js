import { ref, computed } from 'vue'
import { createAutoRefreshTimer } from './useTimerManager.js'

// ===== LOF 套利监控 · 数据单例 =====
// 数据源：腾讯基金行情接口 qt.gtimg.cn（GBK 编码，CORS * 全开）
//   - 批量查询：逗号分隔多个代码，500只/批，3批完成全量1452只候选
//   - 有效 LOF 约 399 只，其中有折溢价率数据约 349 只
//   - 按折溢价阈值 |premium| > 1% 过滤展示
//
// 腾讯 JSONP 字段索引（~分隔，88字段）：
//   [1] 名称  [2] 代码  [3] 现价  [4] 昨收
//   [30] 时间  [33] 涨跌幅%
//   [61] 类型(LOF)  [63] 折溢价率%  [81] 基金净值
//   [82] 币种
//
// LOF 基金代码来源：东财 fundcode_search.js
//   筛选规则：^(16|50|51)\d{4}$ → 16xxxx → sz，50/51xxxx → sh

const tableData = ref([])      // LOF 列表（已按折溢价率绝对值降序）
const loading = ref(false)
const lastUpdate = ref('')
const error = ref('')

// 折溢价阈值：|折溢价率| > 1% 才展示
const PREMIUM_THRESHOLD = 1.0

// 腾讯接口基础 URL
const TX_API_BASE = 'https://qt.gtimg.cn'

// LOF 代码列表缓存（模块级，首次加载后复用）
let _lofCodes = null  // [{code, prefix, name, type}]

// ===== GBK 解码 =====
// 浏览器端使用 TextDecoder('gbk') 解码腾讯返回的 GBK 数据
async function decodeGbk(response) {
  const buffer = await response.arrayBuffer()
  const decoder = new TextDecoder('gbk')
  return decoder.decode(buffer)
}

// ===== 获取 LOF 代码列表 =====
// 从东财 fundcode_search.js 获取全量基金列表，筛选 LOF 代码
async function fetchLofCodes() {
  if (_lofCodes) return _lofCodes

  try {
    const url = 'https://fund.eastmoney.com/js/fundcode_search.js'
    const res = await fetch(url)
    const text = await res.text()

    // 解析 var r = [["000001","HXCZHH","华夏成长混合","混合型-灵活","PINYIN"], ...]
    const m = text.match(/var\s+r\s*=\s*(\[.*?\]);/s)
    if (!m) throw new Error('无法解析基金列表')

    const arr = JSON.parse(m.group(1))
    _lofCodes = []
    for (const item of arr) {
      const code = item[0]
      // LOF 代码匹配：16xxxx → sz，50/51xxxx → sh
      if (/^(16|50|51)\d{4}$/.test(code)) {
        const prefix = code.startsWith('16') ? 'sz' : 'sh'
        _lofCodes.push({
          code,
          prefix,
          name: item[2],
          type: item[3]
        })
      }
    }
    console.log(`[lofArbitrage] LOF 代码列表加载: ${_lofCodes.length} 只`)
    return _lofCodes
  } catch (e) {
    console.error('[lofArbitrage] 基金列表获取失败:', e)
    throw e
  }
}

// ===== 批量查询腾讯行情 =====
// 500只/批，返回解析后的 LOF 数据数组
async function fetchBatchQuotes(codes) {
  // codes: [{code, prefix, name, type}]
  const batchSize = 500
  const results = []

  for (let i = 0; i < codes.length; i += batchSize) {
    const batch = codes.slice(i, i + batchSize)
    const query = batch.map(c => `${c.prefix}${c.code}`).join(',')
    const url = `${TX_API_BASE}/q=${query}`

    const res = await fetch(url)
    const text = await decodeGbk(res)

    // 解析 JSONP：v_sz160105="51~...~"; v_sh501018="...";
    const lines = text.split(';')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.includes('~')) continue

      // 提取引号内的数据
      const m = trimmed.match(/v_\w+="(.+?)"$/)
      if (!m) continue

      const parts = m[1].split('~')
      if (parts.length < 85) continue

      // 只保留 LOF 类型
      const fundType = parts[61] || ''
      if (fundType !== 'LOF') continue

      const code = parts[2]
      const price = parseFloat(parts[3]) || 0
      const nav = parseFloat(parts[81]) || 0
      const premium = parseFloat(parts[63]) || 0

      // 过滤异常数据：现价=0 或 现价=1.0（疑似停牌/转型/未上市）
      if (price <= 0 || price === 1.0) continue

      // 过滤无净值数据
      if (nav <= 0) continue

      // 折溢价阈值过滤
      if (Math.abs(premium) < PREMIUM_THRESHOLD) continue

      results.push({
        code,
        name: parts[1],
        price,
        prevClose: parseFloat(parts[4]) || 0,
        changePct: parseFloat(parts[33]) || 0,
        premiumRate: premium,    // 折溢价率%
        nav,                     // 基金净值
        navDiff: price - nav,     // 现价与净值差额
      })
    }
  }

  return results
}

// ===== 自动刷新定时器（30s，走统一管理） =====
const _lofTimer = createAutoRefreshTimer('lofArbitrage', {
  onRefresh: () => {
    if (!loading.value) fetchLofData()
  },
  refreshInterval: 30,
  initialCountdown: 30,
  shouldRefresh: () => !loading.value
})

const autoRefresh = _lofTimer.isActive
const countdown = _lofTimer.countdown

// ===== 主拉取函数 =====
async function fetchLofData() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const codes = await fetchLofCodes()
    const data = await fetchBatchQuotes(codes)

    // 按折溢价率绝对值降序排列
    data.sort((a, b) => Math.abs(b.premiumRate) - Math.abs(a.premiumRate))

    tableData.value = data
    const now = new Date()
    lastUpdate.value = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
  } catch (e) {
    error.value = 'LOF 数据获取失败：' + (e.message || e)
    console.error('[lofArbitrage] 数据获取失败:', e)
  } finally {
    loading.value = false
  }
}

// ===== 汇总统计 =====
const stats = computed(() => {
  const rows = tableData.value
  const total = rows.length

  // 溢价数量（premium > 0）
  const premiumCount = rows.filter(r => r.premiumRate > 0).length
  // 折价数量（premium < 0）
  const discountCount = rows.filter(r => r.premiumRate < 0).length
  // 高溢价（> 3%）
  const highPremium = rows.filter(r => r.premiumRate > 3).length
  // 深折价（< -3%）
  const deepDiscount = rows.filter(r => r.premiumRate < -3).length
  // 最高溢价
  const maxPremium = rows.reduce((m, r) => Math.max(m, r.premiumRate), 0)
  // 最低折价
  const minDiscount = rows.reduce((m, r) => Math.min(m, r.premiumRate), 0)

  return { total, premiumCount, discountCount, highPremium, deepDiscount, maxPremium, minDiscount }
})

function toggleAutoRefresh() {
  _lofTimer.toggle()
}

export function useLofArbitrageData() {
  return {
    tableData,
    loading,
    lastUpdate,
    error,
    autoRefresh,
    countdown,
    stats,
    fetchLofData,
    toggleAutoRefresh
  }
}
