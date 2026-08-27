import { ref, computed } from 'vue'

// ===== 全局定时器注册表 =====
const _timers = new Map()

// ===== 全局状态 =====
const _globalPause = ref(false)

// ===== 统计信息 =====
const timerStats = ref({ total: 0, active: 0, paused: 0 })
// 响应式版本号：_timers 注册表变动时自增，供 UI 的 timers 列表依赖刷新
const _timersVersion = ref(0)

function updateStats() {
  let active = 0
  let paused = 0
  for (const [, t] of _timers) {
    if (t.handle.isActive.value) active++
    else paused++
  }
  timerStats.value = { total: _timers.size, active, paused }
  _timersVersion.value++
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

    // 若已被 stopAll/destroyTimer 从注册表移除（composable 仍持有句柄闭包），重新注册，
    // 否则会形成"实际在跑但面板看不到/控制不了"的幽灵定时器
    if (!_timers.has(name)) {
      _timers.set(name, { handle, config: { refreshInterval, initialCountdown } })
      _timersVersion.value++  // 注册表变化，显式自增版本号
    }

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
  // 注册后立即刷新统计，否则面板 stats 与实际注册表不同步（按钮显示/隐藏异常）
  updateStats()
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
  _timersVersion.value++  // 暂停会影响每个定时器的 UI 状态，显式刷新
}

/**
 * 恢复所有定时器
 */
export function resumeAll() {
  _globalPause.value = false
  _timersVersion.value++  // 恢复也会影响 UI 状态，显式刷新
}

/**
 * 停止所有定时器（保留注册表，可重新启动）
 * 注意：不能调用 destroyTimer（会从注册表删除），否则面板会显示"暂无注册的定时器"，
 * 用户将失去重新启动任何定时器的入口。
 */
export function stopAll() {
  for (const [, t] of _timers) {
    t.handle.stop()
  }
  _timersVersion.value++  // 全部停止影响每个定时器 UI 状态，显式刷新
}

/**
 * 获取所有定时器（响应式：注册表变动时返回新数组，供面板列表使用）
 */
export function getAllTimers() {
  // 读取版本号，建立响应式依赖
  void _timersVersion.value
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
