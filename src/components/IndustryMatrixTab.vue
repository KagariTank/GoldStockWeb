<template>
  <div class="flex flex-col h-full">
    <!-- Toolbar -->
    <div class="flex items-center gap-2 mb-4 flex-wrap">
      <span class="text-sm font-medium">行业强度矩阵</span>
      <span class="text-xs text-muted-foreground">5日收益 × 20日收益 × 成交额 × 60日色彩</span>

      <div class="flex-1" />

      <span v-if="lastUpdate" class="text-xs text-muted-foreground">
        更新于 {{ lastUpdate }}
      </span>
      <Button :loading="loading" size="sm" @click="fetchMatrixData">刷新数据</Button>
      <Button
        size="sm"
        :variant="autoRefresh ? 'success' : 'outline'"
        @click="toggleAutoRefresh"
      >
        {{ autoRefresh ? `自动刷新 ${countdown}s` : '30s自动刷新' }}
      </Button>
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="border border-red-200 bg-red-50 text-red-600 rounded-lg p-3 mb-4 text-sm">
      ⚠️ {{ error }}
    </div>

    <!-- 市场宽度概览 -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <div v-for="card in breadthCards" :key="card.key" class="border rounded-lg p-3 bg-background">
        <div class="text-xs text-muted-foreground mb-1">{{ card.label }}</div>
        <div class="flex items-baseline gap-2">
          <span class="text-lg font-semibold up-text">{{ card.up }}</span>
          <span class="text-xs text-muted-foreground">/</span>
          <span class="text-lg font-semibold down-text">{{ card.down }}</span>
          <span class="text-xs text-muted-foreground ml-auto">涨跌比 {{ card.ratio }}</span>
        </div>
        <div class="text-[10px] text-muted-foreground mt-0.5">上涨 / 下跌</div>
      </div>
    </div>

    <!-- 气泡矩阵 -->
    <div class="border rounded-lg p-2 flex-1 min-h-0">
      <div class="px-2 mb-2 flex items-center gap-4 flex-wrap">
        <span class="text-sm font-medium">行业强度气泡矩阵</span>
        <!-- 图例 -->
        <span class="text-xs text-muted-foreground flex items-center gap-1">
          <span class="w-3 h-3 rounded-full inline-block bg-red-500"></span> 60日正收益
        </span>
        <span class="text-xs text-muted-foreground flex items-center gap-1">
          <span class="w-3 h-3 rounded-full inline-block bg-green-500"></span> 60日负收益
        </span>
        <span class="text-xs text-muted-foreground flex items-center gap-1">
          <span class="w-3 h-3 rounded-full inline-block border border-muted-foreground/50 bg-muted"></span>
          气泡大小 = 今日成交额
        </span>
        <span class="text-xs text-muted-foreground">稀疏象限全标 + 右上成交额前12</span>
      </div>

      <!-- 图表容器（有数据才渲染，避免空坐标轴占位） -->
      <div v-if="matrixData.length === 0" class="flex items-center justify-center text-muted-foreground text-sm" style="height: 420px">
        {{ loading ? '加载中...' : '等待数据...' }}
      </div>
      <div v-else ref="chartRef" class="w-full" style="height: 420px"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, watchEffect } from 'vue'
import Button from '@/components/ui/Button.vue'
import { init, getInstanceByDom } from '@/lib/echarts.js'
import { useIndustryMatrix } from '@/composables/useIndustryMatrix.js'
import { useTheme } from '@/composables/useTheme.js'

const {
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
} = useIndustryMatrix()

const { isDark } = useTheme()

const chartRef = ref(null)
let chart = null
let _resizeBound = false

// 市场宽度卡片
const breadthCards = computed(() => [
  { key: 'today', label: '当日涨跌', up: breadth.value.today.up, down: breadth.value.today.down, ratio: breadth.value.today.ratio },
  { key: 'day5', label: '5日涨跌', up: breadth.value.day5.up, down: breadth.value.day5.down, ratio: breadth.value.day5.ratio },
  { key: 'day20', label: '20日涨跌', up: breadth.value.day20.up, down: breadth.value.day20.down, ratio: breadth.value.day20.ratio },
  { key: 'day60', label: '60日涨跌', up: breadth.value.day60.up, down: breadth.value.day60.down, ratio: breadth.value.day60.ratio }
])

// 格式化金额（元 -> 亿）
function formatYi(val) {
  if (val === null || val === undefined || isNaN(val)) return '-'
  return (val / 1e8).toFixed(0) + '亿'
}

// 构建气泡图 option
function buildOption() {
  const points = getMatrixPoints()
  const isDarkMode = isDark.value
  const textColor = isDarkMode ? '#a3a3a3' : '#6b7280'
  const axisLineColor = isDarkMode ? '#404040' : '#d1d5db'
  const splitColor = isDarkMode ? '#262626' : '#f3f4f6'

  // 气泡大小映射：成交额 300亿 ~ 2万亿 → 8 ~ 60
  const amounts = points.map(p => p.value[2]).filter(a => a > 0)
  const minAmt = amounts.length ? Math.min(...amounts) : 0
  const maxAmt = amounts.length ? Math.max(...amounts) : 1
  const sizeRange = [6, 34]
  const sizeOf = (amt) => {
    if (amt <= 0) return 8
    if (maxAmt === minAmt) return (sizeRange[0] + sizeRange[1]) / 2
    const t = (amt - minAmt) / (maxAmt - minAmt)
    return sizeRange[0] + t * (sizeRange[1] - sizeRange[0])
  }

  // 象限分割：0 为中线（5日/20日涨幅 0%）
  const xZero = 0
  const yZero = 0

  // 标注策略：稀疏象限全标注 + 密集象限 TopN + 成交额兜底
  // 象限分布实测：右上 55 个（极密集）、左上 9 个、左下 9 个、右下 1 个
  // 左上/左下/右下空间充裕 → 全部标注；右上按成交额取 TopN 作为候选，交给 hideOverlap 自动避让
  const labelTop = new Set()
  // 右上：成交额前 12 名（55 个板块最密集，控制候选数量避免重叠）
  points
    .filter(p => p.value[0] >= 0 && p.value[1] >= 0)
    .sort((a, b) => b.value[2] - a.value[2])
    .slice(0, 12)
    .forEach(p => labelTop.add(p.name))
  // 左上（5日<0 20日>0）：仅 9 个，全部标注
  points.filter(p => p.value[0] < 0 && p.value[1] >= 0).forEach(p => labelTop.add(p.name))
  // 左下（5日<0 20日<0）：仅 9 个，全部标注
  points.filter(p => p.value[0] < 0 && p.value[1] < 0).forEach(p => labelTop.add(p.name))
  // 右下（5日>0 20日<0）：仅 1 个，全部标注
  points.filter(p => p.value[0] >= 0 && p.value[1] < 0).forEach(p => labelTop.add(p.name))
  // 成交额前 8 名兜底（大板块必须显示，无论象限）
  points
    .slice()
    .sort((a, b) => b.value[2] - a.value[2])
    .slice(0, 8)
    .forEach(p => labelTop.add(p.name))

  // 象限标签：计算坐标轴边界（与 axis min/max 逻辑一致）
  const allX = points.map(p => p.value[0])
  const allY = points.map(p => p.value[1])
  const xBound = (allX.length ? Math.max(Math.abs(Math.min(...allX)), Math.abs(Math.max(...allX))) : 1) * 1.1
  const yBound = (allY.length ? Math.max(Math.abs(Math.min(...allY)), Math.abs(Math.max(...allY))) : 1) * 1.1
  const quadPos = (sx, sy) => [sx * xBound * 0.72, sy * yBound * 0.72]
  const quadColor = isDarkMode ? '#525252' : '#c0c4cc'

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
      borderColor: isDarkMode ? '#374151' : '#e5e7eb',
      textStyle: { color: isDarkMode ? '#e5e7eb' : '#111827', fontSize: 12 },
      formatter: (p) => {
        const d = p.data
        if (!d) return ''
        return [
          `<div style="font-weight:600;margin-bottom:4px">${d.name}</div>`,
          `5日收益：<span style="color:${d.value[0] >= 0 ? '#f56c6c' : '#67c23a'}">${d.value[0].toFixed(2)}%</span>`,
          `20日收益：<span style="color:${d.value[1] >= 0 ? '#f56c6c' : '#67c23a'}">${d.value[1].toFixed(2)}%</span>`,
          `60日收益：<span style="color:${d.chg60 >= 0 ? '#f56c6c' : '#67c23a'}">${d.chg60.toFixed(2)}%</span>`,
          `今日成交额：${formatYi(d.amount)}`,
          `主力净流入：${formatYi(d.mainInflow)}`
        ].join('<br/>')
      }
    },
    grid: {
      left: 60,
      right: 20,
      top: 40,
      bottom: 50
    },
    xAxis: {
      type: 'value',
      name: '5日收益 (%)',
      nameLocation: 'middle',
      nameGap: 30,
      nameTextStyle: { color: textColor, fontSize: 11 },
      axisLine: { lineStyle: { color: axisLineColor } },
      axisLabel: { color: textColor, formatter: (v) => v.toFixed(1) + '%' },
      splitLine: { lineStyle: { color: splitColor, type: 'dashed' } },
      min: (v) => { const m = Math.max(Math.abs(v.min), Math.abs(v.max)); return -(Math.round(m * 1.1 * 10) / 10) },
      max: (v) => { const m = Math.max(Math.abs(v.min), Math.abs(v.max)); return Math.round(m * 1.1 * 10) / 10 }
    },
    yAxis: {
      type: 'value',
      name: '20日相对强度 (%)',
      nameLocation: 'middle',
      nameGap: 40,
      nameTextStyle: { color: textColor, fontSize: 11 },
      axisLine: { lineStyle: { color: axisLineColor } },
      axisLabel: { color: textColor, formatter: (v) => v.toFixed(1) + '%' },
      splitLine: { lineStyle: { color: splitColor, type: 'dashed' } },
      min: (data) => {
        const m = Math.max(Math.abs(data.min), Math.abs(data.max)); return -(Math.round(m * 1.1 * 10) / 10)
      },
      max: (data) => { const m = Math.max(Math.abs(data.min), Math.abs(data.max)); return Math.round(m * 1.1 * 10) / 10 }
    },
    series: [
      {
        type: 'scatter',
        data: points.map(p => ({
          name: p.name,
          value: [p.value[0], p.value[1]],
          amount: p.value[2],
          chg60: p.chg60,
          mainInflow: p.mainInflow,
          symbolSize: sizeOf(p.value[2]),
          itemStyle: {
            color: p.chg60 >= 0 ? 'rgba(245, 108, 108, 0.5)' : 'rgba(103, 194, 58, 0.5)',
            borderColor: p.chg60 >= 0 ? '#f56c6c' : '#67c23a',
            borderWidth: 1.5
          },
          label: {
            show: labelTop.has(p.name),
            formatter: p.name,
            fontSize: 10,
            color: p.chg60 >= 0 ? '#f56c6c' : '#67c23a',
            // 右下象限（5日>0 20日<0，通常只有半导体）标签放右侧，避免被右上密集区遮挡
            position: (p.value[0] >= 0 && p.value[1] < 0) ? 'right' : 'top'
          }
        })),
        // 标签避让：先沿 Y 轴移动避免重叠，仍重叠的再隐藏（比纯 hideOverlap 多保留标签）
        labelLayout: {
          hideOverlap: true,
          moveOverlap: 'shiftY'
        },
        emphasis: {
          focus: 'self',
          scale: true,
          scaleSize: 1.5,
          label: { show: true, fontSize: 13, fontWeight: 700 },
          itemStyle: {
            borderWidth: 2,
            borderColor: '#f59e0b',
            shadowBlur: 8,
            shadowColor: 'rgba(0, 0, 0, 0.35)'
          }
        },
        blur: {
          itemStyle: { opacity: 0.12 }
        }
      },
      // 四象限分割参考线 + 象限标签
      {
        type: 'scatter',
        data: [],
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: '#9ca3af', type: 'dashed', width: 1 },
          label: { show: false },
          data: [
            { xAxis: 0 },
            { yAxis: 0 }
          ]
        },
        markPoint: {
          silent: true,
          symbol: 'rect',
          symbolSize: 0,
          data: [
            { coord: quadPos(1, 1), label: { show: true, formatter: '主升浪\n短中期共振↑', color: quadColor, fontSize: 10, fontWeight: 500 } },
            { coord: quadPos(-1, 1), label: { show: true, formatter: '回调中\n中期↑ 短期↓\n可能买点', color: quadColor, fontSize: 10, fontWeight: 500 } },
            { coord: quadPos(1, -1), label: { show: true, formatter: '反弹中\n中期↓ 短期↑\n警惕假反弹', color: quadColor, fontSize: 10, fontWeight: 500 } },
            { coord: quadPos(-1, -1), label: { show: true, formatter: '主跌浪\n短中期共振↓', color: quadColor, fontSize: 10, fontWeight: 500 } }
          ]
        }
      }
    ]
  }
}

// 渲染图表
function renderChart() {
  const el = chartRef.value
  if (!el) return
  const existing = getInstanceByDom(el)
  if (existing) {
    chart = existing
    chart.setOption(buildOption())
  } else {
    chart = init(el)
    chart.setOption(buildOption())
  }
}

// 主题变化重绘
watch(isDark, () => renderChart())

// 数据变化渲染（flush: post 确保 v-else 容器已渲染后再初始化图表，避免竞态）
watchEffect(() => {
  // 依赖 loading 与 matrixData，确保数据到达且容器渲染后再画
  void loading.value
  void matrixData.value.length
  if (!loading.value && chartRef.value) {
    renderChart()
  }
}, { flush: 'post' })

function onResize() {
  if (chart) chart.resize()
}

onMounted(() => {
  if (!_resizeBound) {
    _resizeBound = true
    window.addEventListener('resize', onResize)
  }
  if (matrixData.value.length === 0) fetchMatrixData()
})

onBeforeUnmount(() => {
  if (_resizeBound) {
    _resizeBound = false
    window.removeEventListener('resize', onResize)
  }
  if (chart) {
    chart.dispose()
    chart = null
  }
})
</script>