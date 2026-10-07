import { Routes, Route } from "react-router-dom";

import { Toaster } from "@/components/ui/sonner";
import { JarvisProvider } from "@/lib/jarvis";
import Dashboard from "@/pages/Dashboard";

// One <Route> per page in src/pages; BrowserRouter already wraps this in main.tsx.
export default function App() {
  return (
    <JarvisProvider>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="*" element={<Dashboard />} />
      </Routes>
      <Toaster richColors />
    </JarvisProvider>
  );
}
