import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";

import { AuthProvider, ProtectedRoute, useAuth, homePathFor } from "./lib/auth.jsx";
import AdminLayout from "./layouts/AdminLayout.jsx";
import CounsellorLayout from "./layouts/CounsellorLayout.jsx";

import Login from "./pages/Login.jsx";
import AdminDashboard from "./pages/admin/AdminDashboard.jsx";
import Counsellors from "./pages/admin/Counsellors.jsx";
import Personas from "./pages/admin/Personas.jsx";
import Assignments from "./pages/admin/Assignments.jsx";
import AssignmentCreate from "./pages/admin/AssignmentCreate.jsx";
import AdminReports from "./pages/admin/AdminReports.jsx";

import Dashboard from "./pages/counsellor/Dashboard.jsx";
import MyMocks from "./pages/counsellor/MyMocks.jsx";
import Practice from "./pages/counsellor/Practice.jsx";
import Session from "./pages/counsellor/Session.jsx";
import Reports from "./pages/counsellor/Reports.jsx";

import ReportDetail from "./pages/shared/ReportDetail.jsx";

function RootRedirect() {
  const { user } = useAuth();
  return <Navigate to={user ? homePathFor(user) : "/login"} replace />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<Login />} />

        {/* Admin */}
        <Route
          element={
            <ProtectedRoute role="admin">
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/counsellors" element={<Counsellors />} />
          <Route path="/admin/personas" element={<Personas />} />
          <Route path="/admin/assignments" element={<Assignments />} />
          <Route path="/admin/assignments/new" element={<AssignmentCreate />} />
          <Route path="/admin/reports" element={<AdminReports />} />
          <Route path="/admin/reports/:id" element={<ReportDetail backTo="/admin/reports" />} />
        </Route>

        {/* Counsellor */}
        <Route
          element={
            <ProtectedRoute role="counsellor">
              <CounsellorLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/app" element={<Dashboard />} />
          <Route path="/app/mocks" element={<MyMocks />} />
          <Route path="/app/practice" element={<Practice />} />
          <Route path="/app/reports" element={<Reports />} />
          <Route path="/app/reports/:id" element={<ReportDetail backTo="/app/reports" />} />
        </Route>

        {/* Session runs full-bleed (its own chrome), still counsellor-guarded */}
        <Route
          path="/app/session/:sessionId"
          element={
            <ProtectedRoute role="counsellor">
              <Session />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>
);
