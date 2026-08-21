// Modern App Root with Clean Architecture
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// App Configuration
import { AppProviders } from './app/providers/AppProviders';

// Layout
import MainLayout from './shared/components/layout/MainLayout';

// Feature Pages
import { LoginPage, RegisterPage } from './features/auth';

import SimplifiedExtractionPage from './features/extraction/pages/SimplifiedExtractionPage'; // NEW: Simplified workflow
import FabricExtractionPage from './features/extraction/pages/FabricExtractionPage';
import { DashboardPage, ProfilePage, ProductsPage } from './features/dashboard';
import { HierarchyManagement, UsersManagement, StatusDashboard } from './features/admin';
import Admin from './features/admin/pages/Admin'; // Admin Dashboard
import SrmFailedExtractionsPage from './features/admin/pages/SrmFailedExtractionsPage'; // SRM Failed Extractions
import KsmlUploaderPage from './features/admin/pages/KsmlUploaderPage'; // KSML class-characteristic uploader
import PoolBUploaderPage from './features/admin/pages/PoolBUploaderPage'; // Pool B article-value uploader
import ModificationLogsPage from './features/admin/pages/ModificationLogsPage';
import ApproverDashboard from './features/approver/pages/ApproverDashboard'; // Approver Dashboard
import ArticleDetailPage from './features/approver/pages/ArticleDetailPage'; // Article detail view
import FabricArticleDashboard from './features/fabric-article/pages/FabricArticleDashboard'; // Fabric Article Dashboard
import FabricArticleDetailPage from './features/fabric-article/pages/FabricArticleDetailPage'; // Fabric Article detail view
import BodyArticleDashboard from './features/body-article/pages/BodyArticleDashboard'; // Body Article Dashboard
import BodyArticleDetailPage from './features/body-article/pages/BodyArticleDetailPage'; // Body Article detail view
import POPresentationPage from './features/po-presentation/pages/POPresentationPage'; // PO Presentation
import ModelGenerationPage from './features/model-generation/pages/ModelGenerationPage';

// Shared Components
import { ErrorBoundary } from './shared/components/ErrorBoundary';
import { SentryTest } from './components/SentryTest';
import { Toaster } from './shared/components/ui-tw';

// Global Styles
import './styles/App.css';
import './styles/index.css';

// Route Guards
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const token = localStorage.getItem('authToken');
  const user  = localStorage.getItem('user');

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  // PD_DESIGNER only has access to model-generation
  if (user) {
    const userData = JSON.parse(user);
    if (userData.role === 'PD_DESIGNER') {
      return <Navigate to="/model-generation" replace />;
    }
  }

  return <>{children}</>;
};

const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const token = localStorage.getItem('authToken');
  const user = localStorage.getItem('user');

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (user) {
    const userData = JSON.parse(user);
    if (userData.role !== 'ADMIN') {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return <>{children}</>;
};

const ApproverRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const token = localStorage.getItem('authToken');
  const user = localStorage.getItem('user');

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (user) {
    const userData = JSON.parse(user);
    // Allow ADMIN, APPROVER, CATEGORY_HEAD, SUB_DIVISION_HEAD, CREATOR, PO_COMMITTEE or PD
    if (userData.role !== 'APPROVER' && userData.role !== 'CATEGORY_HEAD' && userData.role !== 'SUB_DIVISION_HEAD' && userData.role !== 'ADMIN' && userData.role !== 'CREATOR' && userData.role !== 'PO_COMMITTEE' && userData.role !== 'PD') {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return <>{children}</>;
};


const CreatorRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const token = localStorage.getItem('authToken');
  const user = localStorage.getItem('user');

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (user) {
    const userData = JSON.parse(user);
    // APPROVER and CATEGORY_HEAD cannot access creator pages; SUB_DIVISION_HEAD can
    if (userData.role === 'APPROVER' || userData.role === 'CATEGORY_HEAD') {
      return <Navigate to="/approver" replace />;
    }
    if (userData.role === 'PD') {
      return <Navigate to="/approver" replace />;
    }
    // PD_DESIGNER only has access to model-generation
    if (userData.role === 'PD_DESIGNER') {
      return <Navigate to="/model-generation" replace />;
    }
  }

  return <>{children}</>;
};

// Extraction page — same access as CreatorRoute, but APPROVER is also allowed.
const ExtractionRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const token = localStorage.getItem('authToken');
  const user  = localStorage.getItem('user');

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (user) {
    const userData = JSON.parse(user);
    // CATEGORY_HEAD has no extraction access; PD_DESIGNER is single-purpose.
    // APPROVER is explicitly allowed (in addition to the creator-side roles).
    if (userData.role === 'CATEGORY_HEAD') {
      return <Navigate to="/approver" replace />;
    }
    if (userData.role === 'PD_DESIGNER') {
      return <Navigate to="/model-generation" replace />;
    }
  }

  return <>{children}</>;
};

// PD_DESIGNER, ADMIN, CREATOR, APPROVER — model-generation page
const ModelGenerationRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const token = localStorage.getItem('authToken');
  const user  = localStorage.getItem('user');

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (user) {
    const userData = JSON.parse(user);
    const allowed = ['PD_DESIGNER', 'ADMIN', 'CREATOR', 'APPROVER'];
    if (!allowed.includes(userData.role)) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return <>{children}</>;
};

const App: React.FC = () => {
  return (
    <AppProviders>
      <ErrorBoundary>
        <Toaster />
        <Router>
            <Routes>
              {/* Public Routes - No MainLayout */}
              <Route path="/" element={<Navigate to="/login" replace />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />

              {/* Sentry Test Route (Development Only - Remove or protect in production) */}
              {import.meta.env.MODE === 'development' && (
                <Route path="/sentry-test" element={<SentryTest />} />
              )}

              {/* Protected Routes - With MainLayout */}
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <MainLayout>
                      <DashboardPage />
                    </MainLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/products"
                element={
                  <CreatorRoute>
                    <MainLayout>
                      <ProductsPage />
                    </MainLayout>
                  </CreatorRoute>
                }
              />
              <Route
                path="/extraction"
                element={<Navigate to="/extraction/fg-article" replace />}
              />

              <Route
                path="/extraction/simplified"
                element={
                  <ExtractionRoute>
                    <MainLayout>
                      <SimplifiedExtractionPage />
                    </MainLayout>
                  </ExtractionRoute>
                }
              />
              <Route
                path="/extraction/fg-article"
                element={
                  <ExtractionRoute>
                    <MainLayout>
                      <SimplifiedExtractionPage />
                    </MainLayout>
                  </ExtractionRoute>
                }
              />
              <Route
                path="/extraction/fabric-article"
                element={
                  <ExtractionRoute>
                    <MainLayout>
                      <FabricExtractionPage />
                    </MainLayout>
                  </ExtractionRoute>
                }
              />
              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <MainLayout>
                      <ProfilePage />
                    </MainLayout>
                  </ProtectedRoute>
                }
              />

              {/* Admin Routes - With MainLayout */}
              <Route
                path="/admin"
                element={
                  <AdminRoute>
                    <MainLayout>
                      <Admin />
                    </MainLayout>
                  </AdminRoute>
                }
              />
              <Route
                path="/admin/dashboard"
                element={
                  <AdminRoute>
                    <MainLayout>
                      <Admin />
                    </MainLayout>
                  </AdminRoute>
                }
              />
              <Route
                path="/admin/hierarchy"
                element={
                  <AdminRoute>
                    <MainLayout>
                      <HierarchyManagement />
                    </MainLayout>
                  </AdminRoute>
                }
              />
              <Route
                path="/admin/users"
                element={
                  <AdminRoute>
                    <MainLayout>
                      <UsersManagement />
                    </MainLayout>
                  </AdminRoute>
                }
              />
              <Route
                path="/admin/expenses"
                element={
                  <AdminRoute>
                    <MainLayout>
                      <Admin />
                    </MainLayout>
                  </AdminRoute>
                }
              />
              <Route
                path="/admin/srm-failed"
                element={
                  <AdminRoute>
                    <MainLayout>
                      <SrmFailedExtractionsPage />
                    </MainLayout>
                  </AdminRoute>
                }
              />
              <Route
                path="/admin/ksml-uploader"
                element={
                  <AdminRoute>
                    <MainLayout>
                      <KsmlUploaderPage />
                    </MainLayout>
                  </AdminRoute>
                }
              />
              <Route
                path="/admin/poolb-uploader"
                element={
                  <AdminRoute>
                    <MainLayout>
                      <PoolBUploaderPage />
                    </MainLayout>
                  </AdminRoute>
                }
              />
              <Route
                path="/admin/modify-logs"
                element={
                  <AdminRoute>
                    <MainLayout>
                      <ModificationLogsPage />
                    </MainLayout>
                  </AdminRoute>
                }
              />
              <Route
                path="/admin/status-dashboard"
                element={
                  <AdminRoute>
                    <MainLayout>
                      <StatusDashboard />
                    </MainLayout>
                  </AdminRoute>
                }
              />

              {/* Approver Routes - With MainLayout */}
              <Route
                path="/approver"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <ApproverDashboard key="new-articles" pathType="new" />
                    </MainLayout>
                  </ApproverRoute>
                }
              />
              <Route
                path="/approver/:id"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <ArticleDetailPage />
                    </MainLayout>
                  </ApproverRoute>
                }
              />
              <Route
                path="/approver/old-articles"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <ApproverDashboard key="old-articles" pathType="old" />
                    </MainLayout>
                  </ApproverRoute>
                }
              />
              <Route
                path="/approver/old-articles/:id"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <ArticleDetailPage />
                    </MainLayout>
                  </ApproverRoute>
                }
              />
              <Route
                path="/approver/rejected"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <ApproverDashboard key="rejected-articles" pathType="rejected" />
                    </MainLayout>
                  </ApproverRoute>
                }
              />
              <Route
                path="/approver/rejected/:id"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <ArticleDetailPage />
                    </MainLayout>
                  </ApproverRoute>
                }
              />
              <Route
                path="/approver/created"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <ApproverDashboard key="created-articles" pathType="created" />
                    </MainLayout>
                  </ApproverRoute>
                }
              />
              <Route
                path="/approver/created/:id"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <ArticleDetailPage />
                    </MainLayout>
                  </ApproverRoute>
                }
              />
              <Route
                path="/approver/failed"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <ApproverDashboard key="failed-articles" pathType="failed" />
                    </MainLayout>
                  </ApproverRoute>
                }
              />
              <Route
                path="/approver/failed/:id"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <ArticleDetailPage />
                    </MainLayout>
                  </ApproverRoute>
                }
              />


              {/* Fabric Article Routes - With MainLayout */}
              <Route
                path="/fabric-article"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <FabricArticleDashboard key="fabric-new-articles" pathType="new" />
                    </MainLayout>
                  </ApproverRoute>
                }
              />
              <Route
                path="/fabric-article/:id"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <FabricArticleDetailPage />
                    </MainLayout>
                  </ApproverRoute>
                }
              />
              <Route
                path="/fabric-article/old-articles"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <FabricArticleDashboard key="fabric-old-articles" pathType="old" />
                    </MainLayout>
                  </ApproverRoute>
                }
              />
              <Route
                path="/fabric-article/old-articles/:id"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <FabricArticleDetailPage />
                    </MainLayout>
                  </ApproverRoute>
                }
              />
              <Route
                path="/fabric-article/rejected"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <FabricArticleDashboard key="fabric-rejected-articles" pathType="rejected" />
                    </MainLayout>
                  </ApproverRoute>
                }
              />
              <Route
                path="/fabric-article/rejected/:id"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <FabricArticleDetailPage />
                    </MainLayout>
                  </ApproverRoute>
                }
              />
              <Route
                path="/fabric-article/created"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <FabricArticleDashboard key="fabric-created-articles" pathType="created" />
                    </MainLayout>
                  </ApproverRoute>
                }
              />
              <Route
                path="/fabric-article/created/:id"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <FabricArticleDetailPage />
                    </MainLayout>
                  </ApproverRoute>
                }
              />
              <Route
                path="/fabric-article/failed"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <FabricArticleDashboard key="fabric-failed-articles" pathType="failed" />
                    </MainLayout>
                  </ApproverRoute>
                }
              />

              {/* Body Article Routes */}
              <Route
                path="/body-article"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <BodyArticleDashboard key="body-new-articles" pathType="new" />
                    </MainLayout>
                  </ApproverRoute>
                }
              />
              <Route
                path="/body-article/:id"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <BodyArticleDetailPage />
                    </MainLayout>
                  </ApproverRoute>
                }
              />
              <Route
                path="/body-article/old-articles"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <BodyArticleDashboard key="body-old-articles" pathType="old" />
                    </MainLayout>
                  </ApproverRoute>
                }
              />
              <Route
                path="/body-article/old-articles/:id"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <BodyArticleDetailPage />
                    </MainLayout>
                  </ApproverRoute>
                }
              />
              <Route
                path="/body-article/rejected"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <BodyArticleDashboard key="body-rejected-articles" pathType="rejected" />
                    </MainLayout>
                  </ApproverRoute>
                }
              />
              <Route
                path="/body-article/rejected/:id"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <BodyArticleDetailPage />
                    </MainLayout>
                  </ApproverRoute>
                }
              />
              <Route
                path="/body-article/created"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <BodyArticleDashboard key="body-created-articles" pathType="created" />
                    </MainLayout>
                  </ApproverRoute>
                }
              />
              <Route
                path="/body-article/created/:id"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <BodyArticleDetailPage />
                    </MainLayout>
                  </ApproverRoute>
                }
              />
              <Route
                path="/body-article/failed"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <BodyArticleDashboard key="body-failed-articles" pathType="failed" />
                    </MainLayout>
                  </ApproverRoute>
                }
              />
              <Route
                path="/body-article/failed/:id"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <BodyArticleDetailPage />
                    </MainLayout>
                  </ApproverRoute>
                }
              />

              {/* PO Presentation */}
              <Route
                path="/po-presentation"
                element={
                  <ApproverRoute>
                    <MainLayout>
                      <POPresentationPage />
                    </MainLayout>
                  </ApproverRoute>
                }
              />

              {/* Model Generation — PD_DESIGNER and ADMIN only */}
              <Route
                path="/model-generation"
                element={
                  <ModelGenerationRoute>
                    <MainLayout>
                      <ModelGenerationPage />
                    </MainLayout>
                  </ModelGenerationRoute>
                }
              />

              {/* Fallback */}
              <Route
                path="*"
                element={(() => {
                  const u = localStorage.getItem('user');
                  if (u && JSON.parse(u).role === 'PD_DESIGNER') {
                    return <Navigate to="/model-generation" replace />;
                  }
                  return <Navigate to="/dashboard" replace />;
                })()}
              />
            </Routes>
        </Router>
      </ErrorBoundary>
    </AppProviders>
  );
};

export default App;