import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout.jsx';
import ProtectedRoute, { FullPageLoader } from './components/layout/ProtectedRoute.jsx';

// Login and Signup stay eager: they are the first paint for a signed-out
// visitor, so code-splitting them would only add a round trip.
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';

/**
 * Everything behind the sign-in wall is split out.
 *
 * Recharts and the markdown renderer are large and only a few screens need
 * them, so loading them up front slows the first paint for no benefit.
 */
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Upload = lazy(() => import('./pages/Upload.jsx'));
const Learn = lazy(() => import('./pages/Learn.jsx'));
const Lesson = lazy(() => import('./pages/Lesson.jsx'));
const Practice = lazy(() => import('./pages/Practice.jsx'));
const TestRunner = lazy(() => import('./pages/TestRunner.jsx'));
const Result = lazy(() => import('./pages/Result.jsx'));
const Mock = lazy(() => import('./pages/Mock.jsx'));
const Analytics = lazy(() => import('./pages/Analytics.jsx'));
const RoadmapPage = lazy(() => import('./pages/Roadmap.jsx'));
const PreviousPapers = lazy(() => import('./pages/PreviousPapers.jsx'));
const Mentor = lazy(() => import('./pages/Mentor.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));

export default function App() {
  return (
    <Suspense fallback={<FullPageLoader label="Loading…" />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />

        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/learn" element={<Learn />} />
          <Route path="/learn/:examId/lesson" element={<Lesson />} />
          <Route path="/practice" element={<Practice />} />
          <Route path="/mock" element={<Mock />} />
          <Route path="/papers" element={<PreviousPapers />} />
          <Route path="/test/:sessionId" element={<TestRunner />} />
          <Route path="/result/:sessionId" element={<Result />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/roadmap" element={<RoadmapPage />} />
          <Route path="/mentor" element={<Mentor />} />
          <Route path="/settings" element={<Settings />} />
        </Route>

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
