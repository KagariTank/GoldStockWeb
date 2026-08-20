<script setup>
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps({
  modelValue: { type: [Number, String], default: 0 },
  min: { type: Number, default: 0 },
  max: { type: Number, default: Infinity },
  step: { type: Number, default: 1 },
  precision: { type: Number, default: 0 },
  class: { type: String, default: '' }
})

const emit = defineEmits(['update:modelValue'])

const inputClass = computed(() => {
  return cn(
    'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
    props.class
  )
})

</script>

<template>
  <input
    type="number"
    :value="modelValue"
    :min="min"
    :max="max"
    :step="step"
    :class="inputClass"
    @input="emit('update:modelValue', parseFloat($event.target.value) || 0)"
  />
</template>