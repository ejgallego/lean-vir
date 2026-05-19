#!/usr/bin/env bash
#
# Copyright (c) 2026 Lean FRO LLC. All rights reserved.
# Released under Apache 2.0 license as described in the file LICENSE.
# Author: Emilio J. Gallego Arias

set -euo pipefail

cd "$(dirname "$0")/.."

host_os="${VIR_WASM_ENGINE_OS:-}"
host_arch="${VIR_WASM_ENGINE_ARCH:-}"
engines="${VIR_WASM_ENGINES:-wasmtime wasmer wasmedge}"

if [ -z "$host_os" ]; then
  case "$(uname -s)" in
    Linux) host_os=linux ;;
    *) echo "error: unsupported OS $(uname -s); set VIR_WASM_ENGINE_OS manually" >&2; exit 1 ;;
  esac
fi

if [ -z "$host_arch" ]; then
  case "$(uname -m)" in
    x86_64|amd64) host_arch=x86_64 ;;
    *) echo "error: unsupported architecture $(uname -m); set VIR_WASM_ENGINE_ARCH manually" >&2; exit 1 ;;
  esac
fi

cache_dir=".tools/cache"
mkdir -p "$cache_dir" .tools

download() {
  local url="$1"
  local archive="$2"
  if [ ! -f "$archive" ]; then
    echo "downloading $url"
    curl --fail --location --progress-bar "$url" --output "$archive"
  fi
}

verify_sha256() {
  local archive="$1"
  local expected="$2"
  if [ -n "$expected" ]; then
    echo "${expected}  ${archive}" | sha256sum --check -
  else
    echo "warning: no SHA-256 configured for ${archive}" >&2
  fi
}

extract_archive() {
  local archive="$1"
  local install_dir="$2"
  local tmp_dir="$3"
  rm -rf "$tmp_dir"
  mkdir -p "$tmp_dir"
  case "$archive" in
    *.tar.gz) tar -xzf "$archive" -C "$tmp_dir" ;;
    *.tar.xz) tar -xJf "$archive" -C "$tmp_dir" ;;
    *) echo "error: unsupported archive format $archive" >&2; exit 1 ;;
  esac

  rm -rf "$install_dir"
  shopt -s nullglob
  local entries=("$tmp_dir"/*)
  if [ "${#entries[@]}" = "1" ] && [ -d "${entries[0]}" ]; then
    mv "${entries[0]}" "$install_dir"
  else
    mkdir -p "$install_dir"
    mv "$tmp_dir"/* "$install_dir"/
  fi
  shopt -u nullglob
  rm -rf "$tmp_dir"
}

install_wasmtime() {
  local version="${WASMTIME_VERSION:-44.0.1}"
  local asset url archive install_dir expected_sha
  if [ "$host_os" != "linux" ] || [ "$host_arch" != "x86_64" ]; then
    echo "error: wasmtime installer currently supports linux x86_64 only" >&2
    exit 1
  fi
  asset="wasmtime-v${version}-x86_64-linux.tar.xz"
  url="https://github.com/bytecodealliance/wasmtime/releases/download/v${version}/${asset}"
  archive="${cache_dir}/${asset}"
  install_dir=".tools/wasmtime-v${version}-x86_64-linux"
  expected_sha="${WASMTIME_SHA256:-afd58715f105e3a7f454169daed22168c5736ec5f225fb04c4ac62c54c9508a3}"

  download "$url" "$archive"
  verify_sha256 "$archive" "$expected_sha"
  if [ ! -x "$install_dir/wasmtime" ]; then
    extract_archive "$archive" "$install_dir" ".tools/.extract-wasmtime"
  fi
  rm -f .tools/wasmtime
  ln -s "$(basename "$install_dir")" .tools/wasmtime
  echo "installed $install_dir"
}

install_wasmer() {
  local version="${WASMER_VERSION:-7.1.0}"
  local asset url archive install_dir expected_sha
  if [ "$host_os" != "linux" ] || [ "$host_arch" != "x86_64" ]; then
    echo "error: wasmer installer currently supports linux x86_64 only" >&2
    exit 1
  fi
  asset="wasmer-linux-amd64.tar.gz"
  url="https://github.com/wasmerio/wasmer/releases/download/v${version}/${asset}"
  archive="${cache_dir}/wasmer-v${version}-linux-amd64.tar.gz"
  install_dir=".tools/wasmer-v${version}-linux-amd64"
  expected_sha="${WASMER_SHA256:-61a6ad0f972ee0afbb7907ab90f1120e15d2e219ec1ce08999f2864e0b8c340f}"

  download "$url" "$archive"
  verify_sha256 "$archive" "$expected_sha"
  if [ ! -x "$install_dir/bin/wasmer" ] && [ ! -x "$install_dir/wasmer" ]; then
    extract_archive "$archive" "$install_dir" ".tools/.extract-wasmer"
  fi
  rm -f .tools/wasmer
  ln -s "$(basename "$install_dir")" .tools/wasmer
  echo "installed $install_dir"
}

install_wasmedge() {
  local version="${WASMEDGE_VERSION:-0.17.0}"
  local asset url archive install_dir expected_sha
  if [ "$host_os" != "linux" ] || [ "$host_arch" != "x86_64" ]; then
    echo "error: wasmedge installer currently supports linux x86_64 only" >&2
    exit 1
  fi
  asset="WasmEdge-${version}-manylinux_2_28_x86_64.tar.gz"
  url="https://github.com/WasmEdge/WasmEdge/releases/download/${version}/${asset}"
  archive="${cache_dir}/${asset}"
  install_dir=".tools/wasmedge-${version}-manylinux_2_28_x86_64"
  expected_sha="${WASMEDGE_SHA256:-5d8165559c553eacc9b87db1799c2204e056db8609bedbf61eb29f8a21a42993}"

  download "$url" "$archive"
  verify_sha256 "$archive" "$expected_sha"
  if [ ! -x "$install_dir/bin/wasmedge" ]; then
    extract_archive "$archive" "$install_dir" ".tools/.extract-wasmedge"
  fi
  rm -f .tools/wasmedge
  ln -s "$(basename "$install_dir")" .tools/wasmedge
  echo "installed $install_dir"
}

for engine in $engines; do
  case "$engine" in
    wasmtime) install_wasmtime ;;
    wasmer) install_wasmer ;;
    wasmedge) install_wasmedge ;;
    *) echo "error: unknown engine '$engine'" >&2; exit 1 ;;
  esac
done

echo
echo "Installed engine commands:"
echo "  .tools/wasmtime/wasmtime"
echo "  .tools/wasmer/bin/wasmer or .tools/wasmer/wasmer"
echo "  .tools/wasmedge/bin/wasmedge"
