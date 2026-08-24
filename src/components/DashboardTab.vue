<template>
  <div class="flex flex-col h-full">
    <!-- Toolbar -->
    <div class="flex items-center gap-2 mb-3 flex-wrap flex-shrink-0">
      <Button :loading="volLoading" @click="volFetchData">刷新量能</Button>
      <Button :loading="fundLoading" @click="refreshFundBoth">刷新资金</Button>
      <Button
        :variant="volAutoRefresh ? 'success' : 'outline'"
        @click="volToggleAutoRefresh"
      >
        {{ volAutoRefresh ? `量能 ${volCountdown}s` : '量能自动' }}
      </Button>
      <Button
        :variant="fundAutoRefresh ? 'success' : 'outline'"
        @click="fundToggleAutoRefresh"
      >
        {{ fundAutoRefresh ? `资金 ${fundCountdown}s` : '资金自动' }}
      </Button>

      <div class="flex-1" />

      <span v-if="volLastUpdate" class="text-xs text-muted-foreground">
        量能 {{ volLastUpdate }}
      </span>
      <span v-if="fundLastUpdate" class="text-xs text-muted-foreground ml-2">
        资金 {{ fundLastUpdate }}
      </span>
    </div>

    <!-- 双栏布局 -->
    <div class="flex-1 overflow-auto">
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 h-full">

        <!-- ========== 左栏：量能概览 ========== -->
        <div class="flex flex-col gap-3 min-w-0">
          <!-- 指标卡片 -->
          <div v-if="volHeader" class="grid grid-cols-2 md:grid-cols-4 gap-2 flex-shrink-0">
            <div class="border rounded-lg p-2.5">
              <div class="text-xs text-muted-foreground mb-0.5">当日成交额</div>
              <div class="text-base font-bold">{{ volFormatVolume(volTodayTotal) }}</div>
            </div>
            <div class="border rounded-lg p-2.5">
              <div class="text-xs text-muted-foreground mb-0.5">昨日成交额</div>
              <div class="text-base font-bold text-muted-foreground">{{ volFormatVolume(volYesterdayTotal) }}</div>
            </div>
            <div class="border rounded-lg p-2.5">
              <div class="text-xs text-muted-foreground mb-0.5">今日为昨日同期</div>
              <div class="text-base font-bold" :class="volVsYesterday >= 100 ? 'text-red-500' : 'text-green-500'">
                {{ volVsYesterday.toFixed(1) }}%
              </div>
            </div>
            <div class="border rounded-lg p-2.5">
              <div class="text-xs text-muted-foreground mb-0.5">预测全天</div>
              <div class="text-base font-bold text-blue-500">{{ volFormatVolume(volPredictTotal) }}</div>
            </div>
          </div>

          <!-- 趋势状态 -->
          <div v-if="volTrendLabel" class="flex items-center gap-2 text-sm flex-shrink-0">
            <span class="text-muted-foreground">趋势：</span>
            <span :class="volTrendColor" class="font-semibold">
              {{ volTrendIcon }} {{ volTrendLabel }}
            </span>
            <span class="text-muted-foreground ml-2">变动：</span>
            <span :class="volCumulativeDiffColor" class="font-semibold">
              {{ volCumulativeDiffText }}
            </span>
          </div>

          <!-- 成交额变动图 -->
          <div v-if="volMinuteData.length > 0" class="border rounded-lg p-2 flex-1 min-h-0 flex flex-col">
            <div class="px-1 mb-1 flex items-center justify-between flex-shrink-0">
              <span class="text-sm font-medium">成交额变动 & 上证分时</span>
              <span class="text-xs text-muted-foreground">加权/未加权线</span>
            </div>
            <div ref="diffChartRef" class="w-full flex-1 min-h-0" style="min-height: 200px"></div>
          </div>
        </div>

        <!-- ========== 右栏：板块资金流向概览 ========== -->
        <div class="flex flex-col gap-3 min-w-0">
          <!-- 板块蜡烛图：行业 + 概念 双图（上下排列），各自带汇总 -->
          <div class="flex flex-col gap-3 flex-1 min-h-0">
            <!-- 行业 -->
            <div class="border rounded-lg p-2 flex flex-col flex-1 min-h-0">
              <div class="px-1 mb-1 flex items-center justify-between flex-shrink-0">
                <span class="text-sm font-medium">行业板块日内K线 — 流入前5 & 流出前5</span>
                <span v-if="fundIndustrySummary.count > 0" class="text-xs text-muted-foreground flex gap-2">
                  <span>共{{ fundIndustrySummary.count }}个</span>
                  <span :class="fundGetFlowClass(fundIndustrySummary.totalInflow)">{{ fundFormatAmount(fundIndustrySummary.totalInflow) }}</span>
                  <span class="text-red-500">流{{ fundIndustrySummary.inflowCount }}</span>
                  <span class="text-green-500">出{{ fundIndustrySummary.outflowCount }}</span>
                </span>
              </div>
              <div v-if="fundSectorCandleIndustry.length === 0 && !fundLoading" class="flex items-center justify-center text-muted-foreground text-sm" style="min-height: 180px">
                等待行业数据...
              </div>
              <div v-else ref="candleIndustryChartRef" class="w-full flex-1 min-h-0" style="min-height: 180px"></div>
            </div>

            <!-- 概念 -->
            <div class="border rounded-lg p-2 flex flex-col flex-1 min-h-0">
              <div class="px-1 mb-1 flex items-center justify-between flex-shrink-0">
                <span class="text-sm font-medium">概念板块日内K线 — 流入前5 & 流出前5</span>
                <span v-if="fundConceptSummary.count > 0" class="text-xs text-muted-foreground flex gap-2">
                  <span>共{{ fundConceptSummary.count }}个</span>
                  <span :class="fundGetFlowClass(fundConceptSummary.totalInflow)">{{ fundFormatAmount(fundConceptSummary.totalInflow) }}</span>
                  <span class="text-red-500">流{{ fundConceptSummary.inflowCount }}</span>
                  <span class="text-green-500">出{{ fundConceptSummary.outflowCount }}</span>
                </span>
              </div>
              <div v-if="fundSectorCandleConcept.length === 0 && !fundLoading" class="flex items-center justify-center text-muted-foreground text-sm" style="min-height: 180px">
                等待概念数据...
              </div>
              <div v-else ref="candleConceptChartRef" class="w-full flex-1 min-h-0" style="min-height: 180px"></div>
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts'
import Button from '@/components/ui/Button.vue'
import { useVolumeMonitor } from '@/composables/useVolumeMonitor.js'
import { useSectorFundFlow } from '@/composables/useSectorFundFlow.js'

// ===== 量能监控数据（单例 composable，与 VolumeMonitorTab 共享） =====
const {
  loading: volLoading,
  lastUpdate: volLastUpdate,
  header: volHeader,
  minuteData: volMinuteData,
  indexData: volIndexData,
  trendLabel: volTrendLabel,
  trendColor: volTrendColor,
  trendIcon: volTrendIcon,
  cumulativeDiffText: volCumulativeDiffText,
  cumulativeDiffColor: volCumulativeDiffColor,
  autoRefresh: volAutoRefresh,
  countdown: volCountdown,
  todayTotal: volTodayTotal,
  yesterdayTotal: volYesterdayTotal,
  predictTotal: volPredictTotal,
  vsYesterdaySamePeriod: volVsYesterday,
  fetchData: volFetchData,
  toggleAutoRefresh: volToggleAutoRefresh,
  formatVolume: volFormatVolume
} = useVolumeMonitor()

// ===== 板块资金流向数据（单例 composable，与 SectorFundFlowTab 共享） =====
const {
  loading: fundLoading,
  lastUpdate: fundLastUpdate,
  autoRefresh: fundAutoRefresh,
  countdown: fundCountdown,
  candleSectorsByType: fundCandleSectorsByType,
  fetchDataByType: fundFetchDataByType,
  toggleAutoRefresh: fundToggleAutoRefresh,
  formatAmount: fundFormatAmount,
  formatPercent: fundFormatPercent,
  getFlowClass: fundGetFlowClass,
  getChangeClass: fundGetChangeClass
} = useSectorFundFlow()

// ===== 资金：各类型汇总（从 candleSectorsByType 直接计算） =====
function buildSummary(type) {
  const sectors = type === 'concept' ? fundCandleSectorsByType.concept.value : fundCandleSectorsByType.industry.value
  const entries = Object.values(sectors)
  if (entries.length === 0) return { count: 0, totalInflow: 0, inflowCount: 0, outflowCount: 0 }
  let totalInflow = 0, inflowCount = 0, outflowCount = 0
  for (const s of entries) {
    const v = s.close || 0
    totalInflow += v
    if (v > 0) inflowCount++
    else if (v < 0) outflowCount++
  }
  return { count: entries.length, totalInflow, inflowCount, outflowCount }
}

const fundIndustrySummary = computed(() => buildSummary('industry'))
const fundConceptSummary = computed(() => buildSummary('concept'))

// ===== 资金：板块蜡烛图数据（按类型分别构建，行业 + 概念互不影响） =====
// 从该类型的 K 线聚合数据中取流入前5 + 流出前5
function buildFundSectorCandleData(type) {
  const sectors = type === 'concept' ? fundCandleSectorsByType.concept.value : fundCandleSectorsByType.industry.value
  const entries = Object.entries(sectors)
  if (entries.length === 0) return []
  const sorted = entries
    .map(([code, agg]) => ({ code, ...agg }))
    .sort((a, b) => b.close - a.close)
  const top = [...sorted.slice(0, 5), ...sorted.slice(-5)]
  const result = []
  for (const sector of top) {
    const closeYi = sector.close / 1e8
    const lowYi = sector.low / 1e8
    const highYi = sector.high / 1e8
    const isUp = closeYi >= 0
    result.push({
      code: sector.code,
      name: sector.name,
      data: [
        0,
        closeYi,
        isUp ? Math.min(lowYi, 0) : Math.min(lowYi, closeYi),
        isUp ? Math.max(highYi, closeYi) : Math.max(highYi, 0)
      ],
      change: closeYi
    })
  }
  return result
}

const fundSectorCandleIndustry = computed(() => buildFundSectorCandleData('industry'))
const fundSectorCandleConcept = computed(() => buildFundSectorCandleData('concept'))

// ===== ECharts: 成交额变动图 =====
const diffChartRef = ref(null)
let diffChart = null

const diffChartOption = computed(() => {
  const data = volMinuteData.value
  if (data.length === 0) return null

  const times = data.map(d => d.time)
  const diffs = data.map(d => {
    if (d.turnoverChange === null || d.turnoverChange === undefined) return null
    return +(d.turnoverChange / 1e8).toFixed(2)
  })

  const idxData = volIndexData.value
  const idxClose = idxData.map(d => d.close)
  const idxAverage = idxData.map(d => d.average)

  const idxValues = idxData
    .filter(d => d.close != null && d.average != null)
    .flatMap(d => [d.close, d.average])
  let idxMin = 0, idxMax = 5000
  if (idxValues.length > 0) {
    const rawMin = Math.min(...idxValues)
    const rawMax = Math.max(...idxValues)
    const range = rawMax - rawMin || rawMax * 0.01 || 10
    const pad = range * 0.15
    idxMin = Math.floor(rawMin - pad)
    idxMax = Math.ceil(rawMax + pad)
  }

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: 'rgba(50, 50, 50, 0.9)',
      borderWidth: 0,
      textStyle: { color: '#fff', fontSize: 12 },
      padding: [8, 12],
      formatter: (params) => {
        let html = `<div style="font-weight:600;margin-bottom:4px">${params[0].axisValue}</div>`
        for (const p of params) {
          const val = p.value
          if (val === null || val === undefined || val === '-' || isNaN(val)) {
            html += `<div>${p.marker} ${p.seriesName}: <span style="color:#999">无数据</span></div>`
          } else if (p.seriesName === '加权线' || p.seriesName === '未加权线') {
            html += `<div>${p.marker} ${p.seriesName}: <span style="font-weight:700;color:${p.color}">${val.toFixed(2)}</span></div>`
          } else {
            const sign = val >= 0 ? '+' : ''
            const color = val >= 0 ? '#ff6b6b' : '#26de81'
            html += `<div>${p.marker} ${p.seriesName}: <span style="font-weight:700;color:${color}">${sign}${val}亿</span></div>`
          }
        }
        return html
      }
    },
    legend: {
      data: ['成交额变动', '加权线', '未加权线'],
      top: 3,
      textStyle: { fontSize: 11, color: '#666' },
      itemWidth: 12,
      itemHeight: 8
    },
    grid: { left: 50, right: 50, top: 30, bottom: 25 },
    xAxis: {
      type: 'category',
      data: times,
      axisLabel: {
        fontSize: 10,
        color: '#888',
        interval: 0,
        formatter: (value, index) => {
          const timeStr = data[index]?.time || value
          const keyTimes = ['09:30', '10:00', '10:30', '11:00', '11:30', '13:30', '14:00', '14:30', '15:00']
          return keyTimes.includes(timeStr) ? timeStr : ''
        }
      },
      axisLine: { lineStyle: { color: '#ccc' } },
      axisTick: { show: false }
    },
    yAxis: [
      {
        type: 'value',
        name: '亿元',
        nameTextStyle: { fontSize: 11, color: '#444' },
        axisLabel: { fontSize: 11, color: '#444' },
        splitLine: { lineStyle: { type: 'dashed', color: '#eee' } }
      },
      {
        type: 'value',
        name: '指数',
        min: idxMin,
        max: idxMax,
        nameTextStyle: { fontSize: 11, color: '#1890ff' },
        axisLabel: { fontSize: 11, color: '#1890ff' },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: '成交额变动',
        type: 'bar',
        data: diffs.map(v => ({
          value: v,
          itemStyle: {
            color: v >= 0
              ? new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                  { offset: 0, color: '#ff6b6b' },
                  { offset: 1, color: '#ee5a52' }
                ])
              : new echarts.graphic.LinearGradient(0, 1, 0, 0, [
                  { offset: 0, color: '#26de81' },
                  { offset: 1, color: '#20bf6b' }
                ]),
            borderRadius: v >= 0 ? [0, 0, 2, 2] : [2, 2, 0, 0]
          }
        })),
        barWidth: '50%',
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: '#ccc', type: 'solid', width: 1 },
          data: [{ yAxis: 0 }],
          label: { show: false }
        }
      },
      {
        name: '加权线',
        type: 'line',
        data: idxClose,
        yAxisIndex: 1,
        smooth: true,
        symbol: 'none',
        showSymbol: false,
        connectNulls: true,
        lineStyle: { width: 1.5, color: '#1890ff' },
        itemStyle: { color: '#1890ff' }
      },
      {
        name: '未加权线',
        type: 'line',
        data: idxAverage,
        yAxisIndex: 1,
        smooth: true,
        symbol: 'none',
        showSymbol: false,
        connectNulls: true,
        lineStyle: { width: 1.5, color: '#faad14' },
        itemStyle: { color: '#faad14' }
      }
    ]
  }
})

function updateDiffChart() {
  if (!diffChart) return
  const opt = diffChartOption.value
  if (opt) diffChart.setOption(opt, { notMerge: true })
}

// ===== ECharts: 板块蜡烛图（行业 + 概念 双图） =====
const candleIndustryChartRef = ref(null)
const candleConceptChartRef = ref(null)
let candleIndustryChart = null
let candleConceptChart = null

function buildCandleChartOption(candles) {
  if (!candles || candles.length === 0) return {}

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
        const isUp = close >= open
        const color = isUp ? '#ff6b6b' : '#26de81'
        return `<div style="font-weight:600;margin-bottom:4px">${candle.name}</div>
                <div>收盘: <span style="font-weight:700;color:${color}">${close.toFixed(2)}亿</span></div>
                <div>最高: <span style="font-weight:700">${high.toFixed(2)}亿</span></div>
                <div>最低: <span style="font-weight:700">${low.toFixed(2)}亿</span></div>`
      }
    },
    grid: { left: 50, right: 20, top: 30, bottom: 50 },
    xAxis: {
      type: 'category',
      data: names,
      axisLabel: {
        fontSize: 11,
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
      nameTextStyle: { fontSize: 11, color: '#666' },
      axisLabel: { fontSize: 10, color: '#666' },
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
      markLine: {
        silent: true,
        symbol: 'none',
        lineStyle: { color: '#bbb', type: 'solid', width: 1 },
        data: [{ yAxis: 0 }],
        label: { show: false }
      },
      markPoint: {
        symbol: 'circle',
        symbolSize: 3,
        data: candles.map((c, i) => {
          const close = c.data[1]
          const isUp = close >= 0
          return {
            coord: [i, close],
            value: close,
            itemStyle: { color: isUp ? '#ee5a52' : '#20bf6b' },
            label: {
              show: true,
              position: isUp ? 'top' : 'bottom',
              distance: 8,
              fontSize: 10,
              fontWeight: 'bold',
              color: isUp ? '#ee5a52' : '#20bf6b',
              formatter: `${close >= 0 ? '+' : ''}${close.toFixed(2)}亿`
            }
          }
        }),
        z: 10
      }
    }]
  }
}

function updateCandleChart(chart, candles) {
  if (!chart) return
  chart.setOption(buildCandleChartOption(candles), { notMerge: true })
}

function updateCandleIndustryChart() {
  updateCandleChart(candleIndustryChart, fundSectorCandleIndustry.value)
}

function updateCandleConceptChart() {
  updateCandleChart(candleConceptChart, fundSectorCandleConcept.value)
}

// ===== Watchers =====
watch(diffChartOption, () => {
  nextTick(() => {
    if (!diffChart && diffChartRef.value) {
      diffChart = echarts.init(diffChartRef.value)
      window.addEventListener('resize', handleResize)
    }
    updateDiffChart()
  })
}, { deep: true })

watch(fundSectorCandleIndustry, () => {
  nextTick(() => {
    if (!candleIndustryChart && candleIndustryChartRef.value) {
      candleIndustryChart = echarts.init(candleIndustryChartRef.value)
      window.addEventListener('resize', handleResize)
    }
    updateCandleIndustryChart()
  })
}, { deep: true })

watch(fundSectorCandleConcept, () => {
  nextTick(() => {
    if (!candleConceptChart && candleConceptChartRef.value) {
      candleConceptChart = echarts.init(candleConceptChartRef.value)
      window.addEventListener('resize', handleResize)
    }
    updateCandleConceptChart()
  })
}, { deep: true })

// ===== Lifecycle =====
onMounted(() => {
  // 如果已有数据（从 composable 单例），立即初始化图表
  nextTick(() => {
    if (diffChartRef.value && volMinuteData.value.length > 0) {
      diffChart = echarts.init(diffChartRef.value)
      updateDiffChart()
    }
    if (candleIndustryChartRef.value && fundSectorCandleIndustry.value.length > 0) {
      candleIndustryChart = echarts.init(candleIndustryChartRef.value)
      updateCandleIndustryChart()
    }
    if (candleConceptChartRef.value && fundSectorCandleConcept.value.length > 0) {
      candleConceptChart = echarts.init(candleConceptChartRef.value)
      updateCandleConceptChart()
    }
  })
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  if (diffChart) {
    diffChart.dispose()
    diffChart = null
  }
  if (candleIndustryChart) {
    candleIndustryChart.dispose()
    candleIndustryChart = null
  }
  if (candleConceptChart) {
    candleConceptChart.dispose()
    candleConceptChart = null
  }
})

function handleResize() {
  diffChart?.resize()
  candleIndustryChart?.resize()
  candleConceptChart?.resize()
}

// 首次加载数据（composable 单例已有数据时不会重复请求）
volFetchData()
// 同时拉取行业与概念两类数据，供双 K 线图使用
// 注意：composable 的 loading 互斥，必须串行 await，否则第二个请求会被跳过
async function initFundData() {
  await fundFetchDataByType('industry')
  await fundFetchDataByType('concept')
}
initFundData()

// 手动刷新资金：同时拉取行业 + 概念（串行避免 loading 互斥）
async function refreshFundBoth() {
  await fundFetchDataByType('industry')
  await fundFetchDataByType('concept')
}
</script>
