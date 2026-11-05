import "./index.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";

import { createQueryClient } from "@/lib/queryClient";
import { RealtimeProvider } from "@/lib/RealtimeProvider";
import { routes } from "@/routes";

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

const queryClient = createQueryClient();
const router = createBrowserRouter(routes);

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider>
        <RouterProvider router={router} />
      </RealtimeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
