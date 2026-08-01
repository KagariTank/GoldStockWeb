<template>
  <div class="flex flex-col h-full">
    <!-- Toolbar -->
    <div class="flex gap-2 mb-4">
      <Textarea
        v-model="dividendInputCodes"
        :rows="1"
        placeholder="输入股票编号（支持批量，空格/逗号分隔）"
        class="flex-1"
      />
      <div class="flex gap-2 flex-wrap">
        <Button :loading="dividendLoading" @click="addDividendCodes">查询并追加</Button>
        <Button :loading="dividendLoading" @click="refreshDividendData">刷新数据</Button>
        <Button
          :variant="autoDividendRefresh ? 'success' : 'outline'"
          @click="toggleAutoDividendRefresh"
        >
          {{ autoDividendRefresh ? `自动刷新 ${dividendCountdown}s` : '60s自动刷新' }}
        </Button>
      </div>
    </div>

    <!-- Table -->
    <div class="border rounded-lg overflow-auto">
      <Table :data="dividendTableData" :loading="dividendLoading">
        <TableHeader>
          <TableRow>
            <TableHead label="股票名称" class="min-w-[120px]" />
            <TableHead label="当前价格" class="w-[120px]" />
            <TableHead label="每10股股息" class="w-[130px]" />
            <TableHead label="股息率" class="w-[100px]" />
            <TableHead label="4%价" class="w-[90px]" />
            <TableHead label="4.5%价" class="w-[90px]" />
            <TableHead label="5%价" class="w-[90px]" />
            <TableHead label="5.5%价" class="w-[90px]" />
            <TableHead label="6%价" class="w-[90px]" />
            <TableHead label="操作" class="w-[80px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="(row, index) in dividendTableData" :key="row.fullCode">
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
                <span>{{ row.name }}</span>
              </div>
            </TableCell>
            <TableCell>
              <div>
                <span class="font-mono font-semibold" :class="getDividendChgClass(row)">
                  {{ row.price || '-' }}
                </span>
              </div>
              <div class="text-xs" :class="getDividendChgClass(row)">
                {{ formatDividendChg(row) }}
              </div>
            </TableCell>
            <TableCell>
              <NumberInput
                v-model="row.dividendPerShare"
                :precision="4"
                :min="0"
                :controls="false"
                class="w-24"
                @change="onUpdateDividendPerShareHandler(row)"
              />
            </TableCell>
            <TableCell>
              <span
                :class="[
                  'font-mono font-semibold',
                  getDividendClass(row.dividendRate)
                ]"
              >
                {{ row.dividendRate !== null && row.dividendRate !== undefined ? row.dividendRate.toFixed(2) + '%' : '-' }}
              </span>
            </TableCell>
            <TableCell>
              <span
                :class="{ 'animate-pulse text-purple-600 font-semibold': isDividendRateReached(row, 4) }"
              >
                {{ row.priceAt400 || '-' }}
              </span>
            </TableCell>
            <TableCell>
              <span
                :class="{ 'animate-pulse text-blue-600 font-semibold': isDividendRateReached(row, 4.5) }"
              >
                {{ row.priceAt450 || '-' }}
              </span>
            </TableCell>
            <TableCell>
              <span
                :class="{ 'animate-pulse text-red-600 font-semibold': isDividendRateReached(row, 5) }"
              >
                {{ row.priceAt500 || '-' }}
              </span>
            </TableCell>
            <TableCell>
              <span
                :class="{ 'animate-pulse text-orange-600 font-semibold': isDividendRateReached(row, 5.5) }"
              >
                {{ row.priceAt550 || '-' }}
              </span>
            </TableCell>
            <TableCell>
              <span
                :class="{ 'animate-pulse text-green-600 font-semibold': isDividendRateReached(row, 6) }"
              >
                {{ row.priceAt600 || '-' }}
              </span>
            </TableCell>
            <TableCell>
              <Button variant="destructive" size="sm" @click="removeDividendItem(index)">移除</Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </div>
</template>

<script setup>
import Button from '@/components/ui/Button.vue'
import Textarea from '@/components/ui/Textarea.vue'
import NumberInput from '@/components/ui/NumberInput.vue'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/Table'
import { useDividendData } from '@/composables/useDividendData.js'
import { getMarket, getMarketLabel } from '@/js/utils.js'
import { getDividendClass, getDividendChgClass, formatDividendChg, isDividendRateReached } from '@/js/dividend.js'

// Use dividend data composable
const {
  dividendInputCodes,
  dividendTableData,
  dividendLoading,
  autoDividendRefresh,
  dividendCountdown,
  addDividendCodes,
  removeDividendItem,
  refreshDividendData,
  toggleAutoDividendRefresh,
  onUpdateDividendPerShareHandler
} = useDividendData()
</script>