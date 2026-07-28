import native from '../index';

// ============================================================================
// netScan() 性能基准 —— 真实轮询场景版（与 process.bench.ts 同方法学）
// ============================================================================
// 与 processScan 同理：真实 UI 的网络面板默认 5s 轮询一次，GC stall 会被间隔
// 稀释。判据 = 真实 5s 轮询节奏下单次采集 p99 < 30ms。
// ============================================================================

const POLL_INTERVAL_MS = 5000;   // 网络面板默认刷新间隔（设计文档 §5.1）
const SAMPLES = 12;              // 12 次轮询 = 60 秒采样窗口
const WARMUP = 5;
const THRESHOLD_MS = 30;

console.log(`=== netScan() 真实轮询基准（每 ${POLL_INTERVAL_MS}ms 一次，共 ${SAMPLES} 次）===\n`);

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function run() {
  for (let i = 0; i < WARMUP; i++) native.netScan();

  const latencies: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t0 = process.hrtime.bigint();
    native.netScan();
    const t1 = process.hrtime.bigint();
    latencies.push(Number(t1 - t0) / 1e6);
    if (i < SAMPLES - 1) await sleep(POLL_INTERVAL_MS);
  }

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(SAMPLES * 0.5)];
  const p95 = latencies[Math.floor(SAMPLES * 0.95)];
  const p99 = latencies[Math.min(SAMPLES - 1, Math.floor(SAMPLES * 0.99))];
  const max = latencies[SAMPLES - 1];
  const avg = latencies.reduce((s, x) => s + x, 0) / SAMPLES;
  const overCount = latencies.filter(x => x >= THRESHOLD_MS).length;

  const sample = native.netScan();
  console.log(`采集连接数: ${sample.length}`);
  console.log(`轮询间隔: ${POLL_INTERVAL_MS} ms（网络面板默认）`);
  console.log(`采样次数: ${SAMPLES}（约 ${(SAMPLES * POLL_INTERVAL_MS / 1000).toFixed(0)} 秒窗口）`);
  console.log(`avg:  ${avg.toFixed(2)} ms`);
  console.log(`p50:  ${p50.toFixed(2)} ms`);
  console.log(`p95:  ${p95.toFixed(2)} ms`);
  console.log(`p99:  ${p99.toFixed(2)} ms`);
  console.log(`max:  ${max.toFixed(2)} ms`);
  console.log(`\n单次采集超过 ${THRESHOLD_MS}ms 的次数: ${overCount} / ${SAMPLES}`);
  console.log(`判据: 单次采集 p99 < ${THRESHOLD_MS} ms  →  ${p99 < THRESHOLD_MS ? '✅ PASS' : '❌ FAIL'}`);

  if (p99 >= THRESHOLD_MS) {
    console.log('\n⚠️  Go/No-Go 判据未通过！');
    process.exit(1);
  }
}

run();
