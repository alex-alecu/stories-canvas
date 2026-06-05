import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import Footer from './components/Footer';
import MarketingConsentBanner from './components/MarketingConsentBanner';
import MarketingRouteTracker from './components/MarketingRouteTracker';
import BrowserThemeSync from './components/BrowserThemeSync';
import ErrorBoundary from './components/ErrorBoundary';
import Home from './pages/Home';
import StoryPage from './pages/StoryPage';

const LegalPage = lazy(() => import('./pages/LegalPage'));
const Login = lazy(() => import('./pages/Login'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const Profile = lazy(() => import('./pages/Profile'));
const Billing = lazy(() => import('./pages/Billing'));
const Explore = lazy(() => import('./pages/Explore'));
const Admin = lazy(() => import('./pages/Admin'));

function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-12 h-12 rounded-full border-4 border-primary-300 dark:border-primary-700 border-t-primary-600 dark:border-t-primary-400 animate-spin" />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserThemeSync />
      <MarketingRouteTracker />
      <Header />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/story/:id" element={<StoryPage />} />
          <Route path="/login" element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/billing" element={<Billing />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/legal/terms" element={<LegalPage routeKey="terms" />} />
          <Route path="/legal/privacy" element={<LegalPage routeKey="privacy" />} />
          <Route path="/legal/cookies" element={<LegalPage routeKey="cookies" />} />
          <Route path="/legal/withdrawal-refunds" element={<LegalPage routeKey="withdrawalRefunds" />} />
          <Route path="/legal/consumer-protection" element={<LegalPage routeKey="consumerProtection" />} />
          <Route path="/legal/contact" element={<LegalPage routeKey="contact" />} />
        </Routes>
      </Suspense>
      <Footer />
      <MarketingConsentBanner />
    </ErrorBoundary>
  );
}
