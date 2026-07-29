<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { cn } from '@/lib/utils'
import Button from './Button.vue'

const props = defineProps({
  items: { type: Array, default: () => [] },
  class: { type: String, default: '' }
})

const emit = defineEmits(['select'])

const isOpen = ref(false)
const dropdownRef = ref(null)

const toggle = () => isOpen.value = !isOpen.value
const close = () => isOpen.value = false

const selectItem = (item) => {
  emit('select', item)
  close()
}

onMounted(() => {
  const handleClickOutside = (e) => {
    if (dropdownRef.value && !dropdownRef.value.contains(e.target)) {
      close()
    }
  }
  document.addEventListener('click', handleClickOutside)
  onUnmounted(() => document.removeEventListener('click', handleClickOutside))
})
</script>

<template>
  <div ref="dropdownRef" class="relative inline-block">
    <slot name="trigger" :toggle="toggle" :isOpen="isOpen">
      <Button variant="outline" @click="toggle">
        <slot name="label">选择</slot>
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ml-2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </Button>
    </slot>
    
    <Transition name="dropdown">
      <div v-if="isOpen" :class="cn('absolute z-50 mt-1 min-w-[160px] rounded-md border bg-background shadow-lg', props.class)">
        <div class="p-1">
          <slot :selectItem="selectItem" :close="close">
            <button
              v-for="(item, index) in items"
              :key="index"
              class="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-accent transition-colors"
              @click="selectItem(item)"
            >
              {{ item.label || item }}
            </button>
          </slot>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>