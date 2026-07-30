<script setup>
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  placeholder: { type: String, default: '' },
  rows: { type: Number, default: 3 },
  class: { type: String, default: '' }
})

const emit = defineEmits(['update:modelValue'])

const textareaClass = computed(() => {
  return cn(
    'flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
    props.class
  )
})
</script>

<template>
  <textarea
    :value="modelValue"
    :placeholder="placeholder"
    :rows="rows"
    :class="textareaClass"
    @input="emit('update:modelValue', $event.target.value)"
  ></textarea>
</template>