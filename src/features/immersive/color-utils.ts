/**
 * 从参考项目 color-utils.js 移植的颜色工具。仅保留 gradient 背景模式所需的函数
 * （getGradientFromPalette 及其依赖链），逐字移植，不重新设计算法。
 *
 * 用途：gradient 背景从 ColorThief 取得的色盘构造 CSS 渐变字符串。
 */

type RGB = [number, number, number]

export const rgb2Hsl = ([r, g, b]: RGB): number[] => {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2

  if (max === min) {
    return [0, 0, l]
  }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  switch (max) {
    case r:
      h = (g - b) / d + (g < b ? 6 : 0)
      break
    case g:
      h = (b - r) / d + 2
      break
    default:
      h = (r - g) / d + 4
      break
  }
  h /= 6
  return [h, s, l]
}

export const calcLuminance = (color: number[]): number => {
  let [r, g, b] = color.map((c) => c / 255)
  ;[r, g, b] = [r, g, b].map((c) => {
    if (c <= 0.03928) {
      return c / 12.92
    }
    return Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export const rgb2Lab = (color: number[]): number[] => {
  let [r, g, b] = color.map((c) => c / 255)
  ;[r, g, b] = [r, g, b].map((c) => {
    if (c <= 0.03928) {
      return c / 12.92
    }
    return Math.pow((c + 0.055) / 1.055, 2.4)
  })
  ;[r, g, b] = [r, g, b].map((c) => c * 100)
  const x = r * 0.4124 + g * 0.3576 + b * 0.1805
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722
  const z = r * 0.0193 + g * 0.1192 + b * 0.9505
  const xyz2Lab = (c: number): number => {
    if (c > 0.008856) {
      return Math.pow(c, 1 / 3)
    }
    return 7.787 * c + 16 / 116
  }
  const L = 116 * xyz2Lab(y / 100) - 16
  const A = 500 * (xyz2Lab(x / 95.047) - xyz2Lab(y / 100))
  const B = 200 * (xyz2Lab(y / 100) - xyz2Lab(z / 108.883))
  return [L, A, B]
}

export const calcColorDifference = (color1: number[], color2: number[]): number => {
  const [L1, A1, B1] = rgb2Lab(color1)
  const [L2, A2, B2] = rgb2Lab(color2)
  const deltaL = L1 - L2
  const deltaA = A1 - A2
  const deltaB = B1 - B2
  return Math.sqrt(deltaL * deltaL + deltaA * deltaA + deltaB * deltaB)
}

/**
 * 从色盘构造 -45deg 线性渐变。
 * 算法：按亮度排序取中间 8 个 → 按饱和度排序取前 6 → DFS 枚举 6! 排列找
 * 相邻色差最大值最小的排列 → 拼成 linear-gradient(-45deg, ...)。
 */
export const getGradientFromPalette = (paletteRaw: number[][]): string => {
  if (!paletteRaw || paletteRaw.length === 0) {
    return 'linear-gradient(-45deg, #666, #fff)'
  }

  // 1. Sort by luminance and take middle range
  let palette = [...paletteRaw].sort((a, b) => calcLuminance(a) - calcLuminance(b))
  const midStart = Math.max(0, Math.floor(palette.length / 2) - 4)
  const midEnd = Math.min(palette.length, midStart + 8)
  palette = palette.slice(midStart, midEnd)

  // 2. Sort by HSL saturation and take top 6 (or less if not enough colors)
  palette = palette.sort((a, b) => rgb2Hsl(b as RGB)[1] - rgb2Hsl(a as RGB)[1])
  const N = Math.min(palette.length, 6)
  palette = palette.slice(0, N)

  if (N === 0) {
    return 'linear-gradient(-45deg, #666, #fff)'
  }
  if (N === 1) {
    const c = palette[0]
    return `linear-gradient(-45deg, rgb(${c[0]}, ${c[1]}, ${c[2]}), rgb(${Math.max(0, c[0] - 40)}, ${Math.max(0, c[1] - 40)}, ${Math.max(0, c[2] - 40)}))`
  }

  // 3. Compute differences between active colors
  const differences: number[][] = Array.from({ length: N }, () => new Array(N).fill(0))
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      differences[i][j] = calcColorDifference(palette[i], palette[j])
      differences[j][i] = differences[i][j]
    }
  }

  // 4. DFS to find optimal sequence
  const used = new Array(N).fill(false)
  let min = 10000000
  let ansSeq: number[] = []

  const dfs = (depth: number, seq: number[] = [], currentMax = -1): void => {
    if (depth === N) {
      if (currentMax < min) {
        min = currentMax
        ansSeq = seq
      }
      return
    }
    for (let i = 0; i < N; i++) {
      if (used[i]) continue
      used[i] = true
      const prev = seq[depth - 1]
      dfs(depth + 1, seq.concat(i), Math.max(currentMax, differences[prev][i]))
      used[i] = false
    }
  }

  for (let i = 0; i < N; i++) {
    used[i] = true
    dfs(1, [i])
    used[i] = false
  }

  // 5. Build gradient string
  const colors: number[][] = []
  for (const idx of ansSeq) {
    colors.push(palette[idx])
  }

  let ans = 'linear-gradient(-45deg,'
  for (let i = 0; i < colors.length; i++) {
    ans += `rgb(${colors[i][0]}, ${colors[i][1]}, ${colors[i][2]})`
    if (i !== colors.length - 1) {
      ans += ','
    }
  }
  ans += ')'
  return ans
}
