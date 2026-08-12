import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

type PackageJSON = {
  bin?: Record<string, string> | string
  exports?: Record<string, ExportTarget>
  name: string
  version: string
}

type ExportTarget = Record<string, ExportTarget | string> | string

export function packageBinTargets(packageJSON: PackageJSON): Record<string, string> {
  if (typeof packageJSON.bin === 'string') return { [packageJSON.name]: packageJSON.bin }
  return packageJSON.bin ?? {}
}

export async function tarballEntries(tarballPath: string): Promise<Set<string>> {
  const { stdout } = await execFileAsync('tar', ['-tf', tarballPath], { encoding: 'utf8' })
  return new Set(stdout.trim().split('\n').filter(Boolean))
}

export async function tarballPackageJSON(tarballPath: string): Promise<PackageJSON> {
  const { stdout } = await execFileAsync('tar', ['-xOf', tarballPath, 'package/package.json'], {
    encoding: 'utf8'
  })
  return JSON.parse(stdout) as PackageJSON
}

export async function validateTarballBinTargets(tarballPath: string): Promise<void> {
  const entries = await tarballEntries(tarballPath)
  const packageJSON = await tarballPackageJSON(tarballPath)

  for (const [name, target] of Object.entries(packageBinTargets(packageJSON))) {
    const entry = `package/${target.replace(/^\.\//, '')}`
    if (!entries.has(entry)) {
      throw new Error(`${tarballPath}: bin ${name} target missing from tarball: ${entry}`)
    }
  }
}

function exportTargetPaths(target: ExportTarget): string[] {
  if (typeof target === 'string') return [target]
  return Object.values(target).flatMap(exportTargetPaths)
}

export async function validateTarballExportTargets(tarballPath: string): Promise<void> {
  const entries = await tarballEntries(tarballPath)
  const packageJSON = await tarballPackageJSON(tarballPath)

  for (const [name, target] of Object.entries(packageJSON.exports ?? {})) {
    for (const path of exportTargetPaths(target)) {
      const entry = `package/${path.replace(/^\.\//, '')}`
      if (!entries.has(entry)) {
        throw new Error(`${tarballPath}: export ${name} target missing from tarball: ${entry}`)
      }
    }
  }
}

export async function validatePackedTarballs(directory: string): Promise<void> {
  const tarballs = (await readdir(directory)).filter((name) => name.endsWith('.tgz'))
  for (const tarball of tarballs) {
    const path = join(directory, tarball)
    await validateTarballBinTargets(path)
    await validateTarballExportTargets(path)
  }
}
