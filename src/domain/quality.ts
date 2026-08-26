import type { PlayableLevel } from './player'

/**
 * 音质档位与展示名称的单一来源。播放栏、沉浸控制条、设置页共用此映射，
 * 避免出现「Hi-Res / 无损 FLAC」等不一致命名。
 */
export const QUALITY_OPTIONS: ReadonlyArray<{ value: PlayableLevel; label: string }> = [
  { value: 'standard', label: '标准' },
  { value: 'exhigh', label: '极高' },
  { value: 'lossless', label: '无损' },
  { value: 'hires', label: 'Hi-Res' }
]

export const QUALITY_LABELS: Record<PlayableLevel, string> = {
  standard: '标准',
  exhigh: '极高',
  lossless: '无损',
  hires: 'Hi-Res'
}

export function qualityLabel(level: PlayableLevel | null | undefined): string {
  if (!level) return '标准'
  return QUALITY_LABELS[level] ?? '标准'
}
