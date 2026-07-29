<script setup>
import { inject } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps({
  class: { type: String, default: '' },
  rowKey: { type: [String, Number], default: '' }
})

const table = inject('table')

const isExpanded = () => {
  if (!table || !props.rowKey) return false
  return table.isExpanded(props.rowKey)
}

const toggleExpand = () => {
  if (!table || !props.rowKey) return
  table.toggleExpand(props.rowKey)
}
</script>

<template>
  <tr :class="cn('border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted', props.class)">
    <slot :isExpanded="isExpanded()" :toggleExpand="toggleExpand" />
  </tr>
</template>