import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { queryClient } from './lib/queryClient';
import { AuthProvider } from './providers/AuthProvider';
import { ToastProvider } from './components/ui';
import { AppShell } from './components/layout/AppShell';
import { RequireAdmin, RequireAuth } from './components/layout/Guards';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { AttendancePage } from './pages/Attendance';
import { LeavePage } from './pages/Leave';
import { DocumentsPage } from './pages/Documents';
import { CopilotPage } from './pages/Copilot';
import { EmployeesPage } from './pages/Employees';
import { NotFoundPage } from './pages/NotFound';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                element={
                  <RequireAuth>
                    <AppShell />
                  </RequireAuth>
                }
              >
                <Route index element={<DashboardPage />} />
                <Route path="attendance" element={<AttendancePage />} />
                <Route path="leave" element={<LeavePage />} />
                <Route path="documents" element={<DocumentsPage />} />
                <Route path="copilot" element={<CopilotPage />} />
                <Route
                  path="employees"
                  element={
                    <RequireAdmin>
                      <EmployeesPage />
                    </RequireAdmin>
                  }
                />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
