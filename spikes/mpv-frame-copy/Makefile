# mpv frame-copy spike (macOS only for now).
#
# Requires: Homebrew libmpv (brew install mpv) and Node >= 18 on PATH (for
# its N-API headers). Both are auto-detected; override BREW_PREFIX/NODE_INC
# if detection picks the wrong one. Works on Apple Silicon (/opt/homebrew)
# and Intel (/usr/local) Homebrew layouts.

# libmpv prefix: Homebrew (Apple Silicon /opt/homebrew or Intel /usr/local)
# or MacPorts (/opt/local, needed on legacy macOS like High Sierra where
# Homebrew is unsupported — install with: sudo port install mpv +libmpv).
MPV_PREFIX ?= $(shell \
	brew_p="$$(brew --prefix 2>/dev/null)"; \
	if [ -n "$$brew_p" ] && ls "$$brew_p"/lib/libmpv*.dylib >/dev/null 2>&1; then echo "$$brew_p"; \
	elif ls /opt/local/lib/libmpv*.dylib >/dev/null 2>&1; then echo /opt/local; \
	else echo /opt/homebrew; fi)
BREW_PREFIX ?= $(MPV_PREFIX)
# Self-contained bundles vendor the four N-API headers so no Node install
# is needed; otherwise take headers from the PATH node.
ifneq (,$(wildcard vendor/node-headers/node_api.h))
NODE_INC ?= vendor/node-headers
else
NODE_INC ?= $(shell node -p "require('path').join(process.execPath, '..', '..', 'include', 'node')" 2>/dev/null)
endif

BUILD := build

all: $(BUILD)/mpv_helper $(BUILD)/shm_reader.node

$(BUILD):
	mkdir -p $(BUILD)

$(BUILD)/mpv_helper: helper/mpv_helper.cpp common/spike_shm.h | $(BUILD)
	clang++ -std=c++17 -O2 -Wall -Icommon -I$(BREW_PREFIX)/include \
		-o $@ helper/mpv_helper.cpp \
		-L$(BREW_PREFIX)/lib -lmpv -Wl,-rpath,$(BREW_PREFIX)/lib \
		-framework OpenGL

$(BUILD)/shm_reader.node: viewer/addon/shm_reader.c common/spike_shm.h | $(BUILD)
	clang -std=c11 -O2 -Wall -Icommon -I$(NODE_INC) \
		-shared -fPIC -Wl,-undefined,dynamic_lookup \
		-o $@ viewer/addon/shm_reader.c

clean:
	rm -rf $(BUILD)

.PHONY: all clean
