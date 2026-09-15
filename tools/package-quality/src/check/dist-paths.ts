/**
 * A published package may only describe itself. Everything here exists because a
 * build wrote the machine it ran on into `dist`, and the resulting tarball was
 * either broken or a disclosure:
 *
 * - `npm pack` drops every `node_modules/` and dot-directory, wherever it sits.
 *   An emitted file underneath one is simply absent from the tarball, so a chunk
 *   importing it ships broken and nothing local ever notices.
 * - A specifier that climbs out of the package resolves to whatever happens to
 *   sit beside it on the build machine, which on a consumer's disk is nothing.
 * - An absolute path is a directory the consumer does not have, and a home
 *   directory they should not be handed.
 *
 * A Grove worktree resolves dependencies through a shared store under the
 * canonical checkout's `.git/`, so what a canonical build merely makes ugly, a
 * worktree build makes fatal. Both are wrong; this fails on both.
 *
 * Known gap: rolldown labels each inlined module with a `//#region <path>`
 * comment written relative to the build cwd, and for a deliberately bundled
 * dependency that path leaves the package. Comments are inert and rolldown
 * exposes no option for them, so they are not checked here. Specifiers, file
 * locations and absolute paths are.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

import { publicPackageDirs } from '../packages'

const TEXT_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.json', '.map', '.css']

/**
 * Only emitted code is read for specifiers. A sourcemap carries `sourcesContent`
 * — the original file, imports and all — and those specifiers belong to the
 * source tree, not to the package.
 */
const CODE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts']

/** `from '…'`, `import('…')`, `import '…'`, `require('…')`. */
const SPECIFIER = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*(['"])([^'"\n]+)\1/g

/** A POSIX home directory — the shape every absolute leak so far has taken. */
const ABSOLUTE_PATH = /\/(?:Users|home)\/[A-Za-z0-9._-]+\//

const errors: string[] = []

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return walk(path)
    return entry.isFile() ? [path] : []
  })
}

/** The first directory `npm pack` would drop this file with, if any. */
function droppedByPack(relativePath: string): string | undefined {
  return relativePath
    .split(sep)
    .slice(0, -1)
    .find((segment) => segment === 'node_modules' || segment.startsWith('.'))
}

function escapesPackage(file: string, specifier: string, packageDir: string): boolean {
  if (!specifier.startsWith('.')) return false
  if (specifier.split('/').includes('node_modules')) return true
  return relative(resolve(packageDir), resolve(dirname(file), specifier)).startsWith('..')
}

for (const packageDir of publicPackageDirs) {
  const distDir = join(packageDir, 'dist')
  try {
    if (!statSync(distDir).isDirectory()) continue
  } catch {
    errors.push(`${packageDir}: dist is missing — build the package before checking it`)
    continue
  }

  for (const file of walk(distDir)) {
    const relativePath = relative(packageDir, file)

    const dropped = droppedByPack(relativePath)
    if (dropped) {
      errors.push(`${relativePath}: emitted under ${dropped}/, which npm pack drops`)
      continue
    }

    if (!TEXT_EXTENSIONS.some((extension) => relativePath.endsWith(extension))) continue
    const contents = readFileSync(file, 'utf8')

    const absolute = ABSOLUTE_PATH.exec(contents)
    if (absolute) {
      errors.push(`${relativePath}: contains the build machine's path ${absolute[0]}…`)
    }

    if (!CODE_EXTENSIONS.some((extension) => relativePath.endsWith(extension))) continue
    for (const [, , specifier] of contents.matchAll(SPECIFIER)) {
      if (escapesPackage(file, specifier, packageDir)) {
        errors.push(`${relativePath}: imports ${specifier}, which is outside the package`)
      }
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)
}

console.log('Built packages contain no paths from the machine that built them.')
