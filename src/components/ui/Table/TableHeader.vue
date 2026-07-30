<script setup>
import { cn } from '@/lib/utils'

const props = defineProps({
  class: { type: String, default: '' }
})
</script>

<template>
  <thead :class="cn('sticky top-0 bg-background z-10 [&_tr]:border-b', props.class)">
    <slot />
  </thead>
</template>