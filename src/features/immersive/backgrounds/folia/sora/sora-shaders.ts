/**
 * sora 的 GLSL —— 按规格 §6.2 的公式**自行重写**（不是从 Folia 抄字符串）。
 *
 * 为什么把两个 shader 抽成常量而不是写在组件里：
 *  1. 公式里的每个魔数（0.008 / 0.024 / 0.0006 / 0.0032 / 3.8 / 3.5 / 0.3 / 0.7 …）
 *     都是「被验证过的观感参数」，散在组件模板旁边很难看出哪些能调、哪些不能；
 *  2. 组件里只留 WebGL 调用，模板层看不到 GLSL。
 *
 * ## 设计要点（改动会直接改变星空观感）
 *
 * - **全部随机量都在顶点着色器里用 hash 现算**，CPU 侧只上传一个 `a_index`（0..149）。
 *   150 个粒子一次 draw call 画完，不占主线程。
 * - **只有 X 随 `u_time` 变化**，且用 `fract()` 循环：星点从右侧穿出后回到左侧。
 * - `gl_PointSize` 按**画布高度**缩放（`× u_resolution.y × 3.5`），保证不同分辨率下
 *   星点与屏幕的比例一致；下限 2px 防止高 DPI 小窗里星点消失。
 * - `size = 0.0006 + 0.0032 * pow(size_rand, 3.8)` 的 3.8 次幂让大多数点很小、
 *   极少数很大 —— 这是「夜空」而非「均匀噪点」的关键，不要「顺手」调成平方。
 * - 片元输出**预乘 alpha**（`baseColor * alpha, alpha`），所以混合函数必须是
 *   `ONE, ONE_MINUS_SRC_ALPHA`。Folia 的注释写的是 "additive blending"，
 *   但代码用的是标准预乘混合（规格 §6.3 第 8 条已指出注释有误导，以代码为准）。
 */

/** 粒子数（规格 §6.2）。改这个数只需要同步改 a_index 缓冲长度。 */
export const SORA_PARTICLE_COUNT = 150

/*
 * 顶点着色器：每个粒子只知道自己叫第几号（`a_index`），其余六项随机量都在这里现算 ——
 * 这样 CPU 侧不用传任何随机数缓冲，也保证「同一个 index 永远得到同一颗星」。
 *
 * 六个随机通道的**次序**是有意义的：`rand()` 的第二个参数就是通道号，
 * 调换两个通道会让星点的位置/速度分布整体错位（画面上看不出「错」，但已经不是同一片星空）。
 */
export const SORA_VERTEX_SHADER = `
attribute float a_index;
uniform vec2 u_resolution;
uniform float u_time;
varying float v_color_type;
varying float v_intensity_base;

// 单精度 hash：取 sin 的小数部分，相邻种子几乎不相关
float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// 同一颗星的第 channel 个随机量（channel 取互不相同的小数，避免通道间相关）
float rand(float seed, float channel) {
  return hash2(vec2(seed, channel));
}

void main() {
  float seed = a_index * 123.456;

  float speed_rand = rand(seed, 1.1);
  float size_rand = rand(seed, 2.2);
  float y_rand = rand(seed, 3.3);
  float x_rand = rand(seed, 4.4);
  float blink_rand = rand(seed, 5.5);
  float color_type_rand = rand(seed, 6.6);

  float aspect = u_resolution.x / u_resolution.y;

  // 每秒漂过屏宽的 0.8%–3.2%；星点大小按 3.8 次幂分布，长尾让夜空里有几颗亮星
  float speed = 0.008 + speed_rand * 0.024;
  float size = 0.0006 + 0.0032 * pow(size_rand, 3.8);

  // 纵坐标均匀铺满 NDC 的 90%，上下各留 0.05 的边
  float y = -0.45 + y_rand * 0.9;

  // 横坐标在 [0,1) 上循环，再映射到「画布宽 + 两侧 margin」的 NDC 范围内
  float margin = 0.05;
  float travelWidth = aspect + margin * 2.0;
  float x = fract(x_rand + u_time * speed) * travelWidth - (aspect * 0.5 + margin);

  // 每颗星相位不同的轻微上下漂浮
  float wave = sin(u_time * 0.3 + y_rand * 6.283) * 0.005;

  gl_Position = vec4(x / (aspect * 0.5), (y + wave) / 0.5, 0.0, 1.0);

  // 尺寸按画布高度缩放（不同分辨率观感一致），下限 2px 防止小窗里星点消失
  gl_PointSize = max(2.0, size * u_resolution.y * 3.5);

  // 闪烁在 0.3–1.0 之间（振幅 0.7，不是 0–1），频率与相位都逐星不同
  v_intensity_base = 0.3 + 0.7 * sin(u_time * (1.0 + blink_rand * 2.5) + x_rand * 6.283);
  v_color_type = color_type_rand;
}
`

/*
 * 片元着色器：把一个方形的 gl_Point 修成圆形软边光点。
 *
 * `smoothstep(0.5, 0.1, dist)` 的参数是**反序**的（大值在前）—— 这是刻意的：
 * distance 越小球越亮，中心 1、半径 0.5 处 0。写成 `smoothstep(0.1, 0.5, dist)`
 * 会得到一圈甜甜圈，看起来像环不是光点。
 */
export const SORA_FRAGMENT_SHADER = `
precision mediump float;
uniform vec3 u_particle_color;
uniform vec3 u_particle_accent_color;

varying float v_color_type;
varying float v_intensity_base;

void main() {
  float dist = length(gl_PointCoord - vec2(0.5));

  float alpha = smoothstep(0.5, 0.1, dist) * v_intensity_base;
  if (alpha < 0.01) discard;

  // 预乘 alpha：与 gl.blendFunc(ONE, ONE_MINUS_SRC_ALPHA) 配套
  vec3 baseColor = v_color_type > 0.90 ? u_particle_accent_color : u_particle_color;
  gl_FragColor = vec4(baseColor * alpha, alpha);
}
`

/** 约 10% 的星点用强调色（片元里的 `v_color_type > 0.90`）。 */
export const SORA_ACCENT_COLOR_TYPE_THRESHOLD = 0.9
