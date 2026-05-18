#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

version="${WASI_SDK_VERSION:-33}"
version_full="${WASI_SDK_VERSION_FULL:-33.0}"
host_os="${WASI_SDK_OS:-}"
host_arch="${WASI_SDK_ARCH:-}"

if [ -z "$host_os" ]; then
  case "$(uname -s)" in
    Linux) host_os=linux ;;
    Darwin) host_os=macos ;;
    *) echo "error: unsupported OS $(uname -s); set WASI_SDK_OS manually" >&2; exit 1 ;;
  esac
fi

if [ -z "$host_arch" ]; then
  case "$(uname -m)" in
    x86_64|amd64) host_arch=x86_64 ;;
    aarch64|arm64) host_arch=arm64 ;;
    riscv64) host_arch=riscv64 ;;
    *) echo "error: unsupported architecture $(uname -m); set WASI_SDK_ARCH manually" >&2; exit 1 ;;
  esac
fi

asset="wasi-sdk-${version_full}-${host_arch}-${host_os}.tar.gz"
url="https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${version}/${asset}"
cache_dir=".tools/cache"
install_dir=".tools/wasi-sdk-${version_full}-${host_arch}-${host_os}"
archive="${cache_dir}/${asset}"
expected_sha="${WASI_SDK_SHA256:-}"

if [ "$version" = "33" ] && [ "$version_full" = "33.0" ] && [ "$host_arch" = "x86_64" ] && [ "$host_os" = "linux" ]; then
  expected_sha="0ba8b5bfaeb2adf3f29bab5841d76cf5318ab8e1642ea195f88baba1abd47bce"
fi

mkdir -p "$cache_dir" .tools

if [ ! -f "$archive" ]; then
  echo "downloading $url"
  curl --fail --location --progress-bar "$url" --output "$archive"
fi

if [ -n "$expected_sha" ]; then
  echo "${expected_sha}  ${archive}" | sha256sum --check -
else
  echo "warning: no SHA-256 configured for ${asset}" >&2
fi

if [ ! -x "$install_dir/bin/clang" ]; then
  tmp_dir=".tools/.extract-wasi-sdk"
  rm -rf "$tmp_dir"
  mkdir -p "$tmp_dir"
  tar -xzf "$archive" -C "$tmp_dir"
  extracted="$(find "$tmp_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  rm -rf "$install_dir"
  mv "$extracted" "$install_dir"
  rm -rf "$tmp_dir"
fi

rm -f .tools/wasi-sdk
ln -s "$(basename "$install_dir")" .tools/wasi-sdk

echo "installed $install_dir"
echo "WASI_SDK_PATH=$PWD/.tools/wasi-sdk"

