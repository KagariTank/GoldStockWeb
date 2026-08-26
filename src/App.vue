<script setup>
import { ref, onMounted, defineAsyncComponent } from 'vue'
import Button from '@/components/ui/Button.vue'
import Textarea from '@/components/ui/Textarea.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Toast from '@/components/ui/Toast.vue'
import { setToastInstance } from '@/js/toast.js'
import Dropdown from '@/components/ui/Dropdown.vue'
import Tabs from '@/components/ui/Tabs.vue'
import TimerControlPanel from '@/components/TimerControlPanel.vue'

// Tab 组件懒加载（按需加载，减小首屏体积）
const DashboardTab = defineAsyncComponent(() => import('@/components/DashboardTab.vue'))
const MonitorTab = defineAsyncComponent(() => import('@/components/MonitorTab.vue'))
const DividendTab = defineAsyncComponent(() => import('@/components/DividendTab.vue'))
const SectorFundFlowTab = defineAsyncComponent(() => import('@/components/SectorFundFlowTab.vue'))
const VolumeMonitorTab = defineAsyncComponent(() => import('@/components/VolumeMonitorTab.vue'))

import { ensureFields, calculateRow } from '@/js/utils.js'
import { initVoices, testNotify, clearAllNotifications } from '@/js/notify.js'
import { useMonitorData } from '@/composables/useMonitorData.js'
import { useDividendData } from '@/composables/useDividendData.js'
import { useTheme } from '@/composables/useTheme.js'
import { useVoice } from '@/composables/useVoice.js'
import { useEnv } from '@/composables/useEnv.js'

// State
const activeTab = ref('dashboard')

// Export/Import
const exportVisible = ref(false)
const importVisible = ref(false)
const exportJsonText = ref('')
const importJsonText = ref('')
const importMode = ref('merge')
const fileInputRef = ref(null)
const selectedFileName = ref('')

// Voice
const chineseVoices = ref([])

// Environment
const { isFileProtocol } = useEnv()

// Tab options
const tabOptions = [
  { label: '综合概览', value: 'dashboard' },
  { label: '指标监控', value: 'monitor' },
  { label: '红利股息监控', value: 'dividend' },
  { label: '板块资金流向', value: 'fundflow' },
  { label: '量能监控', value: 'volume' }
]

// Use monitor data composable (for import/export)
const {
  tableData,
  alertFlags,
  refreshAllPrices,
  saveToLocal
} = useMonitorData()

// Use dividend data composable (for import/export)
const {
  dividendStockList,
  dividendTableData,
  dividendAlertFlags,
  saveDividendStocksToLocal,
  refreshDividendData
} = useDividendData()

// Theme
const { isDark, toggleTheme } = useTheme()

// Voice (shared across all composables)
const { selectedVoice } = useVoice()

// Voice dropdown
const onDropdownCommand = (command) => {
  if (command === 'test') {
    testNotify(isFileProtocol.value, selectedVoice)
  } else {
    selectedVoice.value = command
  }
}

// Export/Import
const openExport = () => {
  exportJsonText.value = JSON.stringify({
    version: 8,
    exportedAt: new Date().toISOString(),
    monitor: { items: tableData.value },
    dividend: {
      stocks: dividendStockList.value,
      data: dividendTableData.value
    }
  }, null, 2)
  exportVisible.value = true
}

const copyExportToClipboard = async () => {
  const txt = exportJsonText.value || ''
  if (!txt) {
    alert('尚未生成导出内容')
    return
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(txt)
      alert('✅ 已复制到剪贴板')
      return
    }
  } catch (e) {}
  const ta = document.createElement('textarea')
  ta.value = txt
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand('copy')
    alert('✅ 已复制到剪贴板')
  } catch (e) {
    alert('复制失败，请手动选中文本复制')
  }
  document.body.removeChild(ta)
}

const downloadExportJson = () => {
  const txt = exportJsonText.value || ''
  if (!txt) {
    alert('尚未生成导出内容')
    return
  }
  const blob = new Blob([txt], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const d = new Date()
  const pad = n => (n < 10 ? '0' : '') + n
  const name = `project-metrics-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    URL.revokeObjectURL(url)
    document.body.removeChild(a)
  }, 100)
}

const handleFileSelect = async (event) => {
  const file = event.target.files?.[0]
  if (!file) return
  
  // 检查文件类型
  if (!file.name.endsWith('.json') && file.type !== 'application/json') {
    alert('请选择 JSON 文件')
    return
  }
  
  try {
    const text = await file.text()
    importJsonText.value = text
    selectedFileName.value = file.name
  } catch (e) {
    alert('读取文件失败：' + e.message)
  }
  
  // 重置 input，这样下次选择同一个文件也能触发 change
  if (fileInputRef.value) {
    fileInputRef.value.value = ''
  }
}

const openImport = () => {
  importJsonText.value = ''
  importMode.value = 'merge'
  selectedFileName.value = ''
  importVisible.value = true
}

const confirmImport = () => {
  let raw
  try {
    raw = JSON.parse(importJsonText.value || '{}')
  } catch (e) {
    alert('JSON 解析失败。请确认粘贴的是完整导出内容（以 { 开头）。')
    return
  }

  let monitorData = null
  let dividendData = null

  if (raw.version && raw.version >= 8) {
    monitorData = raw.monitor?.items
    dividendData = raw.dividend
  } else if (Array.isArray(raw)) {
    monitorData = raw
  } else if (raw.items && Array.isArray(raw.items)) {
    monitorData = raw.items
  } else {
    alert('格式不对，无法识别数据类型。')
    return
  }

  let importCount = 0

  // Import monitor data
  if (monitorData && Array.isArray(monitorData)) {
    const parsed = monitorData.map(r => ensureFields(Object.assign({}, r)))
    if (!parsed.every(r => r && r.fullCode)) {
      alert('监控数据缺少【编号/名称/fullCode】字段。')
      return
    }

    if (importMode.value === 'replace') {
      tableData.value = parsed
    } else {
      const byCode = new Map()
      tableData.value.forEach(r => byCode.set(r.fullCode, r))
      parsed.forEach(r => {
        byCode.set(r.fullCode, r)
      })
      tableData.value = Array.from(byCode.values())
    }
    tableData.value.forEach(r => calculateRow(r, saveToLocal))
    importCount += tableData.value.length
  }

  // Import dividend data
  if (dividendData) {
    if (dividendData.stocks && Array.isArray(dividendData.stocks)) {
      if (importMode.value === 'replace') {
        dividendStockList.value = dividendData.stocks.map(item => ({
          ...item,
          dividendPerShare: item.dividendPerShare || 0
        }))
      } else {
        const byCode = new Map()
        dividendStockList.value.forEach(s => byCode.set(s.fullCode, s))
        dividendData.stocks.forEach(item => {
          byCode.set(item.fullCode, {
            ...item,
            dividendPerShare: item.dividendPerShare || 0
          })
        })
        dividendStockList.value = Array.from(byCode.values())
      }
      saveDividendStocksToLocal()
    }

    if (dividendData.data && Array.isArray(dividendData.data)) {
      if (importMode.value === 'replace') {
        dividendTableData.value = dividendData.data.map(item => ({
          ...item,
          dividendPerShare: item.dividendPerShare || 0
        }))
      } else {
        const byCode = new Map()
        dividendTableData.value.forEach(r => byCode.set(r.fullCode, r))
        dividendData.data.forEach(item => {
          byCode.set(item.fullCode, {
            ...item,
            dividendPerShare: item.dividendPerShare || 0
          })
        })
        dividendTableData.value = Array.from(byCode.values())
      }
      // Sort by dividend rate descending
      dividendTableData.value.sort((a, b) => {
        const rateA = a.dividendRate !== null && !isNaN(a.dividendRate) ? a.dividendRate : -Infinity
        const rateB = b.dividendRate !== null && !isNaN(b.dividendRate) ? b.dividendRate : -Infinity
        return rateB - rateA
      })
      localStorage.setItem('dividend_data_v1', JSON.stringify(dividendTableData.value))
    }
  }

  // Reset alert flags
  alertFlags.value = {}
  dividendAlertFlags.value = {}
  saveToLocal()
  importVisible.value = false

  alert(`导入成功！监控 ${tableData.value.length} 条，红利 ${dividendTableData.value.length} 条。`)

  // Refresh prices
  if (tableData.value.length > 0) refreshAllPrices()
  if (dividendTableData.value.length > 0) refreshDividendData()
}

// Initialize voices
let voicesInitAttempted = false
const ensureVoicesInit = () => {
  if (voicesInitAttempted) return
  voicesInitAttempted = true
  initVoices(chineseVoices, selectedVoice)
}

// Lifecycle
// Toast 实例引用
const toastRef = ref(null)

onMounted(() => {
  // 初始化 Toast
  if (toastRef.value) {
    setToastInstance(toastRef.value)
  }
  
  // Init voices
  if ('speechSynthesis' in window) {
    const initOnUserAction = () => {
      ensureVoicesInit()
      document.removeEventListener('click', initOnUserAction)
      document.removeEventListener('keydown', initOnUserAction)
    }
    document.addEventListener('click', initOnUserAction, { once: true })
    document.addEventListener('keydown', initOnUserAction, { once: true })
    setTimeout(ensureVoicesInit, 500)
  }

  // File protocol warning
  if (isFileProtocol.value) {
    setTimeout(() => {
      alert('当前为本地 file:// 模式，浏览器通常会禁用系统通知。\n\n为了完整使用：\n1. 使用 Live Server 等工具以 http://localhost 打开页面（系统通知 + 语音完整）\n2. 数据迁移：先用右上角【📤 导出数据】复制 JSON，切到 localhost 后点【📥 导入数据】粘贴即可。')
    }, 150)
  }
})
</script>

<template>
  <div class="h-screen bg-background">
    <div class="max-w-full h-full mx-auto p-4 flex flex-col">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-4">
        <div>
          <h1 class="text-2xl font-bold">项目指标看板</h1>
          <p class="text-sm text-muted-foreground mt-1">
            📋 说明：蓝色-达标区 | 橙色-警戒区。保本止损：浮盈达 1.5系数后止损抬至入标成本。
            <span v-if="isFileProtocol" class="text-yellow-600 font-semibold ml-2">
              ⚠️ 当前为本地文件模式（file://），系统通知可能被浏览器禁用。建议使用 Live Server（http://localhost）打开。
            </span>
          </p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <Button variant="success" @click="openExport">导出</Button>
          <Button variant="outline" @click="openImport">导入</Button>

          <Dropdown class="ml-2">
            <template #trigger="{ toggle, isOpen }">
              <Button variant="default" @click="toggle">
                语音设置
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="ml-1">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </Button>
            </template>
            <template #default="{ close }">
              <button
                v-for="voice in chineseVoices"
                :key="voice.name"
                class="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                :class="{ 'text-green-600 font-semibold': selectedVoice === voice.name }"
                @click="onDropdownCommand(voice.name); close()"
              >
                <span v-if="selectedVoice === voice.name">✓ </span>{{ voice.name }}
              </button>
              <div class="border-t my-1"></div>
              <button
                class="w-full text-left px-3 py-2 text-sm text-orange-500 hover:bg-accent transition-colors"
                @click="onDropdownCommand('test'); close()"
              >
                🔊 测试语音提醒
              </button>
            </template>
          </Dropdown>

          <Button variant="outline" @click="toggleTheme">
            {{ isDark ? '☀️ 浅色' : '🌙 深色' }}
          </Button>
          <Button variant="destructive" @click="clearAllNotifications">清除通知</Button>
        </div>
      </div>

      <!-- Tabs -->
      <Tabs :tabs="tabOptions" v-model="activeTab" class="flex-1">
        <template #default="{ activeTab }">
          <!-- Dashboard Tab -->
          <DashboardTab v-if="activeTab === 'dashboard'" />

          <!-- Monitor Tab -->
          <MonitorTab v-if="activeTab === 'monitor'" />

          <!-- Dividend Tab -->
          <DividendTab v-if="activeTab === 'dividend'" />

          <!-- Sector Fund Flow Tab -->
          <SectorFundFlowTab v-if="activeTab === 'fundflow'" />

          <!-- Volume Monitor Tab -->
          <VolumeMonitorTab v-if="activeTab === 'volume'" />
        </template>
      </Tabs>

      <!-- Export Dialog -->
      <Dialog v-model="exportVisible" title="📤 导出数据（一键迁移）" width="720px">
        <p class="text-sm text-muted-foreground mb-2">
          点击下方「复制全部到剪贴板」，然后用 Live Server 打开同一页面后点【📥 导入数据】粘贴即可。或者直接下载 JSON 文件保存到本地。
        </p>
        <Textarea v-model="exportJsonText" :rows="14" class="font-mono text-xs" readonly />
        <template #footer>
          <Button variant="outline" @click="exportVisible = false">关闭</Button>
          <Button @click="copyExportToClipboard">复制全部到剪贴板</Button>
          <Button variant="success" @click="downloadExportJson">下载 JSON 文件</Button>
        </template>
      </Dialog>

      <!-- Import Dialog -->
      <Dialog v-model="importVisible" title="📥 导入数据" width="720px">
        <p class="text-sm text-muted-foreground mb-2">
          粘贴之前导出的 JSON 文本到下面的文本框，或点击按钮选择本地 JSON 文件导入。
        </p>
        <div class="flex gap-4 mb-3">
          <label class="flex items-center gap-2">
            <input type="radio" v-model="importMode" value="merge" class="w-4 h-4" />
            <span class="text-sm">合并（按编号覆盖同编号覆盖、不同编号保留两边相加）</span>
          </label>
          <label class="flex items-center gap-2">
            <input type="radio" v-model="importMode" value="replace" class="w-4 h-4" />
            <span class="text-sm">替换（清空现有，用导入的覆盖整个列表）</span>
          </label>
        </div>
        <div class="flex gap-2 mb-2">
          <input 
            type="file" 
            ref="fileInputRef" 
            accept=".json,application/json" 
            class="hidden"
            @change="handleFileSelect"
          />
          <Button variant="outline" @click="fileInputRef?.click()">
            📂 选择文件
          </Button>
          <span v-if="selectedFileName" class="text-sm text-muted-foreground self-center">
            已选择：{{ selectedFileName }}
          </span>
        </div>
        <Textarea v-model="importJsonText" :rows="14" class="font-mono text-xs" placeholder="请粘贴之前导出的 JSON 字符串，或点击上方按钮选择文件..."/>
        <template #footer>
          <Button variant="outline" @click="importVisible = false">取消</Button>
          <Button @click="confirmImport">确认导入</Button>
        </template>
      </Dialog>
      
      <!-- Toast -->
      <Toast ref="toastRef" />
    </div>

    <!-- 定时器控制面板（浮动） -->
    <TimerControlPanel />
  </div>
</template>

<style>
/* Global styles */
.up-text {
  color: #f56c6c;
}

.down-text {
  color: #67c23a;
}

.alert-text {
  color: #e6a23c;
  font-weight: 600;
}

/* Dividend rate colors */
.rate-green {
  color: #67c23a;
  font-weight: 600;
}

.rate-yellow {
  color: #e6a23c;
  font-weight: 600;
}

.rate-orange {
  color: #f56c6c;
  font-weight: 600;
}

.rate-blue {
  color: #409eff;
  font-weight: 600;
}

/* Animations */
@keyframes flash {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.animate-pulse {
  animation: flash 1s ease-in-out infinite;
}
</style>