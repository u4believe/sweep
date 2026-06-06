import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Analytics } from "@vercel/analytics/react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import { API_BASE } from "@/lib/api";
import Landing from "./pages/landing";
import Login from "./pages/login";
import Register from "./pages/register";
import Dashboard from "./pages/dashboard";
import Subscribe from "./pages/subscribe";
import Pay from "./pages/pay";
import Docs from "./pages/docs";
import ForgotPassword from "./pages/forgot-password";
import ResetPassword from "./pages/reset-password";
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
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/docs" component={Docs} />
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
        <SonnerToaster position="top-center" richColors closeButton />
        <Analytics />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
