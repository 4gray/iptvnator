# mpv frame-copy spike (macOS only for now).
#
# Requires: Homebrew libmpv (brew install mpv) and Node headers for the
# N-API addon. Override NODE_INC if your Node lives elsewhere:
#   make NODE_INC=$(node -e 'console.log(process.execPath)')/../../include/node

BREW_PREFIX ?= /opt/homebrew
NODE_INC ?= $(HOME)/.nvm/versions/node/v22.14.0/include/node

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
