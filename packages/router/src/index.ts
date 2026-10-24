// Route
export {
  Route,
  make as makeRoute,
  render as routeRender,
  get as routeGet,
  post as routePost,
  put as routePut,
  del as routeDelete,
  params as routeParams,
  searchParams as routeSearchParams,
  rawParams as routeRawParams,
  withGuard as routeWithGuard,
  withAnimation as routeWithAnimation,
  static_ as routeStatic,
  lazy as lazyRoute,
  isRoute,
  routeSpecificity,
  parsePath,
  matchSegments,
  TypeId as RouteTypeId,
  type Route as RouteType,
  type RouteContext,
  type RouteHandler,
  type PathSegment,
  type AnimationOptions,
  type GuardOptions,
  meta as routeMeta,
  resolveMeta,
  NoRenderError,
  MetaRenderError,
  type RouteParams,
  type RouteSearchParams,
  type RouteData,
  type RouteMeta,
  type MetaArgs,
  type MetaInput,
  type MetaField,
  type MetaObject,
} from "./Route.js";

// Router
export {
  Router,
  empty as emptyRouter,
  concat as concatRouter,
  prefixAll,
  guard as routerGuard,
  layout as routerLayout,
  findMatch,
  type Router as RouterType,
} from "./Router.js";

// Navigation
export {
  Navigation,
  NavigationContext,
  buildPath,
  make as makeNavigation,
  makeLayer as makeNavigationLayer,
  pathname as navPathname,
  searchParams as navSearchParams,
  currentMatch as navCurrentMatch,
  pushPath as navPushPath,
  replacePath as navReplacePath,
  pushRoute as navPushRoute,
  replaceRoute as navReplaceRoute,
  back as navBack,
  forward as navForward,
  type Navigation as NavigationType,
  type NavigationOptions,
  type NavigationSource,
  type RouteNavigateOptions,
  type CurrentMatch,
} from "./Navigation.js";

// RouteData
export {
  RouteDataContext,
  RouteDataProvider,
  type RouteDataService,
  type RouteDataProviderService,
} from "./RouteData.js";

// Link
export { Link, type LinkProps } from "./Link.js";

// Outlet
export { Outlet, type OutletConfig } from "./Outlet.js";

// Outlet coordination context — page components read this to sequence
// their intro animations off the outlet's current transition group.
export { OutletCtx, type OutletCtxService } from "./OutletCtx.js";

// ScrollBehavior
export { runScrollBehavior, type ScrollBehavior } from "./ScrollBehavior.js";
