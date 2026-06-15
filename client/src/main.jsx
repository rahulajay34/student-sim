import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";

import { AuthProvider, ProtectedRoute, useAuth, homePathFor } from "./lib/auth.jsx";
import { ToastProvider } from "./ui/Toast.jsx";
import AdminLayout from "./layouts/AdminLayout.jsx";
import CounsellorLayout from "./layouts/CounsellorLayout.jsx";
import SuperAdminLayout from "./layouts/SuperAdminLayout.jsx";

import Login from "./pages/Login.jsx";
import AdminDashboard from "./pages/admin/AdminDashboard.jsx";
import Counsellors from "./pages/admin/Counsellors.jsx";
import Personas from "./pages/admin/Personas.jsx";
import Courses from "./pages/admin/Courses.jsx";
import Assignments from "./pages/admin/Assignments.jsx";
import AssignmentCreate from "./pages/admin/AssignmentCreate.jsx";
import AdminReports from "./pages/admin/AdminReports.jsx";
import Rubrics from "./pages/admin/Rubrics.jsx";
import Prompts from "./pages/admin/Prompts.jsx";
import Templates from "./pages/admin/Templates.jsx";

import Dashboard from "./pages/counsellor/Dashboard.jsx";
import MyMocks from "./pages/counsellor/MyMocks.jsx";
import Practice from "./pages/counsellor/Practice.jsx";
import Session from "./pages/counsellor/Session.jsx";
import Reports from "./pages/counsellor/Reports.jsx";
import Profile from "./pages/counsellor/Profile.jsx";

import ReportDetail from "./pages/shared/ReportDetail.jsx";
import Leaderboard from "./pages/shared/Leaderboard.jsx";
import UserManagement from "./pages/superadmin/UserManagement.jsx";

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

        {/* Super Admin */}
        <Route
          element={
            <ProtectedRoute role="superadmin">
              <SuperAdminLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/superadmin" element={<UserManagement />} />
          <Route path="/superadmin/rubrics" element={<Rubrics />} />
          <Route path="/superadmin/templates" element={<Templates />} />
          <Route path="/superadmin/prompts" element={<Prompts />} />
        </Route>

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
          <Route path="/admin/courses" element={<Courses />} />
          <Route path="/admin/assignments" element={<Assignments />} />
          <Route path="/admin/assignments/new" element={<AssignmentCreate />} />
          <Route path="/admin/templates" element={<Templates />} />
          <Route path="/admin/practice" element={<Practice />} />
          <Route path="/admin/reports" element={<AdminReports />} />
          <Route path="/admin/reports/:id" element={<ReportDetail backTo="/admin/reports" />} />
          <Route path="/admin/leaderboard" element={<Leaderboard />} />
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
          <Route path="/app/leaderboard" element={<Leaderboard />} />
          <Route path="/app/profile" element={<Profile />} />
        </Route>

        {/* Session routes run full-bleed (their own chrome) — both admin and counsellor */}
        {/* /app/session/new → green room → start → redirect to :sessionId */}
        <Route
          path="/app/session/new"
          element={
            <ProtectedRoute role={["counsellor", "admin"]}>
              <Session />
            </ProtectedRoute>
          }
        />
        <Route
          path="/app/session/:sessionId"
          element={
            <ProtectedRoute role={["counsellor", "admin"]}>
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
      <ToastProvider>
        <App />
      </ToastProvider>
    </AuthProvider>
  </StrictMode>
);
