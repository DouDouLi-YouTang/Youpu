import { message as staticMessage } from 'ant-design-vue'

// useMessage() 返回的实例类型(消费 ConfigProvider 主题),ant-design-vue 未直接导出该类型,这里用 ReturnType 推导。
type MessageInstance = ReturnType<typeof staticMessage.useMessage>[0]

// 全局 message 实例持有:App.vue 通过 useMessage() 注入消费 ConfigProvider 主题的实例,
// 其它 store(如 player)通过 getMessage() 取用,使播放失败等提示跟随主题且不依赖静态 message。
let instance: MessageInstance | null = null

export function setMessageInstance(msg: MessageInstance): void {
  instance = msg
}

export function getMessage(): MessageInstance {
  // 未注入时回退静态 message:其方法运行时同样接受 options 对象,仅静态类型签名与实例不同,故做 cast。
  return instance ?? (staticMessage as unknown as MessageInstance)
}
