// 通知和语音模块

let _audioCtx = null;
let _voicesReady = false;
let _speechQueue = [];
let _speechBusy = false;

// Mac需要主动触发voices加载，且需要用户交互
export function initVoices(chineseVoices, selectedVoice) {
  if (!('speechSynthesis' in window)) return;

  try {
    // 主动触发voices加载
    const voices = window.speechSynthesis.getVoices && window.speechSynthesis.getVoices();

    // 筛选中文语音
    if (voices && voices.length > 0) {
      const zhVoices = voices.filter(v => /zh|chinese/i.test(v.lang || ''));
      chineseVoices.value = zhVoices;

      // 设置默认语音：优先美嘉，其次婷婷
      if (!selectedVoice.value && zhVoices.length > 0) {
        const meijiaVoice = zhVoices.find(v => v.name.includes('美嘉'));
        const tingtingVoice = zhVoices.find(v => v.name.includes('婷婷'));
        selectedVoice.value = (meijiaVoice || tingtingVoice || zhVoices[0]).name;
      }
    }

    // Mac首次可能返回空数组，需要等待事件
    if (voices && voices.length > 0) {
      _voicesReady = true;
      return;
    }

    // 设置事件监听
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = () => {
        const v = window.speechSynthesis.getVoices && window.speechSynthesis.getVoices();
        if (v && v.length > 0) {
          _voicesReady = true;
          // 更新中文语音列表
          const zhVoices = v.filter(voice => /zh|chinese/i.test(voice.lang || ''));
          chineseVoices.value = zhVoices;
          if (!selectedVoice.value && zhVoices.length > 0) {
            const tingtingVoice = zhVoices.find(voice => voice.name.includes('婷婷'));
            const meijiaVoice = zhVoices.find(voice => voice.name.includes('美嘉'));
            const googleVoice = zhVoices.find(voice => voice.name.includes('Google 普通话'));
            selectedVoice.value = (tingtingVoice || meijiaVoice || googleVoice || zhVoices[0]).name;
          }
        }
      };
    }

    // 备用定时器（某些Mac浏览器事件不触发）
    setTimeout(() => {
      if (!_voicesReady) {
        const v = window.speechSynthesis.getVoices && window.speechSynthesis.getVoices();
        if (v && v.length > 0) {
          const zhVoices = v.filter(voice => /zh|chinese/i.test(voice.lang || ''));
          chineseVoices.value = zhVoices;
          if (!selectedVoice.value && zhVoices.length > 0) {
            const googleVoice = zhVoices.find(voice => voice.name.includes('Google 普通话'));
            const tingtingVoice = zhVoices.find(voice => voice.name.includes('婷婷'));
            selectedVoice.value = (googleVoice || tingtingVoice || zhVoices[0]).name;
          }
        }
        _voicesReady = true;
      }
    }, 1000);
  } catch (e) {
    console.error('初始化语音引擎失败:', e);
  }
}

export function initAudio() {
  if (!_audioCtx) {
    try {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { _audioCtx = null; }
  }
  if (_audioCtx && _audioCtx.state === 'suspended') _audioCtx.resume();
}

export function playBeep(level = 1) {
  initAudio();
  if (!_audioCtx) return;
  const ctx = _audioCtx;
  const freqs = level === 1 ? [880] : level === 2 ? [1100, 980] : [660, 880, 1100, 990];
  const gain = ctx.createGain();
  gain.gain.value = 0.08;
  gain.connect(ctx.destination);
  let tStart = ctx.currentTime;
  freqs.forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const t0 = tStart + i * 0.13;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.08, t0 + 0.02);
    gain.gain.setValueAtTime(0.08, t0 + 0.1);
    gain.gain.linearRampToValueAtTime(0, t0 + 0.12);
    osc.connect(gain);
    osc.start(t0);
    osc.stop(t0 + 0.15);
  });
}

export function fireNotify(title, body, level, isFileProtocol, selectedVoice) {
  let shown = false;
  try {
    if (!isFileProtocol && 'Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification(title, {
        body,
        silent: false,
        requireInteraction: false
      });

      // Mac上通知可能需要事件处理
      notification.onclick = () => {
        notification.close();
        window.focus();
      };

      notification.onerror = (e) => {
        console.warn('通知显示失败:', e);
      };

      shown = true;
    }
  } catch (e) {
    console.error('发送通知失败:', e);
    shown = false;
  }
  try { ElementPlus.ElMessage({ type: 'warning', message: title + ' ' + body, duration: 4500, showClose: true, grouping: true }); } catch (e2) { }
  speakAlert(title, body, level, selectedVoice);
}

// Mac SpeechSynthesis修复：强制唤醒引擎
function wakeUpSpeechSynthesis() {
  if (!('speechSynthesis' in window)) return;

  // Mac修复：播放一个静音的utterance来"唤醒"引擎
  try {
    const dummy = new SpeechSynthesisUtterance('');
    dummy.volume = 0;
    dummy.rate = 10; // 极快播放
    window.speechSynthesis.speak(dummy);
  } catch (e) { }

  // 强制刷新引擎状态
  window.speechSynthesis.pause();
  window.speechSynthesis.resume();
}

// Mac SpeechSynthesis修复：队列播放 + 状态恢复
function processNextSpeech(selectedVoice) {
  if (_speechBusy || _speechQueue.length === 0) return;

  const item = _speechQueue.shift();
  if (!item) return;

  _speechBusy = true;
  const { text, level } = item;

  const doSpeak = () => {
    // 调试：打印可用的voices
    const voices = window.speechSynthesis.getVoices && window.speechSynthesis.getVoices();
    console.log('可用的语音列表:', voices ? voices.length : 0);
    if (voices && voices.length > 0) {
      const zhVoices = voices.filter(v => /zh|chinese/i.test(v.lang || ''));
      console.log('中文语音:', zhVoices.map(v => `${v.name}(${v.lang})`));
    }

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'zh-CN';
    utter.rate = 1.0;
    utter.pitch = 1.0;
    utter.volume = 1.0;

    // 使用用户选择的语音
    let voiceToUse = null;
    if (selectedVoice.value && voices && voices.length) {
      voiceToUse = voices.find(v => v.name === selectedVoice.value);
      if (voiceToUse) {
        console.log('使用选择的语音:', voiceToUse.name, voiceToUse.lang);
      }
    }

    // 如果用户没有选择，使用默认逻辑
    if (!voiceToUse && voices && voices.length) {
      const tingtingVoice = voices.find(v => v.name.includes('婷婷') && v.lang === 'zh-CN');
      const meijiaVoice = voices.find(v => v.name.includes('美嘉'));
      const googleVoice = voices.find(v => v.name.includes('Google 普通话'));
      const zhCNVoice = voices.find(v => v.lang === 'zh-CN');

      voiceToUse = tingtingVoice || meijiaVoice || googleVoice || zhCNVoice;
      if (voiceToUse) {
        console.log('使用默认语音:', voiceToUse.name, voiceToUse.lang);
      }
    }

    if (voiceToUse) {
      utter.voice = voiceToUse;
    } else {
      console.warn('未找到合适的语音，使用默认');
    }

    let completed = false;
    let started = false;
    const startTime = Date.now();

    const timeout = setTimeout(() => {
      if (!completed) {
        const elapsed = Date.now() - startTime;
        console.warn(`语音播放超时(${elapsed}ms)，引擎状态: speaking=${window.speechSynthesis.speaking}, paused=${window.speechSynthesis.paused}, started=${started}`);
        completed = true;
        window.speechSynthesis.cancel();
        _speechBusy = false;
        playBeep(level);
        setTimeout(() => processNextSpeech(selectedVoice), 100);
      }
    }, 8000);

    utter.onstart = () => {
      started = true;
      console.log('语音开始播放');
    };

    utter.onend = () => {
      const elapsed = Date.now() - startTime;
      console.log(`语音播放完成(${elapsed}ms)`);
      completed = true;
      clearTimeout(timeout);
      _speechBusy = false;
      setTimeout(() => processNextSpeech(selectedVoice), 100);
    };

    utter.onerror = (e) => {
      if (!completed) {
        const elapsed = Date.now() - startTime;
        console.error(`语音播放错误(${elapsed}ms):`, e.error, e);
        completed = true;
        clearTimeout(timeout);
        _speechBusy = false;
        playBeep(level);
        setTimeout(() => processNextSpeech(selectedVoice), 100);
      }
    };

    // Mac修复：强制清空引擎状态
    window.speechSynthesis.cancel();

    // Mac修复：多次调用cancel确保清空
    setTimeout(() => window.speechSynthesis.cancel(), 50);
    setTimeout(() => window.speechSynthesis.cancel(), 100);

    // Mac修复：唤醒引擎
    setTimeout(() => {
      wakeUpSpeechSynthesis();

      // 再延迟一下播放
      setTimeout(() => {
        try {
          console.log('开始调用speak()，文本:', text.substring(0, 20) + '...');
          window.speechSynthesis.speak(utter);

          // Mac修复：如果引擎卡住，检测并强制恢复
          const checkStart = setTimeout(() => {
            if (!started && !completed) {
              console.warn('引擎未启动，尝试强制恢复...');
              window.speechSynthesis.cancel();
              window.speechSynthesis.pause();
              window.speechSynthesis.resume();
            }
          }, 500);

          // 清理检测器
          const cleanup = () => clearTimeout(checkStart);
          if (completed) cleanup();
        } catch (e) {
          console.error('语音合成调用失败:', e);
          completed = true;
          clearTimeout(timeout);
          _speechBusy = false;
          playBeep(level);
          setTimeout(() => processNextSpeech(selectedVoice), 100);
        }
      }, 150);
    }, 150);
  };

  // 等待voices准备好
  if (!_voicesReady && window.speechSynthesis.getVoices) {
    const checkVoices = (attempts = 0) => {
      const v = window.speechSynthesis.getVoices();
      if (v && v.length > 0) {
        _voicesReady = true;
        console.log('Voices加载完成，数量:', v.length);
        doSpeak();
      } else if (attempts < 10) {
        setTimeout(() => checkVoices(attempts + 1), 100);
      } else {
        console.warn('Voices未加载，使用默认设置');
        _voicesReady = true;
        doSpeak();
      }
    };
    checkVoices();
  } else {
    doSpeak();
  }
}

export function speakAlert(title, body, level, selectedVoice) {
  initAudio();

  try {
    if ('speechSynthesis' in window) {
      const cleanText = (title + '。' + body).replace(/[⚠️✅📈📉🔻🟠🔔📋]+/g, '').replace(/\s+/g, ' ').trim();
      if (!cleanText) {
        playBeep(level);
        return;
      }

      // 添加到队列
      _speechQueue.push({ text: cleanText, level });

      // 如果队列过长，移除旧的（避免内存泄漏）
      if (_speechQueue.length > 10) {
        _speechQueue.shift();
      }

      // 开始处理队列
      processNextSpeech(selectedVoice);
      return;
    }
  } catch (e) {
    console.error('语音合成失败:', e);
  }

  playBeep(level);
}

export function testNotify(isFileProtocol, selectedVoice) {
  initAudio();
  if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      fireNotify('🔔 指标提醒测试', '通知与语音通道正常。您将在触发阈值时收到提醒。', 2, isFileProtocol, selectedVoice);
    } else if (Notification.permission === 'denied') {
      ElementPlus.ElMessage.error('通知权限已被拒绝。请点击浏览器地址栏左侧 🔒 图标手动开启通知权限后再试。下方仍提供语音与站内提醒。');
      speakAlert('指标提醒测试', '站内提醒与语音通道正常。如需要系统通知请手动开启浏览器权限。', 2, selectedVoice);
    } else {
      ElementPlus.ElMessage.info('即将请求系统通知权限。请在弹窗中点"允许"，请求后将立即发送一条测试通知。');
      try {
        Notification.requestPermission().then(r => {
          setTimeout(() => {
            if (r === 'granted') {
              fireNotify('🔔 指标提醒测试', '通知权限已开启。语音与系统通知通道正常。', 2, isFileProtocol, selectedVoice);
            } else {
              ElementPlus.ElMessage.warning('未开启系统通知，将自动降级为站内消息提醒 + 语音播报。');
              speakAlert('指标提醒测试', '语音播报通道正常。系统通知未开启时将使用站内提醒。', 2, selectedVoice);
            }
          }, 150);
        });
      } catch (e) {
        speakAlert('指标提醒测试', '语音播报通道正常。', 2, selectedVoice);
      }
    }
  } else {
    ElementPlus.ElMessage.warning('当前浏览器不支持系统通知，将使用站内消息 + 语音提醒。');
    speakAlert('指标提醒测试', '语音播报通道正常。', 2, selectedVoice);
  }
}

export async function ensureNotifyPerm() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    const r = await Notification.requestPermission();
    return r === 'granted';
  } catch (e) { return false; }
}