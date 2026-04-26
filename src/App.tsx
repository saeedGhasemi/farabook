import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";
import { Navbar } from "@/components/Navbar";
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import Library from "./pages/Library";
import Store from "./pages/Store";
import Reader from "./pages/Reader";
import Upload from "./pages/Upload";
import Edit from "./pages/Edit";
import Publish from "./pages/Publish";
import Publisher from "./pages/Publisher";
import PublisherSettings from "./pages/PublisherSettings";
import Admin from "./pages/Admin";
import Credits from "./pages/Credits";
import EditorRequests from "./pages/EditorRequests";
import Profile from "./pages/Profile";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <I18nProvider>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Navbar />
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/library" element={<Library />} />
              <Route path="/store" element={<Store />} />
              <Route path="/read/:id" element={<Reader />} />
              <Route path="/upload" element={<Upload />} />
              <Route path="/edit/:id" element={<Edit />} />
              <Route path="/publish/:id" element={<Publish />} />
              <Route path="/publisher/:id" element={<Publisher />} />
              <Route path="/publisher/:id/settings" element={<PublisherSettings />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/credits" element={<Credits />} />
              <Route path="/editor-requests" element={<EditorRequests />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </I18nProvider>
  </QueryClientProvider>
);

export default App;
