import { join } from 'node:path'

import {
  packageIdentities,
  packPublishDirectories,
  preflightAbsentVersions,
  publishTarballs,
  smokePackedPackages,
  tarballsIn,
  validateExactTarballSet
} from './release'

const root = process.cwd()
const command = process.argv[2]
const tarballDirectory = join(root, '.npm-packages')

if (command === 'preflight') {
  await preflightAbsentVersions(await packageIdentities(root))
} else if (command === 'pack') {
  const tarballs = await packPublishDirectories(root)
  await validateExactTarballSet(root, tarballs)
  await smokePackedPackages(tarballs)
} else if (command === 'publish') {
  const tarballs = await tarballsIn(tarballDirectory)
  await validateExactTarballSet(root, tarballs)
  await publishTarballs(tarballs)
} else {
  throw new Error('Usage: bun tools/release-packages/src/cli.ts <preflight|pack|publish>')
}
