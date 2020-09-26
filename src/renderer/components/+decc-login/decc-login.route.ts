import { RouteProps } from "react-router";
import { buildURL } from "../../navigation";

export const deccLoginRoute: RouteProps = {
  path: "/decc-login"
}

export const deccLoginURL = buildURL(deccLoginRoute.path)
