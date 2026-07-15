{
  "targets": [
    {
      "target_name": "embedded_mpv",
      "sources": [],
      "include_dirs": [
        "<(module_root_dir)/../../../node_modules/.pnpm/node_modules/node-addon-api",
        "<!(node -p \"process.env.LIBMPV_INCLUDE_DIR || '/opt/homebrew/include'\")",
        "src"
      ],
      "defines": [
        "NAPI_CPP_EXCEPTIONS"
      ],
      "cflags_cc": [
        "-fexceptions",
        "-std=c++20"
      ],
      "conditions": [
        [
          "OS==\"mac\"",
          {
            "sources": [
              "src/embedded_mpv.mm"
            ],
            "xcode_settings": {
              "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
              "CLANG_ENABLE_OBJC_ARC": "YES",
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "MACOSX_DEPLOYMENT_TARGET": "10.15",
              "OTHER_LDFLAGS": [
                "-Wl,-rpath,@loader_path/lib"
              ]
            },
            "libraries": [
              "-framework AppKit",
              "-framework CoreVideo",
              "-framework Foundation",
              "-framework OpenGL",
              "<!(node -e \"const path = require('path'); const dir = process.env.LIBMPV_LIBRARY_DIR || '/opt/homebrew/lib'; process.stdout.write(path.join(dir, 'libmpv.2.dylib'))\")"
            ]
          }
        ],
        [
          "OS==\"win\"",
          {
            "sources": [
              "src/embedded_mpv_win32.cc"
            ],
            "defines": [
              "WIN32_LEAN_AND_MEAN",
              "NOMINMAX"
            ],
            "libraries": [
              "<!(node -e \"const path = require('path'); const dir = process.env.LIBMPV_LIBRARY_DIR || process.cwd(); const lib = process.env.LIBMPV_IMPORT_LIB || path.join(dir, 'mpv.lib'); process.stdout.write(lib.replace(/\\\\\\\\/g, '/'))\")",
              "user32.lib",
              "gdi32.lib"
            ]
          }
        ],
        [
          "OS==\"linux\"",
          {
            "sources": [
              "src/embedded_mpv_linux.cc"
            ],
            "defines": [
              "IPTVNATOR_DYNAMIC_LIBMPV"
            ],
            "libraries": [
              "-L<!(node -p \"process.env.LINUX_NATIVE_LIBRARY_DIR || '/usr/lib'\")",
              "-lX11",
              "-lXext",
              "-ldl"
            ]
          }
        ]
      ]
    },
    {
      "target_name": "embedded_mpv_frame_reader",
      "sources": [
        "src/embedded_mpv_frame_reader.c"
      ],
      "include_dirs": [
        "helper"
      ]
    },
    {
      "target_name": "iptvnator_mpv_helper",
      "type": "none",
      "conditions": [
        [
          "OS==\"mac\"",
          {
            "type": "executable",
            "sources": [
              "helper/mpv_frame_helper.cpp"
            ],
            "include_dirs": [
              "<!(node -p \"process.env.LIBMPV_INCLUDE_DIR || '/opt/homebrew/include'\")",
              "helper"
            ],
            "cflags_cc": [
              "-std=c++17"
            ],
            "xcode_settings": {
              "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "MACOSX_DEPLOYMENT_TARGET": "11.0",
              "OTHER_LDFLAGS": [
                "-Wl,-rpath,@executable_path/lib",
                "-Wl,-rpath,@loader_path/lib"
              ]
            },
            "libraries": [
              "-framework OpenGL",
              "<!(node -e \"const path = require('path'); const dir = process.env.LIBMPV_LIBRARY_DIR || '/opt/homebrew/lib'; process.stdout.write(path.join(dir, 'libmpv.2.dylib'))\")"
            ]
          }
        ],
        [
          "OS==\"linux\"",
          {
            "type": "executable",
            "sources": [
              "helper/mpv_frame_helper.cpp"
            ],
            "include_dirs": [
              "<!(node -p \"process.env.LIBMPV_INCLUDE_DIR || '/usr/include'\")",
              "helper"
            ],
            "cflags_cc!": [
              "-fno-exceptions"
            ],
            "cflags_cc": [
              "-std=c++17",
              "-fexceptions"
            ],
            "cflags": [
              "-pthread"
            ],
            "ldflags": [
              "-pthread",
              "-Wl,-rpath,'$$ORIGIN/lib'",
              "-Wl,-rpath,<!(node -p \"process.env.LINUX_NATIVE_LIBRARY_DIR || '/usr/lib'\")"
            ],
            "libraries": [
              "-L<!(node -p \"process.env.LINUX_NATIVE_LIBRARY_DIR || '/usr/lib'\")",
              "-lmpv",
              "-lEGL",
              "-lOpenGL",
              "-lgbm",
              "-ldl"
            ]
          }
        ]
      ]
    }
  ]
}
