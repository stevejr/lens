/**
 * Copyright (c) 2021 OpenLens Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import { navigate } from "../../navigation";
import { commandRegistry } from "../../../extensions/registries/command-registry";
import { servicesURL } from "../+network-services";
import { endpointURL } from "../+network-endpoints";
import { ingressURL } from "../+network-ingresses";
import { networkPoliciesURL } from "../+network-policies";

commandRegistry.add({
  id: "cluster.viewServices",
  title: "Cluster: View Services",
  scope: "entity",
  action: () => navigate(servicesURL())
});

commandRegistry.add({
  id: "cluster.viewEndpoints",
  title: "Cluster: View Endpoints",
  scope: "entity",
  action: () => navigate(endpointURL())
});

commandRegistry.add({
  id: "cluster.viewIngresses",
  title: "Cluster: View Ingresses",
  scope: "entity",
  action: () => navigate(ingressURL())
});

commandRegistry.add({
  id: "cluster.viewNetworkPolicies",
  title: "Cluster: View NetworkPolicies",
  scope: "entity",
  action: () => navigate(networkPoliciesURL())
});
