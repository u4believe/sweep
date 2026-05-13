import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import { API_BASE } from "@/lib/api";
import Landing from "./pages/landing";
import Login from "./pages/login";
import Register from "./pages/register";
import Dashboard from "./pages/dashboard";
import Subscribe from "./pages/subscribe";
import DeveloperPortal from "./pages/developer-portal";
import DeveloperAuth from "./pages/developer-auth";
import DeveloperDashboard from "./pages/developer-dashboard";
import Pay from "./pages/pay";
import NotFound from "./pages/not-found";

// Wire up base URL and auth token for every generated API hook
setBaseUrl(API_BASE);
setAuthTokenGetter(() => localStorage.getItem("token"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,              // always re-fetch on mount — no stale cache
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

// Show sidebar app for logged-in users, marketing page for guests — both at "/"
function HomeRoute() {
  const isLoggedIn = !!localStorage.getItem("token");
  return isLoggedIn ? <Dashboard /> : <Landing />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeRoute} />
      <Route path="/landing" component={Landing} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/subscribe/:merchantId" component={Subscribe} />
      <Route path="/pay/:merchantId" component={Pay} />
      <Route path="/developer" component={DeveloperPortal} />
      <Route path="/developer/login" component={DeveloperAuth} />
      <Route path="/developer/reset-password" component={DeveloperAuth} />
      <Route path="/developer/dashboard" component={DeveloperDashboard} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
