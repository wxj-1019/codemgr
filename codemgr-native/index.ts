// 进程快照中的单个进程
export interface ProcessInfo {
  pid: number;
  ppid: number;            // 父进程 PID
  name: string;            // 进程名，如 "node.exe"
  cmdline: string;         // 完整命令行
  kernelTimeMs: number;    // 内核态时间（毫秒）
  userTimeMs: number;      // 用户态时间（毫秒）
  workingSetBytes: number; // 工作集（内存）
  createTimeMs: number;    // 创建时间（epoch 毫秒）
  threadCount: number;
  handleCount: number;
}

// 网络连接
export interface NetConnection {
  protocol: 'tcp' | 'udp';
  localAddr: string;
  localPort: number;
  remoteAddr: string;
  remotePort: number;
  state: string;           // 如 "LISTEN" / "ESTABLISHED"
  pid: number;
  processName: string;
}

// 单进程 CPU 使用率
export interface CpuUsage {
  pid: number;
  cpuPercent: number;      // 0-100，相对于单核
}

export interface NativeBindings {
  hello(): string;
  processScan(): ProcessInfo[];
  netScan(): NetConnection[];
  cpuDelta(): CpuUsage[];
  killProcess(pid: number): boolean;
  killByName(name: string): number;
  killByPids(pids: number[]): number;
}

// 加载编译产物（index.ts 位于包根，build/ 在同级）
const native = require('./build/Release/codemgr-native.node') as NativeBindings;

export default native;
