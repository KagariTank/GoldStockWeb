import { ref } from 'vue'

// 共享环境状态（模块级单例，跨所有 composable 同步）
const isFileProtocol = ref(false)
try {
  isFileProtocol.value = /^file:$/i.test(window.location.protocol)
} catch (e) {}

export function useEnv() {
  return { isFileProtocol }
}

export { isFileProtocol }
