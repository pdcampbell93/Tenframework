//
// Copyright © 2025 Agora
// This file is part of TEN Framework, an open source project.
// Licensed under the Apache License, Version 2.0, with certain conditions.
// Refer to the "LICENSE" file in the root directory for more information.
//
#pragma once

#if defined(__cplusplus)
#define TEN_EXTERN_C extern "C"
#else
#define TEN_EXTERN_C extern
#endif

#if defined(_WIN32)

#if defined(TEN_RUNTIME_EXPORT)
#if !defined(TEN_RUNTIME_API)
#define TEN_RUNTIME_API TEN_EXTERN_C __declspec(dllexport)
#endif
#else
#if !defined(TEN_RUNTIME_API)
#define TEN_RUNTIME_API TEN_EXTERN_C __declspec(dllimport)
#endif
#endif

#if !defined(TEN_RUNTIME_PRIVATE_API)
#define TEN_RUNTIME_PRIVATE_API TEN_EXTERN_C
#endif

#elif defined(__APPLE__)

#include <TargetConditionals.h>

#if !defined(TEN_RUNTIME_API)
#define TEN_RUNTIME_API __attribute__((visibility("default"))) TEN_EXTERN_C
#endif

#if !defined(TEN_RUNTIME_PRIVATE_API)
#define TEN_RUNTIME_PRIVATE_API \
  __attribute__((visibility("hidden"))) TEN_EXTERN_C
#endif

#elif defined(__linux__)

#if !defined(TEN_RUNTIME_API)
#define TEN_RUNTIME_API TEN_EXTERN_C __attribute__((visibility("default")))
#endif

#if !defined(TEN_RUNTIME_PRIVATE_API)
#define TEN_RUNTIME_PRIVATE_API \
  TEN_EXTERN_C __attribute__((visibility("hidden")))
#endif

#else

#if !defined(TEN_RUNTIME_API)
#define TEN_RUNTIME_API TEN_EXTERN_C
#endif

#if !defined(TEN_RUNTIME_PRIVATE_API)
#define TEN_RUNTIME_PRIVATE_API TEN_EXTERN_C
#endif

#endif

/
// Copyright © 2025 Agora
// This file is part of TEN Framework, an open source project.
// Licensed under the Apache License, Version 2.0, with certain conditions.
// Refer to the "LICENSE" file in the root directory for more information.
//
#pragma once

// This header file should be the only header file where outside world should
// include in the C programming language.

#include "ten_runtime/ten_config.h"

#include "ten_runtime/addon/addon.h"                  // IWYU pragma: export
#include "ten_runtime/addon/extension/extension.h"    // IWYU pragma: export
#include "ten_runtime/app/app.h"                      // IWYU pragma: export
#include "ten_runtime/common/error_code.h"            // IWYU pragma: export
#include "ten_runtime/extension/extension.h"          // IWYU pragma: export
#include "ten_runtime/msg/audio_frame/audio_frame.h"  // IWYU pragma: export
#include "ten_runtime/msg/cmd/close_app/cmd.h"        // IWYU pragma: export
#include "ten_runtime/msg/cmd_result/cmd_result.h"    // IWYU pragma: export
#include "ten_runtime/msg/data/data.h"                // IWYU pragma: export
#include "ten_runtime/msg/msg.h"                      // IWYU pragma: export
#include "ten_runtime/msg/video_frame/video_frame.h"  // IWYU pragma: export
#include "ten_runtime/ten_env/ten_env.h"              // IWYU pragma: export


