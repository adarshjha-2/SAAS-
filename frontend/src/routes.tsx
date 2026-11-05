import type { RouteObject } from "react-router";

import { AppShell } from "@/components/layout/AppShell";
import { NAV_ITEMS } from "@/config/navigation";
import { CommandPage } from "@/pages/CommandPage";
import { ModulePage } from "@/pages/ModulePage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { RouteErrorPage } from "@/pages/RouteErrorPage";

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <CommandPage /> },
      ...NAV_ITEMS.filter((item) => item.path !== "/").map((item) => ({
        path: item.path.slice(1),
        element: <ModulePage moduleKey={item.key} />,
      })),
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
