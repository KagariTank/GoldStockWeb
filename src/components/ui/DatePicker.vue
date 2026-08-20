<script setup>
import { ref, computed } from 'vue'
import { cn } from '@/lib/utils'
import Button from './Button.vue'
import { ChevronDown } from 'lucide-vue-next'

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '选择日期' },
  class: { type: String, default: '' }
})

const emit = defineEmits(['update:modelValue'])

const showPicker = ref(false)
const inputRef = ref(null)

const openPicker = () => {
  showPicker.value = true
  inputRef.value?.showPicker?.()
}

</script>

<template>
  <div class="relative inline-block">
    <input
      ref="inputRef"
      type="date"
      :value="modelValue"
      class="absolute inset-0 opacity-0 w-full cursor-pointer"
      @input="emit('update:modelValue', $event.target.value)"
    />
    <Button 
      variant="outline" 
      :class="cn('justify-start', props.class)"
      @click="openPicker"
    >
      <span v-if="modelValue">{{ modelValue }}</span>
      <span v-else class="text-muted-foreground">{{ placeholder }}</span>
      <ChevronDown class="ml-auto h-4 w-4 opacity-50" />
    </Button>
  </div>
</template>