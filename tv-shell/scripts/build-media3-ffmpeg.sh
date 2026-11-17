#!/usr/bin/env bash
set -euo pipefail

media3_commit=8c6678b657ede1e7883fc164ef73ed483c7796c3 # Media3 1.11.1
ffmpeg_version=6.1.6
ffmpeg_sha256=d4fcb164028dd3beee5d92c0ac72e46aac6973c75ea12dc14de07bf8f407370a
ndk=$1
api=$2
output=$3

case "$(uname -s)" in
    Darwin) host=darwin-x86_64 ;;
    Linux) host=linux-x86_64 ;;
    *) echo "Building the Media3 FFmpeg extension requires macOS or Linux." >&2; exit 1 ;;
esac
toolchain="$ndk/toolchains/llvm/prebuilt/$host/bin"
jobs=$(getconf _NPROCESSORS_ONLN)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
generated="$work/generated"

archive="ffmpeg-$ffmpeg_version.tar.xz"
curl --fail --location --silent --show-error --retry 2 "https://ffmpeg.org/releases/$archive" -o "$work/$archive"
(cd "$work" && printf '%s  %s\n' "$ffmpeg_sha256" "$archive" | shasum -a 256 --check)
tar -xf "$work/$archive" -C "$work"
ffmpeg="$work/ffmpeg-$ffmpeg_version"

upstream="https://raw.githubusercontent.com/androidx/media/$media3_commit/libraries/decoder_ffmpeg/src/main"
package=androidx/media3/decoder/ffmpeg
mkdir -p "$generated/java/$package" "$generated/assets/tvshell" "$generated/source"
mv "$work/$archive" "$generated/source/"
for name in FfmpegAudioDecoder FfmpegAudioRenderer FfmpegDecoderException FfmpegLibrary; do
    curl --fail --location --silent --show-error --retry 2 "$upstream/java/$package/$name.java" \
        -o "$generated/java/$package/$name.java"
done
curl --fail --location --silent --show-error --retry 2 "$upstream/jni/ffmpeg_jni.cc" -o "$work/ffmpeg_jni.cc"
cp "$ffmpeg/COPYING.LGPLv2.1" "$generated/assets/tvshell/FFmpeg-LGPL-2.1.txt"

build_abi() (
    abi=$1
    arch=$2
    cpu=$3
    target=$4
    libs="$generated/jniLibs/$abi"
    mkdir -p "$work/$abi" "$libs"
    cd "$work/$abi"

    "$ffmpeg/configure" --target-os=android --enable-cross-compile --arch="$arch" --cpu="$cpu" \
        --cc="$toolchain/$target$api-clang" --ar="$toolchain/llvm-ar" \
        --ranlib="$toolchain/llvm-ranlib" --nm="$toolchain/llvm-nm" --strip="$toolchain/llvm-strip" \
        --libdir="$libs" --incdir="$PWD/include" --enable-shared --disable-static --disable-autodetect --disable-symver \
        --disable-programs --disable-doc --disable-everything --disable-x86asm \
        --disable-avdevice --disable-avformat --disable-avfilter --disable-swscale --disable-postproc \
        --enable-decoder=ac3
    make -j "$jobs"
    make install-libs install-headers

    "$toolchain/$target$api-clang++" -std=c++11 -shared -fPIC -fvisibility=hidden \
        -static-libstdc++ -Wl,--no-undefined -Wl,-soname,libffmpegJNI.so \
        -I "$PWD/include" "$work/ffmpeg_jni.cc" -L "$libs" -lavcodec -lswresample -lavutil -llog \
        -o "$libs/libffmpegJNI.so"
)

build_abi arm64-v8a aarch64 armv8-a aarch64-linux-android
build_abi armeabi-v7a arm armv7-a armv7a-linux-androideabi
build_abi x86_64 x86_64 x86-64 x86_64-linux-android
build_abi x86 x86 i686 i686-linux-android

rm -rf "$output"
mkdir -p "$(dirname "$output")"
mv "$generated" "$output"
