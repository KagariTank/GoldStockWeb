<template>
  <div class="flex flex-col h-full">
    <!-- Toolbar -->
    <div class="flex items-center gap-2 mb-4 flex-wrap flex-shrink-0">
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

      <div class="flex-1" />

      <span v-if="lastUpdate" class="text-xs text-muted-foreground">
        更新于 {{ lastUpdate }}
      </span>
    </div>

    <div class="flex-1 overflow-auto">
        <!-- 告警规则面板 -->
      <div v-if="showRules" class="border rounded-lg mb-4 p-4 bg-muted/30 text-sm space-y-2">
        <div class="font-medium mb-2">量能监控告警规则（自动刷新时检测，同类告警 3 分钟内不重复）</div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-muted-foreground">
          <div>📉 <span class="text-foreground font-medium">缩量趋势</span>　近5分钟均量较昨日同期 &lt; 70%</div>
          <div>📈 <span class="text-foreground font-medium">放量趋势</span>　近5分钟均量较昨日同期 &gt; 130%</div>
          <div>⚠️ <span class="text-foreground font-medium">持续缩量</span>　较昨日同期 &lt; 50%</div>
          <div>🔥 <span class="text-foreground font-medium">持续放量</span>　较昨日同期 &gt; 200%</div>
        </div>
        <div class="font-medium mt-3 mb-2">累计差额告警（红=放量，绿=缩量）</div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-muted-foreground">
          <div>📈 <span class="text-foreground font-medium">绿转红</span>　累计差额由负转正（缩量转放量）</div>
          <div>📉 <span class="text-foreground font-medium">红转绿</span>　累计差额由正转负（放量转缩量）</div>
          <div>🚀 <span class="text-foreground font-medium">放量加速</span>　累计放量差额增长超20%</div>
          <div>⚠️ <span class="text-foreground font-medium">缩量加速</span>　累计缩量差额扩大超20%</div>
          <div>📉 <span class="text-foreground font-medium">放量减弱</span>　红色柱子持续降低（资金流入放缓）</div>
          <div>📈 <span class="text-foreground font-medium">缩量减弱</span>　绿色柱子持续收窄（资金流出放缓）</div>
          <div>🔥 <span class="text-foreground font-medium">极端放量</span>　累计放量差额超3亿</div>
          <div>💧 <span class="text-foreground font-medium">极端缩量</span>　累计缩量差额超3亿</div>
        </div>
      </div>

      <!-- 汇总信息 -->
      <div v-if="header" class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div class="border rounded-lg p-3">
          <div class="text-xs text-muted-foreground mb-1">当日成交额</div>
          <div class="text-lg font-bold">{{ formatVolume(todayTotal) }}</div>
        </div>
        <div class="border rounded-lg p-3">
          <div class="text-xs text-muted-foreground mb-1">昨日成交额</div>
          <div class="text-lg font-bold text-muted-foreground">{{ formatVolume(yesterdayTotal) }}</div>
        </div>
        <div class="border rounded-lg p-3">
          <div class="text-xs text-muted-foreground mb-1">较昨日增减</div>
          <div class="text-lg font-bold" :class="changePercent >= 0 ? 'text-red-500' : 'text-green-500'">
            {{ formatPercent(changePercent) }}
          </div>
        </div>
        <div class="border rounded-lg p-3">
          <div class="text-xs text-muted-foreground mb-1">预测全天成交额</div>
          <div class="text-lg font-bold text-blue-500">{{ formatVolume(predictTotal) }}</div>
        </div>
      </div>

      <!-- 趋势状态 -->
      <div v-if="trendLabel" class="flex items-center gap-2 mb-3 text-sm">
        <span class="text-muted-foreground">当前趋势：</span>
        <span :class="trendColor" class="font-semibold text-base">
          {{ trendIcon }} {{ trendLabel }}
        </span>
        <span class="text-muted-foreground ml-2">累计差额：</span>
        <span :class="cumulativeDiffColor" class="font-semibold text-base">
          {{ cumulativeDiffText }}
        </span>
      </div>

      <!-- ECharts 累计量能图（全天时间轴） -->
      <div v-if="minuteData.length > 0" class="border rounded-lg mb-4 p-2">
        <div class="px-2 mb-2">
          <span class="text-sm font-medium">累计成交量 — 今日 vs 昨日累计（全天）</span>
        </div>
        <div ref="chartRef" class="w-full" style="height: 350px"></div>
      </div>

      <!-- ECharts 累计差额图（全天时间轴） -->
      <div v-if="minuteData.length > 0" class="border rounded-lg mb-4 p-2">
        <div class="px-2 mb-2">
          <span class="text-sm font-medium">累计成交额差额 — 今日减昨日累计（红=累计放量，绿=累计缩量）</span>
        </div>
        <div ref="diffChartRef" class="w-full" style="height: 250px"></div>
      </div>

      <!-- 分钟级数据表格 -->
      <div v-if="reversedMinuteData.length > 0" class="border rounded-lg overflow-auto flex-1" style="max-height: 400px">
        <Table :data="reversedMinuteData" :loading="loading">
          <TableHeader>
            <TableRow>
              <TableHead label="时间" class="w-[80px]" />
              <TableHead label="今日成交量" class="w-[120px]" />
              <TableHead label="昨日成交量" class="w-[120px]" />
              <TableHead label="同比" class="w-[100px]" />
              <TableHead label="趋势" class="w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="(row, index) in reversedMinuteData" :key="row.ts">
              <TableCell>
                <span class="font-mono text-sm">{{ row.time }}</span>
              </TableCell>
              <TableCell>
                <span v-if="!row.hasData" class="font-mono text-muted-foreground">-</span>
                <span v-else class="font-mono font-semibold">{{ formatVolume(row.todayVol) }}</span>
              </TableCell>
              <TableCell>
                <span v-if="!row.hasData" class="font-mono text-muted-foreground">-</span>
                <span v-else class="font-mono text-muted-foreground">{{ formatVolume(row.yestVol) }}</span>
              </TableCell>
              <TableCell>
                <span v-if="!row.hasData" class="font-mono text-muted-foreground">-</span>
                <span
                  v-else
                  class="font-mono font-semibold"
                  :class="row.ratio >= 1 ? 'text-red-500' : 'text-green-500'"
                >
                  {{ (row.ratio * 100).toFixed(0) }}%
                </span>
              </TableCell>
              <TableCell>
                <span v-if="!row.hasData" class="text-muted-foreground text-sm">-</span>
                <span v-else-if="row.ratio >= 1.3" class="text-red-500 text-sm">放量</span>
                <span v-else-if="row.ratio < 0.7" class="text-green-500 text-sm">缩量</span>
                <span v-else class="text-muted-foreground text-sm">平稳</span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts'
import Button from '@/components/ui/Button.vue'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/Table'
import { useVolumeMonitor } from '@/composables/useVolumeMonitor.js'

const {
  loading,
  lastUpdate,
  header,
  points,
  minuteData,
  trendStatus,
  trendLabel,
  trendColor,
  trendIcon,
  cumulativeDiffText,
  cumulativeDiffColor,
  alertEnabled,
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
} = useVolumeMonitor()

const showRules = ref(false)

// 表格倒序（最新在上），只显示有实际数据的已发生记录
const reversedMinuteData = computed(() => 
  minuteData.value.filter(d => d.hasData && !d.isFuture).reverse()
)

// ===== ECharts =====
const chartRef = ref(null)
let chart = null

const chartOption = computed(() => {
  const data = minuteData.value
  if (data.length === 0) return null

  const times = data.map(d => d.time)
  
  // 计算累计成交量（从9:30开始累加）
  let todayCum = 0
  let yestCum = 0
  const todayValues = data.map(d => {
    if (d.todayVol === null || d.todayVol === undefined) return null
    todayCum += d.todayVol
    return +(todayCum / 1e8).toFixed(2)
  })
  
  const yestValues = data.map(d => {
    if (d.yestVol === null || d.yestVol === undefined) return null
    yestCum += d.yestVol
    return +(yestCum / 1e8).toFixed(2)
  })

  return {
    tooltip: {
      trigger: 'axis',
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
          } else {
            const color = p.color
            html += `<div>${p.marker} ${p.seriesName}: <span style="font-weight:700;color:${color}">${val}亿</span></div>`
          }
        }
        return html
      }
    },
    legend: {
      data: ['今日累计', '昨日累计'],
      top: 5,
      textStyle: { fontSize: 13, color: '#666' },
      itemWidth: 20,
      itemHeight: 12
    },
    grid: { left: 60, right: 25, top: 40, bottom: 30 },
    xAxis: {
      type: 'category',
      data: times,
      axisLabel: {
        fontSize: 11,
        color: '#888',
        // 全天240分钟，每30分钟显示一个标签
        interval: 29,
        // 格式化显示关键时间点
        formatter: (value, index) => {
          const timeStr = data[index]?.time || value
          // 只显示整点和关键时间点
          if (timeStr === '09:30' || timeStr === '10:00' || timeStr === '10:30' ||
              timeStr === '11:00' || timeStr === '11:30' || timeStr === '13:00' ||
              timeStr === '13:30' || timeStr === '14:00' || timeStr === '14:30' ||
              timeStr === '15:00') {
            return timeStr
          }
          return ''
        }
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
    series: [
      {
        name: '今日累计',
        type: 'line',
        data: todayValues,
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2.5, color: '#ff6b6b' },
        itemStyle: { color: '#ff6b6b' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(255, 107, 107, 0.25)' },
            { offset: 1, color: 'rgba(255, 107, 107, 0.02)' }
          ])
        },
        emphasis: { focus: 'series' },
        animationDuration: 300,
        animationEasing: 'linear'
      },
      {
        name: '昨日累计',
        type: 'line',
        data: yestValues,
        smooth: true,
        symbol: 'none',
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1.5, color: '#888', type: 'dashed' },
        itemStyle: { color: '#888' },
        emphasis: { focus: 'series' },
        animation: false
      }
    ],
    animationDuration: 300,
    animationEasing: 'linear',
    animationDelay: 0
  }
})

function updateChart() {
  if (!chart) return
  const opt = chartOption.value
  if (opt) chart.setOption(opt, { notMerge: true })
}

// ===== 累计差额图 =====
const diffChartRef = ref(null)
let diffChart = null

const diffChartOption = computed(() => {
  const data = minuteData.value
  if (data.length === 0) return null

  const times = data.map(d => d.time)
  
  // 计算累计差额（从9:30开始累加）
  let cumulativeDiff = 0
  const diffs = data.map(d => {
    // 无数据时保持null，不参与累计
    if (d.todayVol === null || d.todayVol === undefined || d.yestVol === null) {
      return null
    }
    const minDiff = d.todayVol - d.yestVol
    cumulativeDiff += minDiff
    return +(cumulativeDiff / 1e8).toFixed(2)
  })

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
        if (p.value === null || p.value === undefined) {
          return `<div style="font-weight:600;margin-bottom:4px">${p.axisValue}</div>
                  <div>累计差额: <span style="color:#999">无数据</span></div>`
        }
        const sign = p.value >= 0 ? '+' : ''
        const color = p.value >= 0 ? '#ff6b6b' : '#26de81'
        const label = p.value >= 0 ? '累计放量' : '累计缩量'
        return `<div style="font-weight:600;margin-bottom:4px">${p.axisValue}</div>
                <div>累计差额: <span style="font-weight:700;color:${color}">${sign}${p.value}亿</span>（${label}）</div>`
      }
    },
    grid: { left: 60, right: 25, top: 15, bottom: 30 },
    xAxis: {
      type: 'category',
      data: times,
      axisLabel: {
        fontSize: 11,
        color: '#888',
        interval: 29,
        formatter: (value, index) => {
          const timeStr = data[index]?.time || value
          if (timeStr === '09:30' || timeStr === '10:00' || timeStr === '10:30' ||
              timeStr === '11:00' || timeStr === '11:30' || timeStr === '13:00' ||
              timeStr === '13:30' || timeStr === '14:00' || timeStr === '14:30' ||
              timeStr === '15:00') {
            return timeStr
          }
          return ''
        }
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
      },
      animationDuration: 200,
      animationEasing: 'linear',
      animationDelay: 0
    }]
  }
})

function updateDiffChart() {
  if (!diffChart) return
  const opt = diffChartOption.value
  if (opt) diffChart.setOption(opt, { notMerge: true })
}

watch(chartOption, () => {
  nextTick(() => {
    if (!chart && chartRef.value) {
      chart = echarts.init(chartRef.value)
      window.addEventListener('resize', handleResize)
    }
    updateChart()
  })
}, { deep: true })

watch(diffChartOption, () => {
  nextTick(() => {
    if (!diffChart && diffChartRef.value) {
      diffChart = echarts.init(diffChartRef.value)
    }
    updateDiffChart()
  })
}, { deep: true })

onMounted(() => {
  if (chartRef.value) {
    chart = echarts.init(chartRef.value)
    window.addEventListener('resize', handleResize)
  }
  if (diffChartRef.value) {
    diffChart = echarts.init(diffChartRef.value)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  if (chart) {
    chart.dispose()
    chart = null
  }
  if (diffChart) {
    diffChart.dispose()
    diffChart = null
  }
})

function handleResize() {
  chart?.resize()
  diffChart?.resize()
}

// 首次加载
fetchData()
</script>
