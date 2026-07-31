// 非 React 通知出口：异步回调（kill 结果、IPC 错误）用不了 hook，统一从这里发 toast。
import { useToastStore } from '../store/toastStore';

export const notify = {
  success: (message: string): void => { useToastStore.getState().push('success', message); },
  error: (message: string): void => { useToastStore.getState().push('error', message); },
  info: (message: string): void => { useToastStore.getState().push('info', message); },
  warning: (message: string): void => { useToastStore.getState().push('warning', message); },
};
