<template>
  <div class="flex flex-col h-full">
    <!-- Toolbar -->
    <div class="flex items-center gap-2 mb-4 flex-wrap">
      <span class="text-sm font-medium">跌停板监控</span>
      <span class="text-xs text-muted-foreground">
        {{ displayDate ? `数据日期 ${displayDate}` : '全市场跌停股 · 连续跌停天数' }}
      </span>

      <div class="flex-1" />

      <span v-if="lastUpdate" class="text-xs text-muted-foreground">
        更新于 {{ lastUpdate }}
      </span>
      <Button :loading="loading" size="sm" @click="fetchLimitDownData">刷新数据</Button>
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

    <!-- 汇总卡片 -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <div class="border rounded-lg p-3 bg-background">
        <div class="text-xs text-muted-foreground mb-1">今日跌停</div>
        <div class="text-lg font-semibold down-text">{{ stats.total }}</div>
        <div class="text-[10px] text-muted-foreground mt-0.5">全市场</div>
      </div>
      <div class="border rounded-lg p-3 bg-background">
        <div class="text-xs text-muted-foreground mb-1">连续跌停 ≥2</div>
        <div class="text-lg font-semibold" :class="stats.multi > 0 ? 'alert-text' : ''">{{ stats.multi }}</div>
        <div class="text-[10px] text-muted-foreground mt-0.5">连跌股（重点监控）</div>
      </div>
      <div class="border rounded-lg p-3 bg-background">
        <div class="text-xs text-muted-foreground mb-1">封单资金合计</div>
        <div class="text-lg font-semibold">{{ formatYi(stats.sealTotal) }}</div>
        <div class="text-[10px] text-muted-foreground mt-0.5">跌停封单</div>
      </div>
      <div class="border rounded-lg p-3 bg-background">
        <div class="text-xs text-muted-foreground mb-1">开板 / 最高连跌</div>
        <div class="text-lg font-semibold">
          {{ stats.opened }}
          <span class="text-muted-foreground text-sm font-normal">/</span>
          <span class="text-sm font-normal text-muted-foreground">{{ stats.maxDays }}天</span>
        </div>
        <div class="text-[10px] text-muted-foreground mt-0.5">曾开板家数 / 最大连续跌停</div>
      </div>
    </div>

    <!-- 跌停表格 -->
    <div class="border rounded-lg overflow-auto flex-1">
      <Table :data="tableData" :loading="loading">
        <TableHeader>
          <TableRow>
            <TableHead label="#" class="w-[50px]" />
            <TableHead label="名称" class="min-w-[100px]" />
            <TableHead label="代码" class="w-[90px]" />
            <TableHead label="现价" class="w-[80px]" />
            <TableHead label="涨跌幅" class="w-[90px]" />
            <TableHead label="连续跌停" class="w-[90px]" />
            <TableHead label="封单资金" class="w-[110px]" />
            <TableHead label="最后封板" class="w-[90px]" />
            <TableHead label="开板次数" class="w-[90px]" />
            <TableHead label="换手率" class="w-[80px]" />
            <TableHead label="行业" class="min-w-[90px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="(row, index) in tableData"
            :key="row.code"
            :class="{ 'bg-red-50/50': row.dtDays >= 2 }"
          >
            <TableCell>
              <span class="text-muted-foreground text-sm">{{ index + 1 }}</span>
            </TableCell>
            <TableCell>
              <span class="font-medium">{{ row.name }}</span>
            </TableCell>
            <TableCell>
              <span class="text-muted-foreground font-mono text-sm">{{ row.code }}</span>
            </TableCell>
            <TableCell>
              <span class="font-mono">{{ row.price.toFixed(2) }}</span>
            </TableCell>
            <TableCell>
              <span class="font-mono font-semibold down-text">{{ row.pct.toFixed(2) }}%</span>
            </TableCell>
            <TableCell>
              <span
                class="font-mono font-semibold px-1.5 py-0.5 rounded text-xs"
                :class="row.dtDays >= 3 ? 'bg-red-100 text-red-600' : (row.dtDays === 2 ? 'bg-orange-100 text-orange-600' : 'text-muted-foreground')"
              >
                {{ row.dtDays }}天
              </span>
            </TableCell>
            <TableCell>
              <span class="font-mono">{{ formatYi(row.sealFund) }}</span>
            </TableCell>
            <TableCell>
              <span class="font-mono text-sm">{{ row.lastSeal }}</span>
            </TableCell>
            <TableCell>
              <span
                class="font-mono text-sm"
                :class="row.openTimes > 0 ? 'alert-text' : 'text-muted-foreground'"
              >
                {{ row.openTimes }}
              </span>
            </TableCell>
            <TableCell>
              <span class="font-mono text-sm">{{ row.turnover.toFixed(2) }}%</span>
            </TableCell>
            <TableCell>
              <span class="text-sm text-muted-foreground">{{ row.industry || '-' }}</span>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import Button from '@/components/ui/Button.vue'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/Table'
import { useLimitDownData } from '@/composables/useLimitDownData.js'

const {
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
} = useLimitDownData()

// 格式化金额（元 → 亿）
function formatYi(val) {
  if (val === null || val === undefined || isNaN(val)) return '-'
  return (val / 1e8).toFixed(2) + '亿'
}

onMounted(() => {
  if (tableData.value.length === 0) fetchLimitDownData()
})
</script>