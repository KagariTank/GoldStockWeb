// Toast 全局实例
let _toastInstance = null

export function setToastInstance(instance) {
  _toastInstance = instance
}

export function showToast(options) {
  if (_toastInstance) {
    return _toastInstance.add(options)
  }
  // 降级到 console
  console.log('[Toast]', options.message)
}

export function toastSuccess(message, duration = 4500) {
  return showToast({ type: 'success', message, duration })
}

export function toastWarning(message, duration = 4500) {
  return showToast({ type: 'warning', message, duration })
}

export function toastError(message, duration = 4500) {
  return showToast({ type: 'error', message, duration })
}

export function toastInfo(message, duration = 4500) {
  return showToast({ type: 'info', message, duration })
}

export function closeAllToasts() {
  if (_toastInstance) {
    _toastInstance.closeAll()
  }
}