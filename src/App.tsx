import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import StoryPage from './pages/StoryPage';
import Login from './pages/Login';
import AuthCallback from './pages/AuthCallback';
import Profile from './pages/Profile';
import Header from './components/Header';
import ErrorBoundary from './components/ErrorBoundary';

export default function App() {
  return (
    <ErrorBoundary>
      <Header />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/story/:id" element={<StoryPage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/profile" element={<Profile />} />
      </Routes>
    </ErrorBoundary>
  );
}
