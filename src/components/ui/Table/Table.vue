<script setup>
import { ref, provide, computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps({
  data: { type: Array, default: () => [] },
  class: { type: String, default: '' },
  loading: { type: Boolean, default: false }
})

const expandedRows = ref(new Set())

const toggleExpand = (rowKey) => {
  if (expandedRows.value.has(rowKey)) {
    expandedRows.value.delete(rowKey)
  } else {
    expandedRows.value.add(rowKey)
  }
}

const isExpanded = (rowKey) => expandedRows.value.has(rowKey)

provide('table', {
  expandedRows,
  toggleExpand,
  isExpanded
})
</script>

<template>
  <div class="relative w-full">
    <table :class="cn('w-full caption-bottom text-sm', props.class)">
      <slot />
    </table>
    <div v-if="loading" class="absolute inset-0 bg-background/80 flex items-center justify-center">
      <div class="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
    </div>
  </div>
</template>