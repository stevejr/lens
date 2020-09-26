import path from "path"
import Config from "conf"
import { Options as ConfOptions } from "conf/dist/source/types"
import { app, ipcMain, IpcMainEvent, ipcRenderer, IpcRendererEvent, remote } from "electron"
import { action, observable, reaction, runInAction, toJS, when } from "mobx";
import Singleton from "./utils/singleton";
import { getAppVersion } from "./utils/app-version";
import logger from "../main/logger";
import { broadcastIpc, IpcBroadcastParams } from "./ipc";
import isEqual from "lodash/isEqual";

export interface BaseStoreParams<T = any> extends ConfOptions<T> {
  autoLoad?: boolean;
  syncEnabled?: boolean;
}

export class BaseStore<T = any> extends Singleton {
  protected storeConfig: Config<T>;
  protected syncDisposers: Function[] = [];

  whenLoaded = when(() => this.isLoaded);
  @observable isLoaded = false;
  @observable protected data: T;

  protected constructor(protected params: BaseStoreParams) {
    super();
    this.params = {
      autoLoad: false,
      syncEnabled: true,
      ...params,
    }
    this.init();
  }

  get name() {
    return path.basename(this.storeConfig.path);
  }

  get syncChannel() {
    return `store-sync:${this.name}`
  }

  protected async init() {
    try {
      if (this.params.autoLoad) {
        await this.load();
      }
      if (this.params.syncEnabled) {
        await this.whenLoaded;
        this.enableSync();
      }
    } catch (err) {
      logger.error(`[STORE]: Error caught - ${err}`)
    }
  }

  async load() {
    try {
      const { autoLoad, syncEnabled, ...confOptions } = this.params;
      this.storeConfig = new Config({
        ...confOptions,
        projectName: "lens",
        projectVersion: getAppVersion(),
        cwd: (app || remote.app).getPath("userData"),
      });
      logger.info(`[STORE]: LOADED from ${this.storeConfig.path}`);
      this.fromStore(this.storeConfig.store);
      this.isLoaded = true;
    } catch (err) {
      logger.error(`[STORE]: Error caught - ${err}`)
    }
  }

  protected async saveToFile(model: T) {
    try {
      logger.info(`[STORE]: SAVING ${this.name}`);
      // todo: update when fixed https://github.com/sindresorhus/conf/issues/114
      Object.entries(model).forEach(([key, value]) => {
        this.storeConfig.set(key, value);
      });
    } catch (err) {
      logger.error(`[STORE]: Error caught - ${err}`)
    } 
  }

  enableSync() {
    this.syncDisposers.push(
      reaction(() => this.toJSON(), model => this.onModelChange(model)),
    );
    if (ipcMain) {
      const callback = (event: IpcMainEvent, model: T) => {
        logger.silly(`[STORE]: SYNC ${this.name} from renderer`, { model });
        this.onSync(model);
      };
      ipcMain.on(this.syncChannel, callback);
      this.syncDisposers.push(() => ipcMain.off(this.syncChannel, callback));
    }
    if (ipcRenderer) {
      const callback = (event: IpcRendererEvent, model: T) => {
        logger.silly(`[STORE]: SYNC ${this.name} from main`, { model });
        this.onSync(model);
      };
      ipcRenderer.on(this.syncChannel, callback);
      this.syncDisposers.push(() => ipcRenderer.off(this.syncChannel, callback));
    }
  }

  disableSync() {
    this.syncDisposers.forEach(dispose => dispose());
    this.syncDisposers.length = 0;
  }

  protected applyWithoutSync(callback: () => void) {
    this.disableSync();
    runInAction(callback);
    if (this.params.syncEnabled) {
      this.enableSync();
    }
  }

  protected onSync(model: T) {
    // todo: use "resourceVersion" if merge required (to avoid equality checks => better performance)
    if (!isEqual(this.toJSON(), model)) {
      this.fromStore(model);
    }
  }

  protected async onModelChange(model: T) {
    try {
      if (ipcMain) {
        this.saveToFile(model); // save config file
        this.syncToWebViews(model); // send update to renderer views
      }
      // send "update-request" to main-process
      if (ipcRenderer) {
        ipcRenderer.send(this.syncChannel, model);
      }
    } catch (err) {
      logger.error(`[STORE]: Error caught - ${err}`)
    }
  }

  protected async syncToWebViews(model: T) {
    try {
      const msg: IpcBroadcastParams = {
        channel: this.syncChannel,
        args: [model],
      }
      broadcastIpc(msg); // send to all windows (BrowserWindow, webContents)
      const frames = await this.getSubFrames();
      frames.forEach(frameId => {
        // send to all sub-frames (e.g. cluster-view managed in iframe)
        broadcastIpc({
          ...msg,
          frameId: frameId,
          frameOnly: true,
        });
      });
    } catch (err) {
      logger.error(`[STORE]: Error caught - ${err}`)
    }
  }

  // todo: refactor?
  protected async getSubFrames(): Promise<number[]> {
    try {
      const subFrames: number[] = [];
      const { clusterStore } = await import("./cluster-store");
      clusterStore.clustersList.forEach(cluster => {
        if (cluster.frameId) {
          subFrames.push(cluster.frameId)
        }
      });
      return subFrames;
    } catch (err) {
      logger.error(`[STORE]: Error caught - ${err}`)
    }
  }

  @action
  protected fromStore(data: T) {
    this.data = data;
  }

  // todo: use "serializr" ?
  toJSON(): T {
    return toJS(this.data, {
      recurseEverything: true,
    })
  }
}
