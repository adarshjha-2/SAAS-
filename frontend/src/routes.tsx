import type { RouteObject } from "react-router";

import { AppShell } from "@/components/layout/AppShell";
import { NAV_ITEMS } from "@/config/navigation";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { RouteErrorPage } from "@/pages/RouteErrorPage";
import { RouteLoading } from "@/pages/RouteLoading";

/**
 * Pages are code-split: each route's chunk (and heavy dependencies such as
 * Recharts on the dashboard) loads only when the route is visited.
 */
export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    HydrateFallback: RouteLoading,
    children: [
      {
        index: true,
        lazy: async () => {
          const { CommandPage } = await import("@/pages/CommandPage");
          return { Component: CommandPage };
        },
      },
      {
        path: "hashlab",
        lazy: async () => {
          const { HashLabPage } = await import("@/pages/hashlab/HashLabPage");
          return { Component: HashLabPage };
        },
      },
      ...NAV_ITEMS.filter((item) => item.path !== "/" && item.key !== "hashlab").map((item): RouteObject => ({
        path: item.path.slice(1),
        lazy: async () => {
          const { ModulePage } = await import("@/pages/ModulePage");
          return { element: <ModulePage moduleKey={item.key} /> };
        },
      })),
      {
        path: "activity",
        lazy: async () => {
          const { ActivityPage } = await import("@/pages/ActivityPage");
          return { Component: ActivityPage };
        },
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
