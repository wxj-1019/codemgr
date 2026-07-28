cmake_minimum_required(VERSION 3.15)
cmake_policy(SET CMP0091 NEW)

project(codemgr-native)

# cmake-js 提供的变量
include_directories(${CMAKE_JS_INC})

add_definitions(-DNAPI_VERSION=8)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Windows 链接的库
if(WIN32)
  set(WIN_LIBS
    ntdll        # NtQuerySystemInformation
    iphlpapi     # GetExtendedTcpTable
    ws2_32       # 网络辅助
    user32
    pdh          # PDH 磁盘 IO 速率计数器
  )
endif()

add_library(${PROJECT_NAME} SHARED
  ${CMAKE_JS_SRC}
  src/addon.cpp
  src/process_collector.cpp
  src/net_collector.cpp
  src/cpu_tracker.cpp
  src/process_ops.cpp
  src/perf_collector.cpp
)

# 源文件以 UTF-8（无 BOM）保存，含中文注释。MSVC 在简体中文系统默认按
# 代码页 936(GBK) 解析源文件，会误判 UTF-8 多字节序列导致 C4819 警告甚至
# 预处理器错乱（如 C1020）。/utf-8 同时设定源与执行字符集为 UTF-8。
if(MSVC)
  target_compile_options(${PROJECT_NAME} PRIVATE /utf-8)
endif()

set_target_properties(${PROJECT_NAME} PROPERTIES
  PREFIX ""
  SUFFIX ".node"
)

target_include_directories(${PROJECT_NAME} PRIVATE
  ${CMAKE_JS_INC}
  ${CMAKE_SOURCE_DIR}/node_modules/node-addon-api
)

target_link_libraries(${PROJECT_NAME} PRIVATE
  ${CMAKE_JS_LIB}
  ${WIN_LIBS}
)

# node-addon-api 需要 EXCEPTION_DISABLE
add_definitions(-DNAPI_DISABLE_CPP_EXCEPTIONS)
