import type { ThemeId } from "../renderer/theme.store";
import { app, remote } from 'electron';
import semver from "semver"
import { readFile } from "fs-extra"
import { action, observable, reaction, toJS } from "mobx";
import { BaseStore } from "./base-store";
import migrations from "../migrations/user-store"
import { getAppVersion } from "./utils/app-version";
import { kubeConfigDefaultPath, loadConfig } from "./kube-helpers";
import { tracker } from "./tracker";
import logger from "../main/logger";
import path from 'path';
import jwt_decode from "jwt-decode";
import { List } from "material-ui";

export interface UserStoreModel {
  kubeConfigPath: string;
  lastSeenAppVersion: string;
  seenContexts: string[];
  preferences: UserPreferences;
  k8sToken: TokenContents;
  kaasToken: TokenContents;
  lastLoggedInUser: string;
  isLoggedIn: boolean;
}

export interface UserPreferences {
  httpsProxy?: string;
  colorTheme?: string;
  allowUntrustedCAs?: boolean;
  allowTelemetry?: boolean;
  downloadMirror?: string | "default";
  downloadKubectlBinaries?: boolean;
  downloadBinariesPath?: string;
  kubectlBinariesPath?: string;
}

export interface TokenContents {
  preferredUserName?: string,
  token?: string;
  tokenValidTill?: number;
  refreshToken?: string;
  refreshTokenValidTill?: number; 
}

interface IDToken {
  jti: string,
  exp: number,
  nbf: number,
  iat: number,
  iss: string,
  aud: string,
  sub: string,
  typ: string,
  azp: string,
  auth_time: number,
  session_state: string,
  acr: string,
  iam_roles: string[],
  email_verified: boolean,
  preferred_username: string
}

interface RefreshToken {
  jti: string,
  exp: number,
  nbf: number,
  iat: number,
  iss: string,
  aud: string,
  sub: string,
  typ: string,
  azp: string,
  auth_time: number,
  session_state: string,
  realm_access: Array<string[]>,
  scope: string
}

export class UserStore extends BaseStore<UserStoreModel> {
  static readonly defaultTheme: ThemeId = "kontena-dark"

  private constructor() {
    super({
      // configName: "lens-user-store", // todo: migrate from default "config.json"
      migrations: migrations,
    });

    // track telemetry availability
    reaction(() => this.preferences.allowTelemetry, allowed => {
      tracker.event("telemetry", allowed ? "enabled" : "disabled");
    });

    // refresh new contexts
    this.whenLoaded.then(this.refreshNewContexts);
    reaction(() => this.kubeConfigPath, this.refreshNewContexts);
  }

  @observable lastSeenAppVersion = "0.0.0"
  @observable kubeConfigPath = kubeConfigDefaultPath; // used in add-cluster page for providing context
  @observable seenContexts = observable.set<string>();
  @observable newContexts = observable.set<string>();

  @observable preferences: UserPreferences = {
    allowTelemetry: true,
    allowUntrustedCAs: false,
    colorTheme: UserStore.defaultTheme,
    downloadMirror: "default",
    downloadKubectlBinaries: true,  // Download kubectl binaries matching cluster version
    downloadBinariesPath: this.getDefaultKubectlPath(),
    kubectlBinariesPath: ""
  };

  @observable k8sToken = {};

  @observable kaasToken = {};

  @observable lastLoggedInUser = "";

  @observable isLoggedIn = false;

  get isNewVersion() {
    return semver.gt(getAppVersion(), this.lastSeenAppVersion);
  }

  get isUserLoggedIn() {
    return this.isLoggedIn ? true : false;
  }

  get isUserLoggedOut() {
    return this.isLoggedIn ? false : true;
  }

  @action
  resetKubeConfigPath() {
    this.kubeConfigPath = kubeConfigDefaultPath;
  }

  @action
  resetTheme() {
    this.preferences.colorTheme = UserStore.defaultTheme;
  }

  @action
  saveLastSeenAppVersion() {
    tracker.event("app", "whats-new-seen")
    this.lastSeenAppVersion = getAppVersion();
  }

  protected refreshNewContexts = async () => {
    try {
      const kubeConfig = await readFile(this.kubeConfigPath, "utf8");
      if (kubeConfig) {
        this.newContexts.clear();
        loadConfig(kubeConfig).getContexts()
          .filter(ctx => ctx.cluster)
          .filter(ctx => !this.seenContexts.has(ctx.name))
          .forEach(ctx => this.newContexts.add(ctx.name));
      }
    } catch (err) {
      logger.error(err);
      this.resetKubeConfigPath();
    }
  }

  @action
  markNewContextsAsSeen() {
    const { seenContexts, newContexts } = this;
    this.seenContexts.replace([...seenContexts, ...newContexts]);
    this.newContexts.clear();
  }

  /**
   * Getting default directory to download kubectl binaries
   * @returns string
   */
  getDefaultKubectlPath(): string {
    return path.join((app || remote.app).getPath("userData"), "binaries")
  }

  getTokenDetails(clientId: string): TokenContents {
      logger.info(`[USERSTORE]: getTokenDetails for client id ${clientId}`)
      
      if (clientId==="k8s") {
        logger.debug(`[USERSTORE]: getTokenDetails - token retrieved ${JSON.stringify(this.k8sToken)}`)
        return this.k8sToken
      };
      if (clientId==="kaas") {
        logger.debug(`[USERSTORE]: getTokenDetails - token retrieved ${JSON.stringify(this.kaasToken)}`)
        return this.kaasToken
      }; 
  }

  decodeToken(token: string) {
    if (token.length > 0) {
      return jwt_decode<IDToken>(token);
    }
  }

  decodeRefreshToken(refreshToken: string) {
    if (refreshToken.length > 0) {
      return jwt_decode<RefreshToken>(refreshToken);
    }
  }

  getIDTokenIAMPermissions(token: string): string[] {
    let tokenDecoded = this.decodeToken(token);
    const userRoles = tokenDecoded.iam_roles || [];
    return userRoles
  }

  isTokenExpired(validTill: number): boolean {
    // Create a current UnixTime style date in ms
    const timeNow = Math.round(Date.now());
    logger.info(`[USERSTORE]: isTokenExpired: timeNow: ${new Date(timeNow).toString()}`);
    logger.info(`[USERSTORE]: isTokenExpired: validTill: ${new Date(validTill).toString()}`);
    //if ((new Date(validTill).getMinutes() - new Date().getMinutes()) / 1000 / 60 < 0) {
    if (timeNow > validTill) {
      return true;
    }
    return false;
  }

  @action
  setTokenDetails(token: string, refreshToken: string, clientId: string) {
    
    let tokenDecoded = this.decodeToken(token);
    let refreshTokenDecoded = this.decodeToken(refreshToken);
    
    let newToken: TokenContents = {};

    newToken.token = token;
    newToken.refreshToken = refreshToken;
    newToken.preferredUserName = tokenDecoded.preferred_username;

    // Create a current UnixTime style date in secs
    newToken.tokenValidTill = tokenDecoded.exp * 1000; 
    newToken.refreshTokenValidTill = refreshTokenDecoded.exp * 1000;

    logger.debug(`[USERSTORE]: setTokenDetails - The saved token object for client id ${clientId} is: ${JSON.stringify(newToken)}`);
    const tokenSavedAt = new Date();
    logger.debug(`[USERSTORE]: setTokenDetails - Token retrieved at: ${tokenSavedAt.toLocaleTimeString()}`);
    logger.debug(`[USERSTORE]: setTokenDetails - Check if token date is expired: ${this.isTokenExpired(newToken.tokenValidTill)}`);
    if (clientId==="k8s") {this.k8sToken = newToken};
    if (clientId==="kaas") {this.kaasToken = newToken}; 
  }

  @action
  saveLoggedInUser(username: string) {
    this.isLoggedIn = true;
    this.lastLoggedInUser = username;
    logger.info(`[USERSTORE]: setting isLoggedIn to true`);
  }
  
  @action
  saveLastLoggedInUser() {
    this.isLoggedIn = false;
    logger.info(`[USERSTORE]: setting isLoggedIn to false}`);
  }

  @action
  protected async fromStore(data: Partial<UserStoreModel> = {}) {
    try {
      const { lastSeenAppVersion, seenContexts = [], preferences, kubeConfigPath, k8sToken, kaasToken, isLoggedIn } = data
      if (lastSeenAppVersion) {
        this.lastSeenAppVersion = lastSeenAppVersion;
      }
      if (kubeConfigPath) {
        this.kubeConfigPath = kubeConfigPath;
      }
      this.seenContexts.replace(seenContexts);
      Object.assign(this.preferences, preferences);
      Object.assign(this.kaasToken, kaasToken);
      Object.assign(this.k8sToken, k8sToken);
      this.isLoggedIn = isLoggedIn;
    } catch (err) {
      logger.error(`[USERSTORE]: fromStore - Error caught - ${String(err)}`)
    }
  }

  toJSON(): UserStoreModel {
    const model: UserStoreModel = {
      kubeConfigPath: this.kubeConfigPath,
      lastSeenAppVersion: this.lastSeenAppVersion,
      seenContexts: Array.from(this.seenContexts),
      preferences: this.preferences,
      kaasToken: this.kaasToken,
      k8sToken: this.k8sToken,
      lastLoggedInUser: this.lastLoggedInUser,
      isLoggedIn: this.isLoggedIn,
    }
    return toJS(model, {
      recurseEverything: true,
    })
  }
}

export const userStore = UserStore.getInstance<UserStore>();
