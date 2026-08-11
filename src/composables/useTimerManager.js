import { ref, computed } from 'vue'

// ===== 全局定时器注册表 =====
const _timers = new Map()  // { name: { handle, config } }

// ===== 全局状态 =====
const _globalPause = ref(false)

// ===== 统计信息 =====
const timerStats = ref({ total: 0, active: 0, paused: 0 })

function updateStats() {
  let active = 0
  let paused = 0
  for (const [, t] of _timers) {
    if (t.handle.isActive.value) active++
    else paused++
  }
  timerStats.value = { total: _timers.size, active, paused }
}

/**
 * 创建一个自动刷新定时器组
 */
export function createAutoRefreshTimer(name, config) {
  if (_timers.has(name)) {
    destroyTimer(name)
  }

  const {
    onRefresh,
    refreshInterval = 30,
    initialCountdown = 30,
    onStart,
    onStop,
    shouldRefresh
  } = config

  const isActive = ref(false)
  const countdown = ref(initialCountdown)
  const countdownFrom = ref(initialCountdown)

  let _intervalId = null
  let _countdownId = null

  function start() {
    if (isActive.value) return
    if (onStart) onStart()
    isActive.value = true
    countdown.value = countdownFrom.value

    _countdownId = setInterval(() => {
      if (_globalPause.value) return
      countdown.value--
      if (countdown.value <= 0) countdown.value = countdownFrom.value
    }, 1000)

    _intervalId = setInterval(() => {
      if (_globalPause.value) return
      if (!shouldRefresh || shouldRefresh()) {
        onRefresh && onRefresh()
      }
    }, refreshInterval.value * 1000)

    if (!_globalPause.value) {
      onRefresh && onRefresh()
    }

    updateStats()
  }

  function stop() {
    if (!isActive.value) return
    isActive.value = false
    countdown.value = countdownFrom.value
    if (_intervalId) { clearInterval(_intervalId); _intervalId = null }
    if (_countdownId) { clearInterval(_countdownId); _countdownId = null }
    if (onStop) onStop()
    updateStats()
  }

  function toggle() {
    if (isActive.value) stop()
    else start()
  }

  function resetCountdown() {
    countdown.value = countdownFrom.value
  }

  const handle = {
    isActive,
    countdown,
    start,
    stop,
    toggle,
    resetCountdown,
    refreshInterval,
    name,
    updateInterval(newInterval) {
      if (!isActive.value) return
      // 停止旧的 interval
      if (_intervalId) {
        clearInterval(_intervalId)
        _intervalId = null
      }
      // 更新配置
      refreshInterval.value = newInterval
      countdownFrom.value = newInterval
      // 启动新的 interval
      _intervalId = setInterval(() => {
        if (_globalPause.value) return
        if (!shouldRefresh || shouldRefresh()) {
          onRefresh && onRefresh()
        }
      }, newInterval * 1000)
      // 更新存储的配置
      _timers.set(name, { handle, config: { refreshInterval: newInterval, initialCountdown: newInterval } })
    }
  }

  _timers.set(name, { handle, config: { refreshInterval, initialCountdown } })

  return handle
}

/**
 * 销毁定时器
 */
export function destroyTimer(name) {
  const entry = _timers.get(name)
  if (entry) {
    entry.handle.stop()
    _timers.delete(name)
    updateStats()
  }
}

/**
 * 暂停所有定时器
 */
export function pauseAll() {
  _globalPause.value = true
}

/**
 * 恢复所有定时器
 */
export function resumeAll() {
  _globalPause.value = false
}

/**
 * 停止所有定时器
 */
export function stopAll() {
  for (const [name] of _timers) {
    destroyTimer(name)
  }
}

/**
 * 获取所有定时器（含控制句柄，用于控制面板）
 */
export function getAllTimers() {
  const result = []
  for (const [name, t] of _timers) {
    result.push({
      name,
      isActive: t.handle.isActive,
      countdown: t.handle.countdown,
      refreshInterval: t.handle.refreshInterval,
      handle: t.handle
    })
  }
  return result
}

/**
 * 获取单个定时器句柄
 */
export function getTimerHandle(name) {
  return _timers.get(name)?.handle || null
}

/**
 * 定时器统计
 */
export function useTimerManager() {
  return {
    timerStats: computed(() => timerStats.value),
    globalPause: computed(() => _globalPause.value),
    getAllTimers,
    getTimerHandle,
    pauseAll,
    resumeAll,
    stopAll
  }
}
