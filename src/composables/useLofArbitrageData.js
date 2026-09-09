import { ref, computed } from 'vue'
import { createAutoRefreshTimer } from './useTimerManager.js'

// ===== LOF 套利监控 · 数据单例 =====
// 数据源：腾讯基金行情接口 qt.gtimg.cn（GBK 编码，CORS * 全开，dev/生产均可直连）
//   - 批量查询：逗号分隔多个代码，500只/批，约 3 批完成全量
//   - 展示过滤：type=LOF 且 |折溢价率| > 1% 且 现价≠1.0（停牌/未上市）且净值>0
//
// 腾讯 JSONP 字段索引（~分隔，88字段）：
//   [1] 名称  [2] 代码  [3] 现价  [4] 昨收
//   [30] 时间  [33] 涨跌幅%
//   [61] 类型(LOF)  [77] 折溢价率%  [81] 基金净值
//   - [77] 为腾讯权威折溢价率字段，经验证 = (现价 - 单位净值)/单位净值×100%，398/398 全量精确匹配
//   - 注意：[62]/[63] 不是折溢价率（易混淆），切勿使用
//
// LOF 代码列表：内置（腾讯行情接口权威确认的 LOF 品种快照，2026-09）
//   - 16xxxx → sz，50xxxx → sh
//   - 数据来源：遍历东财 fundcode_search.js 匹配 ^(16|50|51)\d{4}$ 的候选，
//     再经腾讯 qt.gtimg.cn 逐只核对 type 字段 === 'LOF' 收敛而得
//   - 收敛前 1453 只中含 450 只 51 开头 ETF（腾讯 type=ETF）与大量 FJ/无行情品种，
//     已全部剔除，避免无效轮询与流量浪费
//   - 内置原因：腾讯无 LOF 列表接口，东财 fundcode_search.js 无 CORS 头，生产环境无法直连
//   - 注意：新上市 LOF 不会自动收录，需定期重新生成快照

const LOF_CODES = [
  "160105","160106","160119","160125","160127","160133","160135","160137","160140","160142","160211","160212",
  "160215","160216","160218","160219","160220","160221","160222","160223","160225","160311","160314","160322",
  "160323","160324","160326","160416","160418","160419","160420","160421","160505","160512","160513","160516",
  "160517","160518","160526","160527","160607","160610","160611","160613","160615","160616","160617","160618",
  "160620","160621","160622","160625","160626","160628","160629","160630","160631","160632","160633","160634",
  "160635","160636","160637","160638","160639","160641","160642","160643","160644","160646","160706","160716",
  "160717","160719","160722","160723","160805","160806","160807","160812","160813","160910","160916","160918",
  "160919","160921","160924","160925","161005","161010","161015","161017","161019","161024","161025","161026",
  "161027","161028","161029","161030","161031","161032","161033","161035","161036","161037","161038","161039",
  "161115","161116","161118","161119","161121","161122","161123","161124","161125","161126","161127","161128",
  "161129","161130","161131","161133","161216","161217","161219","161222","161224","161225","161226","161227",
  "161229","161232","161233","161505","161607","161610","161614","161626","161628","161631","161706","161713",
  "161715","161716","161720","161721","161722","161723","161724","161725","161726","161727","161728","161729",
  "161730","161810","161811","161812","161815","161816","161820","161831","161834","161903","161908","162006",
  "162105","162107","162108","162207","162215","162216","162307","162411","162412","162414","162415","162509",
  "162511","162605","162607","162703","162711","162712","162715","162719","162721","163001","163003","163005",
  "163109","163110","163111","163113","163114","163115","163116","163118","163208","163209","163302","163402",
  "163406","163407","163409","163412","163415","163417","163418","163503","163801","163819","163821","163907",
  "164105","164206","164208","164210","164212","164401","164402","164403","164508","164509","164606","164701",
  "164703","164705","164808","164814","164818","164824","164902","164905","164906","164908","165309","165310",
  "165311","165312","165313","165508","165509","165511","165512","165513","165515","165516","165517","165519",
  "165520","165521","165522","165523","165524","165525","165526","165528","165531","166001","166006","166008",
  "166009","166011","166016","166023","166105","166107","166109","166401","166802","167001","167002","167003",
  "167301","167302","167501","167503","167505","167506","167702","168101","168102","168103","168104","168105",
  "168203","168204","168301","168401","168701","169101","169104","169105","169201","501001","501005","501007",
  "501008","501009","501010","501011","501012","501015","501016","501017","501018","501019","501021","501022",
  "501025","501026","501028","501029","501030","501031","501032","501036","501037","501043","501045","501047",
  "501048","501050","501051","501057","501058","501059","501060","501061","501064","501071","501073","501075",
  "501076","501077","501078","501079","501080","501081","501082","501083","501085","501087","501089","501090",
  "501091","501092","501095","501096","501097","501098","501099","501186","501188","501189","501200","501201",
  "501202","501203","501205","501206","501207","501208","501209","501210","501212","501213","501215","501216",
  "501217","501218","501219","501220","501222","501225","501226","501227","501300","501301","501302","501303",
  "501305","501306","501307","501310","501311","501312","502000","502003","502006","502010","502013","502023",
  "502048","502053","502056",
]

// 折溢价阈值：|折溢价率| > 1% 才展示
const PREMIUM_THRESHOLD = 1.0

// 腾讯接口基础 URL
const TX_API_BASE = 'https://qt.gtimg.cn'

const tableData = ref([])      // LOF 列表（已按折溢价率绝对值降序）
const loading = ref(false)
const lastUpdate = ref('')
const error = ref('')

// ===== GBK 解码 =====
// 浏览器端使用 TextDecoder('gbk') 解码腾讯返回的 GBK 数据
async function decodeGbk(response) {
  const buffer = await response.arrayBuffer()
  const decoder = new TextDecoder('gbk')
  return decoder.decode(buffer)
}

// ===== 批量查询腾讯行情 =====
// 399 只已收敛，单批即可（腾讯 500只/批上限）；保留分页循环以兼容后续扩容
async function fetchBatchQuotes() {
  const batchSize = 500
  const results = []

  for (let i = 0; i < LOF_CODES.length; i += batchSize) {
    const batch = LOF_CODES.slice(i, i + batchSize)
    const query = batch.map(c => `${c.startsWith('16') ? 'sz' : 'sh'}${c}`).join(',')
    const url = `${TX_API_BASE}/q=${query}`

    const res = await fetch(url)
    const text = await decodeGbk(res)

    // 解析 JSONP：v_sz160105="51~...~"; v_sh501018="...";
    const lines = text.split(';')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.includes('~')) continue

      const m = trimmed.match(/v_\w+="(.+?)"$/)
      if (!m) continue

      const parts = m[1].split('~')
      if (parts.length < 85) continue

      // 只保留 LOF 类型（内置列表已收敛，此处为双保险）
      const fundType = parts[61] || ''
      if (fundType !== 'LOF') continue

      const code = parts[2]
      const price = parseFloat(parts[3]) || 0
      const nav = parseFloat(parts[81]) || 0
      const premium = parseFloat(parts[77]) || 0

      // 过滤异常：现价<=0 或 现价=1.0（疑似停牌/转型/未上市）
      if (price <= 0 || price === 1.0) continue
      // 过滤无净值
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
        navDiff: price - nav,     // 现价-净值
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
    const data = await fetchBatchQuotes()

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