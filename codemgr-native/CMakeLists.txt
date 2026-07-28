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
  )
endif()

add_library(${PROJECT_NAME} SHARED
  ${CMAKE_JS_SRC}
  src/addon.cpp
)

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
