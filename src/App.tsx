import { Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import BrowserThemeSync from './components/BrowserThemeSync';
import ErrorBoundary from './components/ErrorBoundary';
import Home from './pages/Home';
import StoryPage from './pages/StoryPage';
import Login from './pages/Login';
import AuthCallback from './pages/AuthCallback';
import Profile from './pages/Profile';
import Billing from './pages/Billing';
import Explore from './pages/Explore';
import Admin from './pages/Admin';

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserThemeSync />
      <Header />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/explore" element={<Explore />} />
        <Route path="/story/:id" element={<StoryPage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </ErrorBoundary>
  );
}
