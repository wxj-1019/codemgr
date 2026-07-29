// UtilityProcess 入口脚本（6c 数据源管道）。
//
// 经 utilityProcess.fork() 启动，是主进程侧的 Node.js 子进程。承载插件数据源所需的
// native 能力采集（按 capability 路由）。主进程经 MessagePort 与本进程通信。
//
// 安全：这是主仓库编译进主包的受控进程，require 的 .node 是主仓库 addon（红线：插件
// 不能自带 .node）。插件声明的 capabilities 经 main 白名单过滤后才到达这里。
//
// 通信协议（经 process.parentPort）：
//   主进程 → 本进程：{ id, capability }  请求某能力的数据
//   本进程 → 主进程：{ id, capability, data } | { id, error }  回复
//
// 本次（6c 第一步）用模拟数据源：不调真 native，返回固定数据验证管道。
// TODO(6c 第二步)：接入真实 collector（如 docker_collector），按 capability 调对应 native 函数。

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// 尝试 require 同一个 native addon，验证"子进程可复用主包 .node"（同一 Electron ABI）。
// 失败不崩进程——模拟数据源不依赖它，但记录日志便于诊断。
let native = null;
try {
  // 路径与 main.ts 的 NATIVE_PATH 一致：打包态 resourcesPath，开发态相对仓库
  const addonPath = process.env.CODEMGR_NATIVE_PATH;
  if (addonPath) native = require(addonPath);
} catch (e) {
  console.error('[utility-host] native addon require failed (模拟数据源仍可用):', e);
}

/**
 * 按 capability 采集数据。本次模拟——真实 collector 接入后在此 switch 分发。
 * TODO(6c 第二步)：每个 case 调对应 native.xxx()（native 已 require 到位）。
 */
function collect(capability) {
  switch (capability) {
    case 'demo-source':
      // 模拟数据：验证端到端管道通畅
      return [
        { id: 'demo-1', name: '示例条目 A', value: 42 },
        { id: 'demo-2', name: '示例条目 B', value: 128 },
      ];
    case 'disk-volumes':
      // 真实数据源：磁盘卷列表（GetLogicalDriveStringsW + GetDriveTypeW + GetDiskFreeSpaceExW）
      // native 已 require 到位（见文件顶部）；UtilityProcess 子进程复用同一 .node
      if (!native) throw new Error('native addon 未加载，无法采集 disk-volumes');
      return native.diskVolumes();
    default:
      throw new Error(`未知 capability: ${capability}`);
  }
}

// 经 parentPort 接收请求，逐个处理（try/catch 包裹，单请求失败不杀进程）
process.parentPort.on('message', (e) => {
  const port = e.ports?.[0];
  const msg = e.data;
  if (!msg || typeof msg !== 'object') return;
  try {
    const data = collect(msg.capability);
    port?.postMessage({ id: msg.id, capability: msg.capability, data });
  } catch (err) {
    port?.postMessage({ id: msg.id, error: String(err) });
  }
});

// 标记就绪（主进程据此知道子进程已启动）
process.parentPort.postMessage({ type: 'ready', nativeLoaded: !!native });
