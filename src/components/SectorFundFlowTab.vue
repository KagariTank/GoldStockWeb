<template>
  <div class="flex flex-col h-full">
    <!-- Toolbar -->
    <div class="flex items-center gap-2 mb-4 flex-wrap">
      <!-- 板块类型 -->
      <div class="flex items-center gap-1">
        <span class="text-sm text-muted-foreground mr-1">板块</span>
        <Button
          v-for="opt in sectorTypeOptions"
          :key="opt.value"
          :variant="sectorType === opt.value ? 'default' : 'outline'"
          size="sm"
          @click="sectorType = opt.value; onSectorTypeChange()"
        >
          {{ opt.label }}
        </Button>
      </div>

      <div class="flex-1" />

      <!-- 更新时间 -->
      <span v-if="lastUpdate" class="text-xs text-muted-foreground">
        更新于 {{ lastUpdate }}
      </span>

      <Button :loading="loading" @click="fetchData">刷新数据</Button>
      <Button
        :variant="autoRefresh ? 'success' : 'outline'"
        @click="toggleAutoRefresh"
      >
        {{ autoRefresh ? `自动刷新 ${countdown}s` : '30s自动刷新' }}
      </Button>
      <Button
        :variant="alertEnabled ? 'default' : 'outline'"
        size="sm"
        @click="alertEnabled = !alertEnabled"
      >
        {{ alertEnabled ? '🔔 告警开' : '🔕 告警关' }}
      </Button>
      <Button variant="ghost" size="sm" @click="showRules = !showRules">
        📋 规则
      </Button>
    </div>

    <!-- 告警规则面板 -->
    <div v-if="showRules" class="border rounded-lg mb-4 p-4 bg-muted/30 text-sm space-y-2">
      <div class="font-medium mb-2">告警规则（自动刷新时检测，同类告警 5 分钟内不重复）</div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-muted-foreground">
        <div>📈 <span class="text-foreground font-medium">巨量流入</span>　主力净流入 &gt; 30亿</div>
        <div>📉 <span class="text-foreground font-medium">巨量流出</span>　主力净流出 &gt; 30亿</div>
        <div>⚠️ <span class="text-foreground font-medium">流向反转</span>　由 &gt;10亿流入转为 &gt;10亿流出（或反向）</div>
        <div>🔥 <span class="text-foreground font-medium">流入前三</span>　新晋主力净流入 Top 3</div>
        <div>❄️ <span class="text-foreground font-medium">流出前三</span>　新晋主力净流出 Top 3</div>
      </div>
    </div>

    <!-- 汇总信息 -->
    <div v-if="tableData.length > 0" class="flex gap-4 mb-3 text-sm">
      <span class="text-muted-foreground">
        共 {{ tableData.length }} 个板块
      </span>
      <span :class="getFlowClass(totalMainInflow)">
        主力净流入合计: {{ formatAmount(totalMainInflow) }}
      </span>
      <span class="text-red-500">
        流入板块: {{ inflowCount }}
      </span>
      <span class="text-green-500">
        流出板块: {{ outflowCount }}
      </span>
    </div>


    <div class="flex-1 overflow-auto">
        <!-- ECharts 柱状图：流入前5 + 流出前5 -->
      <div v-if="tableData.length > 0" class="border rounded-lg mb-4 p-2">
        <div class="px-2 mb-2">
          <span class="text-sm font-medium">主力净流入 — 流入前5 & 流出前5</span>
        </div>
        <div ref="chartRef" class="w-full" style="height: 320px"></div>
      </div>

      <!-- ECharts 蜡烛图：流入前5 + 流出前5 板块日内K线 -->
      <div v-if="sectorCandleData.length > 0" class="border rounded-lg mb-4 p-2">
        <div class="px-2 mb-2 flex items-center gap-2">
          <span class="text-sm font-medium">板块日内K线 — 流入前5 & 流出前5</span>
          <span class="text-xs text-muted-foreground">今日累计资金变化 · 每 30 秒刷新</span>
        </div>
        <div ref="candleChartRef" class="w-full" style="height: 340px"></div>
      </div>

      <!-- Table -->
      <div class="border rounded-lg overflow-auto flex-1">
        <Table :data="sortedData" :loading="loading">
          <TableHeader>
            <TableRow>
              <TableHead label="#" class="w-[50px]" />
              <TableHead class="min-w-[120px]">
                <SortableHeader label="板块名称" sort-key="name" :current="sortKey" :order="sortOrder" @sort="onSort" />
              </TableHead>
              <TableHead class="w-[100px]">
                <SortableHeader label="涨跌幅" sort-key="changePercent" :current="sortKey" :order="sortOrder" @sort="onSort" />
              </TableHead>
              <TableHead class="w-[120px]">
                <SortableHeader label="主力净流入" sort-key="mainNetInflow" :current="sortKey" :order="sortOrder" @sort="onSort" />
              </TableHead>
              <TableHead class="w-[100px]">
                <SortableHeader label="主力净占比" sort-key="mainNetInflowPercent" :current="sortKey" :order="sortOrder" @sort="onSort" />
              </TableHead>
              <TableHead class="w-[110px]">
                <SortableHeader label="超大单" sort-key="superLargeNetInflow" :current="sortKey" :order="sortOrder" @sort="onSort" />
              </TableHead>
              <TableHead class="w-[110px]">
                <SortableHeader label="大单" sort-key="largeNetInflow" :current="sortKey" :order="sortOrder" @sort="onSort" />
              </TableHead>
              <TableHead label="领涨股" class="min-w-[120px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="(row, index) in sortedData" :key="row.code">
              <TableCell>
                <span class="text-muted-foreground text-sm">{{ index + 1 }}</span>
              </TableCell>
              <TableCell>
                <span class="font-medium">{{ row.name }}</span>
              </TableCell>
              <TableCell>
                <span
                  class="font-mono font-semibold"
                  :class="getChangeClass(row.changePercent)"
                >
                  {{ formatPercent(row.changePercent) }}
                </span>
              </TableCell>
              <TableCell>
                <span class="font-mono font-semibold" :class="getFlowClass(row.mainNetInflow)">
                  {{ formatAmount(row.mainNetInflow) }}
                </span>
              </TableCell>
              <TableCell>
                <span class="font-mono" :class="getFlowClass(row.mainNetInflowPercent)">
                  {{ formatPercent(row.mainNetInflowPercent) }}
                </span>
              </TableCell>
              <TableCell>
                <span class="font-mono text-sm" :class="getFlowClass(row.superLargeNetInflow)">
                  {{ formatAmount(row.superLargeNetInflow) }}
                </span>
              </TableCell>
              <TableCell>
                <span class="font-mono text-sm" :class="getFlowClass(row.largeNetInflow)">
                  {{ formatAmount(row.largeNetInflow) }}
                </span>
              </TableCell>
              <TableCell>
                <span v-if="row.topStockName" class="text-sm">
                  {{ row.topStockName }}
                  <span class="text-xs text-muted-foreground ml-1">{{ row.topStockCode }}</span>
                </span>
                <span v-else>-</span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, h, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts'
import Button from '@/components/ui/Button.vue'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/Table'
import { useSectorFundFlow } from '@/composables/useSectorFundFlow.js'

const {
  sectorType,
  tableData,
  loading,
  lastUpdate,
  autoRefresh,
  countdown,
  alertEnabled,
  candleSectors,
  fetchData,
  toggleAutoRefresh,
  onSectorTypeChange,
  formatAmount,
  formatPercent,
  getFlowClass,
  getChangeClass
} = useSectorFundFlow()

const sectorTypeOptions = [
  { label: '行业', value: 'industry' },
  { label: '概念', value: 'concept' }
]

const showRules = ref(false)

// ===== 表格排序 =====
const sortKey = ref('mainNetInflow')
const sortOrder = ref('desc') // asc | desc

function onSort(key) {
  if (sortKey.value === key) {
    sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc'
  } else {
    sortKey.value = key
    sortOrder.value = 'desc'
  }
}

// 排序后的数据
const sortedData = computed(() => {
  const data = [...tableData.value]
  const key = sortKey.value
  const order = sortOrder.value === 'desc' ? -1 : 1
  return data.sort((a, b) => {
    let va = a[key]
    let vb = b[key]
    // name 是字符串
    if (typeof va === 'string') {
      return va.localeCompare(vb, 'zh') * order
    }
    va = parseFloat(va) || 0
    vb = parseFloat(vb) || 0
    return (va - vb) * order
  })
})

// 可排序表头组件
const SortableHeader = {
  props: {
    label: String,
    sortKey: String,
    current: String,
    order: String
  },
  emits: ['sort'],
  setup(props, { emit }) {
    return () => {
      const isActive = props.current === props.sortKey
      const arrow = isActive ? (props.order === 'desc' ? ' ↓' : ' ↑') : ''
      return h(
        'span',
        {
          class: ['cursor-pointer select-none hover:text-foreground transition-colors', isActive ? 'text-foreground font-semibold' : ''],
          onClick: () => emit('sort', props.sortKey)
        },
        props.label + arrow
      )
    }
  }
}

// 汇总计算
const totalMainInflow = computed(() => {
  return tableData.value.reduce((sum, row) => {
    const v = parseFloat(row.mainNetInflow)
    return sum + (isNaN(v) ? 0 : v)
  }, 0)
})

const inflowCount = computed(() => {
  return tableData.value.filter(row => row.mainNetInflow > 0).length
})

const outflowCount = computed(() => {
  return tableData.value.filter(row => row.mainNetInflow < 0).length
})

// ===== ECharts 柱状图 =====
const chartRef = ref(null)
let chart = null

const chartData = computed(() => {
  if (tableData.value.length === 0) return { names: [], values: [], colors: [] }
  const sorted = [...tableData.value].sort((a, b) => b.mainNetInflow - a.mainNetInflow)
  const top5In = sorted.slice(0, 5)
  const top5Out = sorted.slice(-5)
  const combined = [...top5In, ...top5Out]
  return {
    names: combined.map(r => r.name),
    values: combined.map(r => +(r.mainNetInflow / 1e8).toFixed(2)),
    isOutflow: combined.map(r => r.mainNetInflow < 0)
  }
})

function buildChartOption() {
  const { names, values, isOutflow } = chartData.value
  if (names.length === 0) return {}

  // 渐变色
  const inflowColor = new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: '#ff6b6b' },
    { offset: 1, color: '#ee5a52' }
  ])
  const outflowColor = new echarts.graphic.LinearGradient(0, 1, 0, 0, [
    { offset: 0, color: '#26de81' },
    { offset: 1, color: '#20bf6b' }
  ])

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: 'rgba(50, 50, 50, 0.9)',
      borderWidth: 0,
      textStyle: { color: '#fff', fontSize: 12 },
      padding: [8, 12],
      formatter: (params) => {
        const p = params[0]
        const sign = p.value >= 0 ? '+' : ''
        const color = p.value >= 0 ? '#ff6b6b' : '#26de81'
        return `<div style="font-weight:600;margin-bottom:4px">${p.name}</div>
                <div>主力净流入: <span style="font-weight:700;color:${color}">${sign}${p.value}亿</span></div>`
      }
    },
    grid: { left: 60, right: 25, top: 25, bottom: 50 },
    xAxis: {
      type: 'category',
      data: names,
      axisLabel: {
        fontSize: 13,
        fontWeight: 600,
        rotate: 30,
        interval: 0,
        color: '#444',
        formatter: (val) => val.length > 5 ? val.slice(0, 4) + '..' : val
      },
      axisLine: { lineStyle: { color: '#ccc' } },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      name: '亿元',
      nameTextStyle: { fontSize: 13, color: '#444' },
      axisLabel: { fontSize: 13, color: '#444' },
      splitLine: { lineStyle: { type: 'dashed', color: '#eee' } }
    },
    series: [{
      type: 'bar',
      data: values.map((v, i) => ({
        value: v,
        itemStyle: {
          color: isOutflow[i] ? outflowColor : inflowColor,
          borderRadius: isOutflow[i] ? [4, 4, 0, 0] : [0, 0, 4, 4]
        }
      })),
      barWidth: '55%',
      label: {
        show: true,
        position: 'top',
        fontSize: 13,
        fontWeight: 'bold',
        formatter: (p) => (p.value >= 0 ? `+${p.value}` : `${p.value}`),
        color: (p) => p.value >= 0 ? '#ee5a52' : '#20bf6b'
      },
      markLine: {
        silent: true,
        symbol: 'none',
        lineStyle: { color: '#ccc', type: 'solid', width: 1 },
        data: [{ yAxis: 0 }],
        label: { show: false }
      },
      animationDuration: 800,
      animationEasing: 'cubicOut'
    }]
  }
}

function updateChart() {
  if (!chart) return
  chart.setOption(buildChartOption(), { notMerge: true })
}

watch(chartData, () => {
  nextTick(() => {
    if (!chart && chartRef.value) {
      chart = echarts.init(chartRef.value)
      window.addEventListener('resize', handleResize)
    }
    updateChart()
  })
}, { deep: true })

// ===== ECharts 蜡烛图（板块日内K线） =====
const candleChartRef = ref(null)
let candleChart = null

// 选取流入前5 + 流出前5 板块（与柱状图排名一致）
const top10Sectors = computed(() => {
  if (tableData.value.length === 0) return []
  const sorted = [...tableData.value].sort((a, b) => b.mainNetInflow - a.mainNetInflow)
  const top5In = sorted.slice(0, 5)
  const top5Out = sorted.slice(-5)
  // 排序：流入前5（正）+ 流出前5（负），整体按 mainNetInflow 降序
  return [...top5In, ...top5Out]
})

// 为每个板块聚合日内 OHLC（直接从 candleSectors 读取）
const sectorCandleData = computed(() => {
  const sectors = top10Sectors.value
  if (sectors.length === 0) return []

  const result = []
  for (const sector of sectors) {
    const agg = candleSectors.value[sector.code]
    if (!agg) continue

    result.push({
      code: sector.code,
      name: sector.name,
      // ECharts candlestick: [open, close, low, high]，单位：亿元
      // open 恒为 0（日内资金从 0 开始累计）
      data: [
        0,
        +(agg.close / 1e8).toFixed(2),
        +(agg.low / 1e8).toFixed(2),
        +(agg.high / 1e8).toFixed(2)
      ],
      change: +(agg.close / 1e8).toFixed(2)
    })
  }

  return result
})

function buildCandleChartOption() {
  const candles = sectorCandleData.value
  if (candles.length === 0) return {}

  const names = candles.map(c => c.name.length > 6 ? c.name.slice(0, 5) + '..' : c.name)
  const values = candles.map(c => c.data)

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: 'rgba(50, 50, 50, 0.9)',
      borderWidth: 0,
      textStyle: { color: '#fff', fontSize: 12 },
      padding: [8, 12],
      formatter: (params) => {
        const p = params[0]
        if (!p) return ''
        const candle = candles[p.dataIndex]
        if (!candle) return ''
        const [open, close, low, high] = candle.data
        const change = candle.change
        const isUp = close >= open
        const color = isUp ? '#ff6b6b' : '#26de81'
        return `<div style="font-weight:600;margin-bottom:4px">${candle.name}</div>
                <div>开盘: <span style="font-weight:700">${open.toFixed(2)}亿</span></div>
                <div>收盘: <span style="font-weight:700;color:${color}">${close.toFixed(2)}亿</span></div>
                <div>最高: <span style="font-weight:700">${high.toFixed(2)}亿</span></div>
                <div>最低: <span style="font-weight:700">${low.toFixed(2)}亿</span></div>
                <div>变化: <span style="font-weight:700;color:${color}">${change >= 0 ? '+' : ''}${change.toFixed(2)}亿</span></div>`
      }
    },
    grid: { left: 60, right: 25, top: 25, bottom: 60 },
    xAxis: {
      type: 'category',
      data: names,
      axisLabel: {
        fontSize: 12,
        fontWeight: 60,
        color: '#444',
        interval: 0,
        rotate: 25
      },
      axisLine: { lineStyle: { color: '#ccc' } },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      name: '亿元',
      nameTextStyle: { fontSize: 12, color: '#666' },
      axisLabel: { fontSize: 11, color: '#666' },
      splitLine: { lineStyle: { type: 'dashed', color: '#eee' } }
    },
    series: [{
      type: 'candlestick',
      data: values,
      barWidth: '55%',
      itemStyle: {
        color: '#ff6b6b',
        color0: '#26de81',
        borderColor: '#ff6b6b',
        borderColor0: '#26de81',
        borderWidth: 1
      },
      label: {
        show: true,
        position: 'top',
        distance: 4,
        fontSize: 11,
        fontWeight: 600,
        color: '#333',
        formatter: (p) => {
          const close = p.data[1]
          return `${close >= 0 ? '+' : ''}${close.toFixed(1)}亿`
        }
      },
      markLine: {
        silent: true,
        symbol: 'none',
        lineStyle: { color: '#bbb', type: 'solid', width: 1 },
        data: [{ yAxis: 0 }],
        label: { show: false }
      },
      animationDuration: 500,
      animationEasing: 'cubicOut'
    }]
  }
}

function updateCandleChart() {
  if (!candleChart) return
  candleChart.setOption(buildCandleChartOption(), { notMerge: true })
}

watch(sectorCandleData, () => {
  nextTick(() => {
    if (!candleChart && candleChartRef.value) {
      candleChart = echarts.init(candleChartRef.value)
      window.addEventListener('resize', handleResize)
    }
    updateCandleChart()
  })
}, { deep: true })

onMounted(() => {
  if (chartRef.value) {
    chart = echarts.init(chartRef.value)
    window.addEventListener('resize', handleResize)
  }
  if (candleChartRef.value) {
    candleChart = echarts.init(candleChartRef.value)
    window.addEventListener('resize', handleResize)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  if (chart) {
    chart.dispose()
    chart = null
  }
  if (candleChart) {
    candleChart.dispose()
    candleChart = null
  }
})

function handleResize() {
  chart?.resize()
  candleChart?.resize()
}

// 首次加载数据
fetchData()
</script>
