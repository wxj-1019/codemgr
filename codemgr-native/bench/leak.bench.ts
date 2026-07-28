import native from '../index';

const DURATION_MS = 60_000;
const INTERVAL_MS = 500;
const THRESHOLD_MB = 10;

console.log('=== 内存泄漏检测（60s, 500ms 间隔）===\n');

function rssMB() {
  return process.memoryUsage().rss / 1024 / 1024;
}

// 预热
for (let i = 0; i < 20; i++) { native.processScan(); native.netScan(); }

const startRSS = rssMB();
const start = Date.now();
let iterations = 0;

// 同步高频采集（实际运行中 Main 进程会用定时器调度，这里用 setInterval）
const timer = setInterval(() => {
  native.processScan();
  native.netScan();
  iterations++;
}, INTERVAL_MS);

setTimeout(() => {
  clearInterval(timer);
  // 触发 GC 后再测（需 node --expose-gc）
  if (global.gc) global.gc();
  const endRSS = rssMB();
  const delta = endRSS - startRSS;

  console.log(`运行时长: ${(Date.now() - start) / 1000}s`);
  console.log(`采集次数: ${iterations}（每 ${INTERVAL_MS}ms）`);
  console.log(`起始 RSS: ${startRSS.toFixed(1)} MB`);
  console.log(`结束 RSS: ${endRSS.toFixed(1)} MB`);
  console.log(`RSS 增长: ${delta.toFixed(2)} MB`);
  console.log(`\n判据: 增长 < ${THRESHOLD_MB} MB  →  ${delta < THRESHOLD_MB ? '✅ PASS' : '❌ FAIL'}`);

  if (delta >= THRESHOLD_MB) {
    console.log('\n⚠️  疑似内存泄漏！检查 C++ 侧 std::vector 复用与 Napi::Object 生命周期。');
    process.exit(1);
  }
}, DURATION_MS);
