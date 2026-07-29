// cmake-js 包装：用 vswhere 动态发现 VS 自带的 CMake，避免 baked 路径绑定
// 到特定 VS 版本/edition（如 VS2019 Community）而在换机器/CI 上失效。
//
// 背景：cmake-js 不会自动从 VS 安装目录发现 cmake（只查 PATH）；
// 本机与 CI（windows-latest）的 cmake 都不在 PATH 上，VS 安装目录各异，
// 所以用 vswhere 统一发现 VS2017+ 自带的 cmake。
//
// 用法：
//   node scripts/build.mjs            # Node 目标编译
//   node scripts/build.mjs electron   # 为 Electron 重编译（AGENTS.md 陷阱 #1）
//   node scripts/build.mjs rebuild    # clean + compile（Node 目标）
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const addonRoot = join(__dirname, '..')

const VSWHERE =
	'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe'

// 用 vswhere 找最新 VS（含 BuildTools/Community/Enterprise 等所有 edition），
// 取其内置 CMake。失败则回退到 PATH 上的 cmake（交由 cmake-js 自行处理）。
function findCmake() {
	try {
		const vsInstall = execFileSync(
			VSWHERE,
			['-latest', '-products', '*', '-property', 'installationPath'],
			{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
		).trim()
		const cmake = join(
			vsInstall,
			'Common7',
			'IDE',
			'CommonExtensions',
			'Microsoft',
			'CMake',
			'CMake',
			'bin',
			'cmake.exe',
		)
		if (existsSync(cmake)) return cmake
		console.warn(`[build] vswhere 命中 ${vsInstall} 但未找到其 CMake，回退到 PATH 上的 cmake`)
	} catch {
		console.warn('[build] vswhere 不可用，回退到 PATH 上的 cmake')
	}
	return undefined
}

// 读取当前 app 依赖的 Electron 版本，避免 baked 版本号漂移。
function electronVersion() {
	const appPkg = join(addonRoot, '..', 'app', 'package.json')
	try {
		const dep = JSON.parse(readFileSync(appPkg, 'utf8')).dependencies?.electron
		// 依赖形如 "^43.2.0"；从 node_modules 取精确版本
		const installed = join(addonRoot, '..', 'node_modules', 'electron', 'package.json')
		if (existsSync(installed)) {
			return JSON.parse(readFileSync(installed, 'utf8')).version
		}
		return dep?.replace(/[^0-9.]/g, '')
	} catch {
		return undefined
	}
}

async function main() {
	const mode = process.argv[2] // undefined | 'electron' | 'rebuild'
	const { BuildSystem } = await import('cmake-js')

	const options = { directory: addonRoot, cmakePath: findCmake() }
	if (!options.cmakePath) delete options.cmakePath

	if (mode === 'electron') {
		options.runtime = 'electron'
		options.runtimeVersion = electronVersion()
		options.arch = process.arch === 'arm64' ? 'arm64' : 'x64'
		if (!options.runtimeVersion) {
			throw new Error('无法确定 Electron 版本：检查 app/package.json / node_modules/electron')
		}
		console.log(`[build] Electron 目标 runtime=${options.runtimeVersion} arch=${options.arch}`)
	}

	const bs = new BuildSystem(options)
	if (mode === 'rebuild') {
		await bs.clean()
	}
	await bs.compile()
}

main().catch((e) => {
	console.error(e?.stack || e)
	process.exit(1)
})
