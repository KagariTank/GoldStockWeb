<script setup>
import { cn } from '@/lib/utils'

const props = defineProps({
  label: { type: String, default: '' },
  class: { type: String, default: '' }
})
</script>

<template>
  <div :class="cn('space-y-2', props.class)">
    <label class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
      {{ label }}
    </label>
    <slot />
  </div>
</template>