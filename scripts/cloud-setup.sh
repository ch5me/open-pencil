#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

log() {
  printf '[cloud-setup] %s\n' "$*"
}

fail() {
  printf '[cloud-setup] ERROR: %s\n' "$*" >&2
  exit 1
}

command -v mise >/dev/null 2>&1 || fail "mise is required to activate .mise.toml"
mise trust -y "$ROOT_DIR/.mise.toml" >/dev/null
mise install -C "$ROOT_DIR" -y

node_dir="$(mise where -C "$ROOT_DIR" node)"
bun_dir="$(mise where -C "$ROOT_DIR" bun)"
export PATH="$node_dir/bin:$bun_dir/bin:$PATH"

test "$(node --version)" = "v24.14.1" || fail "expected Node v24.14.1"
test "$(bun --version)" = "1.3.14" || fail "expected Bun 1.3.14"

if [ -z "${NPM_TOKEN:-}" ]; then
  fail "NPM_TOKEN is required for private CH5 packages"
fi

umask 077
npmrc="$(mktemp "${TMPDIR:-/tmp}/open-pencil-npmrc.XXXXXX")"
trap 'rm -f "$npmrc"' EXIT
{
  printf 'registry=https://registry.npmjs.org/\n'
  printf '@ch5me:registry=https://npm.ch5.me/\n'
  printf '@chriscode:registry=https://npm.ch5.me/\n'
  printf '@open-pencil:registry=https://npm.ch5.me/\n'
  printf '//npm.ch5.me/:_authToken=%s\n' "$NPM_TOKEN"
} > "$npmrc"
chmod 600 "$npmrc"
export NPM_CONFIG_USERCONFIG="$npmrc"

log "installing root dependencies"
bun install --frozen-lockfile
log "installing API dependencies"
bun install --cwd api --frozen-lockfile
