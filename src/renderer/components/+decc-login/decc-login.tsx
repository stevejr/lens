import React from "react";
import { observer } from "mobx-react";
import { observable, runInAction } from "mobx";
import { navigate } from "../../navigation";
import { Button } from "../button";
import { userStore } from "../../../common/user-store"
import { t, Trans } from "@lingui/macro";
import { Dialog, DialogProps } from "../dialog";
import { Wizard, WizardStep } from "../wizard";
import { Input } from "../input";
import { logger } from "handlebars";
import { Notifications } from "../notifications";
import { _i18n } from "../../i18n";
import { cssNames, prevDefault } from "../../utils";
import { deccManager } from "../../../main/decc-manager";
import { ClusterModel,clusterStore } from "../../../common/cluster-store";

@observer
export class DECCLogin extends React.Component {
  private form: HTMLFormElement;
  @observable.ref error: React.ReactNode;

  @observable username = "";
  @observable password = "";
  @observable isWaiting = false

  ok = (username) => {
    navigate("/");
    userStore.saveLoggedInUser(username);
  }

  async getTokens(username: string, password:string) {
    try {
      let kaasToken = await deccManager.getK8sTokenForUser(username, password, 'kaas');
      await userStore.setTokenDetails(kaasToken["id_token"], kaasToken["refresh_token"], 'kaas');
      //console.log(`Retrieved token: ${JSON.stringify(kaasToken)}`);

      let k8sToken = await deccManager.getK8sTokenForUser(username, password, 'k8s');
      await userStore.setTokenDetails(k8sToken["id_token"], k8sToken["refresh_token"], 'k8s');
      // console.log(`Retrieved token: ${JSON.stringify(k8sToken)}`);
    } catch (err) {
      console.log(`Error getting token: ${String(err)}`);
    }   
  }
 
  async doLogin(username: string, password:string) {
    try {
      console.log("getting tokens");
      await this.getTokens(username, password);
      // console.log("creating decc env");
      // await deccManager.createDECCLensEnv();
      //console.log("saving user details");
      //await userStore.saveLoggedInUser(username);
      // navigate("/");
    } catch (err) {
      console.log(`Error getting token: ${String(err)}`);
    }   
  }

  async importClustersFromDECC() {
    try {
      console.log("creating decc env");
      var clusters: ClusterModel[] = await deccManager.createDECCLensEnv();
      return clusters;
      //console.log("saving user details");
      //await userStore.saveLoggedInUser(username);
      // navigate("/");
    } catch (err) {
      console.log(`Error getting token: ${String(err)}`);
    }   
  }

  submit = () => {
    if (!this.form.noValidate) {
      const valid = this.form.checkValidity();
      if (!valid) return;
    }
    try {
      this.error = ""
      this.isWaiting = true
      this.doLogin(this.username, this.password);

      this.importClustersFromDECC().then(newClusters =>
        runInAction(() => {
          clusterStore.addCluster(...newClusters);
          
            Notifications.ok(
              <Trans>Successfully imported <b>{newClusters.length}</b> cluster(s)</Trans>
            )
          })
      )
    } catch (err) {
      this.error = String(err);
      Notifications.error(<Trans>Error while adding cluster(s): {this.error}</Trans>);
    } finally {
      this.isWaiting = false;
    }



    try {
      // get token for user
      this.doLogin(this.username, this.password);
      console.log(`Login form submitted for user ${this.username} with password ${this.password}`)
    } catch (err) {
      console.log(`Error getting token: ${String(err)}`);
    }
  }

  render() {
    const logo = require("../../components/icon/lens-logo.svg");
    return (
      <div className="DECCLogin flex column gaps box center">
        <h1>
          <Trans>Welcome! Please Login to Docker Enterprise Container Cloud</Trans>
        </h1>
        <form className="DECCLogin"
          onSubmit={prevDefault(this.submit)} noValidate={true}
          ref={e => this.form = e}>

          <label className="flex gaps align-center"/>{"Username"}
          <Input
            ref='login'
            theme="round-black"
            placeholder={_i18n._(t`Username`)}
            value={this.username}
            onChange={v => this.username = v}
            onBlur={() => this.username}
          />
          <Input
            ref='password'
            type="password"
            theme="round-black"
            placeholder={_i18n._(t`Password`)}
            value={this.password}
            onChange={v => this.password = v}
            onBlur={() => this.password}
          />

          <Button
            primary type="submit"
            label={_i18n._(t`Login`)}
            className="big"
            waiting={this.isWaiting}
          />  
        </form>

        <div className="bottom">
          <Button
            primary autoFocus
            label={<Trans>Ok, got it!</Trans>}
            onClick={this.ok}
          />
        </div>
      </div>
    );
  }
}


// interface Props extends DialogProps {
//   onSuccess?(loggedIn: boolean): void;
//   onError?(error: any): void;
// }

// @observer
// export class DECCLogin extends React.Component<Props> {

//   @observable static isOpen = false;
//   @observable username = "";

//   static open() {
//     DECCLogin.isOpen = true;
//   }

//   static close() {
//     DECCLogin.isOpen = false;
//   }

//   close = () => {
//     DECCLogin.close();
//   }

//   ok = () => {
//     navigate("/");
//     userStore.saveLoggedInUser();
//   }

//   login = async () => {
//     const { onSuccess, onError } = this.props;
//     const { username } = this;
//     // try {
//     //   await namespaceStore.create({ name: namespace }).then(onSuccess);
//     //   this.close();
//     // } catch (err) {
//     //   Notifications.error(err);
//     //   onError && onError(err);
//     // }
//     Notifications.info(`${username} Logged In`);
//   }

//   render() {
//     const logo = require("../../components/icon/lens-logo.svg");
//     const { ...dialogProps } = this.props;
//     const { username } = this;

//     const header = <h5><Trans>Login</Trans></h5>;
//     return (
//       <Dialog
//         {...dialogProps}
//         className="DECCLogin"
//         isOpen={DECCLogin.isOpen}
//         close={this.close}
//       >
//         <Wizard header={header} done={this.close}>
//           <WizardStep
//             contentClass="flex gaps column"
//             nextLabel={<Trans>Create</Trans>}
//             next={this.login}
//           >
//             <Input
//               required autoFocus
//               iconLeft="layers"
//               placeholder={_i18n._(t`Username`)}
//               value={username} onChange={v => this.username}
//             />
//           </WizardStep>
//         </Wizard>
//       </Dialog>
//     )

//     // return (
//     //   <div className="DECCLogin flex column">
//     //     {/* <div className="content box grow">
//     //       <img className="logo" src={logo} alt="Lens"/>
//     //       <h2>This is a test Login page</h2>
//     //     </div> */}

//     //     <form className="DECCLogin">
//     //         <span>
//     //           <h3>
//     //             {'Sign In'}
//     //           </h3>
//     //           <h4>
//     //             {'Docker Enterprise Container Cloud'}
//     //           </h4>
//     //         </span>
//     //      </form>
         
//     //      <div className="bottom">
//     //       <Button
//     //         primary autoFocus
//     //         label={<Trans>Ok, got it!</Trans>}
//     //         onClick={this.ok}
//     //       />
//     //     </div>
//     //   </div>
//     // )
//   }
// }