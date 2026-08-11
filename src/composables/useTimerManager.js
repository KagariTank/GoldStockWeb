import { ref, computed } from 'vue'

// ===== 全局定时器注册表 =====
const _timers = new Map()

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
 * 创建一个自动刷新定时器
 */
export function createAutoRefreshTimer(name, config) {
  // 如果已存在同名定时器，先销毁
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
  const intervalDuration = ref(refreshInterval)

  let _timeoutId = null
  let _remainingMs = intervalDuration.value * 1000
  let _lastTickTime = 0

  function tick() {
    if (!isActive.value) return
    if (_globalPause.value) {
      // 暂停时不递减倒计时，但保持定时器运行
      scheduleNext(1000)
      return
    }

    const now = Date.now()
    const elapsed = now - _lastTickTime
    _lastTickTime = now

    _remainingMs -= elapsed
    
    if (_remainingMs <= 0) {
      // 触发刷新
      const shouldDoRefresh = !shouldRefresh || shouldRefresh()
      if (shouldDoRefresh) {
        onRefresh && onRefresh()
      }
      // 重置倒计时
      _remainingMs = intervalDuration.value * 1000
      countdown.value = intervalDuration.value
    } else {
      // 更新显示的倒计时（向下取整到秒）
      countdown.value = Math.ceil(_remainingMs / 1000)
    }

    // 下一次检查在 1 秒后
    scheduleNext(1000)
  }

  function scheduleNext(delayMs) {
    if (_timeoutId) {
      clearTimeout(_timeoutId)
    }
    _timeoutId = setTimeout(() => {
      tick()
    }, delayMs)
  }

  function start() {
    if (isActive.value) return
    if (_timeoutId) return  // 防止重复启动

    if (onStart) onStart()
    isActive.value = true
    _remainingMs = intervalDuration.value * 1000
    countdown.value = intervalDuration.value
    _lastTickTime = Date.now()

    // 立即执行一次
    if (!_globalPause.value) {
      const shouldDoRefresh = !shouldRefresh || shouldRefresh()
      if (shouldDoRefresh) {
        onRefresh && onRefresh()
      }
      _remainingMs = intervalDuration.value * 1000
      countdown.value = intervalDuration.value
    }

    // 启动定时器
    scheduleNext(1000)
    console.log(`[定时器] ${name} 已启动, 间隔: ${intervalDuration.value}s`)
    updateStats()
  }

  function stop() {
    if (!isActive.value) return
    
    isActive.value = false
    countdown.value = intervalDuration.value
    
    if (_timeoutId) {
      clearTimeout(_timeoutId)
      _timeoutId = null
    }
    
    if (onStop) onStop()
    updateStats()
  }

  function toggle() {
    if (isActive.value) stop()
    else start()
  }

  function resetCountdown() {
    _remainingMs = intervalDuration.value * 1000
    countdown.value = intervalDuration.value
  }

  function setInterval(newInterval) {
    intervalDuration.value = newInterval
    countdown.value = newInterval
    if (isActive.value) {
      _remainingMs = newInterval * 1000
    }
  }

  const handle = {
    isActive,
    countdown,
    start,
    stop,
    toggle,
    resetCountdown,
    refreshInterval: intervalDuration,
    name,
    updateInterval: setInterval
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
 * 获取所有定时器
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
