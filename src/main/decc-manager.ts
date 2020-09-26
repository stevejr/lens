import "../common/cluster-ipc";
import type http from "http"
import { action, autorun, observable, toJS } from "mobx";
import { ClusterModel, ClusterStore, clusterStore, getClusterIdFromHost } from "../common/cluster-store"
import { Cluster } from "./cluster"
import logger from "./logger";
import { apiKubePrefix } from "../common/vars";
import { workspaceStore, Workspace } from "../common/workspace-store";
import { userStore, UserStore, TokenContents } from "../common/user-store";
import * as request from "request-promise-native";
import { v4 as uuid } from "uuid";
import {kubeconfig} from '../common/utils/k8sTemplates';
import YAML from 'yaml';
import { readFile } from "fs-extra"
import { getNodeWarningConditions, loadConfig, podHasIssues } from "../common/kube-helpers"
import { customRequestPromise } from "../common/request";
import orderBy from "lodash/orderBy";
import queryString from 'query-string';
import { BaseStore } from "../common/base-store"

const ignoredDECCNamespaces =  [
  'kube-system', 'kube-public', 'openstack-provider-system', 'system',
  'kaas', 'lcm-system', 'istio-system', 'kube-node-lease', 'stacklight'
];

export interface DECCManagerModel {
  deccURL: string;
}

export class DECCManager extends BaseStore<DECCManagerModel> {

  private constructor() {
    super({
      // configName: "lens-user-store", // todo: migrate from default "config.json"
    });
  }

  deccURL = process.env.DECC_URL;

  // @action
  // setDECCURL(url: string) {
  //   this.deccURL = url
  // }

  async getNamespaces(token: string): Promise<[]> {
    try {
      const res = await customRequestPromise({
        uri: `http://${this.deccURL}/api/v1/namespaces`,
        headers: {
          'Authorization': 'Bearer ' + token
        },
        json: true,
        resolveWithFullResponse: true,
        timeout: 10000,
      });
      // logger.info(`getNamespaces: res - ${JSON.stringify(res)}`);
      return res.body;
    } catch (err) {
      logger.error(`[DECCMANAGER]: getNamespaces error - ${String(err)}]`);
    }
  }

  async getClustersByNamespace(ns: string, token: string): Promise<[]> {
    try {
      const res = await customRequestPromise({
        uri: `http://${this.deccURL}/apis/cluster.k8s.io/v1alpha1/namespaces/${ns}/clusters`,
        headers: {
          'Authorization': 'Bearer ' + token
        },
        json: true,
        resolveWithFullResponse: true,
        timeout: 10000,
      });
      // logger.info(`getClustersByNamespace: res - ${JSON.stringify(res)}`);
      return res.body;
    } catch (err) {
      logger.error(`[DECCMANAGER]: getClustersByNamespace error - ${String(err)}]`);
    }
  }

  async getK8sToken(username: string, password: string, clientId: string): Promise<[]> {
    try {
      const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      };

      const res = await customRequestPromise({
        uri: `http://${process.env.DECC_URL}/auth/realms/iam/protocol/openid-connect/token`,
        headers: headers,
        method: 'POST', body: queryString.stringify({
          grant_type: 'password',
          response_type: 'id_token',
          scope: 'openid',
          client_id: clientId,
          username: username,
          password: password,
        }),
        json: true,
        resolveWithFullResponse: true,
        timeout: 10000,
      });
      // logger.info(`getTokenForCluster: res - ${JSON.stringify(res)}`);
      return res.body;
    } catch (err) {
      logger.error(`[DECCMANAGER]: getK8sToken error - ${String(err)}]`);
    }
  }

  async getDECCNamespaces(token: string) {
    try {
      const res = await this.getNamespaces(token);
      // logger.info(`getDECCNamespaces: res - ${JSON.stringify(res)}`);
      var deccNamespaces = [];
      res["items"].forEach(function(namespace) {
        if (!ignoredDECCNamespaces.includes(namespace.metadata.name)) {
          // logger.info(`getDECCNamespaces: Found namespace: ${namespace.metadata.name}`);
          deccNamespaces.push(namespace.metadata.name);
        };
      });
      return deccNamespaces;

    } catch (err) {
      logger.error(`[DECCMANAGER]: getDECCNamespaces error - ${String(err)}`);
    }
  }

  getDECCNamespacesForUser(deccNamespaces, k8sUserIAMRoles: string[], kaasUserIAMRoles: string[], username: string) {
    var deccNamespacesForUser = [];
    k8sUserIAMRoles.forEach(role => {
      deccNamespaces.forEach(ns => {
        logger.debug(`[DECCMANAGER]: getDECCNamespacesForUser ns:${ns}, role:${role}`);  
        if (role.startsWith(`m:k8s:${ns}`)) {
          deccNamespacesForUser.push(ns);
        }
      });
    })
    
    // deccNamespaces.forEach(function(ns) {
    //   logger.debug(`[DECCMANAGER]: getDECCNamespacesForUser ns:${ns}, kaasUserIAMRoles:${JSON.stringify(kaasUserIAMRoles)}`) 
    //   if (kaasUserIAMRoles.includes(`m:kaas:${ns}@reader`) || kaasUserIAMRoles.includes(`m:kaas:${ns}@writer`)) {
    //     // add namespace to workspaceStore if not present
    //     //logger.info(`getDECCNamespacesForUser: User ${username} has access to namespace ${ns}`);
    //     deccNamespacesForUser.push(ns);
    //   }
    // });
    return deccNamespacesForUser;
  }

  async getDECCClustersForNamespace(ns: string, token: string) {
    try {
      const res = await this.getClustersByNamespace(ns, token);
      //logger.info(`getDECCClustersForNamespace: res - ${JSON.stringify(res)}`);

      var deccClustersForNamespace = [];
        //API call ok....
        res["items"].forEach(function(deccCluster) {
          deccClustersForNamespace.push(deccCluster);
        });
        return deccClustersForNamespace;
    } catch(err) {
      logger.error(`[DECCMANAGER]: getDECCClustersForNamespace error - ${String(err)}`);
    }
  }

  public async getK8sTokenForUser(username='', password='', clientId='k8s') {
    try {
      const res = await this.getK8sToken(username, password, clientId);
      return res;
    } catch(err) {
      logger.error(`[DECCMANAGER]: getK8sTokenForUser error - ${String(err)}`);
    }
  }

  addLensDECCWorkspace(ws: string) {
    const wsPrefix = `decc`;

    if (!workspaceStore.getByName(`${wsPrefix}-${ws}`)) {
      workspaceStore.saveWorkspace({id: uuid(), name: `${wsPrefix}-${ws}`, description: `DECC Namespace: ${ws}`});
      logger.info(`Added new workspace: ${wsPrefix}-${ws}`);
    }
  }

  addLensClusterToDECCWorkspace(deccCluster, username: string, workspace: Workspace, k8sToken: TokenContents, kaasToken: TokenContents) {
    // check if cluster is already in the cluster store
    var clusterPresent = false;
    const clusterPrefix = `decc`;

    clusterStore.getByWorkspaceId(workspace.id).forEach(cluster => {
      if (cluster.preferences.clusterName === `${clusterPrefix}-${deccCluster.metadata.name}`) {
        clusterPresent = true;
      }
    });

    if ("status" in deccCluster && !clusterPresent) {
      let ucpDashboard = `https://${deccCluster.status.providerStatus.ucpDashboard.split(":", 2).reverse()[0].substring(2)}:443`;
      logger.info(`addLensClusterToDECCWorkspace: ucpDashboard - ${ucpDashboard}`);

      //let clusterToken = this.getTokenForCluster(deccCluster.metadata.uid);
      //logger.info(`addLensClusterToDECCWorkspace: clusterToken - ${clusterToken}`);

      // let parsedClusterIdToken = userStore.decodeToken(k8sToken["id_token"]);
      // logger.info(`addLensClusterToDECCWorkspace: parsedClusterToken - ${parsedClusterIdToken}`);

      let idTokenToUse = `${clusterPrefix}-${deccCluster.metadata.name}` === "decc-kaas-mgmt" ? kaasToken.token : k8sToken.token;
      let refreshTokenToUse = `${clusterPrefix}-${deccCluster.metadata.name}` === "decc-kaas-mgmt" ? kaasToken.refreshToken : k8sToken.refreshToken;

      // const idTokenToUse = k8sToken.token;
      // const refreshTokenToUse = k8sToken.refreshToken;
      let jsConfig = kubeconfig({
        username: username,
        clusterName: `${clusterPrefix}-${deccCluster.metadata.name}`,
        clientId: deccCluster.status.providerStatus.oidc.clientId,
        idpCertificateAuthorityData: deccCluster.status.providerStatus.oidc.certificate,
        idpIssuerUrl: deccCluster.status.providerStatus.oidc.issuerUrl,
        server: ucpDashboard,
        apiCertificate: deccCluster.status.providerStatus.apiServerCertificate,
        idToken: idTokenToUse,
        refreshToken: refreshTokenToUse
      });

      logger.debug(`Generated kubeconfig: ${YAML.stringify(jsConfig)}`)

      let newClusters: ClusterModel[] = [];

      let newCluster: ClusterModel = {
        id: deccCluster.metadata.uid,
        contextName: `${username}@${clusterPrefix}-${deccCluster.metadata.name}`,
        preferences: {
          clusterName: `${clusterPrefix}-${deccCluster.metadata.name}`,
          httpsProxy: undefined,
        },
        kubeConfigPath: ClusterStore.embedCustomKubeConfig(deccCluster.metadata.uid, YAML.stringify(jsConfig)),
        workspace: workspace.id,
      };

      // newClusters.push(newCluster);
      // clusterStore.addCluster(...newClusters);
      // clusterStore.setActive(newCluster.id);
      logger.info(`addLensClusterToDECCWorkspace: Created Cluster Name: ${newCluster.preferences.clusterName}, Cluster UCP Dashboard URL: ${ucpDashboard}`);

      return newCluster;
      
      // newClusters.push(newCluster);
      // clusterStore.addCluster(...newClusters);
     
      // let createdCluster = clusterStore.getById(newCluster.id);
      // createdCluster.pushState();
      // clusterStore.load();

      // clusterStore.setActive(newCluster.id);
      //logger.info(`addLensClusterToDECCWorkspace: Created Cluster Name: ${createdCluster.preferences.clusterName}, Cluster UCP Dashboard URL: ${ucpDashboard}`);
    };
  }

  addLensClustersToDECCWorkspace(deccClusters, username: string, wsName: string, k8sToken: TokenContents, kaasToken: TokenContents) {
    const wsPrefix = `decc`;
    const workspace = workspaceStore.getByName(`${wsPrefix}-${wsName}`);

    //logger.info(`addLensClustersToDECCWorkspace: Processing clusters in Workspace ${workspace.name} for User ${username}`);

    let clusters:ClusterModel[] = [];
    deccClusters.forEach(cluster => {
      if (cluster.metadata.name != "kaas-mgmt") { 
        logger.info(`[DECCMANAGER]: addLensClustersToDECCWorkspace - processing cluster ${cluster.metadata.name}`);
        clusters.push(this.addLensClusterToDECCWorkspace(cluster, username, workspace, k8sToken, kaasToken));
      }
    });
    logger.info(`[DECCMANAGER]: addLensClustersToDECCWorkspace - returning clusters ${JSON.stringify(clusters)}`);
    return clusters;
  }

  deleteLensDECCClustersByWorkspace(ws) {
    logger.info(`deleteLensDECCClustersByWorkspace: Removing all Lens DECC clusters for Workspace ${ws.name}`)
    clusterStore.removeByWorkspaceId(ws.id);
  }

  deleteLensDECCWorkspace(workspaceId) {
    workspaceStore.removeWorkspace(workspaceId);
  }

  deleteLensDECCWorkspaces(userDECCNamespaces) {
    const wsPrefix = `decc`;
    workspaceStore.workspacesList.forEach(ws => {
      let strippedPrefixWorkspaceName = ws.name.slice(5);
      //logger.info(`deleteLensDECCWorkspaces: Existing Workspace ${ws.name} being checked against ${userDECCNamespaces.toString()}`) 
      if (ws.name != "default") {
        //logger.info(`deleteLensDECCWorkspaces: Stripped Workspace ${strippedPrefixWorkspaceName} being checked against ${userDECCNamespaces.toString()}`) 
        if (!userDECCNamespaces.includes(`${strippedPrefixWorkspaceName}`)) {
          logger.info(`deleteLensDECCWorkspaces: User does not have access to existing Workspace ${ws.name} - Deleting`)
          this.deleteLensDECCClustersByWorkspace(ws);
          this.deleteLensDECCWorkspace(ws.id);
        }
      }
    }); 
  }

  refreshLensDECCClusterKubeconfigs(username: string, workspace: string, k8sToken: TokenContents, kaasToken: TokenContents) {
    //logger.info(`refreshLensDECCClusterKubeconfigs: Processing Workspace Name ${workspace}`);
    const wsPrefix = `decc`;
    const ws = workspaceStore.getByName(`${wsPrefix}-${workspace}`);

    if (ws === undefined) { return }

    logger.info(`[DECCMANAGER]: refreshLensDECCClusterKubeconfigs - Processing Workspace ${JSON.stringify(ws)}`);
    clusterStore.getByWorkspaceId(ws.id).forEach(cluster => {
      logger.info(`[DECCMANAGER]: refreshLensDECCClusterKubeconfigs: Processing Cluster ${JSON.stringify(cluster)}`);
      let idTokenToUse = cluster.preferences.clusterName === "decc-kaas-mgmt" ? kaasToken.token : k8sToken.token
      let refreshTokenToUse = cluster.preferences.clusterName === "decc-kaas-mgmt" ? kaasToken.refreshToken : k8sToken.refreshToken

      // const idTokenToUse = k8sToken.token;
      // const refreshTokenToUse = k8sToken.refreshToken;
      let currentKubeConfig = loadConfig(cluster.kubeConfigPath); //readFile(cluster.kubeConfigPath, "utf8");
      // console.log(`refreshClusterKubeConfigs: Read kubeconfig from file: ${cluster.kubeConfigPath}. Contents: ${YAML.stringify(kubeConfig)}`);
      // console.log(`refreshClusterKubeConfigs: kubeconfig users[0]: ${YAML.stringify(kubeConfig.users[0])}`);
      // console.log(`refreshClusterKubeConfigs: kubeconfig users[0] id-token: ${YAML.stringify(kubeConfig.users[0].authProvider.config["id-token"])}`);
      // console.log(`refreshClusterKubeConfigs: kubeconfig users[0] refresh-token: ${YAML.stringify(kubeConfig.users[0].authProvider.config["refresh-token"])}`);
      let jsConfig = kubeconfig({
        username: username,
        clusterName: currentKubeConfig.clusters[0].name,
        clientId: currentKubeConfig.users[0].authProvider.config["client-id"],
        idpCertificateAuthorityData: currentKubeConfig.users[0].authProvider.config["idp-certificate-authority-data"],
        idpIssuerUrl: currentKubeConfig.users[0].authProvider.config["idp-issuer-url"],
        server: currentKubeConfig.clusters[0].server,
        apiCertificate: currentKubeConfig.clusters[0].caData,
        idToken: idTokenToUse,
        refreshToken: refreshTokenToUse
      });

      cluster.contextName = `${username}@${currentKubeConfig.clusters[0].name}`;
      ClusterStore.embedCustomKubeConfig(cluster.id, YAML.stringify(jsConfig));
      logger.info(`refreshLensDECCClusterKubeconfigs: Updated Cluster ${cluster.preferences.clusterName} kubeconfig with new token values`);
      cluster.pushState();
      //cluster.refresh();
    });
  }

  async createDECCLensEnv() {
    try {
      logger.debug(`createDECCLensEnv: creating Lens DECC Env`)
      const kaasToken = userStore.getTokenDetails('kaas');
      const parsedKaasIdToken = userStore.decodeToken (kaasToken.token);
      const username = parsedKaasIdToken.preferred_username;
      const kaasUserIAMRoles = parsedKaasIdToken.iam_roles;

      // get the token from the k8s client for this user
      const k8sToken = userStore.getTokenDetails('k8s');
      const parsedK8sIdToken = userStore.decodeToken (k8sToken.token);
      const k8sUserIAMRoles = parsedK8sIdToken.iam_roles;

      // get all available DECC Namespaces
      const deccNamespaces = await this.getDECCNamespaces(kaasToken.token);
      logger.info(`createDECCLensEnv: The following namespaces exist in DECC - ${deccNamespaces.toString()}`);

      // get all DECC Namespaces the user has access to
      const userDECCNamespaces: string[] = this.getDECCNamespacesForUser(deccNamespaces, k8sUserIAMRoles, kaasUserIAMRoles, username);

      let clusterModels: ClusterModel[] = [];

      if (userDECCNamespaces.length > 0) {
        userDECCNamespaces.sort(); 
        logger.info(`createDECCLensEnv: The following namespaces exist in DECC for User ${username} - ${userDECCNamespaces.toString()}`);

        // lets remove workspaces this user does not have access to
        this.deleteLensDECCWorkspaces(userDECCNamespaces);

        
        userDECCNamespaces.forEach(async (ns) => {
          try {
            let deccClustersByNamespace = await this.getDECCClustersForNamespace(ns, kaasToken.token);
            //logger.info(`createDECCLensEnv: The following clusters exist in Namespace ${ns} - ${JSON.stringify(deccClustersByNamespace)}`);

            // refresh tokens for any existing clusters
            this.refreshLensDECCClusterKubeconfigs(username, ns, k8sToken, kaasToken);
            
            // now lets add the workspace in Lens
            this.addLensDECCWorkspace(ns);

            // now lets add the clusters to the workspace
            clusterModels.push(...this.addLensClustersToDECCWorkspace(deccClustersByNamespace, username, ns, k8sToken, kaasToken));
            logger.info(`[DECCMANAGER]: createDECCLensEnv - clusterModels now contains ${JSON.stringify(clusterModels)}`);

          } catch (err) {
            logger.error(`createDECCLensEnv: ${String(err)}`); 
          }
        });

        
        //logger.info(`[DECCMANAGER]: createDECCLensEnv - adding new clusters ${JSON.stringify(clusterModels)}`);
        //clusterStore.addCluster(...clusterModels);
        //clusterStore.load();
      }

      return clusterModels;
    } catch (err) {
      logger.error(`[DECCMANAGER]: createDECCLensEnv error - ${String(err)}`); 
    }
  }

  @action
  protected async fromStore(data: Partial<DECCManagerModel> = {}) {
    try {
      const { deccURL } = data

      if (deccURL) {
        this.deccURL = deccURL;
      }
    } catch (err) {
      logger.error(`[DECCMANAGER]: fromStore error - ${String(err)}`)
    }
  }

  toJSON(): DECCManagerModel {
    const model: DECCManagerModel = {
      deccURL: this.deccURL,
    }
    return toJS(model, {
      recurseEverything: true,
    })
  }
}

export const deccManager = DECCManager.getInstance<DECCManager>();
