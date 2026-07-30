<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const toasts = ref([])
let toastId = 0

const add = (options) => {
  const id = ++toastId
  const toast = {
    id,
    ...options,
    show: true
  }
  toasts.value.push(toast)
  
  setTimeout(() => {
    remove(id)
  }, options.duration || 4500)
  
  return id
}

const remove = (id) => {
  const index = toasts.value.findIndex(t => t.id === id)
  if (index !== -1) {
    toasts.value.splice(index, 1)
  }
}

const closeAll = () => {
  toasts.value = []
}

const getTypeClass = (type) => {
  const classes = {
    success: 'bg-green-500 text-white',
    warning: 'bg-yellow-500 text-white',
    error: 'bg-red-500 text-white',
    info: 'bg-blue-500 text-white'
  }
  return classes[type] || 'bg-slate-700 text-white'
}

// 暴露全局方法
defineExpose({
  add,
  remove,
  closeAll,
  success: (message, duration = 4500) => add({ type: 'success', message, duration }),
  warning: (message, duration = 4500) => add({ type: 'warning', message, duration }),
  error: (message, duration = 4500) => add({ type: 'error', message, duration }),
  info: (message, duration = 4500) => add({ type: 'info', message, duration })
})
</script>

<template>
  <Teleport to="body">
    <div class="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          :class="['px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 max-w-sm', getTypeClass(toast.type)]"
        >
          <span class="flex-1 text-sm">{{ toast.message }}</span>
          <button
            class="text-white/80 hover:text-white"
            @click="remove(toast.id)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(100%);
}
</style>