import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { api } from './api/client';
import type { Me } from './api/types';
import { Crt } from './shell/Crt';
import { Shell } from './shell/Shell';
import { PanePage } from './pages/Pane';
import { PanesPage } from './pages/Panes';
import { WindowPage } from './pages/Window';
import { BoardPage } from './pages/Board';
import { SignInPage } from './pages/SignIn';
import { queryClient } from './query';
import { keys } from './api/queries';

// Signed-in routes ask the hub who we are once per load; a 401 goes to sign-in.
async function requireSession() {
  try {
    await queryClient.fetchQuery({
      queryKey: keys.me,
      queryFn: () => api<Me>('/v1/me'),
      staleTime: 30_000,
    });
  } catch {
    throw redirect({ to: '/signin' });
  }
}

const root = createRootRoute({
  component: () => (
    <Crt>
      <Shell />
    </Crt>
  ),
});
const signIn = createRoute({ getParentRoute: () => root, path: '/signin', component: SignInPage });
const panes = createRoute({
  getParentRoute: () => root,
  path: '/',
  beforeLoad: requireSession,
  component: PanesPage,
});
const pane = createRoute({
  getParentRoute: () => root,
  path: '/p/$',
  beforeLoad: requireSession,
  component: PanePage,
});
const window = createRoute({
  getParentRoute: () => root,
  path: '/w/$host/$session/$window',
  beforeLoad: requireSession,
  component: WindowPage,
});
const board = createRoute({
  getParentRoute: () => root,
  path: '/b/$name',
  beforeLoad: requireSession,
  component: BoardPage,
});
const notFound = createRoute({
  getParentRoute: () => root,
  path: '$',
  component: () => (
    <div className="mx-empty">
      nothing here. <Outlet />
    </div>
  ),
});

export const router = createRouter({
  routeTree: root.addChildren([signIn, panes, pane, window, board, notFound]),
  // Several panes travel in one splat, comma separated.
  pathParamsAllowedCharacters: [','],
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
