<script setup>
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps({
  tabs: { type: Array, default: () => [] },
  modelValue: { type: String, default: '' },
  class: { type: String, default: '' }
})

const emit = defineEmits(['update:modelValue'])

const activeTab = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})
</script>

<template>
  <div :class="cn('w-full flex flex-col overflow-hidden', props.class)">
    <div class="flex border-b">
      <button
        v-for="tab in tabs"
        :key="tab.value"
        :class="cn(
          'px-4 py-2 text-sm font-medium transition-colors',
          activeTab === tab.value 
            ? 'border-b-2 border-primary text-primary' 
            : 'text-muted-foreground hover:text-foreground'
        )"
        @click="activeTab = tab.value"
      >
        {{ tab.label }}
      </button>
    </div>
    <div class="mt-4 flex-1 overflow-hidden">
      <slot :activeTab="activeTab" />
    </div>
  </div>
</template>