import { app, remote } from "electron"
import  { ensureDirSync, writeFileSync } from "fs-extra"
import * as path from "path"

/**
 *
 * @returns app version correctly regardless of dev/prod mode and main/renderer differences
 */
export function getAppVersion(): string {
  // app is undefined when running in renderer
  let version = (app || remote.app).getVersion()
  if(process.env.NODE_ENV === 'development') {
    version = require("../../package.json").version
  }
  return version;
}

// Writes kubeconfigs to "embedded" store, i.e. .../Lens/kubeconfigs/
export function writeEmbeddedKubeConfig(clusterId: string, kubeConfig: string): string {
  // This can be called from main & renderer
  const a = (app || remote.app)
  const kubeConfigBase = path.join(a.getPath("userData"), "kubeconfigs")
  ensureDirSync(kubeConfigBase)

  const kubeConfigFile = path.join(kubeConfigBase, clusterId)
  writeFileSync(kubeConfigFile, kubeConfig)

  return kubeConfigFile
}