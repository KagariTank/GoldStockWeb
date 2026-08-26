import { ref } from 'vue'

// 共享语音选择状态（模块级单例，跨所有 composable 同步）
const selectedVoice = ref('')

export function useVoice() {
  return { selectedVoice }
}

export { selectedVoice }
