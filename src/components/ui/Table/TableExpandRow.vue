<script setup>
import { cn } from '@/lib/utils'
import TableRow from './TableRow.vue'

const props = defineProps({
  class: { type: String, default: '' },
  expand: { type: Boolean, default: false }
})
</script>

<template>
  <TableRow :class="cn('bg-muted/50', props.class)">
    <td colspan="100%" class="p-0">
      <div class="p-4">
        <slot />
      </div>
    </td>
  </TableRow>
</template>