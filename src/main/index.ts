// Main process

import "../common/system-ca"
import "../common/prometheus-providers"
import { app, dialog } from "electron"
import { appName } from "../common/vars";
import path from "path"
import { LensProxy } from "./lens-proxy"
import { WindowManager } from "./window-manager";
import { ClusterManager } from "./cluster-manager";
import AppUpdater from "./app-updater"
import { shellSync } from "./shell-sync"
import { getFreePort } from "./port"
import { mangleProxyEnv } from "./proxy-env"
import { registerFileProtocol } from "../common/register-protocol";
import { ClusterStore, clusterStore } from "../common/cluster-store"
import { userStore } from "../common/user-store";
import { workspaceStore } from "../common/workspace-store";
import { tracker } from "../common/tracker";
import logger from "./logger"
import * as fs from 'fs';
import * as http from "http";
import * as request from "request-promise-native";
import { uniqueId } from "lodash";
import { v4 as uuid } from "uuid";
import { Cluster } from "../main/cluster";
import {kubeconfig} from '../common/utils/k8sTemplates';
import YAML from 'yaml';
import { DECCManager } from "./decc-manager";

const workingDir = path.join(app.getPath("appData"), appName);
app.setName(appName);
if (!process.env.CICD) {
  app.setPath("userData", workingDir);
}

let windowManager: WindowManager;
let clusterManager: ClusterManager;
let proxyServer: LensProxy;
let deccManager: DECCManager;

mangleProxyEnv()
if (app.commandLine.getSwitchValue("proxy-server") !== "") {
  process.env.HTTPS_PROXY = app.commandLine.getSwitchValue("proxy-server")
}

const keycloakWinURL = process.env.NODE_ENV === 'development'
? `http://localhost:3000/keycloak_index.html`
: `file://${__static}/keycloak_index.html`
const { ipcMain } = require('electron')

async function main() {
  await shellSync();
  logger.info(`🚀 Starting Lens from "${workingDir}"`)

  tracker.event("app", "start");
  const updater = new AppUpdater()
  updater.start();

  registerFileProtocol("static", __static);

  // find free port
  let proxyPort: number
  try {
    proxyPort = await getFreePort()
  } catch (error) {
    logger.error(error)
    dialog.showErrorBox("Lens Error", "Could not find a free port for the cluster proxy")
    app.quit();
  }

  // preload configuration from stores
  await Promise.all([
    userStore.load(),
    clusterStore.load(),
    workspaceStore.load(),
  ]);

  // create cluster manager
  clusterManager = new ClusterManager(proxyPort);

  // run proxy
  try {
    proxyServer = LensProxy.create(proxyPort, clusterManager);
  } catch (error) {
    logger.error(`Could not start proxy (127.0.0:${proxyPort}): ${error.message}`)
    dialog.showErrorBox("Lens Error", `Could not start proxy (127.0.0:${proxyPort}): ${error.message || "unknown error"}`)
    app.quit();
  }

  
  //start renderer with keycloak login page
  const keycloakServer = http.createServer(function(req: http.IncomingMessage, res: http.ServerResponse) {
    res.writeHead(200, {"Content-Type": "text/html"});  
    var readSream = fs.createReadStream(__static + '/keycloak_index.html','utf8')
    readSream.pipe(res);
  }).listen(3000);

    //start renderer with keycloak login page
    const deccServer = http.createServer(function(req: http.IncomingMessage, res: http.ServerResponse) {
      res.writeHead(200, {"Content-Type": "text/html"});  
      var readSream = fs.createReadStream(__static + '/decc_login.html','utf8')
      readSream.pipe(res);
    }).listen(3001);

  // create cluster manager
  //deccManager = new DECCManager(keycloakServer, 'a09bfce9ea3074e25b8e5e7b1df576fd-1162277427.eu-west-2.elb.amazonaws.com');


  // create window manager and open app
  windowManager = new WindowManager(proxyPort, 3001);
  //windowManager = new WindowManager(3000);

  //open login page in keyloak renderer
  // if (isDevelopment) {
  //   process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  //   app.commandLine.appendSwitch('allow-insecure-localhost', 'true');
  //   app.commandLine.appendSwitch('ignore-certificate-errors', 'true');
  // }

  // SSL/TSL: this is the self signed certificate support
  app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    // On certificate error we disable default behaviour (stop loading the page)
    // and we then say "it is all fine - true" to the callback
    logger.error('cert error: ' + String(error));
    event.preventDefault();
    callback(true);
  });

  logger.info(`Current DECC details are: ${JSON.stringify(userStore.preferences.decc)}`);

  //windowManager.showMain(keycloakWinURL);
}

async function processLogin(username: string, password: string, deccManagerUrl: string) {
  logger.info('processLogin');
  try {
    userStore.preferences.decc.username = username;
    userStore.preferences.decc.password = password;
    userStore.preferences.decc.url = deccManagerUrl;
    
    var deccURL = userStore.preferences.decc.url != '' ? userStore.preferences.decc.url : process.env.DECC_URL
    logger.info(`processLogin: Current deccURL is ${deccURL}`);
    if (deccURL != '' && deccURL != undefined) {
      // create decc manager
      deccManager = new DECCManager(deccURL);
       
      let userKaasToken = await deccManager.getK8sTokenForUser(username, password, 'kaas');
      logger.info(`processLogin: userKaasToken is - ${JSON.stringify(userKaasToken)}`);
      userStore.setTokenDetails(userKaasToken["id_token"], userKaasToken["refresh_token"]); 
      // setup clusters from DECC
      await deccManager.createDECCLensEnv();
    }

    await clusterStore.load();
    await windowManager.showMain();

  } catch (err) {
    logger.error(`processLogin: Error - ${String(err)}`);
  }
}

async function processKCLogin(idToken, refreshToken) {
  logger.info('processKCLogin');

  try {
    userStore.setTokenDetails(idToken, refreshToken);
    //logger.info('saved id token and refreshToken to userStore');

    //logger.info('the idToken is: ' + userStore.getTokenDetails().token);

    var parsedToken = userStore.decodeToken (idToken);
    
    var deccURL = userStore.preferences.decc.url != '' ? userStore.preferences.decc.url : process.env.DECC_URL
    logger.info(`Current deccURL is ${deccURL}`);
    if (deccURL != '' && deccURL != undefined) {
      // create decc manager
      deccManager = new DECCManager(deccURL);
      // setup clusters from DECC
      await deccManager.createDECCLensEnv();
    }
    
    await clusterStore.load();
    await windowManager.showMain();
  } catch (err) {
    logger.error(`processKCLogin: Error - ${String(err)}`);
  }

}

app.on("ready", main);

app.on("will-quit", async (event) => {
  event.preventDefault(); // To allow mixpanel sending to be executed
  if (proxyServer) proxyServer.close()
  if (clusterManager) clusterManager.stop()
  app.exit();
})

ipcMain.on('decc-login', (event, username, password, deccManagerUrl) => {
  processLogin(username, password,deccManagerUrl );  
});

ipcMain.on('keycloak-token', (event, idToken, refreshToken) => {
  processKCLogin(idToken, refreshToken);  
});

ipcMain.on('keycloak-token-update', (event, idToken, refreshToken) => {
  logger.info('token refresh receivied:' + idToken);
  if(userStore.isTokenExpired(userStore.token.tokenValidTill)) {
    userStore.setTokenDetails(idToken, refreshToken);
    logger.info('saved new id token and refreshToken to userStore');
    logger.info('the idToken is: ' + userStore.getTokenDetails().token);
    //deccManager.refreshClusterKubeConfigs();
  };
});

ipcMain.on('keycloak-logout', (event, data) => {
  logger.error('logout');
  windowManager.showKeycloak();
});
