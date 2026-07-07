cmake_minimum_required(VERSION 3.20)
project(capnp_es_rpc_interop_cpp CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(CapnProto CONFIG REQUIRED)

set(SCHEMA_DIR ${CMAKE_CURRENT_SOURCE_DIR}/capnp)
set(SCHEMAS
  ${SCHEMA_DIR}/simple-interface.capnp
  ${SCHEMA_DIR}/import-interface.capnp
  ${SCHEMA_DIR}/rpc-level2.capnp
  ${SCHEMA_DIR}/sandstorm-powerbox-flow.capnp
  ${SCHEMA_DIR}/web-session-interop.capnp
)

capnp_generate_cpp(CAPNP_SRCS CAPNP_HDRS ${SCHEMAS})

add_executable(cpp_vat_server
  src/cpp_vat_server.cxx
  ${CAPNP_SRCS}
)

target_include_directories(cpp_vat_server PRIVATE
  ${CMAKE_CURRENT_BINARY_DIR}
  ${SCHEMA_DIR}
)

target_link_libraries(cpp_vat_server PRIVATE
  CapnProto::capnp-rpc
  CapnProto::capnp
  CapnProto::kj
  CapnProto::kj-async
)

add_executable(cpp_vat_client
  src/cpp_vat_client.cxx
  ${CAPNP_SRCS}
)

target_include_directories(cpp_vat_client PRIVATE
  ${CMAKE_CURRENT_BINARY_DIR}
  ${SCHEMA_DIR}
)

target_link_libraries(cpp_vat_client PRIVATE
  CapnProto::capnp-rpc
  CapnProto::capnp
  CapnProto::kj
  CapnProto::kj-async
)
