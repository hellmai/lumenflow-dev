import {
  createTasksPath,
  resolveRouteParams,
  type RouteContext,
} from '../../../../src/server/api-route-paths';
import { forwardToHttpSurface } from '../../../../src/server/http-surface-route-adapter';
import { getHttpSurfaceForWeb } from '../../../../src/server/http-surface-runtime';

interface TasksRouteParams {
  readonly slug?: string[];
}

type TasksRouteContext = RouteContext<TasksRouteParams>;

async function delegateTaskRequest(
  request: Request,
  context: TasksRouteContext,
): Promise<Response> {
  const params = await resolveRouteParams(context);
  const surface = await getHttpSurfaceForWeb();

  return forwardToHttpSurface({
    request,
    surface,
    pathName: createTasksPath(params.slug ?? []),
  });
}

export async function GET(request: Request, context: TasksRouteContext): Promise<Response> {
  return delegateTaskRequest(request, context);
}

export async function POST(request: Request, context: TasksRouteContext): Promise<Response> {
  return delegateTaskRequest(request, context);
}
