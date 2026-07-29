// 进程快照中的单个进程
export interface ProcessInfo {
  pid: number;
  ppid: number;            // 父进程 PID
  name: string;            // 进程名，如 "node.exe"
  cmdline: string;         // 完整命令行
  cwd: string;             // 当前工作目录（从命令行启发式抽取，非 PEB 直读；见 process_collector.cpp）
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

// 磁盘卷（6c 数据源：GetLogicalDriveStringsW + GetDriveTypeW + GetDiskFreeSpaceExW）
export interface DiskVolume {
  letter: string;          // 盘符路径，如 "C:\\"
  type: 'fixed' | 'removable' | 'cdrom' | 'network' | 'ram' | 'unknown';
  totalBytes: number;      // 总空间（字节）；不可达卷为 0
  freeBytes: number;       // 空闲空间（字节）
  availableBytes: number;  // 可用空间（字节，可能 < freeBytes，受配额影响）
}

// 系统性能计数器快照
export interface PerfData {
  cpu: { totalPercent: number; perCore: number[] };
  memory: { totalBytes: number; availableBytes: number; usedPercent: number };
  disks: Array<{
    name: string;
    totalBytes: number;
    freeBytes: number;
    readBytesPerSec: number;
    writeBytesPerSec: number;
    activePercent: number;
  }>;
  networks: Array<{ name: string; recvBytesPerSec: number; sendBytesPerSec: number }>;
  gpu: {
    available: boolean;          // false 时 UI 显示"不可用"（虚拟机/远程桌面）
    totalPercent: number;        // 0-100
    vramUsedBytes: number;       // DXGI Local CurrentUsage
    vramBudgetBytes: number;     // DXGI Local Budget（0 = 未知，DXGI 失败时）
    perProcess: Array<{ pid: number; gpuPercent: number; vramBytes: number }>;
    adapters: Array<{            // v2.x 多适配器明细（核显+独显分卡）
      name: string;
      totalPercent: number;
      vramUsedBytes: number;
      vramBudgetBytes: number;
      perProcess: Array<{ pid: number; gpuPercent: number; vramBytes: number }>;
    }>;
  };
  timestamp: number;
}

export interface NativeBindings {
  hello(): string;
  processScan(): ProcessInfo[];
  netScan(): NetConnection[];
  cpuDelta(): CpuUsage[];
  perfCounters(): PerfData;
  killProcess(pid: number): boolean;
  killByName(name: string): number;
  killByPids(pids: number[]): number;
  killTree(pid: number): number;
  readProcessEnv(pid: number): Record<string, string>;
  readProcessCwd(pid: number): string;
  diskVolumes(): DiskVolume[];
}

// 加载编译产物（index.ts 位于包根，build/ 在同级）
const native = require('./build/Release/codemgr-native.node') as NativeBindings;

export default native;
