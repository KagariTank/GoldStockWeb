<script setup>
import { computed, watch, onMounted, onUnmounted } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  width: { type: String, default: '500px' }
})

const emit = defineEmits(['update:modelValue'])

const close = () => emit('update:modelValue', false)

watch(() => props.modelValue, (val) => {
  if (val) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="fixed inset-0 z-50">
        <!-- Backdrop -->
        <div class="fixed inset-0 bg-black/80" @click="close"></div>
        
        <!-- Modal -->
        <div class="fixed left-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%]">
          <div 
            :style="{ width }"
            class="relative bg-background shadow-lg rounded-lg border max-h-[90vh] overflow-auto"
          >
            <!-- Header -->
            <div class="flex items-center justify-between p-4 border-b">
              <h2 class="text-lg font-semibold">{{ title }}</h2>
              <button 
                class="rounded-sm opacity-70 hover:opacity-100 transition-opacity"
                @click="close"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            
            <!-- Content -->
            <div class="p-4">
              <slot />
            </div>
            
            <!-- Footer -->
            <div v-if="$slots.footer" class="p-4 border-t flex justify-end gap-2">
              <slot name="footer" />
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-active .bg-background,
.modal-leave-active .bg-background {
  transition: transform 0.2s ease;
}

.modal-enter-from .bg-background,
.modal-leave-to .bg-background {
  transform: scale(0.95);
}
</style>