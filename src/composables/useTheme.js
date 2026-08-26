import { ref, watch, onMounted, onUnmounted } from 'vue'

const isDark = ref(false)
const THEME_KEY = 'theme_mode'

// 获取系统主题偏好
function getSystemPreference() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

// 应用主题
function applyTheme(dark) {
  if (dark) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

// 初始化主题
function initTheme() {
  // 优先从 localStorage 读取
  const saved = localStorage.getItem(THEME_KEY)
  if (saved !== null) {
    isDark.value = saved === 'dark'
  } else {
    // 没有保存则使用系统偏好
    isDark.value = getSystemPreference()
  }
  applyTheme(isDark.value)
}

// 切换主题
function toggleTheme() {
  isDark.value = !isDark.value
  applyTheme(isDark.value)
  localStorage.setItem(THEME_KEY, isDark.value ? 'dark' : 'light')
}

// 系统主题变化回调（具名函数，便于移除）
function onSystemThemeChange(e) {
  // 只有在用户没有手动设置过主题时才跟随系统
  if (localStorage.getItem(THEME_KEY) === null) {
    isDark.value = e.matches
    applyTheme(e.matches)
  }
}

// 导出 composable
export function useTheme() {
  let _media = null

  onMounted(() => {
    initTheme()
    _media = window.matchMedia('(prefers-color-scheme: dark)')
    _media.addEventListener('change', onSystemThemeChange)
  })

  onUnmounted(() => {
    if (_media) {
      _media.removeEventListener('change', onSystemThemeChange)
    }
  })

  return {
    isDark,
    toggleTheme
  }
}