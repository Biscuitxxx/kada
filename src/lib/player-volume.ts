// 播放音量记忆：把用户拖过的音量存到 localStorage，下次打开同一个浏览器还是这个音量。
// 之前每次进详情页都是浏览器默认的 100%，声音一开就炸，所以这里统一收口。

const VOLUME_KEY = "pianxia.player.volume";

/** 没存过音量时的起始值：不吵人，第一次进来也不会炸耳朵。想恢复浏览器默认就改成 1。 */
const DEFAULT_VOLUME = 0.6;

function readSavedVolume(): number | null {
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    if (raw === null) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return null;
    return parsed;
  } catch {
    // 隐私模式 / 禁用存储时按「没存过」处理，不影响播放
    return null;
  }
}

/**
 * 给 <video> 挂上音量记忆：挂载时套用上次的音量，之后每次音量变化都写回去。
 * 返回清理函数，路由切换或组件卸载时解绑监听。
 */
export function attachVolumeMemory(el: HTMLVideoElement): () => void {
  const saved = readSavedVolume();
  el.volume = saved ?? DEFAULT_VOLUME;
  // 不要顺带把静音状态写死：上次静音了这次还静音会让人以为没声音
  el.muted = false;

  const onVolumeChange = () => {
    try {
      window.localStorage.setItem(VOLUME_KEY, String(el.volume));
    } catch {
      // 存不下就算了，本页内的音量调节仍然生效
    }
  };
  el.addEventListener("volumechange", onVolumeChange);
  return () => el.removeEventListener("volumechange", onVolumeChange);
}

/** 清掉记忆的音量（调试或「恢复默认」时用） */
export function clearVolumeMemory(): void {
  try {
    window.localStorage.removeItem(VOLUME_KEY);
  } catch {
    // 忽略
  }
}
