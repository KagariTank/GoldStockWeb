<template>
  <div class="flex flex-col h-full">
    <!-- Toolbar -->
    <div class="flex items-center gap-2 mb-4 flex-wrap">
      <span class="text-sm font-medium">LOF 套利监控</span>
      <span class="text-xs text-muted-foreground">
        {{ `折溢价率 |${PREMIUM_THRESHOLD}| > 1% · 现价≠1.0 · 有净值数据` }}
      </span>

      <div class="flex-1" />

      <span v-if="lastUpdate" class="text-xs text-muted-foreground">
        更新于 {{ lastUpdate }}
      </span>
      <Button :loading="loading" size="sm" @click="fetchLofData">刷新数据</Button>
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
      {{ error }}
    </div>

    <!-- 汇总卡片 -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <div class="border rounded-lg p-3 bg-background">
        <div class="text-xs text-muted-foreground mb-1">展示数量</div>
        <div class="text-lg font-semibold">{{ stats.total }}</div>
        <div class="text-[10px] text-muted-foreground mt-0.5">符合阈值 LOF</div>
      </div>
      <div class="border rounded-lg p-3 bg-background">
        <div class="text-xs text-muted-foreground mb-1">溢价 / 折价</div>
        <div class="text-lg font-semibold">
          <span class="up-text">{{ stats.premiumCount }}</span>
          <span class="text-muted-foreground text-sm font-normal"> / </span>
          <span class="down-text">{{ stats.discountCount }}</span>
        </div>
        <div class="text-[10px] text-muted-foreground mt-0.5">溢价数 / 折价数</div>
      </div>
      <div class="border rounded-lg p-3 bg-background">
        <div class="text-xs text-muted-foreground mb-1">最高溢价</div>
        <div class="text-lg font-semibold up-text">
          {{ stats.maxPremium > 0 ? '+' + stats.maxPremium.toFixed(2) + '%' : '-' }}
        </div>
        <div class="text-[10px] text-muted-foreground mt-0.5">溢价 > 3%: {{ stats.highPremium }} 只</div>
      </div>
      <div class="border rounded-lg p-3 bg-background">
        <div class="text-xs text-muted-foreground mb-1">最深折价</div>
        <div class="text-lg font-semibold down-text">
          {{ stats.minDiscount < 0 ? stats.minDiscount.toFixed(2) + '%' : '-' }}
        </div>
        <div class="text-[10px] text-muted-foreground mt-0.5">折价 > 3%: {{ stats.deepDiscount }} 只</div>
      </div>
    </div>

    <!-- LOF 表格 -->
    <div class="border rounded-lg overflow-auto flex-1">
      <Table :data="tableData" :loading="loading">
        <TableHeader>
          <TableRow>
            <TableHead label="#" class="w-[50px]" />
            <TableHead label="名称" class="min-w-[120px]" />
            <TableHead label="代码" class="w-[90px]" />
            <TableHead label="现价" class="w-[80px]" />
            <TableHead label="涨跌幅" class="w-[90px]" />
            <TableHead label="基金净值" class="w-[90px]" />
            <TableHead label="折溢价率" class="w-[100px]" />
            <TableHead label="价-净值" class="w-[90px]" />
            <TableHead label="套利方向" class="w-[100px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="(row, index) in tableData"
            :key="row.code"
            :class="{
              'bg-red-50/50': row.premiumRate > 3,
              'bg-green-50/30': row.premiumRate < -3
            }"
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
              <span class="font-mono">{{ row.price.toFixed(3) }}</span>
            </TableCell>
            <TableCell>
              <span
                class="font-mono font-semibold text-sm"
                :class="row.changePct > 0 ? 'up-text' : (row.changePct < 0 ? 'down-text' : 'text-muted-foreground')"
              >
                {{ row.changePct > 0 ? '+' : '' }}{{ row.changePct.toFixed(2) }}%
              </span>
            </TableCell>
            <TableCell>
              <span class="font-mono text-sm">{{ row.nav.toFixed(4) }}</span>
            </TableCell>
            <TableCell>
              <span
                class="font-mono font-semibold px-1.5 py-0.5 rounded text-xs"
                :class="premiumClass(row.premiumRate)"
              >
                {{ row.premiumRate > 0 ? '+' : '' }}{{ row.premiumRate.toFixed(2) }}%
              </span>
            </TableCell>
            <TableCell>
              <span
                class="font-mono text-sm"
                :class="row.navDiff > 0 ? 'up-text' : 'down-text'"
              >
                {{ row.navDiff > 0 ? '+' : '' }}{{ row.navDiff.toFixed(3) }}
              </span>
            </TableCell>
            <TableCell>
              <span
                class="text-xs px-1.5 py-0.5 rounded font-medium"
                :class="row.premiumRate > 0
                  ? 'bg-red-100 text-red-600'
                  : 'bg-green-100 text-green-600'"
              >
                {{ row.premiumRate > 0 ? '申购→卖出' : '买入→赎回' }}
              </span>
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
import { useLofArbitrageData } from '@/composables/useLofArbitrageData.js'

const PREMIUM_THRESHOLD = 1.0

const {
  tableData,
  loading,
  lastUpdate,
  error,
  autoRefresh,
  countdown,
  stats,
  fetchLofData,
  toggleAutoRefresh
} = useLofArbitrageData()

// 折溢价率样式
function premiumClass(rate) {
  if (rate > 5) return 'bg-red-200 text-red-700'
  if (rate > 3) return 'bg-red-100 text-red-600'
  if (rate > 1) return 'bg-orange-100 text-orange-600'
  if (rate < -5) return 'bg-green-200 text-green-700'
  if (rate < -3) return 'bg-green-100 text-green-600'
  return 'bg-gray-100 text-gray-600'
}

onMounted(() => {
  if (tableData.value.length === 0) fetchLofData()
})
</script>
