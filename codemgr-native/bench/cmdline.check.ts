// 诊断：processScan 返回的 cmdline 到底是 ImagePathName 还是 CommandLine？
const native = require('../build/Release/codemgr-native.node');

const procs = native.processScan();
// 找当前 node 进程自己（带参数）
const self = procs.find((p: any) => p.pid === process.pid);
console.log('self pid:', process.pid);
console.log('self cmdline:', JSON.stringify(self?.cmdline));
console.log('expected to contain:', process.execPath, '+ script args');

// 统计：有多少 cmdline 以 .exe 结尾（疑似只有路径无参数）
const exeOnly = procs.filter((p: any) => /\.exe["']?$/i.test((p.cmdline || '').trim()));
console.log(`exe-only cmdline: ${exeOnly.length}/${procs.length}`);

// 抽几个带参数的样例（应含空格）
const withArgs = procs.filter((p: any) => p.cmdline && p.cmdline.includes(' ') && !p.cmdline.endsWith('.exe'));
console.log('with-args samples:', withArgs.slice(0, 3).map((p: any) => ({ name: p.name, cmd: p.cmdline?.slice(0, 80) })));
