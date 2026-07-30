<template>
  <div class="flex flex-col h-full">
    <!-- Toolbar -->
    <div class="flex gap-2 mb-4">
      <Textarea
        v-model="inputCodes"
        :rows="1"
        placeholder="输入编号（支持批量，空格/逗号分隔）"
        class="flex-1"
      />
      <div class="flex gap-2 flex-wrap">
        <Button :loading="loading" @click="addNewCodes">查询并追加</Button>
        <Button :loading="loading" @click="refreshAllPrices">刷新数据</Button>
        <Button
          :variant="autoRefresh ? 'success' : 'outline'"
          @click="toggleAutoRefresh"
        >
          {{ autoRefresh ? `自动刷新 ${autoCountdown}s` : '30s自动刷新' }}
        </Button>
        <Button variant="outline" @click="clearAll">清空</Button>
      </div>
    </div>

    <!-- Table -->
    <div class="border rounded-lg overflow-auto flex-1">
      <Table :data="tableData" :loading="loading">
        <TableHeader>
          <TableRow>
            <TableHead class="w-10"></TableHead>
            <TableHead label="项目 / 编号" class="min-w-[140px]" />
            <TableHead label="当前值 / 波动" class="w-[160px]" />
            <TableHead label="均线" class="w-[80px]" />
            <TableHead label="止盈止损" class="w-[170px]" />
            <TableHead label="距离(%)" class="w-[130px]" />
            <TableHead label="黄金分割线" class="w-[210px]" />
            <TableHead label="8848线" class="w-[150px]" />
            <TableHead label="操作" class="w-[140px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <template v-for="(row, index) in tableData" :key="row.fullCode">
            <TableRow :rowKey="row.fullCode" :class="getRowClass(row)" #="{ isExpanded, toggleExpand }">
              <TableCell>
                <button
                  class="p-1 hover:bg-accent rounded transition-transform"
                  :class="{ 'rotate-90': isRowExpanded(row) }"
                  @click="toggleRowExpand(row)"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </button>
              </TableCell>
              <TableCell>
                <div class="flex items-center gap-1">
                  <span
                    :class="[
                      'inline-block px-1.5 py-0.5 text-xs rounded font-medium',
                      getMarket(row.fullCode) === 'sh' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' :
                      getMarket(row.fullCode) === 'sz' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' :
                      getMarket(row.fullCode) === 'hk' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' :
                      'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                    ]"
                  >
                    {{ getMarketLabel(row.fullCode) }}
                  </span>
                  <span class="font-semibold">{{ row.name }}</span>
                  <span
                    v-if="row.addPositions?.length"
                    class="ml-1 text-xs bg-green-500 text-white px-1.5 py-0.5 rounded"
                  >
                    +{{ row.addPositions.length }}
                  </span>
                </div>
                <div class="text-xs text-muted-foreground ml-8">{{ row.fullCode }}</div>
              </TableCell>
              <TableCell>
                <div>
                  <span
                    class="font-mono font-semibold"
                    :class="[
                      getChgClass(row),
                      { 'animate-pulse': hasAlert(row.fullCode, 'TAKE_PROFIT') || hasAlert(row.fullCode, 'STOP_LOSS') }
                    ]"
                  >
                    {{ row.now }}
                  </span>
                </div>
                <div class="text-xs" :class="getChgClass(row)">
                  {{ formatChg(row) }}
                </div>
              </TableCell>
              <TableCell>
                <span class="font-mono text-blue-600">{{ row.avg }}</span>
              </TableCell>
              <TableCell>
                <div class="text-sm">
                  <div
                    class="font-mono"
                    :class="{ 'animate-pulse text-green-600 dark:text-green-400': hasAlert(row.fullCode, 'TAKE_PROFIT') }"
                  >
                    止盈 {{ row.takeProfit || '-' }}
                  </div>
                  <div
                    class="font-mono mt-1"
                    :class="{ 'animate-pulse text-red-600 dark:text-red-400': hasAlert(row.fullCode, 'STOP_LOSS') }"
                  >
                    止损 {{ row.stopLoss || '-' }}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <div class="text-sm">
                  <div
                    v-if="row.toTPPct !== undefined && row.toTPPct !== ''"
                    class="font-mono"
                    :class="[
                      getPnlClass(row._toTPNum),
                      { 'animate-pulse text-green-600': hasAlert(row.fullCode, 'TAKE_PROFIT') }
                    ]"
                  >
                    {{ row.toTPPct }}
                  </div>
                  <div v-else class="text-muted-foreground">距止盈 -</div>
                  <div
                    v-if="row.toSLPct !== undefined && row.toSLPct !== ''"
                    class="font-mono mt-1"
                    :class="[
                      getPnlClass(row._toSLNum),
                      { 'animate-pulse text-red-600': hasAlert(row.fullCode, 'STOP_LOSS') }
                    ]"
                  >
                    {{ row.toSLPct }}
                  </div>
                  <div v-else class="text-muted-foreground mt-1">距止损 -</div>
                </div>
              </TableCell>
              <TableCell>
                <div class="text-sm font-mono">
                  <div>
                    <span
                      :class="{ 'animate-pulse text-orange-600 dark:text-orange-400': hasAlert(row.fullCode, 'L2_THRESH') && !hasAlert(row.fullCode, 'L3_THRESH') }"
                    >
                      L1 {{ row.f382 }}
                    </span>
                    &nbsp;
                    <span
                      :class="{ 'animate-pulse text-orange-600 dark:text-orange-400': hasAlert(row.fullCode, 'L2_THRESH') && !hasAlert(row.fullCode, 'L3_THRESH') }"
                    >
                      L2 {{ row.f618 }}
                    </span>
                  </div>
                  <div
                    class="mt-1"
                    :class="{ 'animate-pulse text-red-600 dark:text-red-400': hasAlert(row.fullCode, 'L3_THRESH') }"
                  >
                    L3 {{ row.f786 }}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <div class="text-sm font-mono">
                  <div
                    :class="{ 'animate-pulse text-green-600 dark:text-green-400': hasAlert(row.fullCode, 'TOP_BOUND') }"
                  >
                    上 {{ row.topLine }}
                  </div>
                  <div
                    class="mt-1"
                    :class="{ 'animate-pulse text-red-600 dark:text-red-400': hasAlert(row.fullCode, 'BOT_BOUND') }"
                  >
                    下 {{ row.bottomLine }}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <div class="flex gap-1">
                  <Button variant="success" size="sm" @click="openAddPos(row)">加仓</Button>
                  <Button variant="outline" size="sm" @click="openCfg(row)">参数</Button>
                  <Button variant="destructive" size="sm" @click="removeItem(index)">移除</Button>
                </div>
              </TableCell>
            </TableRow>

            <!-- Expand Row -->
            <TableExpandRow v-if="isRowExpanded(row)">
              <div class="bg-gradient-to-b from-slate-50 to-white p-4 rounded-lg space-y-4">
                <!-- 底仓信息 -->
                <div class="bg-gradient-to-r from-blue-50 to-white border border-blue-200 rounded-lg p-3 shadow-sm">
                  <div class="flex items-center gap-2 mb-3">
                    <span class="w-2 h-2 bg-blue-500 rounded-full"></span>
                    <span class="font-semibold text-blue-600">📊 底仓</span>
                    <span class="text-xs text-slate-400 ml-2">ADR20: {{ row.adr20 || '-' }}</span>
                  </div>
                  <div class="grid grid-cols-3 gap-x-6 gap-y-1.5 text-sm">
                    <div class="flex items-center gap-1.5">
                      <span class="text-slate-500">成本</span>
                      <span class="font-mono font-medium">{{ row.buyPrice || '-' }}</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                      <span class="text-slate-500">数量</span>
                      <span class="font-mono font-medium">{{ row.quantity || '-' }}</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                      <span class="text-slate-500">盈亏</span>
                      <span class="font-mono font-medium" :class="getPnlClass(row.pnlAmount)">{{ row.pnlAmount || '-' }} ({{ row.pnlPct || '-' }})</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                      <span class="text-slate-500 dark:text-slate-400">止盈</span>
                      <span class="font-mono font-medium" :class="{ 'animate-pulse text-green-600 dark:text-green-400 font-bold': hasAlert(row.fullCode, 'TAKE_PROFIT') }">{{ row.takeProfit || '-' }}</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                      <span class="text-slate-500 dark:text-slate-400">止损</span>
                      <span class="font-mono font-medium" :class="{ 'animate-pulse text-red-600 dark:text-red-400 font-bold': hasAlert(row.fullCode, 'STOP_LOSS') }">{{ row.stopLoss || '-' }}</span>
                    </div>
                    <div class="flex items-center gap-1.5 col-span-1">
                      <span class="text-xs text-slate-400">距止盈 {{ row.toTPPct || '-' }}</span>
                      <span class="text-xs text-slate-300">|</span>
                      <span class="text-xs text-slate-400">距止损 {{ row.toSLPct || '-' }}</span>
                    </div>
                  </div>
                </div>

                <!-- 加仓记录 -->
                <div v-if="row.addPositions?.length">
                  <div class="font-semibold text-green-600 mb-3 flex items-center gap-2">
                    <span class="w-2 h-2 bg-green-500 rounded-full"></span>
                    📈 加仓记录
                  </div>
                  <div class="space-y-2">
                    <div
                      v-for="(pos, idx) in row.addPositions"
                      :key="pos.id"
                      class="bg-gradient-to-r from-green-50 to-white border border-green-200 rounded-lg p-3 shadow-sm"
                    >
                      <div class="flex items-center justify-between mb-2">
                        <span class="inline-flex items-center gap-1.5 px-2 py-0.5 bg-green-100 text-green-700 text-xs font-semibold rounded">
                          <span class="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                          加仓 {{ idx + 1 }}
                        </span>
                        <Button variant="ghost" size="sm" class="h-6 px-2 text-xs text-red-500 hover:text-red-700 hover:bg-red-50" @click="removeAddPos(row, pos.id)">删除</Button>
                      </div>
                      <div class="grid grid-cols-3 gap-x-6 gap-y-1.5 text-sm">
                        <div class="flex items-center gap-1.5">
                          <span class="text-slate-500">成本</span>
                          <span class="font-mono font-medium">{{ pos.buyPrice || '-' }}</span>
                        </div>
                        <div class="flex items-center gap-1.5">
                          <span class="text-slate-500">ADR20</span>
                          <span class="font-mono font-medium">{{ pos.adr20 || '-' }}</span>
                        </div>
                        <div class="flex items-center gap-1.5">
                          <span class="text-slate-500">数量</span>
                          <span class="font-mono font-medium">{{ pos.quantity || '-' }}</span>
                        </div>
                        <div class="flex items-center gap-1.5">
                          <span class="text-slate-500 dark:text-slate-400">止盈</span>
                          <span class="font-mono font-medium" :class="{ 'animate-pulse text-green-600 dark:text-green-400 font-bold': hasAlert(row.fullCode, `ADD_${idx}_TAKE_PROFIT`) }">{{ pos.takeProfit || '-' }}</span>
                        </div>
                        <div class="flex items-center gap-1.5">
                          <span class="text-slate-500 dark:text-slate-400">止损</span>
                          <span class="font-mono font-medium" :class="{ 'animate-pulse text-red-600 dark:text-red-400 font-bold': hasAlert(row.fullCode, `ADD_${idx}_STOP_LOSS`) }">{{ pos.stopLoss || '-' }}</span>
                        </div>
                        <div class="flex items-center gap-1.5">
                          <span class="text-slate-500">盈亏</span>
                          <span class="font-mono font-medium" :class="getPnlClass(pos.pnlAmount)">{{ pos.pnlAmount || '-' }} ({{ pos.pnlPct || '-' }})</span>
                        </div>
                        <div class="flex items-center gap-1.5 col-span-3 pt-1 border-t border-green-100 mt-1">
                          <span class="text-xs text-slate-400">距止盈 {{ pos.toTPPct || '-' }}</span>
                          <span class="text-xs text-slate-300">|</span>
                          <span class="text-xs text-slate-400">距止损 {{ pos.toSLPct || '-' }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-else class="text-muted-foreground text-sm py-2">暂无加仓</div>
              </div>
            </TableExpandRow>
          </template>
        </TableBody>
      </Table>
    </div>

    <!-- Config Dialog -->
    <Dialog v-model="cfgVisible" title="参数设置" width="520px">
      <div v-if="cfgRow" class="space-y-4">
        <FormItem label="阶段峰值">
          <NumberInput v-model="cfgRow.high" :precision="3" :controls="false" class="w-64" @change="cfgChanged = true" />
        </FormItem>
        <FormItem label="阶段谷值">
          <NumberInput v-model="cfgRow.low" :precision="3" :controls="false" class="w-64" @change="cfgChanged = true" />
        </FormItem>
        <FormItem label="波动系数(20)">
          <NumberInput v-model="cfgRow.adr20" :precision="3" :controls="false" class="w-64" @change="cfgChanged = true" />
        </FormItem>
        <FormItem label="入标日期">
          <DatePicker v-model="cfgRow.buyDate" class="w-64" />
        </FormItem>
        <FormItem label="入标成本">
          <NumberInput v-model="cfgRow.buyPrice" :precision="3" :controls="false" class="w-64" @change="cfgChanged = true" />
        </FormItem>
        <FormItem label="权重（数量）">
          <NumberInput v-model="cfgRow.quantity" :precision="0" :controls="false" class="w-64" @change="cfgChanged = true" />
        </FormItem>
      </div>
      <template #footer>
        <Button variant="outline" @click="cfgVisible = false">取消</Button>
        <Button @click="saveCfg">保存应用</Button>
      </template>
    </Dialog>

    <!-- Add Position Dialog -->
    <Dialog v-model="addPosVisible" title="📈 加仓设置" width="480px">
      <div class="space-y-4">
        <FormItem label="加仓成本">
          <NumberInput v-model="addPosForm.buyPrice" :precision="3" :controls="false" class="w-60" />
        </FormItem>
        <FormItem label="ADR20">
          <NumberInput v-model="addPosForm.adr20" :precision="3" :controls="false" class="w-60" />
        </FormItem>
        <FormItem label="加仓数量">
          <NumberInput v-model="addPosForm.quantity" :precision="0" :controls="false" class="w-60" />
        </FormItem>
        <FormItem label="加仓日期">
          <DatePicker v-model="addPosForm.buyDate" class="w-60" />
        </FormItem>
      </div>
      <p class="text-sm text-muted-foreground mt-4">
        提示：加仓将独立计算止盈止损，点击行左侧展开按钮可查看各仓位详情。
      </p>
      <template #footer>
        <Button variant="outline" @click="addPosVisible = false">取消</Button>
        <Button variant="success" @click="saveAddPos">确认加仓</Button>
      </template>
    </Dialog>
  </div>
</template>

<script setup>
import Button from '@/components/ui/Button.vue'
import Textarea from '@/components/ui/Textarea.vue'
import Dialog from '@/components/ui/Dialog.vue'
import NumberInput from '@/components/ui/NumberInput.vue'
import DatePicker from '@/components/ui/DatePicker.vue'
import FormItem from '@/components/ui/FormItem.vue'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell, TableExpandRow } from '@/components/ui/Table'
import { useMonitorData } from '@/composables/useMonitorData.js'
import { getMarket, getMarketLabel, getChgClass, formatChg, getPnlClass } from '@/js/utils.js'

// Use monitor data composable
const {
  inputCodes,
  tableData,
  loading,
  autoRefresh,
  autoCountdown,
  cfgVisible,
  cfgRow,
  cfgChanged,
  addPosVisible,
  addPosForm,
  hasAlert,
  addNewCodes,
  refreshAllPrices,
  openCfg,
  saveCfg,
  removeItem,
  clearAll,
  toggleAutoRefresh,
  openAddPos,
  saveAddPos,
  removeAddPos,
  toggleRowExpand,
  isRowExpanded
} = useMonitorData()

// Helper functions for template
const getRowClass = (row) => {
  const classes = []
  const now = parseFloat(row.now)
  const sl = parseFloat(row.stopLoss)
  const tp = parseFloat(row.takeProfit)

  if (!isNaN(sl) && sl > 0 && now <= sl) {
    classes.push('bg-red-50', 'dark:bg-red-950', 'dark:text-red-200')
  } else if (!isNaN(tp) && tp > 0 && now >= tp) {
    classes.push('bg-green-50', 'dark:bg-green-950', 'dark:text-green-200')
  } else if (!isNaN(now) && row.f618) {
    if (now <= parseFloat(row.f786)) {
      classes.push('bg-red-50', 'dark:bg-red-950', 'dark:text-red-200')
    } else if (now <= parseFloat(row.f618)) {
      classes.push('bg-orange-50', 'dark:bg-orange-950', 'dark:text-orange-200')
    }
  }

  return classes.join(' ')
}
</script>