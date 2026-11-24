// Every feature module's routes. Importing a module also registers its background services.
import type { RouteRegistrar } from './server/app.js';
import { registerCoreRoutes } from './server/routes/core.js';
import { registerSummaryRoutes } from './server/routes/summary.js';
import { registerNotificationRoutes } from './notify.js';
import { registerAgentRoutes } from './agent/routes.js';
import { registerDiagnosticsRoutes } from './server/routes/diagnostics.js';
import { registerProfileRoutes } from './profile/routes.js';
import { registerScanRoutes } from './scan/routes.js';
import './scheduler.js';

export const featureRoutes: RouteRegistrar[] = [
  registerCoreRoutes,
  registerSummaryRoutes,
  registerNotificationRoutes,
  registerAgentRoutes,
  registerDiagnosticsRoutes,
  registerProfileRoutes,
  registerScanRoutes,
];
