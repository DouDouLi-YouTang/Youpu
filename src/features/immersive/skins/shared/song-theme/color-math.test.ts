import { describe, expect, it } from 'vitest'

import {
  adjustLightnessForContrast,
  clamp01,
  getContrastRatio,
  getHueDistance,
  getRelativeLuminance,
  hexToHsl,
  hslToHex,
  mixHexColors,
  normalizeHue,
  parseHexColor,
  rgbToHex,
  rgbToHsl
} from './color-math'

describe('parseHexColor', () => {
  it('解析 6 位十六进制', () => {
    expect(parseHexColor('#1c1917')).toEqual({ r: 28, g: 25, b: 23 })
    expect(parseHexColor('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('把 3 位十六进制展开成 6 位通道', () => {
    expect(parseHexColor('#abc')).toEqual({ r: 170, g: 187, b: 204 })
  })

  it('非十六进制输入一律返回 null（不抛错、不做半套兼容）', () => {
    for (const broken of [
      '',
      'red',
      'rgb(1, 2, 3)',
      '#12',
      '#12345',
      '#1234567',
      '#gggggg',
      ' #ffffff',
      null,
      undefined,
      42,
      {}
    ]) {
      expect(parseHexColor(broken)).toBeNull()
    }
  })
})

describe('rgbToHex', () => {
  it('通道越界时钳到 0–255 并四舍五入', () => {
    expect(rgbToHex({ r: -10, g: 300, b: 127.6 })).toBe('#00ff80')
  })
})

describe('RGB ↔ HSL', () => {
  it('灰阶的饱和度为 0、色相为 0', () => {
    expect(rgbToHsl({ r: 128, g: 128, b: 128 })).toEqual({ h: 0, s: 0, l: 128 / 255 })
  })

  it('纯红落在 0°、纯绿落在 120°、纯蓝落在 240°', () => {
    expect(rgbToHsl({ r: 255, g: 0, b: 0 }).h).toBeCloseTo(0, 6)
    expect(rgbToHsl({ r: 0, g: 255, b: 0 }).h).toBeCloseTo(120, 6)
    expect(rgbToHsl({ r: 0, g: 0, b: 255 }).h).toBeCloseTo(240, 6)
  })

  it('往返转换保持通道不变（误差在取整范围内）', () => {
    for (const hex of ['#000000', '#ffffff', '#1c1917', '#ea580c', '#09090b']) {
      const hsl = hexToHsl(hex)
      expect(hsl).not.toBeNull()
      expect(hslToHex(hsl!)).toBe(hex)
    }
  })
})

describe('normalizeHue / getHueDistance', () => {
  it('把任意角度折回 [0, 360)', () => {
    expect(normalizeHue(0)).toBe(0)
    expect(normalizeHue(360)).toBe(0)
    expect(normalizeHue(-90)).toBe(270)
    expect(normalizeHue(450)).toBe(90)
  })

  it('角距取最短弧（不会给出 > 180 的值）', () => {
    expect(getHueDistance(10, 350)).toBeCloseTo(20, 6)
    expect(getHueDistance(0, 180)).toBeCloseTo(180, 6)
    expect(getHueDistance(0, 90)).toBeCloseTo(90, 6)
  })
})

describe('clamp01', () => {
  it('钳到 [0, 1]', () => {
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(2)).toBe(1)
    expect(clamp01(0.4)).toBe(0.4)
  })
})

describe('getRelativeLuminance / getContrastRatio', () => {
  it('黑 0、白 1', () => {
    expect(getRelativeLuminance('#000000')).toBeCloseTo(0, 6)
    expect(getRelativeLuminance('#ffffff')).toBeCloseTo(1, 6)
  })

  it('黑白对比度是 21', () => {
    expect(getContrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
  })

  it('同色对比度是 1，且与顺序无关', () => {
    expect(getContrastRatio('#1c1917', '#1c1917')).toBeCloseTo(1, 6)
    expect(getContrastRatio('#ffffff', '#000000')).toBeCloseTo(
      getContrastRatio('#000000', '#ffffff'),
      6
    )
  })

  it('解析失败的输入返回有限的数值（不会 NaN）', () => {
    expect(Number.isFinite(getContrastRatio('red', '#ffffff'))).toBe(true)
    expect(Number.isFinite(getRelativeLuminance('#12345'))).toBe(true)
  })

  it('走的是 sRGB 反变换（不是通道直算）', () => {
    // 若直接用归一化通道当亮度，#0a0a0a 会得到 10/255 ≈ 0.0392；
    // sRGB 反变换把它压到 ≈ 0.003，差一个数量级。
    expect(getRelativeLuminance('#0a0a0a')).toBeLessThan(10 / 255 / 5)
    // 中灰同理：128/255 ≈ 0.502，反变换后 ≈ 0.216
    expect(getRelativeLuminance('#808080')).toBeLessThan(0.3)
  })
})

describe('mixHexColors', () => {
  it('0 → from、1 → to、0.5 → 中点', () => {
    expect(mixHexColors('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mixHexColors('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mixHexColors('#000000', '#ffffff', 0.5)).toBe('#808080')
  })

  it('amount 越界被钳住', () => {
    expect(mixHexColors('#000000', '#ffffff', -5)).toBe('#000000')
    expect(mixHexColors('#000000', '#ffffff', 5)).toBe('#ffffff')
  })

  it('任一端解析失败时二选一而不是画脏边', () => {
    expect(mixHexColors('red', '#ffffff', 0.9)).toBe('#ffffff')
    expect(mixHexColors('#000000', 'red', 0.1)).toBe('#000000')
    // 两端都坏则原样返回 from
    expect(mixHexColors('red', 'blue', 0.5)).toBe('red')
  })
})

describe('adjustLightnessForContrast', () => {
  it('满足地板时返回的色相对齐原色（只动亮度）', () => {
    const result = adjustLightnessForContrast('#808080', '#000000', 9)
    const hsl = hexToHsl(result)
    expect(hsl?.h).toBeCloseTo(0, 0)
    expect(getContrastRatio(result, '#000000')).toBeGreaterThanOrEqual(9)
  })

  it('背景亮时往暗推、背景暗时往亮推', () => {
    const onLight = adjustLightnessForContrast('#808080', '#ffffff', 4.5)
    const onDark = adjustLightnessForContrast('#808080', '#000000', 4.5)

    expect(getRelativeLuminance(onLight)).toBeLessThan(getRelativeLuminance(onDark))
    expect(getContrastRatio(onLight, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(getContrastRatio(onDark, '#000000')).toBeGreaterThanOrEqual(4.5)
  })

  it('地板高到不可达时返回过程中对比度最高的候选（而不是原色）', () => {
    const result = adjustLightnessForContrast('#7f7f7f', '#808080', 21)
    expect(getContrastRatio(result, '#808080')).toBeGreaterThanOrEqual(
      getContrastRatio('#7f7f7f', '#808080')
    )
  })

  it('无法解析的颜色原样返回', () => {
    expect(adjustLightnessForContrast('red', '#000000', 9)).toBe('red')
  })

  it('色相与饱和度在推的过程中保持不变', () => {
    const before = hexToHsl('#ea580c')!
    const after = hexToHsl(adjustLightnessForContrast('#ea580c', '#09090b', 3.2))!
    expect(after.h).toBeCloseTo(before.h, 1)
    expect(after.s).toBeCloseTo(before.s, 2)
  })
})
