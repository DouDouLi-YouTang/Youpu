/**
 * 站点统计 SDK 集成。
 *
 * 真实 id/ck 不写入本仓库 —— 由 CI 打包时通过环境变量 VITE_LA_51_ID /
 * VITE_LA_51_CK 注入(源码与公开仓库均不出现明文),防止统计 id 被他人冒用。
 * 本地/无密钥构建时值为空,自动跳过上报,避免开发环境污染数据。
 *
 * 注意:客户端统计的 id/ck 最终会编译进发行包,这是客户端 SDK 的固有特性;
 * 若要彻底防止他人提取,需改由自有后端转发上报。
 */

const LA_51_SDK_URL = 'https://sdk.51.la/js-sdk-pro.min.js'

interface La51Sdk {
  init(options: { id: string; ck: string }): void
}

declare global {
  interface Window {
    LA?: La51Sdk
  }
}

export function initLa51Analytics(): void {
  const id = import.meta.env.VITE_LA_51_ID
  const ck = import.meta.env.VITE_LA_51_CK

  if (!id || !ck) {
    return
  }

  try {
    const script = document.createElement('script')
    script.id = 'LA_COLLECT'
    script.charset = 'UTF-8'
    script.async = true
    script.src = LA_51_SDK_URL
    script.onload = () => {
      window.LA?.init({ id, ck })
    }
    script.onerror = () => {
      console.warn('[analytics] 统计 SDK 加载失败,已跳过统计上报')
    }
    document.head.appendChild(script)
  } catch (error) {
    console.warn('[analytics] 统计 SDK 初始化失败:', error)
  }
}
