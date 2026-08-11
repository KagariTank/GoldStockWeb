<template>
  <div
    v-if="visible"
    class="fixed z-50 shadow-xl rounded-lg border bg-background min-w-[425px]"
    :style="positionStyle"
  >
    <!-- 头部拖拽条 -->
    <div
      class="flex items-center justify-between px-3 py-2 border-b cursor-move select-none"
      @mousedown="startDrag"
    >
      <div class="flex items-center gap-2">
        <span class="text-sm font-semibold">⏱ 定时器控制面板</span>
        <span
          class="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded"
          :class="stats.active > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'"
        >
          <span
            class="w-1.5 h-1.5 rounded-full"
            :class="stats.active > 0 ? 'bg-green-500 animate-pulse' : 'bg-gray-400'"
          />
          {{ stats.active }}/{{ stats.total }} 活跃
        </span>
      </div>
      <div class="flex items-center gap-1">
        <button
          v-if="stats.active > 0"
          class="text-xs px-2 py-0.5 rounded border hover:bg-muted transition-colors"
          title="暂停全部"
          @click="pauseAll"
        >⏸ 暂停</button>
        <button
          v-if="stats.paused > 0"
          class="text-xs px-2 py-0.5 rounded border hover:bg-muted transition-colors"
          title="恢复全部"
          @click="resumeAll"
        >▶ 恢复</button>
        <button
          v-if="stats.active > 0"
          class="text-xs px-2 py-0.5 rounded border hover:bg-red-50 text-red-600 transition-colors"
          title="停止全部"
          @click="stopAll"
        >■ 停止</button>
        <button
          class="text-xs w-6 h-6 rounded hover:bg-muted transition-colors"
          title="关闭"
          @click="visible = false"
        >✕</button>
      </div>
    </div>

    <!-- 定时器列表 -->
    <div class="p-2 min-w-[260px] max-h-[400px] overflow-auto">
      <div v-if="timers.length === 0" class="text-center py-6 text-muted-foreground text-sm">
        暂无注册的定时器
      </div>
      <div v-else class="space-y-1.5">
        <div
          v-for="timer in timers"
          :key="timer.name"
          class="flex items-center gap-2 p-2 rounded border transition-colors"
          :class="timer.isActive.value
            ? 'border-green-200 bg-green-50/50'
            : 'border-red-200 bg-red-50/30'"
        >
          <!-- 心跳指示灯 -->
          <span
            class="w-2.5 h-2.5 rounded-full flex-shrink-0"
            :class="timer.isActive.value
              ? 'bg-green-500 animate-pulse shadow-[0_0_6px_rgba(34,197,94,0.5)]'
              : 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.3)]'"
          />

          <!-- 名称和信息 -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="text-sm font-medium truncate">{{ formatName(timer.name) }}</span>
              <span
                class="text-[10px] px-1 rounded font-mono"
                :class="timer.isActive.value
                  ? 'bg-green-100 text-green-600'
                  : 'bg-red-100 text-red-600'"
              >
                {{ timer.isActive.value ? '运行中' : '已停止' }}
              </span>
            </div>
            <div class="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
              <span>间隔 {{ timer.refreshInterval }}s</span>
              <span v-if="timer.isActive.value">
                下次刷新 <span class="font-mono text-foreground">{{ timer.countdown.value }}s</span>
              </span>
            </div>
          </div>

          <!-- 控制按钮 -->
          <div class="flex items-center gap-1 flex-shrink-0">
            <button
              v-if="timer.isActive.value"
              class="w-7 h-7 rounded border text-sm hover:bg-muted transition-colors"
              title="停止"
              @click="timer.handle.stop()"
            >■</button>
            <button
              v-else
              class="w-7 h-7 rounded border text-sm text-green-600 hover:bg-green-50 transition-colors"
              title="启动"
              @click="timer.handle.start()"
            >▶</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 浮动按钮（关闭时显示） -->
  <button
    v-if="!visible"
    class="fixed bottom-6 right-6 z-50 min-w-[56px] h-12 px-3 rounded-full border shadow-lg flex flex-col items-center justify-center hover:scale-110 transition-transform"
    :class="stats.active > 0
      ? 'bg-green-500 text-white border-green-600'
      : 'bg-background border-border'"
    @click="visible = true"
    title="定时器控制面板"
  >
    <span class="text-sm leading-none">⏱</span>
    <span class="text-[10px] leading-tight font-mono">{{ stats.active }}/{{ stats.total }}</span>
    <span
      v-if="stats.active > 0"
      class="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 border-2 border-white animate-pulse"
    />
  </button>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useTimerManager } from '@/composables/useTimerManager.js'

const props = defineProps({
  defaultOpen: { type: Boolean, default: false }
})

const visible = ref(props.defaultOpen)
const position = ref({ x: window.innerWidth - 430, y: 500 })

const { timerStats, getAllTimers, pauseAll, resumeAll, stopAll } = useTimerManager()

const timers = computed(() => getAllTimers())
const stats = computed(() => timerStats.value)

const positionStyle = computed(() => ({
  left: position.value.x + 'px',
  top: position.value.y + 'px'
}))

// 拖拽
let _dragging = false
let _dragOffset = { x: 0, y: 0 }

function startDrag(e) {
  _dragging = true
  const rect = e.currentTarget.closest('.fixed').getBoundingClientRect()
  _dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top }
  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', stopDrag)
}

function onDrag(e) {
  if (!_dragging) return
  position.value = {
    x: Math.max(10, Math.min(window.innerWidth - 300, e.clientX - _dragOffset.x)),
    y: Math.max(10, Math.min(window.innerHeight - 100, e.clientY - _dragOffset.y))
  }
}

function stopDrag() {
  _dragging = false
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
}

function formatName(name) {
  const map = {
    monitor: '股价监控',
    volume: '量能检测',
    sector: '板块资金',
    dividend: '股息监控'
  }
  return map[name] || name
}

onMounted(() => {
  // 初始化位置
  if (position.value.x > window.innerWidth - 280) {
    position.value = { x: window.innerWidth - 280, y: 80 }
  }
})

onBeforeUnmount(() => {
  stopDrag()
})
</script>
